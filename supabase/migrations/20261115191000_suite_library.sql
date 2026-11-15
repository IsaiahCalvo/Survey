-- Kal Voe suite library (KAL-585; spec KAL-584 "Library v2"; Isaiah's go
-- 2026-11-15). One library of Categories and Category Types shared by
-- Walkthru, Plot and Survey, kept in Survey's database (the suite's home).
--
--   kind          'category' (Camera) or 'categoryType' (PTZ, under a Category)
--   parent_id     a Category Type's Category; a Category has none
--   scope         'mine' (the person's own: My library) or 'company'
--                 (Company library, needs organization_id)
--   owner_id      who made it; for 'mine' the only person who sees it
--   removed_at    removing keeps the row (nothing is lost; app templates
--                 that point at it still resolve its name)
--
-- Each app keeps its own extras on its link to an entry (Survey: the
-- checklist stays on the template category, which stores libraryEntryId in
-- its config). Rules: anyone who can see an entry's library may add to it;
-- only the owner of a My library entry, or a company owner / admin, may
-- rename or remove one. Rows are written straight from the app (one upsert
-- per entry, with an id made on the device) so offline edits sync one entry
-- at a time; the policies and the trigger below are the whole guard.

create table if not exists public.library_entries (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('category', 'categoryType')),
  parent_id       uuid references public.library_entries(id) on delete restrict,
  name            text not null check (char_length(btrim(name)) between 1 and 120),
  scope           text not null check (scope in ('mine', 'company')),
  owner_id        uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null,
  removed_at      timestamptz,
  constraint library_entries_scope_org check ((scope = 'company') = (organization_id is not null)),
  constraint library_entries_kind_parent check ((kind = 'category') = (parent_id is null))
);

create index if not exists library_entries_owner_mine
  on public.library_entries (owner_id) where scope = 'mine';
create index if not exists library_entries_org
  on public.library_entries (organization_id) where scope = 'company';
create index if not exists library_entries_parent
  on public.library_entries (parent_id) where parent_id is not null;

alter table public.library_entries enable row level security;
revoke all on public.library_entries from anon;
revoke delete, truncate on public.library_entries from authenticated;
grant select, insert, update on public.library_entries to authenticated;
grant all on public.library_entries to service_role;

-- Can the caller see this library at all?
create or replace function public.can_read_library(p_scope text, p_owner uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when p_scope = 'mine' then p_owner = auth.uid()
    when p_scope = 'company' then public.my_org_role(p_org) is not null
    else false
  end;
$$;
revoke all on function public.can_read_library(text, uuid, uuid) from public, anon;
grant execute on function public.can_read_library(text, uuid, uuid) to authenticated, service_role;

-- May the caller rename or remove an entry of this library?
create or replace function public.can_manage_library(p_scope text, p_owner uuid, p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null then false
    when p_scope = 'mine' then p_owner = auth.uid()
    when p_scope = 'company' then public.my_org_role(p_org) in ('owner', 'admin')
    else false
  end;
$$;
revoke all on function public.can_manage_library(text, uuid, uuid) from public, anon;
grant execute on function public.can_manage_library(text, uuid, uuid) to authenticated, service_role;

drop policy if exists library_entries_select on public.library_entries;
create policy library_entries_select on public.library_entries
  for select to authenticated
  using (public.can_read_library(scope, owner_id, organization_id));

-- Guests (anonymous sessions) and AI agents make nothing of their own.
drop policy if exists library_entries_insert on public.library_entries;
create policy library_entries_insert on public.library_entries
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and not public.is_guest_session()
    and not public.is_agent_session()
    and removed_at is null
    and public.can_read_library(scope, owner_id, organization_id)
  );

drop policy if exists library_entries_update on public.library_entries;
create policy library_entries_update on public.library_entries
  for update to authenticated
  using (public.can_manage_library(scope, owner_id, organization_id))
  with check (public.can_manage_library(scope, owner_id, organization_id));

-- Shape rules the policies can't express: a Category Type sits under a live
-- Category of the same library; who made an entry, its kind, library and
-- parent never change; updated_at / updated_by are stamped here.
create or replace function public.library_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent record;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.kind is distinct from old.kind
       or new.scope is distinct from old.scope or new.owner_id is distinct from old.owner_id
       or new.organization_id is distinct from old.organization_id
       or new.parent_id is distinct from old.parent_id or new.created_at is distinct from old.created_at then
      raise exception 'Only the name of a library entry can change, or it can be removed.'
        using errcode = '42501';
    end if;
  end if;
  if new.kind = 'categoryType' then
    select kind, scope, owner_id, organization_id, removed_at into v_parent
      from public.library_entries where id = new.parent_id;
    if not found or v_parent.kind <> 'category' then
      raise exception 'A Category Type needs a Category.' using errcode = '23514';
    end if;
    if v_parent.scope <> new.scope
       or (new.scope = 'mine' and v_parent.owner_id <> new.owner_id)
       or (new.scope = 'company' and v_parent.organization_id <> new.organization_id) then
      raise exception 'A Category Type stays in its Category''s library.' using errcode = '23514';
    end if;
    if tg_op = 'INSERT' and v_parent.removed_at is not null then
      raise exception 'That Category was removed.' using errcode = '23514';
    end if;
  end if;
  new.name := btrim(new.name);
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;
revoke all on function public.library_entries_guard() from public, anon, authenticated;

drop trigger if exists library_entries_guard on public.library_entries;
create trigger library_entries_guard
  before insert or update on public.library_entries
  for each row execute function public.library_entries_guard();
