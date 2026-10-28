-- Company workspace for the Enterprise plan (beta flag 'company-admin').
--
-- A company holds people (owner / admin / member), invites by email, and an
-- activity log that the database fills itself, so nobody can skip it. Seats:
-- members plus open invites may not pass seat_limit. Only the payments
-- listener (service role) may change seat_limit or billing_status; nothing
-- here grants a paid plan. Full plan split:
-- /mnt/project-files/security/pro-vs-enterprise.md
--
-- Every write goes through the SECURITY DEFINER functions below. The tables
-- only have SELECT policies, so a signed-in user cannot write them directly.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (char_length(btrim(name)) between 1 and 120),
  created_by          uuid references auth.users(id) on delete set null,
  seat_limit          integer not null default 3 check (seat_limit >= 0),
  billing_status      text not null default 'none'
                        check (billing_status in ('none', 'trialing', 'active', 'past_due', 'canceled')),
  storage_limit_bytes bigint not null default 1099511627776, -- 1 TB, shared by the company
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  role            text not null check (role in ('owner', 'admin', 'member')),
  added_by        uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id),
  -- One company per person keeps "which plan am I on" a single answer.
  constraint organization_members_one_company unique (user_id)
);

create table if not exists public.organization_invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email           text not null check (email = lower(btrim(email)) and email like '%_@_%'),
  role            text not null check (role in ('admin', 'member')),
  invited_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '14 days'),
  accepted_at     timestamptz,
  accepted_by     uuid references auth.users(id) on delete set null,
  revoked_at      timestamptz,
  declined_at     timestamptz
);
create unique index if not exists organization_invites_open_email
  on public.organization_invites (organization_id, email)
  where accepted_at is null and revoked_at is null and declined_at is null;
create index if not exists organization_invites_email
  on public.organization_invites (email)
  where accepted_at is null and revoked_at is null and declined_at is null;

