-- Outside agents sign in through Supabase's OAuth server and get an access
-- token for the person. Supabase Auth accepts that token on its own account
-- endpoints too, so an agent could change the person's password, start an
-- email change, or approve another agent's consent (which survives removing
-- the first agent). Auth has no setting to stop OAuth tokens there, and it
-- does not tell the database who is asking, so the person's app says so first:
--
--   1. The app calls begin_auth_change('password' | 'email' | 'consent') with
--      the person's own token. Agent tokens are refused (is_agent_session()).
--   2. Triggers on auth.users and auth.oauth_consents let the change through
--      only when that person asked for it in the last 2 minutes, and use up
--      the ask.
--
-- Not guarded: sign-up before the account is confirmed, confirming an email
-- change from its link, and revoking a consent.
-- Service-role callers (the E2E seed) pass the user id to begin_auth_change.

create table if not exists public.auth_change_intents (
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('password', 'email', 'consent')),
  -- For 'consent': the agent (OAuth client id) the person is letting in, so
  -- another agent cannot spend the ask on itself. '' for the others.
  target text not null default '',
  created_at timestamptz not null default now(),
  primary key (user_id, action, target)
);

alter table public.auth_change_intents enable row level security;
revoke all on table public.auth_change_intents from public, anon, authenticated;
grant all on table public.auth_change_intents to service_role;

create or replace function public.begin_auth_change(p_action text, p_user_id uuid default null, p_target text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if p_action not in ('password', 'email', 'consent') then
    raise exception 'unknown account change' using errcode = '22023';
  end if;
  if (p_action = 'consent') <> (coalesce(p_target, '') <> '') then
    raise exception 'a consent names its agent; nothing else does' using errcode = '22023';
  end if;
  if auth.role() = 'service_role' and p_user_id is not null then
    v_user := p_user_id;
  elsif v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  elsif public.is_agent_session() then
    raise exception 'agents cannot change the account' using errcode = '42501';
  end if;
  insert into public.auth_change_intents (user_id, action, target, created_at)
  values (v_user, p_action, coalesce(p_target, ''), now())
  on conflict (user_id, action, target) do update set created_at = excluded.created_at;
end;
$$;

revoke all on function public.begin_auth_change(text, uuid, text) from public, anon;
grant execute on function public.begin_auth_change(text, uuid, text) to authenticated, service_role;

-- True (and used up) when the person asked for this change in the last 2 minutes.
create or replace function public.take_auth_change_intent(p_user_id uuid, p_action text, p_target text default '')
returns boolean
language sql
security definer
set search_path = ''
as $$
  with used as (
    delete from public.auth_change_intents
     where user_id = p_user_id and action = p_action and target = p_target
       and created_at > now() - interval '2 minutes'
    returning 1
  )
  select exists (select 1 from used);
$$;

revoke all on function public.take_auth_change_intent(uuid, text, text) from public, anon, authenticated;

create or replace function public.guard_account_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A new password. Unconfirmed accounts (sign-up again before confirming)
  -- have no owner yet, so they pass. A reset link's page is the person's own
  -- session and asks first like Settings does; anyone can make Auth send a
  -- reset email, so its timestamp proves nothing.
  if coalesce(new.encrypted_password, '') <> ''
     and new.encrypted_password is distinct from old.encrypted_password
     and (old.email_confirmed_at is not null or old.phone_confirmed_at is not null)
     and not public.take_auth_change_intent(new.id, 'password') then
    raise exception 'account_change_needs_the_person' using errcode = '42501',
      hint = 'Call begin_auth_change(''password'') with the person''s own session first.';
  end if;

  -- Asking for a new email, or setting one directly. Confirming a requested
  -- change from its link (email becomes the pending address) passes.
  if ((coalesce(new.email_change, '') <> '' and new.email_change is distinct from old.email_change)
      or (new.email is distinct from old.email and new.email is distinct from old.email_change))
     and old.email_confirmed_at is not null
     and not public.take_auth_change_intent(new.id, 'email') then
    raise exception 'account_change_needs_the_person' using errcode = '42501',
      hint = 'Call begin_auth_change(''email'') with the person''s own session first.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_account_change() from public, anon, authenticated;

-- Created only when missing: dropping a trigger on an auth table needs its
-- owner (supabase_auth_admin), creating one only the TRIGGER grant.
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'guard_account_change' and tgrelid = 'auth.users'::regclass) then
    create trigger guard_account_change
      before update of encrypted_password, email, email_change on auth.users
      for each row execute function public.guard_account_change();
  end if;
end;
$$;

-- Letting an agent in. Auth writes the consent in the same transaction that
-- approves the request, so refusing here refuses the approval. It inserts a
-- new consent, or updates the old row (new granted_at, revoked_at cleared)
-- when that agent was let in before, so both are guarded. Revoking only
-- sets revoked_at and passes.
create or replace function public.guard_oauth_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and new.granted_at is not distinct from old.granted_at
     and new.scopes is not distinct from old.scopes
     and not (old.revoked_at is not null and new.revoked_at is null) then
    return new;
  end if;
  if not public.take_auth_change_intent(new.user_id, 'consent', new.client_id::text) then
    raise exception 'account_change_needs_the_person' using errcode = '42501',
      hint = 'Call begin_auth_change(''consent'') with the person''s own session first.';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_oauth_consent() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'guard_oauth_consent' and tgrelid = 'auth.oauth_consents'::regclass) then
    create trigger guard_oauth_consent
      before insert or update on auth.oauth_consents
      for each row execute function public.guard_oauth_consent();
  end if;
end;
$$;
