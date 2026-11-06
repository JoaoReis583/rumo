// POST /api/arrependimento — direito de arrependimento de 7 dias (CDC art. 49 e Decreto 7.962/2013, art. 5º).
// Cancela a assinatura NA HORA, devolve o valor integral da primeira cobrança no mesmo cartão (Stripe) e responde
// com a confirmação imediata na tela. Só vale para a primeira cobrança paga, dentro de 7 dias, e uma vez por conta.
// Qualquer outro caso (renovação, cobrança em duplicidade etc.) é tratado pelo suporte, conforme /reembolso.
const { HttpError, db, ts, stripe, requireUser, rateLimit, handler } = require('./_lib');

const PRAZO_MS = 7 * 86400000 + 12 * 3600000; // 7 dias corridos + 12 h de tolerância (fuso/hora do pagamento)

module.exports = handler('POST', async (req) => {
  await rateLimit(req, 'arrependimento', 5, 60 * 60 * 1000);
  const u = await requireUser(req);
  const ref = db().collection('subscriptions').doc(u.uid);
  const sub = (await ref.get()).data() || {};

  if (!sub.stripe_subscription) throw new HttpError(404, 'Você ainda não tem uma assinatura paga. O teste grátis não tem cobrança, então não há o que desfazer.');
  if (sub.arrependimento_em) throw new HttpError(409, 'O arrependimento já foi usado nesta conta. Para outras situações escreva para o suporte (veja Reembolso e Cancelamento).');

  // Primeira cobrança efetivamente paga da assinatura
  const lista = await stripe('GET', '/invoices', { subscription: sub.stripe_subscription, status: 'paid', limit: 20 });
  const pagas = (lista.data || [])
    .filter((i) => Number(i.amount_paid) > 0)
    .sort((a, b) => ((a.status_transitions && a.status_transitions.paid_at) || a.created) - ((b.status_transitions && b.status_transitions.paid_at) || b.created));
  const primeira = pagas[0];
  if (!primeira) throw new HttpError(404, 'Não encontramos uma cobrança paga para devolver. Se você pagou há pouco, toque em "Já paguei, atualizar" e tente de novo.');

  const pagoEm = ((primeira.status_transitions && primeira.status_transitions.paid_at) || primeira.created) * 1000;
  if (Date.now() - pagoEm > PRAZO_MS) {
    throw new HttpError(403, 'O prazo de 7 dias, contado do primeiro pagamento (' + new Date(pagoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) + '), já terminou. Você pode cancelar a renovação em "Assinatura". Para outros casos, fale com o suporte.');
  }
  if (!primeira.payment_intent && !primeira.charge) throw new HttpError(500, 'Não conseguimos localizar o pagamento para estornar. Escreva para o suporte; seu pedido de arrependimento será atendido.');

  // 1) Para novas cobranças primeiro
  try { await stripe('DELETE', '/subscriptions/' + encodeURIComponent(sub.stripe_subscription), {}); }
  catch (e) { if (!/no such|already|canceled/i.test(String(e && e.message))) throw new HttpError(502, 'Não conseguimos cancelar agora. Tente de novo em instantes ou escreva para o suporte.'); }

  // 2) Estorno integral, no mesmo meio de pagamento
  let refund = null, erroEstorno = null;
  try {
    refund = await stripe('POST', '/refunds', {
      ...(primeira.payment_intent ? { payment_intent: typeof primeira.payment_intent === 'string' ? primeira.payment_intent : primeira.payment_intent.id } : { charge: typeof primeira.charge === 'string' ? primeira.charge : primeira.charge.id }),
      reason: 'requested_by_customer',
      metadata: { uid: u.uid, motivo: 'arrependimento_cdc_art49' },
    });
  } catch (e) { erroEstorno = e && e.message; console.error('arrependimento: estorno falhou', u.uid, erroEstorno); }

  await ref.set({
    status: 'canceled',
    access_until: ts(new Date()),
    arrependimento_em: ts(new Date()),
    arrependimento_estorno: refund ? refund.id : null,
    arrependimento_pendente: !refund, // o suporte enxerga aqui se o estorno precisa ser feito à mão
    updated_at: ts(new Date()),
  }, { merge: true });

  if (!refund) throw new HttpError(502, 'Sua assinatura foi cancelada, mas o estorno automático falhou. Escreva para o suporte agora: seu direito de arrependimento está registrado e o valor será devolvido.');
  return { ok: true, valor: Number(primeira.amount_paid) / 100, estorno: refund.id, mensagem: 'Assinatura cancelada e estorno de R$ ' + (Number(primeira.amount_paid) / 100).toFixed(2).replace('.', ',') + ' solicitado ao Stripe. Ele aparece no seu cartão em até 10 dias (o banco pode levar até duas faturas).' };
});
