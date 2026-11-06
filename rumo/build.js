// Build script do Rumo — gera a pasta dist/ com todos os arquivos estáticos.
// Também troca os marcadores {{CHAVE}} das páginas pelos dados da empresa (empresa.json).
const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const out = path.join(root, 'dist');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

// ---- Dados da empresa (empresa.json) ----
let empresa = {};
try { empresa = JSON.parse(fs.readFileSync(path.join(root, 'empresa.json'), 'utf8')); }
catch (e) { console.warn('Aviso: empresa.json não encontrado ou inválido. Os dados legais ficarão como [PREENCHER].'); }
const faltando = new Set();
const meses = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const dataExtenso = (iso) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${+m[3]} de ${meses[+m[2] - 1]} de ${m[1]}` : iso; };
empresa.DATA_DOCUMENTOS = dataExtenso(empresa.VERSAO_DOCUMENTOS);

// Preços e teste grátis vêm das mesmas variáveis de ambiente que a cobrança usa (api/_lib.js), para os textos legais nunca divergirem do valor cobrado.
const BRL = (n) => 'R$ ' + n.toFixed(2).replace('.', ',');
const mensal = Number(process.env.PLAN_VALUE || 5.9);
const anual = Number(process.env.PLAN_VALUE_ANUAL || mensal * 10);
empresa.PRECO_MENSAL = BRL(mensal);
empresa.PRECO_ANUAL = BRL(anual);
empresa.MESES_GRATIS_ANUAL = String(Math.max(0, Math.round(12 - anual / mensal)));
empresa.TESTE_DIAS = String(process.env.TRIAL_DAYS ?? 7);
const ANO = String(new Date().getFullYear());
empresa.ANO = ANO;

function injetar(txt) {
  return txt.replace(/\{\{([A-Z_]+)\}\}/g, (all, k) => {
    const v = empresa[k];
    if (v === undefined || v === null || String(v).trim() === '') { faltando.add(k); return `[PREENCHER: ${k}]`; }
    return String(v);
  });
}
function copiar(from, to) {
  if (/\.(html|txt|xml)$/i.test(from)) fs.writeFileSync(to, injetar(fs.readFileSync(from, 'utf8')));
  else fs.copyFileSync(from, to);
}

// Arquivos estáticos raiz
const statics = [
  'index.html', 'favicon.png', 'privacidade.html', 'termos.html', 'cookies.html', 'reembolso.html',
  'acessibilidade.html', 'empresa.html', 'blog.html', 'login.html', 'registro.html', 'convite.html',
  'legal.css', 'consentimento.js', 'sitemap.xml', 'robots.txt', 'llms.txt',
];

for (const file of statics) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) {
    if (file === 'index.html') { console.error('ERRO: index.html não encontrado.'); process.exit(1); }
    console.warn('Aviso: ' + file + ' não encontrado, pulando.');
    continue;
  }
  copiar(from, path.join(out, file));
}

// Arquivos de verificação do Google Search Console (google<código>.html) precisam ir para a raiz do site
for (const file of fs.readdirSync(root)) {
  if (/^google[0-9a-f]+\.html$/i.test(file)) {
    fs.copyFileSync(path.join(root, file), path.join(out, file));
    console.log('Verificação do Google copiada: ' + file);
  }
}

// Copia diretório de artigos recursivamente
const artigosIn  = path.join(root, 'artigos');
const artigosOut = path.join(out, 'artigos');
if (fs.existsSync(artigosIn)) {
  fs.mkdirSync(artigosOut, { recursive: true });
  for (const file of fs.readdirSync(artigosIn)) {
    if (file.endsWith('.html')) copiar(path.join(artigosIn, file), path.join(artigosOut, file));
  }
  console.log('Artigos copiados: ' + fs.readdirSync(artigosOut).length + ' arquivo(s).');
}

if (faltando.size) {
  console.warn('\n⚠️  ATENÇÃO: preencha estes campos em empresa.json antes de abrir o site ao público:\n   ' + [...faltando].join(', ') + '\n   (sem isso as páginas legais mostram [PREENCHER: ...] na tela)\n');
}
console.log('Rumo static site built into dist/');
