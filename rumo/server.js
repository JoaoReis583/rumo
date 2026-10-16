// Rumo — servidor + banco de dados SQLite. Sem dependências externas (Node >= 22.5).
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PROD = process.env.NODE_ENV === 'production';
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // ligue atrás de Nginx/Caddy/Render/Railway etc.
const SESSION_DAYS = 30;
const scrypt = promisify(crypto.scrypt);

/* ---------- Categorias (mesmas do front-end) ---------- */
const DEFAULTS = { mor: 30, ali: 15, tra: 10, sau: 5, res: 15, inv: 10, edu: 5, laz: 10 };
const CAT_IDS = Object.keys(DEFAULTS);

/* ---------- Banco de dados ---------- */
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'rumo.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');

const MIGRATIONS = [
  `CREATE TABLE users (
     id            INTEGER PRIMARY KEY,
     email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
     name          TEXT NOT NULL,
     password_hash TEXT NOT NULL,
     created_at    INTEGER NOT NULL DEFAULT (unixepoch())
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL DEFAULT (unixepoch()),
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX idx_sessions_user ON sessions(user_id);
   CREATE INDEX idx_sessions_exp  ON sessions(expires_at);
   CREATE TABLE budgets (
     user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     income_cents INTEGER NOT NULL DEFAULT 0 CHECK (income_cents >= 0),
     updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
   );
   CREATE TABLE allocations (
     user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     category_id TEXT    NOT NULL,
     percent     INTEGER NOT NULL CHECK (percent BETWEEN 0 AND 100),
     PRIMARY KEY (user_id, category_id)
   ) WITHOUT ROWID;`,
  // Próximas mudanças de estrutura: adicione novos itens aqui (nunca edite os antigos).
];
(function migrate() {
  let v = db.prepare('PRAGMA user_version').get().user_version;
  for (; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[v]); db.exec(`PRAGMA user_version = ${v + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
})();

const q = {
  userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
  insertUser: db.prepare('INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(`SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON u.id = s.user_id
                           WHERE s.token_hash = ? AND s.expires_at > unixepoch()`),
  delSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= unixepoch()'),
  getBudget: db.prepare('SELECT income_cents FROM budgets WHERE user_id = ?'),
  getAlloc: db.prepare('SELECT category_id, percent FROM allocations WHERE user_id = ?'),
  upBudget: db.prepare(`INSERT INTO budgets (user_id, income_cents, updated_at) VALUES (?, ?, unixepoch())
                        ON CONFLICT(user_id) DO UPDATE SET income_cents = excluded.income_cents, updated_at = unixepoch()`),
  upAlloc: db.prepare(`INSERT INTO allocations (user_id, category_id, percent) VALUES (?, ?, ?)
                       ON CONFLICT(user_id, category_id) DO UPDATE SET percent = excluded.percent`),
  delUser: db.prepare('DELETE FROM users WHERE id = ?'),
};
setInterval(() => { try { q.purgeSessions.run(); } catch {} }, 3600_000).unref();

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/* ---------- Senhas e sessões ---------- */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, s, k] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = await scrypt(pw, Buffer.from(s, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const exp = Buffer.from(k, 'base64');
  return key.length === exp.length && crypto.timingSafeEqual(key, exp);
}
const DUMMY_HASH = await hashPassword('senha-falsa-para-igualar-tempo'); // evita descobrir e-mails pelo tempo de resposta
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  q.insertSession.run(sha256(token), userId, Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400);
  return token;
}
const cookieOpts = () => `Path=/; HttpOnly; SameSite=Lax${PROD ? '; Secure' : ''}`;
const setSessionCookie = (res, token) =>
  res.setHeader('Set-Cookie', `rumo_sid=${token}; Max-Age=${SESSION_DAYS * 86400}; ${cookieOpts()}`);
const clearSessionCookie = (res) => res.setHeader('Set-Cookie', `rumo_sid=; Max-Age=0; ${cookieOpts()}`);
function getToken(req) {
  const m = /(?:^|;\s*)rumo_sid=([^;]+)/.exec(req.headers.cookie || '');
  return m ? m[1] : null;
}
function authUser(req) {
  const t = getToken(req);
  return t ? q.sessionUser.get(sha256(t)) || null : null;
}

/* ---------- Limite de tentativas (em memória) ---------- */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const h = hits.get(key);
  if (!h || h.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return false; }
  return ++h.n > max;
}
setInterval(() => { const n = Date.now(); for (const [k, v] of hits) if (v.reset < n) hits.delete(k); }, 600_000).unref();
const clientIp = (req) =>
  (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

/* ---------- Utilidades HTTP ---------- */
const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  ...(PROD && { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' }),
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SEC_HEADERS, ...headers });
  res.end(body);
}
const json = (res, status, obj) =>
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function readJson(req, limit = 8192) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/i.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'Formato inválido.'));
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new HttpError(413, 'Requisição grande demais.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { reject(new HttpError(400, 'JSON inválido.')); } });
    req.on('error', reject);
  });
}

/* ---------- Regras de negócio ---------- */
function loadBudget(userId) {
  const b = q.getBudget.get(userId);
  const pcts = { ...DEFAULTS };
  for (const r of q.getAlloc.all(userId)) if (r.category_id in pcts) pcts[r.category_id] = r.percent;
  return { income: b ? b.income_cents / 100 : 0, pcts };
}
function validEmail(e) { return typeof e === 'string' && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

const routes = {
  'POST /api/register': async (req, res) => {
    const ip = clientIp(req);
    if (limited(`reg:${ip}`, 10, 3600_000)) throw new HttpError(429, 'Muitas tentativas. Tente novamente mais tarde.');
    const { email, password, name } = await readJson(req);
    const mail = String(email || '').trim().toLowerCase(), nm = String(name || '').trim();
    if (!validEmail(mail)) throw new HttpError(400, 'Digite um e-mail válido, como nome@email.com.');
    if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw new HttpError(400, 'A senha precisa ter de 8 a 200 caracteres.');
    if (!nm || nm.length > 80) throw new HttpError(400, 'Informe seu nome para criar a conta.');
    if (q.userByEmail.get(mail)) throw new HttpError(409, 'Este e-mail já tem conta. Use a aba Entrar.');
    const hash = await hashPassword(password);
    let id;
    try { id = Number(q.insertUser.run(mail, nm, hash).lastInsertRowid); }
    catch { throw new HttpError(409, 'Este e-mail já tem conta. Use a aba Entrar.'); }
    setSessionCookie(res, createSession(id));
    json(res, 201, { ok: true });
  },

  'POST /api/login': async (req, res) => {
    const { email, password } = await readJson(req);
    const mail = String(email || '').trim().toLowerCase();
    if (limited(`login:${clientIp(req)}:${mail}`, 8, 15 * 60_000)) throw new HttpError(429, 'Muitas tentativas. Aguarde alguns minutos.');
    const u = validEmail(mail) ? q.userByEmail.get(mail) : null;
    const ok = await verifyPassword(String(password || '').slice(0, 200), u ? u.password_hash : DUMMY_HASH);
    if (!u || !ok) throw new HttpError(401, 'E-mail ou senha incorretos. Confira e tente de novo.');
    setSessionCookie(res, createSession(u.id));
    json(res, 200, { ok: true });
  },

  'POST /api/logout': async (req, res) => {
    const t = getToken(req);
    if (t) q.delSession.run(sha256(t));
    clearSessionCookie(res);
    json(res, 200, { ok: true });
  },

  'GET /api/me': async (req, res) => {
    const u = authUser(req);
    if (!u) throw new HttpError(401, 'Não autenticado.');
    json(res, 200, { user: { name: u.name, email: u.email }, budget: loadBudget(u.id) });
  },

  'PUT /api/budget': async (req, res) => {
    const u = authUser(req);
    if (!u) throw new HttpError(401, 'Não autenticado.');
    const { income, pcts } = await readJson(req);
    if (typeof income !== 'number' || !Number.isFinite(income) || income < 0 || income > 1e9) throw new HttpError(400, 'Renda inválida.');
    if (!pcts || typeof pcts !== 'object') throw new HttpError(400, 'Divisão inválida.');
    const clean = {};
    for (const id of CAT_IDS) {
      const p = pcts[id];
      if (!Number.isInteger(p) || p < 0 || p > 100) throw new HttpError(400, 'Percentual inválido.');
      clean[id] = p;
    }
    tx(() => {
      q.upBudget.run(u.id, Math.round(income * 100));
      for (const id of CAT_IDS) q.upAlloc.run(u.id, id, clean[id]);
    });
    json(res, 200, { ok: true });
  },

  // Exclusão da conta e de todos os dados (LGPD). Exige a senha.
  'DELETE /api/me': async (req, res) => {
    const u = authUser(req);
    if (!u) throw new HttpError(401, 'Não autenticado.');
    const { password } = await readJson(req);
    const row = q.userByEmail.get(u.email);
    if (!(await verifyPassword(String(password || '').slice(0, 200), row.password_hash))) throw new HttpError(401, 'Senha incorreta.');
    q.delUser.run(u.id);
    clearSessionCookie(res);
    json(res, 200, { ok: true });
  },
};

/* ---------- Servidor ---------- */
const INDEX = path.join(__dirname, 'public', 'index.html');
const server = http.createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://x');
    if (pathname.startsWith('/api/')) {
      const h = routes[`${req.method} ${pathname}`];
      if (!h) throw new HttpError(404, 'Não encontrado.');
      return await h(req, res);
    }
    if (pathname === '/healthz') return json(res, 200, { ok: true });
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Método não permitido.');
    if (pathname === '/' || pathname === '/index.html') {
      return send(res, 200, req.method === 'HEAD' ? undefined : fs.readFileSync(INDEX), {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache',
      });
    }
    throw new HttpError(404, 'Não encontrado.');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    if (res.headersSent) return res.end();
    json(res, e.status || 500, { error: e instanceof HttpError ? e.message : 'Erro interno. Tente novamente.' });
  }
});
server.requestTimeout = 15_000;
server.listen(PORT, () => console.log(`Rumo rodando em http://localhost:${PORT}  (dados em ${DATA_DIR})`));

const stop = () => { server.close(() => { try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); db.close(); } catch {} process.exit(0); }); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
