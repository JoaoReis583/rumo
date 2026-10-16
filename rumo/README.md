# Rumo + Supabase (hospedagem na Vercel)

Site estático (`index.html`). Login e banco de dados ficam no Supabase. Não há servidor próprio.

## 1. Criar o banco
1. Em supabase.com, crie um projeto.
2. Vá em **SQL Editor > New query**, cole o conteúdo de `supabase.sql` e clique em **Run**.

## 2. Ligar o site ao Supabase
1. Em **Project Settings > API**, copie a **Project URL** e a chave **anon / public**.
2. No `index.html`, procure `COLE_AQUI` (início do `<script>`) e cole os dois valores.
   - A chave anon pode ficar no site: quem protege os dados são as regras (RLS) do `supabase.sql`.
   - **Nunca** coloque a chave `service_role` no site.

## 3. Configurar o login (Authentication)
- **URL Configuration:** em *Site URL*, coloque o endereço do seu site na Vercel (ex.: `https://rumo.vercel.app`).
  Isso faz o link do e-mail de confirmação voltar para o lugar certo.
- **Sign In / Providers > Email:** por padrão exige confirmar o e-mail. Para testar mais rápido, desligue
  *Confirm email*; em produção, prefira deixar ligado.
- Opcional: em *Password*, ajuste o tamanho mínimo para 8 (o site já exige 8).
- O e-mail padrão do Supabase tem limite baixo de envios por hora. Para um app público, configure um SMTP próprio
  (Resend, Brevo etc.) em *Project Settings > Authentication > SMTP*.

## 4. Publicar na Vercel
Suba esta pasta (`index.html`, `vercel.json`) para um repositório e importe na Vercel,
ou use `npx vercel` dentro da pasta. Não precisa de build nem de variáveis de ambiente.

## Backup
No painel do Supabase: *Database > Backups* (planos pagos têm backup diário automático).
