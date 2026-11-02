// POST /api/perfil { acao, ... } — dados de cadastro (nascimento + CPF), autorização de menores e monitoramento.
//
// acao: 'obter'       → situação do cadastro da pessoa logada + pedidos/dependentes se ela for responsável
// acao: 'salvar'      → { nascimento: 'YYYY-MM-DD', cpf } valida o CPF de verdade (Receita Federal) e grava o perfil
// acao: 'responsavel' → { email } (só menor de 18) pede autorização a uma conta de maior já cadastrada no Rumo
// acao: 'decidir'     → { menor_uid, aceitar } o responsável aceita/recusa (ou revoga) no painel dele
// acao: 'monitorar'   → { menor_uid } números agregados do dependente aprovado (sem descrição dos lançamentos)
//
// Coleções (só o servidor escreve; as regras do Firestore deixam apenas a própria pessoa ler `profiles/{uid}`):
//   profiles/{uid}   nome, birth_date, cpf_hash, is_minor, can_use, guardian_*, ...
//   cpf_index/{hash} { uid }  → impede o mesmo CPF em duas contas
const {
  HttpError, db, ts, admin, requireUser, bodyOf, rateLimit, handler,
  MAIOR_IDADE, soDigitos, cpfValido, hojeBR, dataIsoValida, idadeEm, cpfHash, verificarCpfReal,
} = require('./_lib');

const MAX_ERROS_CPF_DIA = 5; // trava por conta: evita usar a tela como "adivinhador" de data de nascimento

const maskEmail = (e) => {
  const [u, d] = String(e || '').split('@');
  return u ? u[0] + '***@' + d : '';
};

const profRef = (uid) => db().collection('profiles').doc(uid);

// Pode ser responsável: conta com e-mail confirmado, cadastro completo e maior de idade.
async function checarResponsavel(uid, emailVerificado) {
  if (!emailVerificado) throw new HttpError(403, 'Confirme seu e-mail (link que enviamos) antes de autorizar um menor.');
  const p = (await profRef(uid).get()).data();
  if (!p || !p.birth_date || p.is_minor || !p.can_use) throw new HttpError(403, 'Só uma conta de maior de idade, com cadastro completo, pode autorizar.');
  return p;
}

