// GET /api/planos — preços e teste grátis que o servidor REALMENTE cobra (variáveis PLAN_VALUE, PLAN_VALUE_ANUAL e TRIAL_DAYS).
// O site lê daqui para nunca mostrar um preço diferente do cobrado (publicidade/oferta divergente é infração ao CDC, arts. 30 e 37).
const { CFG, handler } = require('./_lib');

module.exports = handler('GET', async (req, res) => {
  const c = CFG();
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  return { mensal: c.value, anual: Math.round(c.valueAnual * 100) / 100, teste_dias: c.trialDays };
});
