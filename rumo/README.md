# Rumo — Supabase

Aplicação estática que usa **exclusivamente Supabase** para autenticação e persistência dos dados. Não há backend próprio nem banco SQLite.

## Configurar o Supabase

1. Crie um projeto em https://supabase.com.
2. No painel, abra **SQL Editor → New query**, cole o conteúdo de `supabase.sql` e execute.
3. Em **Project Settings → API**, copie a **Project URL** e a chave pública **anon** (ou publishable, se disponível).
4. Abra `index.html` e substitua `COLE_AQUI_A_PROJECT_URL` e `COLE_AQUI_A_ANON_PUBLIC_KEY` pelos valores do seu projeto.
   - A chave pública pode ser usada no navegador porque o acesso é protegido pelas políticas RLS definidas em `supabase.sql`.
   - **Nunca** exponha a chave `service_role` ou uma chave secreta no frontend.

## Configurar autenticação

No Supabase, em **Authentication → URL Configuration**, configure a `Site URL` para o endereço final do site. Em **Authentication → Sign In / Providers → Email**, escolha se a confirmação de e-mail será obrigatória. Para produção, recomenda-se manter a confirmação habilitada e configurar SMTP próprio.

## Publicar na Vercel

Importe esta pasta do projeto na Vercel como site estático. Não é necessário instalar dependências, executar servidor Node ou configurar build command. O `index.html` é a página principal e `vercel.json` define cabeçalhos de segurança.

## Dados

Os dados de orçamento ficam na tabela `public.budgets`, com `user_id` ligado a `auth.users`. As políticas RLS restringem cada usuário aos próprios dados. Contas e sessões são gerenciadas pelo Supabase Auth.
