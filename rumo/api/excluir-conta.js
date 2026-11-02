// POST /api/excluir-conta — exclui todos os dados do usuário do Firestore e a conta do Firebase Auth.
// LGPD: a pessoa tem direito de excluir a própria conta e todos os seus dados.
const { HttpError, admin, db, requireUser, rateLimit, handler } = require('./_lib');

module.exports = handler('POST', async (req) => {
  // Rate limit: máximo 3 tentativas por IP a cada hora (operação destrutiva)
  await rateLimit(req, 'excluir-conta', 3, 60 * 60 * 1000);

  const u = await requireUser(req);
  const uid = u.uid;
  const firestore = db();

  // Exclui todas as subcoleções do usuário
  const colecoes = ['transactions', 'bills', 'goals'];
  for (const col of colecoes) {
    const snap = await firestore.collection(`users/${uid}/${col}`).get();
    const batch = firestore.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    if (snap.docs.length) await batch.commit();
  }

  // Cadastro (nascimento/CPF): apaga o perfil e o índice de CPF para o número poder ser usado de novo
  const perfil = (await firestore.collection('profiles').doc(uid).get()).data();
  if (perfil && perfil.cpf_hash) await firestore.collection('cpf_index').doc(perfil.cpf_hash).delete().catch(() => { });
  // Se era responsável de menores, eles perdem o acesso até outro responsável autorizar
  const deps = await firestore.collection('profiles').where('guardian_uid', '==', uid).get();
  if (!deps.empty) {
    const b = firestore.batch();
    deps.docs.forEach(d => b.set(d.ref, { guardian_status: 'rejected', can_use: false }, { merge: true }));
    await b.commit();
  }

  // Exclui documento raiz do usuário e assinatura
  await Promise.allSettled([
    firestore.collection('profiles').doc(uid).delete(),
    firestore.collection('cpf_tentativas').doc(uid).delete(),
    firestore.collection('users').doc(uid).delete(),
    firestore.collection('subscriptions').doc(uid).delete(),
    firestore.collection('assistant_usage').where('uid', '==', uid).get()
      .then(snap => {
        if (snap.empty) return;
        const batch = firestore.batch();
        snap.docs.forEach(d => batch.delete(d.ref));
        return batch.commit();
      }),
  ]);

  // Exclui a conta do Firebase Auth (o próprio usuário autenticado)
  try {
    await admin().auth().deleteUser(uid);
  } catch (e) {
    console.error('Erro ao excluir conta Firebase Auth:', e && e.message);
    // Não falha: os dados já foram apagados
  }

  return { ok: true };
});