// Lê o perfil e, se o menor fez 18 anos, libera sozinho (sem precisar de responsável).
async function lerPerfil(uid) {
  const ref = profRef(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  let p = snap.data();
  if (p.is_minor && idadeEm(p.birth_date) >= MAIOR_IDADE) {
    const upd = { is_minor: false, can_use: true, guardian_status: 'none', updated_at: ts(new Date()) };
    await ref.set(upd, { merge: true });
    p = { ...p, ...upd };
  }
  return p;
}

function resumoPerfil(p) {
  if (!p) return { completo: false };
  return {
    completo: true,
    menor: !!p.is_minor,
    can_use: !!p.can_use,
    responsavel: p.is_minor ? { email: maskEmail(p.guardian_email), status: p.guardian_status || 'none' } : null,
  };
}

// Pedidos e dependentes de quem é responsável
async function dependentesDe(uid) {
  const q = await db().collection('profiles').where('guardian_uid', '==', uid).get();
  const pendentes = [], aprovados = [];
  for (const d of q.docs) {
    const p = d.data();
    const item = { uid: d.id, nome: p.nome || 'Sem nome', idade: p.birth_date ? idadeEm(p.birth_date) : null };
    if (!p.is_minor) continue;
    if (p.guardian_status === 'pending') pendentes.push(item);
    else if (p.guardian_status === 'approved') aprovados.push(item);
  }
  return { pendentes, aprovados };
}

async function aprovadoDoResponsavel(uid, menorUid) {
  const p = (await profRef(String(menorUid || '')).get()).data();
  if (!p || !p.is_minor || p.guardian_uid !== uid || p.guardian_status !== 'approved') throw new HttpError(403, 'Você não tem autorização para ver esta conta.');
  return p;
}

module.exports = handler('POST', async (req) => {
  const u = await requireUser(req);
  const { acao } = bodyOf(req);
  const b = bodyOf(req);

  if (acao === 'obter') {
    const p = await lerPerfil(u.uid);
    const dep = await dependentesDe(u.uid);
    return { ...resumoPerfil(p), dependentes_pendentes: dep.pendentes, dependentes_aprovados: dep.aprovados };
  }

  if (acao === 'salvar') {
    await rateLimit(req, 'perfil-salvar', 10, 60 * 60 * 1000);
    if ((await profRef(u.uid).get()).exists) throw new HttpError(409, 'Seu cadastro já foi concluído.');
    const nascimento = String(b.nascimento || '');
    const cpf = soDigitos(b.cpf);
    if (!dataIsoValida(nascimento)) throw new HttpError(400, 'Data de nascimento inválida.');
    const hoje = hojeBR();
    if (nascimento > hoje) throw new HttpError(400, 'A data de nascimento não pode ser no futuro.');
    const idade = idadeEm(nascimento);
    if (idade > 120) throw new HttpError(400, 'Data de nascimento inválida.');
    if (!cpfValido(cpf)) throw new HttpError(400, 'CPF inválido. Confira os números.');

    const hash = cpfHash(cpf);
    const idxRef = db().collection('cpf_index').doc(hash);
    const idx = await idxRef.get();
    if (idx.exists && idx.data().uid !== u.uid) throw new HttpError(409, 'Este CPF já está cadastrado em outra conta.');

    // Trava de erros por conta/dia (a consulta custa dinheiro e não pode virar adivinhador de datas)
    const tRef = db().collection('cpf_tentativas').doc(u.uid);
    const t = (await tRef.get()).data() || {};
    const erros = t.dia === hoje ? t.n || 0 : 0;
    if (erros >= MAX_ERROS_CPF_DIA) throw new HttpError(429, 'Muitas tentativas com dados que não conferem. Tente novamente amanhã.');

    let real;
    try { real = await verificarCpfReal(cpf, nascimento); }
    catch (e) {
      if (e instanceof HttpError && e.status === 422) await tRef.set({ dia: hoje, n: erros + 1 });
      throw e;
    }

    const menor = idade < MAIOR_IDADE;
    const agora = ts(new Date());
    await db().runTransaction(async (tx) => {
      const i = await tx.get(idxRef);
      if (i.exists && i.data().uid !== u.uid) throw new HttpError(409, 'Este CPF já está cadastrado em outra conta.');
      tx.set(idxRef, { uid: u.uid, created_at: agora });
      tx.set(profRef(u.uid), {
        uid: u.uid,
        nome: u.name || real.nome || null,
        birth_date: nascimento,
        cpf_hash: hash,
        cpf_verificado_em: agora,
        is_minor: menor,
        can_use: !menor,
        guardian_status: 'none',
        created_at: agora,
        updated_at: agora,
      });
    });
    return resumoPerfil((await profRef(u.uid).get()).data());
  }

  if (acao === 'responsavel') {
    await rateLimit(req, 'perfil-responsavel', 15, 60 * 60 * 1000);
    const p = await lerPerfil(u.uid);
    if (!p) throw new HttpError(400, 'Conclua primeiro seu cadastro (nascimento e CPF).');
    if (!p.is_minor) throw new HttpError(400, 'Sua conta não precisa de autorização.');
    const email = String(b.email || '').trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Digite um e-mail válido.');
    if (email === String(u.email || '').toLowerCase()) throw new HttpError(400, 'Use o e-mail da conta do seu responsável, não o seu.');

    let g;
    try { g = await admin().auth().getUserByEmail(email); }
    catch (e) { throw new HttpError(404, 'Não achamos uma conta do Rumo com esse e-mail. Seu responsável precisa criar a conta dele primeiro.'); }
    if (g.uid === u.uid) throw new HttpError(400, 'O responsável precisa ser outra pessoa.');
    try { await checarResponsavel(g.uid, g.emailVerified); }
    catch (e) { throw new HttpError(400, 'Essa conta não pode autorizar: precisa ser de uma pessoa maior de 18 anos, com cadastro completo e e-mail confirmado.'); }

    await profRef(u.uid).set({
      guardian_email: email,
      guardian_uid: g.uid,
      guardian_status: 'pending',
      guardian_requested_at: ts(new Date()),
      can_use: false,
      updated_at: ts(new Date()),
    }, { merge: true });
    return resumoPerfil((await profRef(u.uid).get()).data());
  }

  if (acao === 'decidir') {
    const menorRef = profRef(String(b.menor_uid || ''));
    await checarResponsavel(u.uid, u.email_verified);
    const m = (await menorRef.get()).data();
    if (!m || !m.is_minor || m.guardian_uid !== u.uid || !['pending', 'approved'].includes(m.guardian_status)) throw new HttpError(404, 'Pedido não encontrado.');
    const aceitar = b.aceitar === true;
    if (aceitar && m.guardian_status === 'approved') return { ok: true };
    await menorRef.set({
      guardian_status: aceitar ? 'approved' : 'rejected',
      can_use: aceitar,
      guardian_decided_at: ts(new Date()),
      updated_at: ts(new Date()),
    }, { merge: true });
    return { ok: true, dependentes: await dependentesDe(u.uid) };
  }

  if (acao === 'monitorar') {
    await checarResponsavel(u.uid, u.email_verified);
    const m = await aprovadoDoResponsavel(u.uid, b.menor_uid);
    const menorUid = String(b.menor_uid);
    const agora = new Date(Date.now() - 3 * 3600 * 1000);
    const mesAtual = agora.toISOString().slice(0, 7);
    const meses = [];
    for (let n = 5; n >= 0; n--) meses.push(new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - n, 1)).toISOString().slice(0, 7));
    const f = db();
    const [txs, bills, goals] = await Promise.all([
      f.collection(`users/${menorUid}/transactions`).where('tx_date', '>=', meses[0] + '-01').get(),
      f.collection(`users/${menorUid}/bills`).get(),
      f.collection(`users/${menorUid}/goals`).get(),
    ]);
    const porMes = Object.fromEntries(meses.map(k => [k, { k, inc: 0, out: 0 }]));
    const porCat = {};
    txs.forEach(d => {
      const t = d.data(), k = String(t.tx_date || '').slice(0, 7);
      if (!porMes[k]) return;
      if (t.kind === 'income') porMes[k].inc += t.amount_cents || 0;
      else {
        porMes[k].out += t.amount_cents || 0;
        if (k === mesAtual && t.cat) porCat[t.cat] = (porCat[t.cat] || 0) + (t.amount_cents || 0);
      }
    });
    // Só números e títulos de metas: as descrições dos lançamentos do menor continuam privadas.
    return {
      nome: m.nome || 'Dependente',
      idade: idadeEm(m.birth_date),
      mes_atual: mesAtual,
      meses: meses.map(k => porMes[k]),
      categorias: Object.entries(porCat).map(([cat, cents]) => ({ cat, cents })).sort((a, c) => c.cents - a.cents),
      contas: { qtd: bills.size, total_cents: bills.docs.reduce((s, d) => s + (d.data().amount_cents || 0), 0) },
      metas: goals.docs.map(d => { const g = d.data(); return { nome: g.name, alvo_cents: g.target_cents || 0, guardado_cents: g.saved_cents || 0 }; }),
    };
  }

  throw new HttpError(400, 'Ação desconhecida.');
});
