-- Custom builds library: kits given to one customer.
--
-- A kit is a published, versioned piece of plain data (an Excel layout, a
-- template, a tool) that Survey's own code draws; it never holds code. Kits
-- shipped with the app live in src/services/exportFormats/kits; these tables
-- hold the ones built for a single customer, so other customers never see them.
--
-- Additive only: two new tables, no change to existing ones.
--   kits          one row per kit version; never edited once published
--   account_kits  which kit version an account has, plus that account's tweaks
-- People (and their agents) can only READ the kits given to their own
-- account. Only staff, through the service role, publish or assign kits.

create table if not exists public.kits (
  id text not null check (id ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  version text not null check (version ~ '^\d+\.\d+\.\d+$'),
  kind text not null check (kind in ('exportKit', 'templateKit', 'toolKit')),
  label text not null default '',
  definition jsonb not null check (jsonb_typeof(definition) = 'object'),
  created_at timestamptz not null default now(),
  primary key (id, version)
);

create table if not exists public.account_kits (
  user_id uuid not null references auth.users(id) on delete cascade,
  kit_id text not null,
  kit_version text not null,
  overrides jsonb not null default '{}'::jsonb check (jsonb_typeof(overrides) = 'object'),
  created_at timestamptz not null default now(),
  primary key (user_id, kit_id),
  foreign key (kit_id, kit_version) references public.kits(id, version)
);

create index if not exists account_kits_kit_idx on public.account_kits (kit_id, kit_version);

alter table public.kits enable row level security;
alter table public.account_kits enable row level security;

-- A published version never changes: fixes ship as a new version.
create or replace function public.kits_are_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'kits are never edited; publish a new version' using errcode = '42501';
end;
$$;

drop trigger if exists kits_no_update on public.kits;
create trigger kits_no_update before update on public.kits
  for each row execute function public.kits_are_immutable();

revoke all on public.kits from anon, authenticated;
revoke all on public.account_kits from anon, authenticated;
grant select on public.kits to authenticated;
grant select on public.account_kits to authenticated;
grant all on public.kits to service_role;
grant all on public.account_kits to service_role;

drop policy if exists account_kits_owner_read on public.account_kits;
create policy account_kits_owner_read on public.account_kits
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists kits_assigned_read on public.kits;
create policy kits_assigned_read on public.kits
  for select
  to authenticated
  using (exists (
    select 1 from public.account_kits ak
     where ak.user_id = auth.uid()
       and ak.kit_id = kits.id
       and ak.kit_version = kits.version
  ));
