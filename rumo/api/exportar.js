// POST /api/exportar — exporta todos os dados do usuário em JSON (LGPD: portabilidade de dados).
// Retorna um JSON com todos os dados: usuário, lançamentos, contas fixas, metas e assinatura.
const { HttpError, db, requireUser, rateLimit, handler } = require('./_lib');

module.exports = handler('POST', async (req) => {
  // Rate limit: máximo 5 exportações por hora por IP
  await rateLimit(req, 'exportar', 5, 60 * 60 * 1000);

  const u = await requireUser(req);
  const uid = u.uid;
  const firestore = db();

  // Dados raiz do usuário
  const userDoc = await firestore.collection('users').doc(uid).get();
  const userData = userDoc.exists ? userDoc.data() : {};

  // Subcoleções
  const loadCol = async (col) => {
    const snap = await firestore.collection(`users/${uid}/${col}`).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  };

  const [transactions, bills, goals] = await Promise.all([
    loadCol('transactions'),
    loadCol('bills'),
    loadCol('goals'),
  ]);

  // Assinatura (apenas status e datas, sem dados de cartão — esses ficam só no Stripe)
  const subDoc = await firestore.collection('subscriptions').doc(uid).get();
  const sub = subDoc.exists ? subDoc.data() : null;

  // Cadastro (o CPF não é guardado em claro, só um código protegido)
  const perfilDoc = await firestore.collection('profiles').doc(uid).get();
  const perfil = perfilDoc.exists ? perfilDoc.data() : null;

  // Telefone confirmado (fica no Firebase Authentication)
  let telefone = null;
  try { telefone = (await require('./_lib').admin().auth().getUser(uid)).phoneNumber || null; } catch (e) { }
  const [budgetsSnap, histDoc, refDoc] = await Promise.all([
    firestore.collection(`users/${uid}/budgets`).get(),
    firestore.collection('ai_history').doc(uid).get(),
    firestore.collection('referrals').doc(uid).get(),
  ]);
  const tsIso = (v) => (v && v.toDate ? v.toDate().toISOString() : v || null);

  const exportData = {
    exportado_em: new Date().toISOString(),
    usuario: {
      uid,
      email: u.email || null,
      nome: u.name || null,
      telefone,
    },
    aceites_e_consentimentos: perfil ? {
      termos_aceitos_em: tsIso(perfil.terms_accepted_at),
      versao_dos_termos: perfil.terms_version || null,
      telefone_verificado_em: tsIso(perfil.phone_verified_at),
      consentimento_ia: perfil.consents && perfil.consents.ia ? { valor: !!perfil.consents.ia.valor, em: tsIso(perfil.consents.ia.em) } : null,
      consentimento_marketing: perfil.consents && perfil.consents.marketing ? { valor: !!perfil.consents.marketing.valor, em: tsIso(perfil.consents.marketing.em) } : null,
    } : null,
    orcamentos_mensais: budgetsSnap.docs.map(d => ({ mes: d.id, ...d.data() })),
    historico_assistente: histDoc.exists ? histDoc.data() : null,
    indicacoes: refDoc.exists ? { codigo: refDoc.data().codigo || null, amigos_indicados: refDoc.data().total || 0 } : null,
    cadastro: perfil ? {
      data_nascimento: perfil.birth_date,
      menor_de_idade: !!perfil.is_minor,
      responsavel_email: perfil.guardian_email || null,
      responsavel_status: perfil.guardian_status || null,
      cpf_verificado_em: perfil.cpf_verificado_em ? perfil.cpf_verificado_em.toDate().toISOString() : null,
    } : null,
    renda_e_planejamento: {
      renda_mensal_reais: userData.income_cents ? userData.income_cents / 100 : 0,
      divisao_percentual: userData.pcts || {},
    },
    lancamentos: transactions.map(t => ({
      id: t.id,
      tipo: t.kind === 'income' ? 'renda' : 'gasto',
      descricao: t.description,
      valor_reais: t.amount_cents / 100,
      categoria: t.cat || null,
      data: t.tx_date,
      criado_em: t.created_at,
    })),
    contas_fixas: bills.map(b => ({
      id: b.id,
      nome: b.name,
      valor_reais: b.amount_cents / 100,
      dia_vencimento: b.due_day,
      categoria: b.cat,
      criado_em: b.created_at,
    })),
    metas: goals.map(g => ({
      id: g.id,
      nome: g.name,
      valor_alvo_reais: g.target_cents / 100,
      valor_guardado_reais: g.saved_cents / 100,
      prazo: g.deadline || null,
      criado_em: g.created_at,
    })),
    assinatura: sub ? {
      status: sub.status,
      plano: sub.plan_interval || 'month',
      acesso_ate: sub.access_until ? sub.access_until.toDate().toISOString() : null,
      atualizado_em: sub.updated_at ? sub.updated_at.toDate().toISOString() : null,
    } : null,
  };

  return exportData;
});
