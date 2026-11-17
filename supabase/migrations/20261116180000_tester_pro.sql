-- KAL-649: Pro free for the people testing Survey.
--
-- Outside testers start on Free, where sharing, projects past the first and
-- documents past the fifth are shut. The switch 'tester-pro' at /flags (Off /
-- Testers / Everyone, with its tester email list) gives the people it names a
-- Pro plan with no card: their user_subscriptions row becomes tier 'pro',
-- status 'trialing', marked tester_grant. Every rule that reads a plan
-- (get_user_tier, my_effective_tier, invite accept, limits) sees an ordinary
-- Pro row, so nothing else needs to know about testers.
--
-- A row someone pays for (a Stripe subscription id) is never touched, either
-- way. Taking an email off the list (or the switch Off) puts only rows this
-- switch gave back to Free. Their documents are kept: past the Free limits a
-- person can still open everything but cannot add more, as after any downgrade.

alter table public.user_subscriptions
  add column if not exists tester_grant boolean not null default false;

insert into public.feature_flags (key, mode, tester_emails, description)
values ('tester-pro', 'off', '{}',
        'The people listed here (or everyone, with Everyone) get Pro with no card. Taking someone off puts them back on Free; paid plans are never touched.')
on conflict (key) do nothing;

-- Does the switch give this person Pro?
create or replace function public._tester_pro_wanted(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.feature_flags f
      join auth.users u on u.id = p_user
     where f.key = 'tester-pro'
       and (f.mode = 'on'
            or (f.mode = 'testers'
                and coalesce(lower(u.email), '') <> ''
                and lower(u.email) = any (f.tester_emails)))
       and not coalesce(u.is_anonymous, false)
  );
$$;
revoke all on function public._tester_pro_wanted(uuid) from public, anon, authenticated;
grant execute on function public._tester_pro_wanted(uuid) to service_role;

-- Bring every row in line with the switch.
create or replace function public.sync_tester_pro()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- People listed who have no plan row yet.
  insert into public.user_subscriptions (user_id, tier, status, tester_grant)
  select u.id, 'pro', 'trialing', true
    from auth.users u
   where public._tester_pro_wanted(u.id)
     and not exists (select 1 from public.user_subscriptions s where s.user_id = u.id)
  on conflict (user_id) do nothing;

  -- Listed and on Free (never a paid row).
  update public.user_subscriptions s
     set tier = 'pro', status = 'trialing', tester_grant = true
   where s.stripe_subscription_id is null
     and not s.tester_grant
     and s.tier = 'free'
     and public._tester_pro_wanted(s.user_id);

  -- Given by this switch, no longer listed.
  update public.user_subscriptions s
     set tier = 'free', status = 'active', tester_grant = false
   where s.tester_grant
     and s.stripe_subscription_id is null
     and not public._tester_pro_wanted(s.user_id);

  -- Someone who started paying keeps their plan; drop the mark.
  update public.user_subscriptions s
     set tester_grant = false
   where s.tester_grant
     and s.stripe_subscription_id is not null;
end;
$$;
revoke all on function public.sync_tester_pro() from public, anon, authenticated;
grant execute on function public.sync_tester_pro() to service_role;

create or replace function public.feature_flags_sync_tester_pro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.key = 'tester-pro' then
    perform public.sync_tester_pro();
  end if;
  return null;
end;
$$;
revoke all on function public.feature_flags_sync_tester_pro() from public, anon, authenticated;

drop trigger if exists feature_flags_sync_tester_pro on public.feature_flags;
create trigger feature_flags_sync_tester_pro
  after insert or update on public.feature_flags
  for each row execute function public.feature_flags_sync_tester_pro();

-- A listed person who signs up later starts on Pro: the plan row made at
-- sign-up (handle_new_user_subscription) is lifted as it is written.
create or replace function public.user_subscriptions_tester_pro()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tier = 'free' and new.stripe_subscription_id is null
     and public._tester_pro_wanted(new.user_id) then
    new.tier := 'pro';
    new.status := 'trialing';
    new.tester_grant := true;
  end if;
  return new;
end;
$$;
revoke all on function public.user_subscriptions_tester_pro() from public, anon, authenticated;

drop trigger if exists user_subscriptions_tester_pro on public.user_subscriptions;
create trigger user_subscriptions_tester_pro
  before insert on public.user_subscriptions
  for each row execute function public.user_subscriptions_tester_pro();
