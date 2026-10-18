// POST /api/assinar  { cpfCnpj }  (Authorization: Bearer <ID token do Firebase>)
// Cria o cliente e a assinatura mensal no Asaas. Na 1ª vez libera o período de teste.
const { HttpError, db, ts, CFG, asaas, today, addDays, endOfDay, requireUser, handler } = require('./_lib');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openInvoice(subId, tries) {
  for (let i = 0; i < tries; i++) {
    const l = await asaas('GET', `/subscriptions/${subId}/payments`);
    const p = (l.data || []).find((x) => ['PENDING', 'OVERDUE'].includes(x.status) && x.invoiceUrl);
    if (p) return p.invoiceUrl;
    if (i < tries - 1) await sleep(700);
  }
  return null;
}

module.exports = handler('POST', async (req) => {
  const u = await requireUser(req);
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const cpfCnpj = String(body.cpfCnpj || '').replace(/\D/g, '');
  if (![11, 14].includes(cpfCnpj.length)) throw new HttpError(400, 'Informe um CPF (11 dígitos) ou CNPJ (14 dígitos).');

  const cfg = CFG();
  const ref = db().collection('subscriptions').doc(u.uid);
  const prev = (await ref.get()).data() || {};
  const hasAccess = prev.access_until && prev.access_until.toDate() > new Date();

  // Já existe assinatura em andamento: não cria outra, só devolve o link de pagamento pendente.
  if (prev.asaas_subscription && prev.status && prev.status !== 'canceled' && prev.status !== 'refunded') {
    if (hasAccess && prev.status === 'active') return { already: true };
    if (hasAccess && prev.status === 'trial') return { trial: true, already: true };
    const url = await openInvoice(prev.asaas_subscription, 3);
    if (url) return { invoiceUrl: url };
  }

  let customer = prev.asaas_customer;
  if (!customer) {
    const c = await asaas('POST', '/customers', {
      name: u.name || (u.email || 'Cliente Rumo').split('@')[0],
      email: u.email,
      cpfCnpj,
      externalReference: u.uid,
    });
    customer = c.id;
  }

  const trial = !prev.trial_used && cfg.trialDays > 0;
  const nextDueDate = addDays(today(), trial ? cfg.trialDays : 0);
  const sub = await asaas('POST', '/subscriptions', {
    customer,
    billingType: 'UNDEFINED', // a pessoa escolhe Pix, boleto ou cartão na página do Asaas
    nextDueDate,
    value: cfg.value,
    cycle: 'MONTHLY',
    description: 'Assinatura Rumo',
    externalReference: u.uid,
  });

  const invoiceUrl = trial ? null : await openInvoice(sub.id, 5);
  await ref.set({
    status: trial ? 'trial' : 'pending',
    asaas_customer: customer,
    asaas_subscription: sub.id,
    trial_used: prev.trial_used || trial,
    access_until: trial ? ts(endOfDay(nextDueDate)) : prev.access_until || ts(new Date(0)),
    pending_invoice_url: invoiceUrl,
    updated_at: ts(new Date()),
  }, { merge: true });

  return trial ? { trial: true } : { invoiceUrl };
});
