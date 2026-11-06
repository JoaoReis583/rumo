// POST /api/assinar — cria a sessão de pagamento do Stripe (Checkout embutido no site).
// O teste grátis de 7 dias é liberado sem cartão no cadastro (api/perfil.js). Aqui o pagamento é direto, sem teste.
// Suporta planos mensais e anuais.
const { HttpError, db, CFG, stripe, requireUser, originOf, rateLimit, handler } = require('./_lib');

module.exports = handler('POST', async (req) => {
  // Rate limit: máximo 10 tentativas por IP a cada 15 minutos
  await rateLimit(req, 'assinar', 10, 15 * 60 * 1000);

  const u = await requireUser(req);
  if (!process.env.STRIPE_PUBLISHABLE_KEY) throw new HttpError(500, 'Servidor sem STRIPE_PUBLISHABLE_KEY. Cadastre a variável na Vercel e faça um novo deploy.');
  const cfg = CFG();
  const prev = (await db().collection('subscriptions').doc(u.uid).get()).data() || {};
  const hasAccess = prev.access_until && prev.access_until.toDate() > new Date();

  if (hasAccess && ['active', 'trial'].includes(prev.status)) return { already: true };
  // Pagamento falhou numa assinatura que já existe: não cria outra, manda atualizar o cartão.
  if (prev.stripe_subscription && prev.status === 'overdue') return { overdue: true };

  // Plano: 'mensal' (padrão) ou 'anual'
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const plano = body.plano === 'anual' ? 'anual' : 'mensal';
  const isAnual = plano === 'anual';

  const trial = false; // pagamento direto: o teste grátis já foi dado no cadastro
  const preco = isAnual ? Math.round(cfg.valueAnual * 100) : Math.round(cfg.value * 100);
  const s = await stripe('POST', '/checkout/sessions', {
    mode: 'subscription',
    ui_mode: 'embedded',
    redirect_on_completion: 'if_required',
    return_url: originOf(req) + '/?assinatura=ok',
    locale: 'pt-BR',
    // Informação clara no momento da compra (CDC arts. 6º e 31; Decreto 7.962/2013): renovação, cancelamento e arrependimento.
    custom_text: { submit: { message: (isAnual
      ? 'Assinatura ANUAL com renovação automática a cada ano até você cancelar. '
      : 'Assinatura MENSAL com renovação automática a cada mês até você cancelar. ')
      + 'Cancele quando quiser no painel (Assinatura), sem multa. Arrependimento: você pode desistir em até 7 dias e receber tudo de volta. Ao pagar você aceita os Termos de Uso e a Política de Privacidade do Rumo.' } },
    client_reference_id: u.uid,
    metadata: { uid: u.uid },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'brl',
        unit_amount: preco,
        recurring: { interval: isAnual ? 'year' : 'month' },
        product_data: { name: isAnual ? 'Rumo (assinatura anual)' : 'Rumo (assinatura mensal)' },
      },
    }],
    subscription_data: { metadata: { uid: u.uid }, ...(trial ? { trial_period_days: cfg.trialDays } : {}) },
    ...(prev.stripe_customer ? { customer: prev.stripe_customer } : { customer_email: u.email }),
  });

  return {
    clientSecret: s.client_secret,
    sessionId: s.id,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    trial,
    plano,
  };
});
