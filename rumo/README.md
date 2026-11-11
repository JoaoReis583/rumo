# Rumo — Firebase

Site estático (hospedado na Vercel) que usa **Firebase Authentication** para o login por e-mail e senha e o **Cloud Firestore** para guardar os dados. Não há backend próprio. O Supabase não é mais usado.

## Funções do painel

- **Resumo**: entradas, gastos, saldo e contas a pagar do mês, planejado x gasto por categoria, próximas contas e metas.
- **Gastos**: lançamento de gastos e rendas extras, filtro por categoria e navegação mês a mês.
- **Contas fixas**: vencimentos, status (paga, pendente, atrasada) e botão de marcar como paga (cria o gasto automaticamente).
- **Metas**: objetivos com prazo, guardar e retirar valores, quanto separar por mês.
- **Relatórios**: comparação dos últimos 6 meses, gastos por categoria e exportação em CSV.
- **Planejamento**: renda mensal, divisão em % e reserva de emergência.

## Configurar o Firebase (uma vez)

1. Acesse https://console.firebase.google.com e clique em **Adicionar projeto** (o Google Analytics pode ficar desligado).
2. Em **Criação → Authentication → Vamos começar → Método de login**, ative **E-mail/senha** (deixe "Link por e-mail" desligado).
3. Em **Criação → Firestore Database → Criar banco de dados**, escolha uma região (por exemplo `southamerica-east1`, São Paulo) e o modo de **produção**.
4. Ainda no Firestore, abra a aba **Regras**, apague o conteúdo, cole o arquivo `firestore.rules` deste projeto e clique em **Publicar**. Sem esse passo o painel mostra um aviso amarelo e não salva nada.
5. Em **Configurações do projeto (engrenagem) → Seus apps → ícone `</>` (Web)**, registre um app e copie o objeto `firebaseConfig`.
6. Abra `index.html`, procure `FIREBASE_CONFIG` e preencha `apiKey`, `authDomain`, `projectId` e `appId` com os valores copiados.
7. Em **Authentication → Configurações → Domínios autorizados**, adicione o endereço do seu site na Vercel (por exemplo `seu-site.vercel.app` e o domínio próprio, se tiver).

A `apiKey` do Firebase pode ficar no site: ela só identifica o projeto. Quem protege os dados são as regras do `firestore.rules`, que deixam cada usuário ler e gravar apenas em `users/{seu uid}` e validam os valores no servidor.

## Cadastro e limite de tentativas

O cadastro entra direto, sem e-mail de confirmação, então não existe mais o limite de envios que bloqueava a criação de contas. O e-mail só é usado em "Esqueci minha senha" (o Firebase envia o link de redefinição).

No site, cada aparelho pode fazer até **5 tentativas por hora** de criar conta e **5 por hora** de "Esqueci minha senha". Na 5ª, o botão fica bloqueado e mostra quanto falta para liberar. Essa trava é só no navegador; o Firebase tem a própria proteção contra abuso (mensagem "Muitas tentativas seguidas").

## Publicar na Vercel

Importe esta pasta na Vercel. O `build.js` gera o site em `dist/`, e a pasta `api/` vira funções de servidor (precisa do `npm install` automático da Vercel, por causa do `firebase-admin`). Defina as variáveis de ambiente da seção abaixo **antes** do deploy.

## Cadastro: nascimento, CPF e menores de 18

O registro (`/registro`) tem 3 abas: **1 Conta**, **2 Seus dados** (data de nascimento + CPF) e **3 Responsável** (só aparece para menor de 18). Quem entra por Google, ou já tinha conta antes desta versão, cai na aba 2 no primeiro acesso.

- **CPF de verdade**: o servidor (`api/perfil.js`) valida os dígitos e depois consulta a Receita Federal pelo CPFHub (50 consultas grátis por mês), que só confirma se o CPF **e** a data de nascimento forem da mesma pessoa. Sem o token configurado o cadastro **não conclui** (falha fechada). Cada CPF só vale para uma conta; só guardamos um código protegido (HMAC), nunca o número. Depois de 5 tentativas que não conferem no dia, a conta é travada até o dia seguinte.
- **Menor de 18**: informa o e-mail de um responsável que já tenha conta no Rumo (maior de 18, cadastro completo e e-mail confirmado). Até o responsável aceitar, o painel do menor fica bloqueado e o Firestore recusa gravações (`can_use` em `profiles/{uid}`, ver `firestore.rules`). Ao completar 18 anos o acesso é liberado sozinho.
- **Responsável**: o pedido aparece como aviso no topo do painel dele(a), com Aceitar/Recusar. Ao aceitar, surge a aba **Monitoramento** com gráficos do dependente (6 meses, categorias do mês, metas, total de contas fixas; sem as descrições dos lançamentos). Pode remover a autorização a qualquer momento.

