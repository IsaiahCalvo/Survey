-- Company sign-in setup for the Enterprise company workspace (beta flag
-- 'company-admin'). An owner or admin adds their email domain, proves they
-- own it with one DNS line (the company-sso function checks it), then
-- connects their company login (SAML) themselves. Survey uses Supabase's own
-- SAML sign-in; this only keeps track of which company owns which domain and
-- which Supabase sign-on connection.

create table if not exists public.organization_domains (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  domain             text not null
                       check (domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
                              and char_length(domain) <= 253),
  verification_token text not null default replace(gen_random_uuid()::text, '-', ''),
  verified_at        timestamptz,
  created_by         uuid references auth.users(id) on delete set null,
  created_at         timestamptz not null default now(),
  unique (organization_id, domain)
);
-- Two companies may both say they own a domain; only one can prove it.
create unique index if not exists organization_domains_proved_once
  on public.organization_domains (domain) where verified_at is not null;

alter table public.organization_domains enable row level security;
revoke insert, update, delete, truncate on public.organization_domains from anon, authenticated;
revoke all on public.organization_domains from anon;

drop policy if exists organization_domains_select_admin on public.organization_domains;
create policy organization_domains_select_admin on public.organization_domains
  for select to authenticated using (public.my_org_role(organization_id) in ('owner', 'admin'));

alter table public.organizations
  add column if not exists sso_provider_id uuid,
  add column if not exists sso_connected_at timestamptz;

-- The company-sso function (service role) writes the log for checks and
-- connections it makes.
grant execute on function public._org_log(uuid, uuid, text, text, text, text, uuid, uuid, jsonb) to service_role;

-- Free mail services: nobody owns gmail.com, so no company may claim it.
create or replace function public._is_public_mail_domain(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_domain = any (array[
    'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
    'yahoo.com', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me',
    'protonmail.com', 'gmx.com', 'gmx.net', 'mail.com', 'zoho.com', 'yandex.com',
    'hey.com', 'fastmail.com'
  ]);
$$;

create or replace function public.add_organization_domain(p_org uuid, p_domain text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain text := lower(btrim(coalesce(p_domain, '')));
  v_id uuid;
begin
  if coalesce(public.my_org_role(p_org), '') not in ('owner', 'admin') then
    raise exception 'Only an owner or admin can add a domain.' using errcode = '42501';
  end if;
  -- Take "jane@acme.com", "https://acme.com/" or "www.acme.com" as acme.com.
  v_domain := regexp_replace(v_domain, '^.*@', '');
  v_domain := regexp_replace(v_domain, '^[a-z]+://', '');
  v_domain := regexp_replace(v_domain, '[/:].*$', '');
  v_domain := regexp_replace(v_domain, '^www\.', '');
  v_domain := rtrim(v_domain, '.');
  if v_domain !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'That does not look like a domain. Type it like acme.com.' using errcode = '22023';
  end if;
  if public._is_public_mail_domain(v_domain) then
    raise exception '% is a public mail service, so no company can claim it.', v_domain using errcode = '22023';
  end if;
  if exists (select 1 from public.organization_domains d
              where d.domain = v_domain and d.verified_at is not null and d.organization_id <> p_org) then
    raise exception 'Another company has already proved it owns %.', v_domain using errcode = '23505';
  end if;
  select id into v_id from public.organization_domains where organization_id = p_org and domain = v_domain;
  if v_id is not null then return v_id; end if;
  if (select count(*) from public.organization_domains where organization_id = p_org) >= 20 then
    raise exception 'A company can have up to 20 domains.' using errcode = '53400';
  end if;
  insert into public.organization_domains (organization_id, domain, created_by)
    values (p_org, v_domain, auth.uid()) returning id into v_id;
  perform public._org_log(p_org, auth.uid(), 'domain.added', 'domain', v_id::text, v_domain);
  return v_id;
end;
$$;

create or replace function public.remove_organization_domain(p_domain_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.organization_domains%rowtype;
begin
  select * into v_row from public.organization_domains where id = p_domain_id;
  if not found or coalesce(public.my_org_role(v_row.organization_id), '') not in ('owner', 'admin') then
    raise exception 'Domain not found.' using errcode = '42501';
  end if;
  if v_row.verified_at is not null
     and (select sso_provider_id from public.organizations where id = v_row.organization_id) is not null then
    raise exception 'Disconnect company sign-in before removing a proved domain.' using errcode = '22023';
  end if;
  delete from public.organization_domains where id = p_domain_id;
  perform public._org_log(v_row.organization_id, auth.uid(), 'domain.removed', 'domain', p_domain_id::text, v_row.domain);
end;
$$;

revoke all on function public.add_organization_domain(uuid, text) from public, anon;
grant execute on function public.add_organization_domain(uuid, text) to authenticated, service_role;
revoke all on function public.remove_organization_domain(uuid) from public, anon;
grant execute on function public.remove_organization_domain(uuid) to authenticated, service_role;

-- get_my_organization also says whether company sign-in is connected.
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
    'sso_connected', v_row.sso_provider_id is not null,
    'sso_connected_at', v_row.sso_connected_at,
    'created_at', v_row.created_at
  );
end;
$$;
