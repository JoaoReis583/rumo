// POST /api/cancelar  — cancela a assinatura no Asaas. O acesso continua até o fim do período já pago.
const { db, ts, asaas, requireUser, handler } = require('./_lib');

module.exports = handler('POST', async (req) => {
  const u = await requireUser(req);
  const ref = db().collection('subscriptions').doc(u.uid);
  const prev = (await ref.get()).data();
  if (!prev || !prev.asaas_subscription) return { ok: true };
  try { await asaas('DELETE', `/subscriptions/${prev.asaas_subscription}`); }
  catch (e) { if (!/não encontrad|not found/i.test(e.message)) throw e; }
  await ref.set({ status: 'canceled', pending_invoice_url: null, updated_at: ts(new Date()) }, { merge: true });
  return { ok: true };
});
