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

## Assinatura mensal com Asaas

Fluxo: a pessoa cria a conta, vê a tela de teste/assinatura, informa o CPF ou CNPJ e o servidor cria o cliente e a assinatura no Asaas (`api/assinar.js`). O Asaas avisa pagamentos e cancelamentos em `api/webhook-asaas.js`, que grava o acesso em `subscriptions/{uid}` no Firestore. As regras do Firestore só deixam gravar dados enquanto `access_until` estiver no futuro; sem acesso, o painel vira somente leitura. Só o servidor escreve em `subscriptions`.

### Variáveis de ambiente (Vercel > Settings > Environment Variables)

| Nome | O que é |
|---|---|
| `ASAAS_API_KEY` | Chave de API do Asaas (Integração > Chaves de API). Comece pela do Sandbox. |
| `ASAAS_API_URL` | Sandbox: `https://api-sandbox.asaas.com/v3`. Produção: `https://api.asaas.com/v3` (padrão). |
| `ASAAS_WEBHOOK_TOKEN` | Texto longo e aleatório que você inventa. O mesmo vai no webhook do Asaas. |
| `FIREBASE_SERVICE_ACCOUNT` | Conteúdo inteiro do JSON da conta de serviço (Firebase > Configurações do projeto > Contas de serviço > Gerar nova chave privada). |
| `PLAN_VALUE` | Valor da mensalidade, ex.: `5.90` (padrão 5.90). |
| `TRIAL_DAYS` | Dias de teste grátis (padrão 7; `0` desliga). |

O preço mostrado na tela está em `const PLAN` no `index.html`; mantenha igual a `PLAN_VALUE` e `TRIAL_DAYS`.

### Configurar o webhook no Asaas

1. No Asaas (Sandbox primeiro): Integrações > Webhooks > criar.
2. URL: `https://SEU-SITE.vercel.app/api/webhook-asaas`
3. Token de autenticação: o mesmo valor de `ASAAS_WEBHOOK_TOKEN`.
4. Marque os eventos de cobranças (criada, atualizada, confirmada, recebida, vencida, estornada) e de assinaturas (removida, inativada).
5. Publique as novas regras do `firestore.rules` no Firebase.

### Testar no Sandbox

Crie uma conta no site, comece o teste grátis e confira no Firestore o documento `subscriptions/{uid}`. No Sandbox do Asaas, confirme o pagamento de uma cobrança manualmente e veja o status virar `active`.

## Dados

Estrutura no Firestore:

- `users/{uid}`: `income_cents` e `pcts` (divisão em %).
- `users/{uid}/transactions`: gastos e rendas extras.
- `users/{uid}/bills`: contas fixas.
- `users/{uid}/goals`: metas.

Os dados que estavam no Supabase não são migrados automaticamente (as senhas não podem ser exportadas). As contas precisam ser criadas de novo.