| Variável | Tipo | O que é |
|---|---|---|
| `CPFHUB_API_KEY` | Secret | Chave de API do CPFHub (app.cpfhub.io > Chaves de API). Usa a consulta em tempo real (`/cpf/realtime`), que exige CPF + nascimento. |
| `CPF_API_URL` | Config | Opcional. Troca o endereço da consulta. |
| `CPF_PEPPER` | Secret | Texto longo e aleatório que protege o código do CPF. **Não troque depois**, senão os CPFs já cadastrados deixam de ser reconhecidos. |
| `CPF_VERIFY_DISABLED` | Config | Só para testes locais: `1` pula a consulta à Receita. Nunca use em produção. |

Depois do deploy, publique o novo `firestore.rules`. Contas antigas ficam sem gravar até completarem o cadastro (a tela pede na hora do login).

## Teste grátis de 7 dias (sem cartão)

Ao concluir o cadastro (nascimento + CPF conferidos; para menor, depois que o responsável aceita), o servidor cria `subscriptions/{uid}` com `status: trial`, `free_trial: true` e `access_until` = hoje + `TRIAL_DAYS` (padrão 7). É feito uma só vez por conta, e como o CPF é único não dá para renovar criando outra conta. Contas antigas que nunca assinaram ganham os 7 dias quando completam o cadastro. Passados os 7 dias o painel mostra a tela de cobrança (mensal ou anual) e o pagamento no Stripe é direto, sem período de teste. Para mudar a duração, altere `TRIAL_DAYS` na Vercel e `PLAN.trial`/`PLAN_PW.trial` no `index.html`.

## Assinatura mensal com Stripe

Fluxo: a pessoa cria a conta, vê a tela de teste/assinatura e clica no botão. O servidor (`api/assinar.js`) cria uma sessão de pagamento no Stripe e o formulário do cartão aparece **dentro do site** (Checkout embutido). Ao pagar, `api/sincronizar.js` confere no Stripe e libera o acesso na hora. Renovações, falhas e cancelamentos chegam por webhook em `api/webhook-stripe.js`. O acesso fica em `subscriptions/{uid}` no Firestore; as regras só deixam gravar dados enquanto `access_until` estiver no futuro (sem acesso, o painel vira somente leitura). Só o servidor escreve em `subscriptions`. O botão "Assinatura" do painel abre o portal do Stripe (`api/portal.js`) para trocar o cartão, ver faturas e cancelar.

### Variáveis de ambiente (Vercel > Settings > Environment Variables)

| Nome | Tipo | O que é |
|---|---|---|
| `STRIPE_SECRET_KEY` | Secret | Chave secreta (`sk_test_...` para testar, `sk_live_...` em produção). Stripe > Desenvolvedores > Chaves de API. |
| `STRIPE_PUBLISHABLE_KEY` | Config | Chave publicável (`pk_test_...` / `pk_live_...`), da mesma tela. Use sempre o mesmo modo (teste ou produção) nas duas chaves. |
| `FIREBASE_SERVICE_ACCOUNT` | Secret | Conteúdo inteiro do JSON da conta de serviço (Firebase > Configurações do projeto > Contas de serviço > Gerar nova chave privada). |
| `PLAN_VALUE` | Config | Opcional. Mensalidade em reais, ex.: `5.90` (padrão 5.90). |
| `TRIAL_DAYS` | Config | Opcional. Dias de teste grátis (padrão 7; `0` desliga). |

O preço mostrado na tela está em `const PLAN` no `index.html`; mantenha igual a `PLAN_VALUE` e `TRIAL_DAYS`.

### Configurar no Stripe (modo de teste primeiro)

