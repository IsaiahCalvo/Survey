-- Kal Voe suite billing (KAL-856).
--
-- One Stripe account (Survey's) sells Survey Pro, Walkthru Pro, Plot Pro and
-- the Kal Voe Suite. A purchase can start on kalvoe.com, in Walkthru or in
-- Survey, so it is keyed by the email the buyer paid with, not by a Survey
-- user id. stripe-webhook writes one row per Stripe subscription here; each
-- app asks which plans an email holds:
--   - Survey reads it directly (apply_suite_plan below turns a Survey or
--     Suite plan into an ordinary Pro row in user_subscriptions);
--   - Walkthru asks the suite-entitlement edge function with a shared key.
--
-- A plan is only ever matched to an account whose email is CONFIRMED, so
-- nobody can claim a paid plan by signing up with someone else's address.

create table if not exists public.suite_entitlements (
  stripe_subscription_id text primary key,
  stripe_customer_id text not null,
  stripe_price_id text,
  email text not null check (email = lower(email) and email <> ''),
  plan text not null check (plan in ('survey', 'walkthru', 'plot', 'suite')),
  status text not null,
  current_period_end timestamptz,
  cancel_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suite_entitlements_email_idx on public.suite_entitlements (email);

alter table public.suite_entitlements enable row level security;

-- Signed-in people may read the plans bought with their own confirmed email.
-- Writes are service-role only (the webhook).
drop policy if exists "Read own suite plans" on public.suite_entitlements;
create policy "Read own suite plans" on public.suite_entitlements
  for select to authenticated
  using (
    email = (
      select lower(u.email) from auth.users u
       where u.id = auth.uid() and u.email_confirmed_at is not null
    )
  );

revoke all on public.suite_entitlements from anon;
grant select on public.suite_entitlements to authenticated;

-- Which apps does this email hold right now? A Suite plan holds all three.
create or replace function public.suite_apps_for_email(p_email text)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct app order by app), '{}')
    from public.suite_entitlements e
    cross join lateral unnest(
      case when e.plan = 'suite' then array['survey', 'walkthru', 'plot'] else array[e.plan] end
    ) as app
   where e.email = lower(trim(coalesce(p_email, '')))
     and e.status in ('active', 'trialing', 'past_due');
$$;
revoke all on function public.suite_apps_for_email(text) from public, anon, authenticated;
grant execute on function public.suite_apps_for_email(text) to service_role;

-- Give a Survey account the Pro plan its email paid for (a Survey or Suite
-- plan bought outside the app). Only rows with no Stripe subscription of
-- their own, or already tied to this one, are touched; developer and
-- enterprise rows never are.
create or replace function public.apply_suite_plan(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  e public.suite_entitlements%rowtype;
begin
  select lower(u.email) into v_email
    from auth.users u
   where u.id = p_user
     and u.email_confirmed_at is not null
     and not coalesce(u.is_anonymous, false);
  if coalesce(v_email, '') = '' then return; end if;

  select * into e
    from public.suite_entitlements s
   where s.email = v_email
     and s.plan in ('survey', 'suite')
     and s.status in ('active', 'trialing', 'past_due')
   order by s.current_period_end desc nulls last
   limit 1;
  if not found then return; end if;

  update public.user_subscriptions us
     set tier = 'pro',
         status = (case e.status when 'trialing' then 'trialing' when 'past_due' then 'past_due' else 'active' end)::public.subscription_status,
         tester_grant = false,
         stripe_subscription_id = e.stripe_subscription_id,
         stripe_price_id = e.stripe_price_id,
         current_period_end = e.current_period_end,
         stripe_customer_id = coalesce(
           us.stripe_customer_id,
           case when exists (select 1 from public.user_subscriptions o
                              where o.stripe_customer_id = e.stripe_customer_id)
                then null else e.stripe_customer_id end)
   where us.user_id = p_user
     and us.tier in ('free', 'pro')
     and (us.stripe_subscription_id is null or us.stripe_subscription_id = e.stripe_subscription_id);
end;
$$;
revoke all on function public.apply_suite_plan(uuid) from public, anon, authenticated;
grant execute on function public.apply_suite_plan(uuid) to service_role;

-- The webhook calls this after it records a plan: every confirmed account
-- with that email gets it (there is at most one).
create or replace function public.apply_suite_plan_for_email(p_email text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  select u.id into v_user
    from auth.users u
   where lower(u.email) = lower(trim(coalesce(p_email, '')))
     and u.email_confirmed_at is not null
     and not coalesce(u.is_anonymous, false)
   limit 1;
  if v_user is null then return null; end if;
  perform public.apply_suite_plan(v_user);
  return v_user;
end;
$$;
revoke all on function public.apply_suite_plan_for_email(text) from public, anon, authenticated;
grant execute on function public.apply_suite_plan_for_email(text) to service_role;

-- Someone who paid on kalvoe.com before making a Survey account gets Pro the
-- moment their email is confirmed (Google and Microsoft sign-ins arrive
-- confirmed). Runs after on_auth_user_created_subscription made the Free row.
create or replace function public.auth_user_suite_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email_confirmed_at is not null then
    perform public.apply_suite_plan(new.id);
  end if;
  return new;
exception when others then
  -- Never block a sign-up or sign-in over a plan lookup.
  raise warning 'auth_user_suite_plan: %', sqlerrm;
  return new;
end;
$$;
revoke all on function public.auth_user_suite_plan() from public, anon, authenticated;

drop trigger if exists on_auth_user_z_suite_plan on auth.users;
create trigger on_auth_user_z_suite_plan
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.auth_user_suite_plan();
