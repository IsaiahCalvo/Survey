-- Live two-way sync between a survey and a spreadsheet, run on the server so
-- phones, the web and the desktop app all sync (supabase/functions/sheet-sync,
-- engine in supabase/functions/_shared/sheetSync). Google Sheets first;
-- Microsoft 365 workbooks use the same tables (provider 'msgraph').
--
-- 1. The beta flag. Survey Nightly turns beta flags on in the app; the
--    function also lets flag admins and testers (can_use_nightly) link sheets.
insert into public.feature_flags (key, mode, description) values
  ('sheet-team-sync', 'off', 'Live two-way team sync with Google Sheets and Microsoft 365 workbooks (server-side, every device).')
on conflict (key) do nothing;

-- 2. One person's sign-in to a spreadsheet provider. The refresh token is
--    encrypted by the function (tokenCrypto.js); no client can read or write
--    this table, not even its owner.
create table if not exists public.sheet_sync_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'msgraph')),
  account_email text,
  refresh_token_enc text not null,
  scopes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.sheet_sync_connections enable row level security;
revoke all on public.sheet_sync_connections from anon, authenticated;
comment on table public.sheet_sync_connections is
  'Encrypted provider refresh tokens for live sheet sync. Server only (sheet-sync function, service role).';

-- 3. A survey (document + template) linked to one spreadsheet. The baseline
--    is what both sides last agreed on per marker (field fingerprints, not
--    values); state holds the tab map, open conflicts and rows deleted in the
--    sheet. Everyone who can open the document may read its links (the app
--    shows "Live in Google Sheets"); only the function writes.
create table if not exists public.sheet_sync_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents (id) on delete cascade,
  template_id text not null,
  provider text not null check (provider in ('google', 'msgraph')),
  -- Whose provider sign-in the server uses to reach the file.
  connection_user_id uuid not null references auth.users (id) on delete cascade,
  file_id text not null,
  file_url text,
  title text,
  layout jsonb not null,
  baseline jsonb not null default '{}'::jsonb,
  state jsonb not null default '{}'::jsonb,
  remote_version text,
  app_hash text,
  status text not null default 'active' check (status in ('active', 'paused', 'broken')),
  last_round_at timestamptz,
  last_error text,
  lease_until timestamptz,
  backoff_until timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (document_id, template_id, provider)
);
create index if not exists sheet_sync_links_connection_idx on public.sheet_sync_links (connection_user_id);
alter table public.sheet_sync_links enable row level security;
revoke all on public.sheet_sync_links from anon, authenticated;
grant select (id, document_id, template_id, provider, file_url, title, status, last_round_at, last_error, created_by, created_at)
  on public.sheet_sync_links to authenticated;

drop policy if exists "Document readers see its sheet links" on public.sheet_sync_links;
create policy "Document readers see its sheet links"
  on public.sheet_sync_links for select to authenticated
  using (public.user_can_access_document(document_id, 'viewer'));

-- 4. One round at a time per link: the function takes a short lease before
--    reading the sheet and gives it back when it saves. Service role only.
create or replace function public.sheet_sync_take_lease(p_link_id uuid, p_seconds integer default 45)
returns boolean
language sql
security definer
set search_path = public
as $$
  with taken as (
    update public.sheet_sync_links
       set lease_until = now() + make_interval(secs => greatest(5, least(p_seconds, 300)))
     where id = p_link_id
       and (lease_until is null or lease_until < now())
    returning 1
  )
  select exists (select 1 from taken);
$$;
revoke all on function public.sheet_sync_take_lease(uuid, integer) from public, anon, authenticated;
grant execute on function public.sheet_sync_take_lease(uuid, integer) to service_role;