1. Crie a conta no Stripe e ative o **modo de teste** (chave de teste).
2. Em *Configurações > Faturamento > Portal do cliente*, ative o portal e salve (é o que faz o botão "Assinatura" funcionar).
3. Em *Desenvolvedores > Webhooks > Adicionar endpoint*, use a URL `https://SEU-SITE.vercel.app/api/webhook-stripe` e marque os eventos: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` e `invoice.payment_failed`.
4. Publique o novo `firestore.rules` no Firebase.

O webhook não usa segredo de assinatura: o aviso só indica qual assinatura mudou, e o servidor lê o estado real direto no Stripe.

### Ir para produção (cobrança real)

1. Ative a conta no Stripe (Ativar conta: dados do negócio, identidade e conta bancária) e saia do modo de teste.
2. No modo real, copie as chaves `sk_live_...` e `pk_live_...` e **substitua** `STRIPE_SECRET_KEY` e `STRIPE_PUBLISHABLE_KEY` na Vercel.
3. Refaça no modo real o que foi feito no teste: o **webhook** (mesma URL e mesmos eventos) e o **Portal do cliente**. Cada modo tem a sua própria configuração.
4. No Firestore, apague os documentos de `subscriptions/` criados nos testes: eles guardam códigos de cliente do modo de teste, que não existem no modo real.
5. Para cobrar desde o primeiro dia, defina `TRIAL_DAYS=0` na Vercel e `trial:0` em `const PLAN` no `index.html`.
6. Apague `api/status.js`, faça o redeploy e teste com uma compra real; depois cancele e peça o reembolso no painel do Stripe.

### Testar

Crie uma conta no site e clique em "Começar teste grátis". Use o cartão de teste `4242 4242 4242 4242`, qualquer data futura e qualquer CVC. Confira no Firestore o documento `subscriptions/{uid}` com `status: trial`.

## Assistente de IA

Botão "Assistente" no canto do painel (só aparece para quem tem acesso ativo). O assistente recebe, a cada pergunta, um resumo dos dados do mês da própria pessoa (renda, planejado x gasto por categoria, contas fixas, metas e últimos lançamentos). A conversa não é guardada. A rota é `api/assistente.js`, que funciona com **Gemini (Google)** ou **Claude (Anthropic)**.

O que ele faz: avalia a divisão da renda, analisa onde o dinheiro está indo, acompanha contas fixas e metas, ajuda a montar a reserva e organizar dívidas, explica termos financeiros e ensina a usar o site. **O assistente também altera os dados da pessoa**: no chat ela pode pedir, por exemplo, "mude a conta de luz para internet", "adicione um gasto de R$ 50 no mercado" ou "crie uma meta de viagem" (lançamentos, contas fixas, metas, renda e divisão em %). Na aba Planejamento, o botão **Ajustar com a IA** reorganiza a divisão da renda com base nos dados, com opção de desfazer. A IA só devolve as ações; o navegador valida e grava no Firestore da própria pessoa (as regras do `firestore.rules` continuam valendo), e exclusões pedem confirmação. Não é preciso mudar as regras. Ele não indica investimentos específicos nem substitui um profissional.

| Variável | Tipo | O que é |
|---|---|---|
| `GEMINI_API_KEY` | Secret | Chave do Google AI Studio (aistudio.google.com > Get API key). Se existir, o Gemini é usado. |
| `ANTHROPIC_API_KEY` | Secret | Alternativa: chave da Anthropic (console.anthropic.com). Usada se não houver `GEMINI_API_KEY`. |
| `ASSISTANT_PROVIDER` | Config | Opcional. `gemini` ou `claude`, para forçar um dos dois. |
| `ASSISTANT_MODEL` | Config | Opcional. Padrão `gemini-2.5-flash` (Gemini) ou `claude-haiku-5-5` (Claude). |
| `ASSISTANT_DAILY_LIMIT` | Config | Opcional. Perguntas por pessoa por dia (padrão 30). |

Atenção: no plano gratuito da API do Gemini, o Google pode usar o conteúdo enviado para melhorar seus produtos. Como o assistente envia dados financeiros dos usuários, ative o faturamento (plano pago) no Google AI Studio e confira os termos de uso de dados antes de abrir ao público. Os dados enviados à IA devem constar na Política de Privacidade do site.

## Dados

Estrutura no Firestore:

- `users/{uid}`: `income_cents` e `pcts` (divisão em %).
- `users/{uid}/transactions`: gastos e rendas extras.
- `users/{uid}/bills`: contas fixas.
- `users/{uid}/goals`: metas.

Os dados que estavam no Supabase não são migrados automaticamente (as senhas não podem ser exportadas). As contas precisam ser criadas de novo.


## Conformidade legal (LGPD, CDC, ECA Digital)

**Antes de abrir ao público**, preencha `empresa.json` (razão social/nome, CNPJ/CPF, endereço, cidade/UF, e-mails de suporte e privacidade, encarregado). O build troca os marcadores `{{...}}` das páginas legais e do rodapé por esses dados; enquanto faltar algo, a tela mostra `[PREENCHER: CAMPO]` e o build avisa. Os preços e os dias de teste dos textos legais vêm das mesmas variáveis da cobrança (`PLAN_VALUE`, `PLAN_VALUE_ANUAL`, `TRIAL_DAYS`). Ao mudar a versão dos textos, altere `VERSAO_DOCUMENTOS` (o aceite do usuário guarda essa versão).

Páginas: `privacidade`, `termos`, `cookies`, `reembolso`, `acessibilidade`, `empresa` (todas em `/nome`). Aviso de cookies em `consentimento.js` (o Pixel da Meta só carrega com consentimento). Preços exibidos vêm de `GET /api/planos`.

**Telefone:** o cadastro pede o celular com DDD, mas **não confirma por SMS** (o Firebase exige o plano Blaze para enviar SMS). O número fica em `profiles/{uid}.telefone` (`telefone_verificado: false`), gravado por `api/perfil.js`, e sai na exportação de dados. Como não é confirmado, não serve para provar identidade; a trava de contas duplicadas e de abuso do teste grátis vem do CPF conferido na Receita Federal.

**Arrependimento de 7 dias:** botão "Desistir (7 dias)" no painel chama `api/arrependimento.js` (cancela e estorna a primeira cobrança no Stripe). Excluir a conta agora cancela a assinatura no Stripe antes de apagar os dados.

**Consentimentos:** aceite dos Termos (data + versão), consentimento da IA (primeiro uso) e de marketing ficam em `profiles/{uid}`. A API de Conversões da Meta só roda para maior de 18 anos com consentimento de marketing. Histórico da IA na nuvem é opt-in.

`api/status.js` (diagnóstico que expunha o início das chaves) foi removido.