// Funções compartilhadas pelas rotas /api (servidor, nunca vai para o navegador).
const crypto = require('node:crypto');

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

let _admin;
function admin() {
  if (_admin) return _admin;
  const a = require('firebase-admin');
  if (!a.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new HttpError(500, 'FIREBASE_SERVICE_ACCOUNT não configurada');
    const sa = JSON.parse(raw);
    if (sa.private_key) sa.private_key = sa.private_key.replace(/\\n/g, '\n');
    a.initializeApp({ credential: a.credential.cert(sa) });
  }
  return (_admin = a);
}
const db = () => admin().firestore();
const ts = (d) => admin().firestore.Timestamp.fromDate(d);

const CFG = () => ({
  url: (process.env.ASAAS_API_URL || 'https://api.asaas.com/v3').replace(/\/$/, ''),
  key: process.env.ASAAS_API_KEY,
  value: Number(process.env.PLAN_VALUE || 14.9),
  trialDays: Number(process.env.TRIAL_DAYS ?? 7),
  paidDays: 31,
});

async function asaas(method, path, body) {
  const c = CFG();
  if (!c.key) throw new HttpError(500, 'ASAAS_API_KEY não configurada');
  const r = await fetch(c.url + path, {
    method,
    headers: { 'Content-Type': 'application/json', access_token: c.key, 'User-Agent': 'Rumo' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Asaas', method, path, r.status, JSON.stringify(j));
    const m = j.errors && j.errors[0] && j.errors[0].description;
    throw new HttpError(r.status === 401 || r.status === 403 ? 500 : 400, m || 'Falha ao falar com o Asaas.');
  }
  return j;
}

// Datas em horário de Brasília, formato AAAA-MM-DD.
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const addDays = (ymd, n) => { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const endOfDay = (ymd) => new Date(ymd + 'T23:59:59-03:00');

async function requireUser(req) {
  const h = req.headers.authorization || '';
  const m = /^Bearer (.+)$/.exec(h);
  if (!m) throw new HttpError(401, 'Entre na sua conta para continuar.');
  try { return await admin().auth().verifyIdToken(m[1]); }
  catch (e) { throw new HttpError(401, 'Sessão expirada. Entre de novo.'); }
}

function handler(method, fn) {
  return async (req, res) => {
    try {
      if (req.method !== method) { res.setHeader('Allow', method); return res.status(405).json({ error: 'Método não permitido.' }); }
      const out = await fn(req, res);
      if (!res.writableEnded) res.status(200).json(out || { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      if (!res.writableEnded) res.status(status).json({ error: status === 500 && !(e instanceof HttpError) ? 'Erro interno. Tente novamente.' : e.message });
    }
  };
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { HttpError, admin, db, ts, CFG, asaas, today, addDays, endOfDay, requireUser, handler, safeEqual };
