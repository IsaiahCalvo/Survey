-- Feature flags: one switch per unfinished feature, so new work can ship in
-- the code but stay hidden until it is ready. Each flag is:
--   off      -> hidden for everyone
--   testers  -> on only for the emails in tester_emails
--   on       -> on for everyone
-- The app reads its own answers through get_my_feature_flags(); tester emails
-- are never sent to anyone but a flag admin. Admins change flags at /flags.
-- The client registry of flag keys lives in src/featureFlags.js.

create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  mode text not null default 'off' check (mode in ('off', 'testers', 'on')),
  tester_emails text[] not null default '{}',
  description text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.feature_flags is
  'On/off switches for unfinished features. Read via get_my_feature_flags(); only rows in feature_flag_admins can see or change them directly.';

-- Who may change flags. Seeded by hand (never in this public repo).
create table if not exists public.feature_flag_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);

alter table public.feature_flags enable row level security;
alter table public.feature_flag_admins enable row level security;

create or replace function public.is_feature_flag_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and not public.is_agent_session()
     and exists (select 1 from public.feature_flag_admins a where a.user_id = auth.uid());
$$;

revoke all on function public.is_feature_flag_admin() from public;
grant execute on function public.is_feature_flag_admin() to anon, authenticated, service_role;

drop policy if exists "Flag admins read flags" on public.feature_flags;
create policy "Flag admins read flags"
  on public.feature_flags for select to authenticated
  using (public.is_feature_flag_admin());

drop policy if exists "Flag admins add flags" on public.feature_flags;
create policy "Flag admins add flags"
  on public.feature_flags for insert to authenticated
  with check (public.is_feature_flag_admin());

drop policy if exists "Flag admins change flags" on public.feature_flags;
create policy "Flag admins change flags"
  on public.feature_flags for update to authenticated
  using (public.is_feature_flag_admin())
  with check (public.is_feature_flag_admin());

drop policy if exists "Flag admins see admins" on public.feature_flag_admins;
create policy "Flag admins see admins"
  on public.feature_flag_admins for select to authenticated
  using (public.is_feature_flag_admin());

-- Stamp who changed a flag and when, and keep tester emails tidy.
create or replace function public.feature_flags_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.tester_emails := coalesce(
    (select array_agg(distinct e order by e)
       from (select lower(trim(x)) as e from unnest(new.tester_emails) x) t
      where e <> ''),
    '{}');
  return new;
end;
$$;

drop trigger if exists feature_flags_stamp on public.feature_flags;
create trigger feature_flags_stamp
  before insert or update on public.feature_flags
  for each row execute function public.feature_flags_stamp();

-- The caller's own answers: { "smart-fill": true, ... }. Works signed out
-- too (only flags that are on for everyone come back true).
create or replace function public.get_my_feature_flags()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(f.key,
           f.mode = 'on'
           or (f.mode = 'testers'
               and coalesce(lower(auth.jwt() ->> 'email'), '') <> ''
               and lower(auth.jwt() ->> 'email') = any (f.tester_emails))),
         '{}'::jsonb)
    from public.feature_flags f;
$$;

revoke all on function public.get_my_feature_flags() from public;
grant execute on function public.get_my_feature_flags() to anon, authenticated, service_role;

-- Today's unfinished features, all hidden. Keep in step with src/featureFlags.js.
insert into public.feature_flags (key, mode, description) values
  ('smart-fill', 'off', 'Smart fill: tap inside a tag to mark its outline.')
on conflict (key) do nothing;
