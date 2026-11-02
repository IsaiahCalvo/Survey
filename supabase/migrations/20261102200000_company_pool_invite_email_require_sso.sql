-- Enterprise company workspace, three gaps left after #1269 (beta flag
-- 'company-admin', Nightly only):
--
-- 1. Shared storage. A paid company's seated people now fill ONE pool
--    (organizations.storage_limit_bytes, 1 TB by default) instead of each
--    getting their own 1 TB. The byte gate is still the storage.objects
--    trigger (see 20260818010000 for why RLS cannot do it); it now meters the
--    whole company for a seated person. People outside a paid seat keep their
--    own plan's limit, unchanged.
-- 2. Invite emails. organization_invites.emailed_at lets send-invite-email
--    claim one email per invite (and a resend no sooner than 10 minutes
--    later), so a double click or a retry never sends twice.
-- 3. Require company sign-in. An owner or admin can make everyone whose email
--    is at the company's proved domains sign in through the company's SSO.
--    Two layers: the app checks after every sign-in and signs out a session
--    that did not come through SSO, and custom_access_token_hook (Supabase
--    Auth hook, switched on in the project's auth settings) refuses to issue
--    such a token at all. The hook never blocks anyone else, and any error
--    inside it lets the sign-in through, so it cannot lock the app.

-- ---------------------------------------------------------------------------
-- 1. Shared storage pool
-- ---------------------------------------------------------------------------

-- Bytes stored by every person in a company: their documents folder plus the
-- survey photos they uploaded. p_skip_bucket/p_skip_name leave out the object
-- being written, so an overwrite is counted once. (coalesce: with no skip
-- given the test is null, and "not null" would drop every row.)
create or replace function public._company_storage_used(
  p_org uuid, p_skip_bucket text default null, p_skip_name text default null
)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
           select sum((o.metadata->>'size')::bigint)
             from storage.objects o
             join public.organization_members m
               on m.organization_id = p_org
              and o.name like m.user_id::text || '/%'
            where o.bucket_id = 'documents'
              and not coalesce(p_skip_bucket = 'documents' and o.name = p_skip_name, false)
         ), 0)
       + coalesce((
           select sum((o.metadata->>'size')::bigint)
             from storage.objects o
             join public.organization_members m
               on m.organization_id = p_org
              and o.owner_id = m.user_id::text
            where o.bucket_id = 'survey-media'
              and not coalesce(p_skip_bucket = 'survey-media' and o.name = p_skip_name, false)
         ), 0);
$$;
revoke all on function public._company_storage_used(uuid, text, text) from public, anon, authenticated;
grant execute on function public._company_storage_used(uuid, text, text) to service_role;

-- Replaces the 20261001131413 body; the trigger itself is unchanged. Same
-- rules as before (non-growing writes always pass, growing writes lock and
-- meter), plus: a person in a paid company seat meters against the company
-- pool, under one lock per company so two people cannot race past it.
create or replace function public.enforce_documents_storage_quota()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner       uuid;
  v_new_size    bigint;
  v_old_size    bigint := 0;
  v_other_total bigint := 0;
  v_limit       bigint;
  v_org         uuid;
begin
  if NEW.bucket_id = 'documents' then
    begin
      v_owner := (storage.foldername(NEW.name))[1]::uuid;
    exception when others then
      return NEW;
    end;
  elsif NEW.bucket_id = 'survey-media' then
    begin
      v_owner := nullif(NEW.owner_id, '')::uuid;
    exception when others then
      return NEW;
    end;
  else
    return NEW;
  end if;

  if v_owner is null then
    return NEW;
  end if;

  v_new_size := (NEW.metadata->>'size')::bigint;
  if v_new_size is null then
    return NEW;
  end if;

  select coalesce(max((o.metadata->>'size')::bigint), 0)
    into v_old_size
    from storage.objects o
   where o.bucket_id = NEW.bucket_id
     and o.name = NEW.name;

  if v_new_size <= v_old_size then
    return NEW;
  end if;

  -- A paid company seat: the company's shared pool.
  if public._company_seated(v_owner) then
    v_org := public._org_of_user(v_owner);
  end if;
  if v_org is not null then
    perform pg_catalog.pg_advisory_xact_lock(
              pg_catalog.hashtextextended('kal390org:' || v_org::text, 0));
    v_other_total := public._company_storage_used(v_org, NEW.bucket_id, NEW.name);
    select o.storage_limit_bytes into v_limit from public.organizations o where o.id = v_org;
    if v_other_total + v_new_size > v_limit then
      raise exception
        'Company storage is full: this save needs % bytes of the % bytes your company shares.',
        v_other_total + v_new_size, v_limit
        using errcode = '42501',
              hint    = 'Delete documents your company no longer needs, or ask your company owner about more storage.';
    end if;
    return NEW;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended('kal390:' || v_owner::text, 0));

  select coalesce((
           select sum((o.metadata->>'size')::bigint)
             from storage.objects o
            where o.bucket_id = 'documents'
              and o.name like v_owner::text || '/%'
              and not (NEW.bucket_id = 'documents' and o.name = NEW.name)
         ), 0)
       + coalesce((
           select sum((o.metadata->>'size')::bigint)
             from storage.objects o
            where o.bucket_id = 'survey-media'
              and o.owner_id = v_owner::text
              and not (NEW.bucket_id = 'survey-media' and o.name = NEW.name)
         ), 0)
    into v_other_total;

  v_limit := public.get_storage_limit(v_owner);

  if v_other_total + v_new_size > v_limit then
    raise exception
      'Storage quota exceeded: this save needs % bytes of the % bytes allowed on your plan.',
      v_other_total + v_new_size, v_limit
      using errcode = '42501',
            hint    = 'Free space by deleting documents, or upgrade your plan.';
  end if;

  return NEW;
