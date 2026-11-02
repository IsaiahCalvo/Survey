-- Live sheet sync: a Google or Microsoft sign-in is finished by the Survey
-- account that started it, in that person's own browser or app.
--
-- Before: the provider's consent page sent the person back to the sheet-sync
-- function, which saved the sign-in straight onto the Survey account named in
-- the signed `state`. Anyone with beta access could start Connect Google, send
-- the consent link to someone else, and if that person said yes, their Google
-- account was linked to the sender's Survey account.
--
-- Now the function parks the sign-in here with a one-time code and hands the
-- code only to the browser that finished consent. The sign-in becomes a
-- connection only when the Survey account that started it sends that code
-- back (service.js action 'claim'): the web app reads it from the page the
-- consent tab lands on; the desktop and phone apps ask the person to type the
-- short code that page shows. A stranger who says yes on the sender's link
-- keeps the code in their own browser; the sender never sees it.
create table if not exists public.sheet_sync_pending_connections (
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('google', 'msgraph')),
  code_hash text not null,
  account_email text,
  refresh_token_enc text not null,
  scopes text,
  attempts integer not null default 0,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, provider)
);
alter table public.sheet_sync_pending_connections enable row level security;
revoke all on public.sheet_sync_pending_connections from anon, authenticated;
comment on table public.sheet_sync_pending_connections is
  'Provider sign-ins waiting for the Survey account that started them to claim them with a one-time code. Server only (sheet-sync function, service role).';
