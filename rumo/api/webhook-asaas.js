// POST /api/webhook-asaas — o Asaas avisa aqui sobre cobranças e assinaturas.
// Cada evento só grava valores fixos (idempotente), então reenvios do Asaas não causam problema.
const { HttpError, db, ts, CFG, asaas, today, addDays, endOfDay, handler, safeEqual } = require('./_lib');

async function findRef(subId) {
  const q = await db().collection('subscriptions').where('asaas_subscription', '==', subId).limit(1).get();
  if (!q.empty) return q.docs[0].ref;
  // O aviso pode chegar antes de o cadastro terminar de gravar: descobre o usuário pelo externalReference.
  const s = await asaas('GET', `/subscriptions/${subId}`);
  return s.externalReference ? db().collection('subscriptions').doc(s.externalReference) : null;
}

module.exports = handler('POST', async (req) => {
  if (!safeEqual(req.headers['asaas-access-token'], process.env.ASAAS_WEBHOOK_TOKEN || '')) throw new HttpError(401, 'Não autorizado.');
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const ev = b.event, p = b.payment, s = b.subscription;
  const subId = (p && p.subscription) || (s && s.id);
  if (!ev || !subId) return { ignored: true };

  const ref = await findRef(subId);
  if (!ref) return { ignored: true };
  const prev = (await ref.get()).data() || {};
  const set = { asaas_subscription: subId, updated_at: ts(new Date()) };

  if (ev === 'PAYMENT_CONFIRMED' || ev === 'PAYMENT_RECEIVED') {
    // Cada cobrança paga vale um ciclo a partir do seu vencimento.
    let until = endOfDay(addDays((p && p.dueDate) || today(), CFG().paidDays));
    const cur = prev.access_until && prev.access_until.toDate();
    if (cur && cur > until) until = cur;
    Object.assign(set, { status: 'active', access_until: ts(until), pending_invoice_url: null });
  } else if (ev === 'PAYMENT_OVERDUE') {
    if (prev.status !== 'canceled') set.status = 'overdue';
    if (p && p.invoiceUrl) set.pending_invoice_url = p.invoiceUrl;
  } else if ((ev === 'PAYMENT_CREATED' || ev === 'PAYMENT_UPDATED') && p && p.status === 'PENDING') {
    set.pending_invoice_url = p.invoiceUrl || null;
  } else if (ev === 'PAYMENT_REFUNDED' || ev === 'PAYMENT_CHARGEBACK_REQUESTED') {
    Object.assign(set, { status: 'refunded', access_until: ts(new Date()) });
  } else if (ev === 'SUBSCRIPTION_DELETED' || ev === 'SUBSCRIPTION_INACTIVATED') {
    set.status = 'canceled';
  } else {
    return { ignored: true };
  }

  await ref.set(set, { merge: true });
  return { ok: true };
});
