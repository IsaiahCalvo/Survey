-- Your own Excel layout (Nightly beta 'own-excel-layouts', plan 2026-10-27):
-- an export kit someone makes from their own sheet, kept on their account.
-- Unlike public.kits (staff publish, customers read), each person writes
-- their own rows here and nobody else sees them. The app checks the kit with
-- validateExportKit before saving and again on load.

create table if not exists public.own_export_kits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id text not null check (id ~ '^own-[a-z0-9][a-z0-9-]{0,58}$'),
  label text not null check (char_length(btrim(label)) between 1 and 60),
  definition jsonb not null check (jsonb_typeof(definition) = 'object' and pg_column_size(definition) < 16384),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

alter table public.own_export_kits enable row level security;
revoke all on table public.own_export_kits from anon;
grant select, insert, delete on table public.own_export_kits to authenticated;

drop policy if exists "own export kits: owner reads" on public.own_export_kits;
create policy "own export kits: owner reads" on public.own_export_kits
  for select to authenticated
  using (user_id = (select auth.uid()));

-- Outside agents (OAuth tokens) may not add or remove layouts.
drop policy if exists "own export kits: owner adds" on public.own_export_kits;
create policy "own export kits: owner adds" on public.own_export_kits
  for insert to authenticated
  with check (user_id = (select auth.uid()) and not public.is_agent_session());

drop policy if exists "own export kits: owner removes" on public.own_export_kits;
create policy "own export kits: owner removes" on public.own_export_kits
  for delete to authenticated
  using (user_id = (select auth.uid()) and not public.is_agent_session());

-- At most 50 a person, stamped with the server's time.
create or replace function public.own_export_kits_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := now();
  if (select count(*) from public.own_export_kits where user_id = new.user_id) >= 50 then
    raise exception 'own_kit_limit' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.own_export_kits_guard() from public, anon, authenticated;

drop trigger if exists own_export_kits_guard on public.own_export_kits;
create trigger own_export_kits_guard
  before insert on public.own_export_kits
  for each row execute function public.own_export_kits_guard();

insert into public.feature_flags (key, mode, description) values
  ('own-excel-layouts', 'off', 'Your own Excel layout: upload your sheet, match its columns to Survey fields, save it as an export kit.')
on conflict (key) do nothing;