end;
$$;

comment on function public.enforce_documents_storage_quota() is
  'KAL-390 + survey media + company pool (20261102): authoritative storage byte gate. documents bucket owner = first path folder; survey-media owner = uploader. A person in a paid company seat meters against the company''s shared pool (organizations.storage_limit_bytes); everyone else against their own plan. RLS cannot do this job (see 20260818010000). Never blocks a non-growing write.';

-- ---------------------------------------------------------------------------
-- 2. Invite emails
-- ---------------------------------------------------------------------------
alter table public.organization_invites
  add column if not exists emailed_at timestamptz;

-- Claim the email for one open invite. Answers the details the email needs,
-- or null when the caller may not send it, the invite is closed, or it was
-- emailed less than 10 minutes ago.
create or replace function public.claim_company_invite_email(p_invite uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.organization_invites%rowtype;
  v_org text;
begin
  select * into v_inv from public.organization_invites where id = p_invite for update;
  if not found or coalesce(public.my_org_role(v_inv.organization_id), '') not in ('owner', 'admin') then
    return null;
  end if;
  if v_inv.accepted_at is not null or v_inv.revoked_at is not null or v_inv.declined_at is not null
     or v_inv.expires_at <= now() then
    return null;
  end if;
  if v_inv.emailed_at is not null and v_inv.emailed_at > now() - interval '10 minutes' then
    return null;
  end if;
  update public.organization_invites set emailed_at = now() where id = p_invite;
  select o.name into v_org from public.organizations o where o.id = v_inv.organization_id;
  return jsonb_build_object(
    'email', v_inv.email,
    'role', v_inv.role,
    'company_name', v_org,
    'expires_at', v_inv.expires_at
  );
end;
$$;

-- A send that surely failed gives the claim back so the admin can try again.
create or replace function public.release_company_invite_email(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.organization_invites i set emailed_at = null
   where i.id = p_invite
     and coalesce(public.my_org_role(i.organization_id), '') in ('owner', 'admin');
end;
$$;

revoke all on function public.claim_company_invite_email(uuid) from public, anon;
grant execute on function public.claim_company_invite_email(uuid) to authenticated, service_role;
revoke all on function public.release_company_invite_email(uuid) from public, anon;
grant execute on function public.release_company_invite_email(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Require company sign-in
-- ---------------------------------------------------------------------------
alter table public.organizations
  add column if not exists require_sso boolean not null default false;

-- True when a company that has connected SSO and switched "require" on has
-- proved the domain of this email.
create or replace function public._sso_required_for_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.organization_domains d
      join public.organizations o on o.id = d.organization_id
     where d.verified_at is not null
       and o.require_sso
       and o.sso_provider_id is not null
       and d.domain = split_part(lower(btrim(coalesce(p_email, ''))), '@', 2)
  );
$$;
revoke all on function public._sso_required_for_email(text) from public, anon, authenticated;

-- Did this token come from a company (SAML) sign-in? Supabase lists how the
-- session was made in the amr claim; SSO shows as "sso/saml".
create or replace function public._amr_has_sso(p_amr jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(p_amr) = 'array' then p_amr else '[]'::jsonb end) a
     where (case when jsonb_typeof(a) = 'object' then a->>'method' else a #>> '{}' end) like 'sso%'
  );
$$;

-- The sign-in form asks before sending a password: "must this email use SSO?"
-- It names nothing but yes or no for one domain.
create or replace function public.sso_required_for_email(p_email text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public._sso_required_for_email(p_email);
$$;
revoke all on function public.sso_required_for_email(text) from public;
grant execute on function public.sso_required_for_email(text) to anon, authenticated, service_role;

-- The app asks after every sign-in: "must I sign this session out?"
create or replace function public.my_sign_in_needs_sso()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and public._sso_required_for_email((select u.email from auth.users u where u.id = auth.uid()))
     and not public._amr_has_sso(auth.jwt()->'amr');
$$;
revoke all on function public.my_sign_in_needs_sso() from public, anon;
grant execute on function public.my_sign_in_needs_sso() to authenticated, service_role;

create or replace function public.set_organization_require_sso(p_org uuid, p_on boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.organizations%rowtype;
  v_email text;
  v_domains text[];
begin
  if coalesce(public.my_org_role(p_org), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can change this.' using errcode = '42501';
  end if;
  select * into v_row from public.organizations where id = p_org for update;
  if coalesce(p_on, false) = v_row.require_sso then return; end if;
  select array_agg(d.domain order by d.domain) into v_domains
    from public.organization_domains d where d.organization_id = p_org and d.verified_at is not null;
  if p_on then
    if v_row.sso_provider_id is null or coalesce(cardinality(v_domains), 0) = 0 then
      raise exception 'Connect company sign-in for a proved domain first.' using errcode = '22023';
    end if;
    -- Turning it on from a password session at the same domain would lock the
    -- admin out the moment it saves if SSO does not work. Make them prove it
    -- works first by signing in with it.
    select lower(u.email) into v_email from auth.users u where u.id = auth.uid();
    if split_part(v_email, '@', 2) = any (v_domains) and not public._amr_has_sso(auth.jwt()->'amr') then
      raise exception 'Sign out, then sign back in with "Sign in with company SSO" to show it works. Then turn this on.'
        using errcode = '22023';
    end if;
  end if;
  update public.organizations set require_sso = coalesce(p_on, false), updated_at = now() where id = p_org;
  perform public._org_log(p_org, auth.uid(), case when p_on then 'sso.required' else 'sso.optional' end,
    'company', p_org::text, v_row.name, null, null, jsonb_build_object('domains', to_jsonb(coalesce(v_domains, '{}'::text[]))));
end;
$$;
revoke all on function public.set_organization_require_sso(uuid, boolean) from public, anon;
grant execute on function public.set_organization_require_sso(uuid, boolean) to authenticated, service_role;

-- Disconnecting SSO also drops the requirement, or nobody at the domain could
-- sign in at all. company-sso clears sso_provider_id with the service role.
create or replace function public._org_sso_disconnect_clears_require()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if NEW.sso_provider_id is null and OLD.sso_provider_id is not null then
    NEW.require_sso := false;
  end if;
  return NEW;
end;
$$;
revoke all on function public._org_sso_disconnect_clears_require() from public, anon, authenticated;
drop trigger if exists org_sso_disconnect_clears_require on public.organizations;
create trigger org_sso_disconnect_clears_require
  before update of sso_provider_id on public.organizations
  for each row execute function public._org_sso_disconnect_clears_require();

-- Supabase Auth "custom access token" hook. Runs before every token is issued
-- (sign-in and refresh) once it is switched on in the auth settings. It only
-- ever says no to a token for an email at a domain whose company requires SSO
-- when the session did not come from SSO. Everything else, and any error,
-- passes the event through untouched.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  v_email := coalesce(event->'claims'->>'email', '');
  if v_email = '' or position('@' in v_email) = 0 then
    return event;
  end if;
  if not public._sso_required_for_email(v_email) then
    return event;
  end if;
  if public._amr_has_sso(event->'claims'->'amr') then
    return event;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Your company asks you to sign in with your work account. Choose "Sign in with company SSO".'));
exception when others then
  return event;
end;
$$;
revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema public to supabase_auth_admin';
    execute 'grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin';
  end if;
end $$;

-- get_my_organization: the pool now counts survey photos too, and it says
-- whether company sign-in is required.
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
begin
  if v_uid is null then return null; end if;
  select o.*, m.role as my_role into v_row
    from public.organization_members m
    join public.organizations o on o.id = m.organization_id
   where m.user_id = v_uid;
  if not found then return null; end if;

  return jsonb_build_object(
    'id', v_row.id,
    'name', v_row.name,
    'my_role', v_row.my_role,
    'seat_limit', v_row.seat_limit,
    'seats_used', public._org_seats_used(v_row.id),
    'member_count', (select count(*) from public.organization_members m where m.organization_id = v_row.id),
    'billing_status', v_row.billing_status,
    'storage_limit_bytes', v_row.storage_limit_bytes,
    'storage_used_bytes', public._company_storage_used(v_row.id),
    'sso_connected', v_row.sso_provider_id is not null,
    'sso_connected_at', v_row.sso_connected_at,
    'require_sso', v_row.require_sso,
    'my_seat_paid', public._company_seated(v_uid),
    'created_at', v_row.created_at
  );
end;
$$;
revoke all on function public.get_my_organization() from public, anon;
grant execute on function public.get_my_organization() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Flag for the "Continue with Microsoft" sign-in button. A beta flag, so
-- only Survey Nightly shows it. Keep in step with src/featureFlags.js.
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, mode, description) values
  ('microsoft-sign-in', 'off', 'Continue with Microsoft on the sign-in form (Supabase Azure sign-in).')
on conflict (key) do nothing;
