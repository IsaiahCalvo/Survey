-- Survey Nightly (surveytool-nightly.vercel.app) turns every beta feature on
-- and shares this database, so only the people who run Survey and the testers
-- they list at /flags may use it. The nightly app asks this once a person
-- signs in; everyone else is pointed back to surveytool.app. Not a security
-- boundary (beta features keep their own server checks); it keeps strangers
-- off unfinished features.
create or replace function public.can_use_nightly()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and not public.is_agent_session()
     and (
       exists (select 1 from public.feature_flag_admins a where a.user_id = auth.uid())
       or exists (
         select 1 from public.feature_flags f
          where coalesce(lower(auth.jwt() ->> 'email'), '') <> ''
            and lower(auth.jwt() ->> 'email') = any (f.tester_emails)
       )
     );
$$;

revoke all on function public.can_use_nightly() from public;
grant execute on function public.can_use_nightly() to anon, authenticated, service_role;
