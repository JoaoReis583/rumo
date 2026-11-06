// POST /api/excluir-conta — exclui todos os dados do usuário do Firestore e a conta do Firebase Auth.
// LGPD: a pessoa tem direito de excluir a própria conta e todos os seus dados (art. 18, VI).
// Antes de apagar, cancela a assinatura no Stripe: sem isso o cartão da pessoa continuaria sendo cobrado depois da exclusão.
// O Stripe mantém faturas e registros de pagamento pelo prazo fiscal (5 anos), o que a Política de Privacidade informa.
const crypto = require('crypto');
const { HttpError, admin, db, stripe, requireUser, rateLimit, handler } = require('./_lib');

async function apagarColecao(firestore, caminho) {
  const snap = await firestore.collection(caminho).get();
  if (snap.empty) return;
  const batch = firestore.batch();
  snap.docs.forEach(d => batch.delete(d.ref));
  await batch.commit();
}

module.exports = handler('POST', async (req) => {
  // Rate limit: máximo 3 tentativas por IP a cada hora (operação destrutiva)
  await rateLimit(req, 'excluir-conta', 3, 60 * 60 * 1000);

  const u = await requireUser(req);
  const uid = u.uid;
  const firestore = db();

  // 0) Cancela a assinatura no Stripe PRIMEIRO. Se não der, não apaga nada (a pessoa não pode ficar sem conta e com cobrança).
  const subDoc = (await firestore.collection('subscriptions').doc(uid).get()).data();
  if (subDoc && subDoc.stripe_subscription) {
    try { await stripe('DELETE', '/subscriptions/' + encodeURIComponent(subDoc.stripe_subscription), {}); }
    catch (e) {
      if (!/no such|already|canceled/i.test(String((e && e.message) || ''))) {
        console.error('excluir-conta: falha ao cancelar assinatura', uid, e && e.message);
        throw new HttpError(502, 'Não conseguimos cancelar sua assinatura agora, então a conta não foi excluída (para você não continuar sendo cobrado). Tente de novo em instantes ou escreva para o suporte.');
      }
    }
  }

  // 1) Subcoleções do usuário
  for (const col of ['transactions', 'bills', 'goals', 'budgets']) await apagarColecao(firestore, `users/${uid}/${col}`);

  // 2) Cadastro (nascimento/CPF): apaga o perfil e o índice de CPF para o número poder ser usado de novo
  const perfil = (await firestore.collection('profiles').doc(uid).get()).data();
  if (perfil && perfil.cpf_hash) await firestore.collection('cpf_index').doc(perfil.cpf_hash).delete().catch(() => { });
  // Se era responsável de menores, eles perdem o acesso até outro responsável autorizar
  const deps = await firestore.collection('profiles').where('guardian_uid', '==', uid).get();
  if (!deps.empty) {
    const b = firestore.batch();
    deps.docs.forEach(d => b.set(d.ref, { guardian_status: 'rejected', can_use: false }, { merge: true }));
    await b.commit();
  }

  // 3) Eventos de uso (guardam só um identificador embaralhado)
  const uidHash = crypto.createHash('sha256').update(uid).digest('hex').slice(0, 12);
  const metr = await firestore.collection('_metrics').where('uid_hash', '==', uidHash).get().catch(() => null);
  if (metr && !metr.empty) { const b = firestore.batch(); metr.docs.forEach(d => b.delete(d.ref)); await b.commit(); }

  // 4) Documentos raiz do usuário
  await Promise.allSettled([
    firestore.collection('profiles').doc(uid).delete(),
    firestore.collection('cpf_tentativas').doc(uid).delete(),
    firestore.collection('users').doc(uid).delete(),
    firestore.collection('subscriptions').doc(uid).delete(),
    firestore.collection('ai_history').doc(uid).delete(),
    firestore.collection('referrals').doc(uid).delete(),
    firestore.collection('referral_uses').doc(uid).delete(),
    firestore.collection('assistant_usage').where('uid', '==', uid).get()
      .then(snap => {
        if (snap.empty) return;
        const batch = firestore.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        return batch.commit();
      }),
  ]);

  // 5) Exclui a conta do Firebase Auth (e-mail, senha protegida e telefone verificado saem junto)
  try {
    await admin().auth().deleteUser(uid);
  } catch (e) {
    console.error('Erro ao excluir conta Firebase Auth:', e && e.message);
    // Não falha: os dados já foram apagados
  }

  return { ok: true };
});
