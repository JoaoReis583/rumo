-- Rumo: rode este arquivo UMA vez no Supabase (SQL Editor > New query > Run)

-- Valida a divisão: precisa ter exatamente as 8 categorias, cada uma com inteiro de 0 a 100
create or replace function public.valid_pcts(p jsonb) returns boolean
language sql immutable as $$
  select jsonb_typeof(p) = 'object'
     and (select count(*) from jsonb_object_keys(p)) = 8
     and p ?& array['mor','ali','tra','sau','res','inv','edu','laz']
     and not exists (
       select 1 from jsonb_each(p) e
       where jsonb_typeof(e.value) <> 'number'
          or e.value::text !~ '^[0-9]{1,3}$'
          or e.value::text::int > 100
     );
$$;

create table if not exists public.budgets (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  income_cents bigint not null default 0 check (income_cents >= 0 and income_cents <= 100000000000),
  pcts         jsonb  not null default '{"mor":30,"ali":15,"tra":10,"sau":5,"res":15,"inv":10,"edu":5,"laz":10}'
                      check (public.valid_pcts(pcts)),
  updated_at   timestamptz not null default now()
);

-- Segurança: cada pessoa só enxerga e altera a própria linha
alter table public.budgets enable row level security;

drop policy if exists "budgets_select_own" on public.budgets;
drop policy if exists "budgets_insert_own" on public.budgets;
drop policy if exists "budgets_update_own" on public.budgets;
drop policy if exists "budgets_delete_own" on public.budgets;

create policy "budgets_select_own" on public.budgets for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "budgets_insert_own" on public.budgets for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "budgets_update_own" on public.budgets for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "budgets_delete_own" on public.budgets for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Visitantes sem login não acessam nada
revoke all on public.budgets from anon;
grant select, insert, update, delete on public.budgets to authenticated;