create table if not exists public.organization_activity (
  id              bigserial primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_id        uuid,
  actor_email     text,
  action          text not null,
  target_type     text,
  target_id       text,
  target_label    text,
  project_id      uuid,
  document_id     uuid,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists organization_activity_org_id
  on public.organization_activity (organization_id, id desc);
create index if not exists organization_activity_org_actor
  on public.organization_activity (organization_id, actor_id, id desc);
create index if not exists organization_activity_edit_throttle
  on public.organization_activity (organization_id, actor_id, document_id, created_at desc)
  where action = 'document.edited';

alter table public.organizations         enable row level security;
alter table public.organization_members  enable row level security;
alter table public.organization_invites  enable row level security;
alter table public.organization_activity enable row level security;

revoke insert, update, delete, truncate on public.organizations,
  public.organization_members, public.organization_invites,
  public.organization_activity from anon, authenticated;
revoke all on public.organizations, public.organization_members,
  public.organization_invites, public.organization_activity from anon;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- The caller's role in a company, or null. SECURITY DEFINER so the policies
-- on organization_members can call it without recursing into themselves.
create or replace function public.my_org_role(p_org uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.organization_members m
   where m.organization_id = p_org and m.user_id = auth.uid();
$$;
revoke all on function public.my_org_role(uuid) from public, anon;
grant execute on function public.my_org_role(uuid) to authenticated, service_role;

create or replace function public._org_of_user(p_user uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.organization_id from public.organization_members m where m.user_id = p_user;
$$;
revoke all on function public._org_of_user(uuid) from public, anon, authenticated;

create or replace function public._org_seats_used(p_org uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select (select count(*) from public.organization_members m where m.organization_id = p_org)::integer
       + (select count(*) from public.organization_invites i
           where i.organization_id = p_org and i.accepted_at is null and i.revoked_at is null
             and i.declined_at is null and i.expires_at > now())::integer;
$$;
revoke all on function public._org_seats_used(uuid) from public, anon, authenticated;

create or replace function public._org_log(
  p_org uuid, p_actor uuid, p_action text,
  p_target_type text default null, p_target_id text default null, p_target_label text default null,
  p_project uuid default null, p_document uuid default null, p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org is null then return; end if;
  insert into public.organization_activity
    (organization_id, actor_id, actor_email, action, target_type, target_id, target_label,
     project_id, document_id, details)
  values
    (p_org, p_actor, (select u.email from auth.users u where u.id = p_actor), p_action,
     p_target_type, p_target_id, left(p_target_label, 300), p_project, p_document,
     coalesce(p_details, '{}'::jsonb));
end;
$$;
revoke all on function public._org_log(uuid, uuid, text, text, text, text, uuid, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Policies: members read their company and its people; owners and admins
-- also read invites and the activity log.
-- ---------------------------------------------------------------------------
drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member on public.organizations
  for select to authenticated using (public.my_org_role(id) is not null);

drop policy if exists organization_members_select_member on public.organization_members;
create policy organization_members_select_member on public.organization_members
  for select to authenticated using (public.my_org_role(organization_id) is not null);

drop policy if exists organization_invites_select_admin on public.organization_invites;
create policy organization_invites_select_admin on public.organization_invites
  for select to authenticated using (public.my_org_role(organization_id) in ('owner', 'admin'));

drop policy if exists organization_activity_select_admin on public.organization_activity;
create policy organization_activity_select_admin on public.organization_activity
  for select to authenticated using (public.my_org_role(organization_id) in ('owner', 'admin'));

-- ---------------------------------------------------------------------------
-- Company actions
-- ---------------------------------------------------------------------------
create or replace function public.create_organization(p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_org uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'Give the company a name.' using errcode = '22023';
  end if;
  if public._org_of_user(v_uid) is not null then
    raise exception 'You are already in a company workspace.' using errcode = '23505';
  end if;
  insert into public.organizations (name, created_by) values (v_name, v_uid) returning id into v_org;
  insert into public.organization_members (organization_id, user_id, role, added_by)
    values (v_org, v_uid, 'owner', v_uid);
  perform public._org_log(v_org, v_uid, 'company.created', 'company', v_org::text, v_name);
  return v_org;
end;
$$;

create or replace function public.rename_organization(p_org uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_old text;
begin
  if coalesce(public.my_org_role(p_org), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can rename the company.' using errcode = '42501';
  end if;
  if char_length(v_name) not between 1 and 120 then
    raise exception 'Give the company a name.' using errcode = '22023';
  end if;
  select name into v_old from public.organizations where id = p_org;
  if v_old = v_name then return; end if;
  update public.organizations set name = v_name, updated_at = now() where id = p_org;
  perform public._org_log(p_org, auth.uid(), 'company.renamed', 'company', p_org::text, v_name,
    null, null, jsonb_build_object('from', v_old, 'to', v_name));
end;
$$;

-- The caller's company with its seat and storage figures, or null.
create or replace function public.get_my_organization()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
  v_storage bigint;
begin
  if v_uid is null then return null; end if;
  select o.*, m.role as my_role into v_row
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
   where m.user_id = v_uid;
  if not found then return null; end if;

  -- The pool: every member's real stored bytes in the documents bucket.
  select coalesce(sum((so.metadata->>'size')::bigint), 0) into v_storage
    from storage.objects so
   where so.bucket_id = 'documents'
     and (storage.foldername(so.name))[1] in (
       select m.user_id::text from public.organization_members m where m.organization_id = v_row.id);

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'my_role', v_row.my_role,
    'seat_limit', v_row.seat_limit,
    'seats_used', public._org_seats_used(v_row.id),
    'member_count', (select count(*) from public.organization_members m where m.organization_id = v_row.id),
    'billing_status', v_row.billing_status,
    'storage_limit_bytes', v_row.storage_limit_bytes,
    'storage_used_bytes', v_storage,
    'created_at', v_row.created_at
  );
end;
$$;

-- People in the company, with email, name, join date, last sign-in and the
-- bytes each one stores. Any member may read it (same as a team list).
create or replace function public.list_organization_members(p_org uuid)
returns table (
  user_id uuid, email text, full_name text, role text, joined_at timestamptz,
  last_sign_in_at timestamptz, storage_bytes bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if public.my_org_role(p_org) is null then
    raise exception 'Not a member of this company.' using errcode = '42501';
  end if;
  return query
    select m.user_id,
           u.email::text,
           coalesce(nullif(u.raw_user_meta_data->>'full_name', ''), nullif(u.raw_user_meta_data->>'name', ''))::text,
           m.role,
           m.created_at,
           u.last_sign_in_at,
           coalesce((select sum((so.metadata->>'size')::bigint) from storage.objects so
                      where so.bucket_id = 'documents'
                        and (storage.foldername(so.name))[1] = m.user_id::text), 0)::bigint
      from public.organization_members m
      join auth.users u on u.id = m.user_id
     where m.organization_id = p_org
     order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, u.email;
end;
$$;

create or replace function public.invite_organization_member(p_org uuid, p_email text, p_role text default 'member')
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_role text := coalesce(p_role, 'member');
  v_seats integer;
  v_limit integer;
  v_id uuid;
begin
  if coalesce(public.my_org_role(p_org), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can invite people.' using errcode = '42501';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'That email does not look right.' using errcode = '22023';
  end if;
  if v_role not in ('admin', 'member') then
    raise exception 'Pick admin or member.' using errcode = '22023';
  end if;
  if exists (select 1 from public.organization_members m join auth.users u on u.id = m.user_id
              where m.organization_id = p_org and lower(u.email) = v_email) then
    raise exception '% is already in this company.', v_email using errcode = '23505';
  end if;
  -- An open invite to the same person: send it again rather than add a second.
  select id into v_id from public.organization_invites
   where organization_id = p_org and email = v_email
     and accepted_at is null and revoked_at is null and declined_at is null;
  if v_id is not null then
    update public.organization_invites
       set role = v_role, invited_by = v_uid, expires_at = now() + interval '14 days'
     where id = v_id;
    return v_id;
  end if;

  -- Expired invites stop holding a seat; clear them so the open-invite index
  -- does not block a fresh one.
  update public.organization_invites set revoked_at = now()
   where organization_id = p_org and email = v_email and expires_at <= now()
     and accepted_at is null and revoked_at is null and declined_at is null;

  select seat_limit into v_limit from public.organizations where id = p_org for update;
  v_seats := public._org_seats_used(p_org);
  if v_seats >= v_limit then
    raise exception 'All % seats are taken. Add seats or remove someone first.', v_limit using errcode = '53400';
  end if;

  insert into public.organization_invites (organization_id, email, role, invited_by)
    values (p_org, v_email, v_role, v_uid) returning id into v_id;
  perform public._org_log(p_org, v_uid, 'member.invited', 'invite', v_id::text, v_email,
    null, null, jsonb_build_object('role', v_role));
  return v_id;
end;
$$;

create or replace function public.revoke_organization_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.organization_invites%rowtype;
begin
  select * into v_inv from public.organization_invites where id = p_invite;
  if not found or coalesce(public.my_org_role(v_inv.organization_id), '') not in ('owner', 'admin') then
    raise exception 'Invite not found.' using errcode = '42501';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.declined_at is not null then
    return;
  end if;
  update public.organization_invites set revoked_at = now() where id = p_invite;
  perform public._org_log(v_inv.organization_id, auth.uid(), 'member.invite_canceled', 'invite',
    p_invite::text, v_inv.email);
end;
$$;

-- Invites waiting for the signed-in person (matched on their account email).
create or replace function public.my_organization_invites()
returns table (id uuid, organization_id uuid, organization_name text, role text,
               invited_by_email text, created_at timestamptz, expires_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select i.id, i.organization_id, o.name, i.role, ib.email::text, i.created_at, i.expires_at
    from public.organization_invites i
    join public.organizations o on o.id = i.organization_id
    left join auth.users ib on ib.id = i.invited_by
   where i.email = (select lower(u.email) from auth.users u where u.id = auth.uid())
     and i.accepted_at is null and i.revoked_at is null and i.declined_at is null
     and i.expires_at > now()
   order by i.created_at desc;
$$;

create or replace function public.accept_organization_invite(p_invite uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_inv public.organization_invites%rowtype;
  v_limit integer;
  v_members integer;
begin
  if v_uid is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  select lower(email) into v_email from auth.users where id = v_uid;
  select * into v_inv from public.organization_invites where id = p_invite for update;
  if not found or v_inv.email is distinct from v_email then
    raise exception 'This invite is for a different email.' using errcode = '42501';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.declined_at is not null
     or v_inv.expires_at <= now() then
    raise exception 'This invite has expired or was canceled.' using errcode = '22023';
  end if;
  if public._org_of_user(v_uid) is not null then
    raise exception 'Leave your current company workspace first.' using errcode = '23505';
  end if;
  -- The invite already holds a seat; this only guards a seat cut made after it
  -- was sent.
  select seat_limit into v_limit from public.organizations where id = v_inv.organization_id for update;
  select count(*) into v_members from public.organization_members where organization_id = v_inv.organization_id;
  if v_members >= v_limit then
    raise exception 'This company has no free seats right now. Ask its admin.' using errcode = '53400';
  end if;

  insert into public.organization_members (organization_id, user_id, role, added_by)
    values (v_inv.organization_id, v_uid, v_inv.role, v_inv.invited_by);
  update public.organization_invites set accepted_at = now(), accepted_by = v_uid where id = p_invite;
  perform public._org_log(v_inv.organization_id, v_uid, 'member.joined', 'member', v_uid::text, v_email,
    null, null, jsonb_build_object('role', v_inv.role));
  return v_inv.organization_id;
end;
$$;

create or replace function public.decline_organization_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_inv public.organization_invites%rowtype;
begin
  select lower(email) into v_email from auth.users where id = auth.uid();
  select * into v_inv from public.organization_invites where id = p_invite;
  if not found or v_inv.email is distinct from v_email then
    raise exception 'Invite not found.' using errcode = '42501';
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.declined_at is not null then
    return;
  end if;
  update public.organization_invites set declined_at = now() where id = p_invite;
  perform public._org_log(v_inv.organization_id, auth.uid(), 'member.invite_declined', 'invite',
    p_invite::text, v_email);
end;
$$;

create or replace function public.set_organization_member_role(p_org uuid, p_user uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mine text := public.my_org_role(p_org);
  v_theirs text;
begin
  if p_role not in ('owner', 'admin', 'member') then
    raise exception 'Pick owner, admin or member.' using errcode = '22023';
  end if;
  select role into v_theirs from public.organization_members
   where organization_id = p_org and user_id = p_user for update;
  if v_theirs is null then raise exception 'That person is not in this company.' using errcode = '22023'; end if;
  if v_theirs = p_role then return; end if;
  -- Owners change anyone. Admins move people between admin and member only.
  if v_mine = 'owner' then
    null;
  elsif v_mine = 'admin' and v_theirs <> 'owner' and p_role <> 'owner' then
    null;
  else
    raise exception 'You cannot change this role.' using errcode = '42501';
  end if;
  if v_theirs = 'owner' and (select count(*) from public.organization_members
                              where organization_id = p_org and role = 'owner') <= 1 then
    raise exception 'A company needs at least one owner.' using errcode = '22023';
  end if;
  update public.organization_members set role = p_role where organization_id = p_org and user_id = p_user;
  perform public._org_log(p_org, auth.uid(), 'member.role_changed', 'member', p_user::text,
    (select email from auth.users where id = p_user), null, null,
    jsonb_build_object('from', v_theirs, 'to', p_role));
end;
$$;

-- Take someone out of the company. With p_handoff_to (an owner or admin of
-- the same company), that person gets edit access to every project the
-- leaver made while in the company, so the company keeps its work.
create or replace function public.remove_organization_member(p_org uuid, p_user uuid, p_handoff_to uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mine text := public.my_org_role(p_org);
  v_theirs text;
  v_joined timestamptz;
  v_email text;
  v_handoff_email text;
  v_count integer := 0;
begin
  select role, created_at into v_theirs, v_joined from public.organization_members
   where organization_id = p_org and user_id = p_user for update;
  if v_theirs is null then raise exception 'That person is not in this company.' using errcode = '22023'; end if;
  if p_user = v_uid then
    raise exception 'Use Leave company to take yourself out.' using errcode = '22023';
  end if;
  if not (v_mine = 'owner' or (v_mine = 'admin' and v_theirs <> 'owner')) then
    raise exception 'You cannot remove this person.' using errcode = '42501';
  end if;
  if v_theirs = 'owner' and (select count(*) from public.organization_members
                              where organization_id = p_org and role = 'owner') <= 1 then
    raise exception 'A company needs at least one owner.' using errcode = '22023';
  end if;
  select email into v_email from auth.users where id = p_user;

  if p_handoff_to is not null then
    if p_handoff_to = p_user or coalesce((select role from public.organization_members
         where organization_id = p_org and user_id = p_handoff_to), '') not in ('owner', 'admin') then
      raise exception 'Hand projects to an owner or admin of this company.' using errcode = '22023';
    end if;
    select email into v_handoff_email from auth.users where id = p_handoff_to;
    insert into public.project_collaborators (project_id, user_id, invited_by, role, email, status)
      select p.id, p_handoff_to, v_uid, 'editor', v_handoff_email, 'active'
        from public.projects p
       where p.user_id = p_user and p.created_at >= v_joined
      on conflict (project_id, user_id) do nothing;
    get diagnostics v_count = row_count;
  end if;

  delete from public.organization_members where organization_id = p_org and user_id = p_user;
  perform public._org_log(p_org, v_uid, 'member.removed', 'member', p_user::text, v_email, null, null,
    jsonb_build_object('role', v_theirs, 'projects_handed_off', v_count,
                       'handoff_to', v_handoff_email));
  return v_count;
end;
$$;

create or replace function public.leave_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mine text := public.my_org_role(p_org);
begin
  if v_mine is null then return; end if;
  if v_mine = 'owner' and (select count(*) from public.organization_members
                            where organization_id = p_org and role = 'owner') <= 1 then
    raise exception 'Make someone else an owner first, or delete the company.' using errcode = '22023';
  end if;
  delete from public.organization_members where organization_id = p_org and user_id = v_uid;
  perform public._org_log(p_org, v_uid, 'member.left', 'member', v_uid::text,
    (select email from auth.users where id = v_uid));
end;
$$;

create or replace function public.delete_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.my_org_role(p_org) is distinct from 'owner' then
    raise exception 'Only an owner can delete the company.' using errcode = '42501';
  end if;
  if (select billing_status from public.organizations where id = p_org) in ('active', 'trialing', 'past_due') then
    raise exception 'Cancel the company plan before deleting the company.' using errcode = '22023';
  end if;
  -- Projects and documents belong to the people, not the company: they stay.
  delete from public.organizations where id = p_org;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'create_organization(text)', 'rename_organization(uuid, text)', 'get_my_organization()',
    'list_organization_members(uuid)', 'invite_organization_member(uuid, text, text)',
    'revoke_organization_invite(uuid)', 'my_organization_invites()', 'accept_organization_invite(uuid)',
    'decline_organization_invite(uuid)', 'set_organization_member_role(uuid, uuid, text)',
    'remove_organization_member(uuid, uuid, uuid)', 'leave_organization(uuid)', 'delete_organization(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Activity log, filled by the database
-- ---------------------------------------------------------------------------
-- An event lands in the actor's company and in the company of whoever owns
-- the project or document (they can differ: an outside guest edits a
-- company's drawing). A failure here never blocks the real write.
create or replace function public._org_activity_capture()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_owner uuid;
  v_action text;
  v_type text;
  v_target_id text;
  v_label text;
  v_project uuid;
  v_document uuid;
  v_details jsonb := '{}'::jsonb;
  v_orgs uuid[];
  v_org uuid;
begin
  begin
    if TG_TABLE_NAME = 'projects' then
      v_type := 'project';
      if TG_OP = 'INSERT' then
        v_action := 'project.created'; v_owner := NEW.user_id; v_project := NEW.id; v_label := NEW.name;
      elsif TG_OP = 'UPDATE' then
        if NEW.name is distinct from OLD.name then
          v_action := 'project.renamed'; v_details := jsonb_build_object('from', OLD.name, 'to', NEW.name);
        elsif NEW.user_archived_at is distinct from OLD.user_archived_at then
          v_action := case when NEW.user_archived_at is null then 'project.restored' else 'project.archived' end;
        else
          return NEW;
        end if;
        v_owner := NEW.user_id; v_project := NEW.id; v_label := NEW.name;
      else
        v_action := 'project.deleted'; v_owner := OLD.user_id; v_project := OLD.id; v_label := OLD.name;
      end if;
      v_target_id := v_project::text;

    elsif TG_TABLE_NAME = 'documents' then
      v_type := 'document';
      if TG_OP = 'INSERT' then
        v_action := 'document.uploaded'; v_owner := NEW.user_id; v_document := NEW.id;
        v_project := NEW.project_id; v_label := NEW.name;
        v_details := jsonb_build_object('bytes', NEW.file_size);
      elsif TG_OP = 'UPDATE' then
        if NEW.name is distinct from OLD.name then
          v_action := 'document.renamed'; v_details := jsonb_build_object('from', OLD.name, 'to', NEW.name);
        elsif NEW.project_id is distinct from OLD.project_id then
          v_action := 'document.moved';
          v_details := jsonb_build_object('from_project', OLD.project_id, 'to_project', NEW.project_id);
        else
          return NEW;
        end if;
        v_owner := NEW.user_id; v_document := NEW.id; v_project := NEW.project_id; v_label := NEW.name;
      else
        v_action := 'document.deleted'; v_owner := OLD.user_id; v_document := OLD.id;
        v_project := OLD.project_id; v_label := OLD.name;
        -- A whole project being deleted logs once, as project.deleted.
        if v_project is not null and not exists (select 1 from public.projects p where p.id = v_project) then
          return OLD;
        end if;
      end if;
      v_target_id := v_document::text;

    elsif TG_TABLE_NAME in ('project_collaborators', 'document_collaborators') then
      if TG_TABLE_NAME = 'project_collaborators' then
        v_type := 'project';
        v_project := coalesce(NEW.project_id, OLD.project_id);
        select p.user_id, p.name into v_owner, v_label from public.projects p where p.id = v_project;
      else
        v_type := 'document';
        v_document := coalesce(NEW.document_id, OLD.document_id);
        select d.user_id, d.name, d.project_id into v_owner, v_label, v_project
          from public.documents d where d.id = v_document;
      end if;
      -- Parent already gone (cascade from a delete): the delete itself is logged.
      -- The owner's own row (added when they create it) is not a share.
      if v_owner is null or v_owner = coalesce(NEW.user_id, OLD.user_id) then
        return coalesce(NEW, OLD);
      end if;
      v_target_id := coalesce(v_document, v_project)::text;
      v_details := jsonb_build_object(
        'person', coalesce((select u.email from auth.users u where u.id = coalesce(NEW.user_id, OLD.user_id)),
                           coalesce(NEW.email, OLD.email)),
        'role', coalesce(NEW.role, OLD.role));
      if TG_OP = 'INSERT' then
        v_action := v_type || '.shared';
      elsif TG_OP = 'UPDATE' then
        if NEW.role is not distinct from OLD.role and NEW.status is not distinct from OLD.status then
          return NEW;
        end if;
        v_action := case when NEW.status = 'revoked' then v_type || '.unshared' else v_type || '.role_changed' end;
        v_details := v_details || jsonb_build_object('from', OLD.role);
      else
        v_action := v_type || '.unshared';
      end if;

    elsif TG_TABLE_NAME = 'project_invites' then
      v_type := 'project'; v_project := NEW.project_id; v_target_id := v_project::text;
      select p.user_id, p.name into v_owner, v_label from public.projects p where p.id = v_project;
      v_action := 'project.invite_sent';
      v_details := jsonb_build_object('person', coalesce(NEW.target_email, 'link'), 'role', NEW.intended_role);

    elsif TG_TABLE_NAME = 'document_history_events' then
      -- Markup edits: one "edited" row per person per document per 30 minutes.
      v_actor := coalesce(v_actor, NEW.user_id);
      if v_actor is null then return NEW; end if;
      v_type := 'document'; v_document := NEW.document_id; v_target_id := v_document::text;
      v_action := 'document.edited';
      select d.user_id, d.name, d.project_id into v_owner, v_label, v_project
        from public.documents d where d.id = v_document;
    else
      return coalesce(NEW, OLD);
    end if;

    v_orgs := array_remove(array[public._org_of_user(v_actor), public._org_of_user(v_owner)], null);
    if cardinality(v_orgs) = 0 then return coalesce(NEW, OLD); end if;

    foreach v_org in array (select array_agg(distinct x) from unnest(v_orgs) x) loop
      if v_action = 'document.edited' and exists (
           select 1 from public.organization_activity a
            where a.organization_id = v_org and a.actor_id = v_actor and a.document_id = v_document
              and a.action = 'document.edited' and a.created_at > now() - interval '30 minutes') then
        continue;
      end if;
      perform public._org_log(v_org, v_actor, v_action, v_type, v_target_id, v_label,
        v_project, v_document, v_details);
    end loop;
  exception when others then
    raise warning 'company activity log skipped (%): %', TG_TABLE_NAME, sqlerrm;
  end;
  return coalesce(NEW, OLD);
end;
$$;
revoke all on function public._org_activity_capture() from public, anon, authenticated;

drop trigger if exists org_activity_projects on public.projects;
create trigger org_activity_projects
  after insert or delete or update of name, user_archived_at on public.projects
  for each row execute function public._org_activity_capture();

drop trigger if exists org_activity_documents on public.documents;
create trigger org_activity_documents
  after insert or delete or update of name, project_id on public.documents
  for each row execute function public._org_activity_capture();

drop trigger if exists org_activity_project_collaborators on public.project_collaborators;
create trigger org_activity_project_collaborators
  after insert or delete or update of role, status on public.project_collaborators
  for each row execute function public._org_activity_capture();

drop trigger if exists org_activity_document_collaborators on public.document_collaborators;
create trigger org_activity_document_collaborators
  after insert or delete or update of role, status on public.document_collaborators
  for each row execute function public._org_activity_capture();

drop trigger if exists org_activity_project_invites on public.project_invites;
create trigger org_activity_project_invites
  after insert on public.project_invites
  for each row execute function public._org_activity_capture();

drop trigger if exists org_activity_document_history on public.document_history_events;
create trigger org_activity_document_history
  after insert on public.document_history_events
  for each row execute function public._org_activity_capture();

-- ---------------------------------------------------------------------------
-- Flag. A beta flag, so only Survey Nightly shows it. Keep in step with
-- src/featureFlags.js.
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, mode, description) values
  ('company-admin', 'off', 'Company workspace for Enterprise: people, roles, seats, shared storage and activity log.')
on conflict (key) do nothing;
