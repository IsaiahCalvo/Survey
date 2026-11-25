-- The sign-in form asks after a password fails: "does this email's company
-- sign in with its own work account?" When yes, the form moves the person to
-- company sign-in instead of leaving them on "email and password don't
-- match". It names nothing but yes or no for one domain, the same thing
-- Supabase's own SSO lookup already tells anyone who tries the domain.
create or replace function public.company_sign_in_for_email(p_email text)
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
       and o.sso_provider_id is not null
       and d.domain = split_part(lower(btrim(coalesce(p_email, ''))), '@', 2)
  );
$$;
revoke all on function public.company_sign_in_for_email(text) from public;
grant execute on function public.company_sign_in_for_email(text) to anon, authenticated, service_role;
