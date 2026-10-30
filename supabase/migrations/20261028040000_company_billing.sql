-- Seats on one bill for the Enterprise company workspace (beta flag
-- 'company-admin'). The payments listener (stripe-webhook, service role) is
-- the only writer of a company's billing_status and seat_limit. While a
-- company's plan is active or trialing, its first seat_limit people (by join
-- date) are on Enterprise wherever the server checks a plan: limits, the
-- project update rule and invite acceptance. A person's own Pro or Free plan
-- is never changed; the company plan only lifts it.

alter table public.organizations
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text;
create unique index if not exists organizations_stripe_subscription
  on public.organizations (stripe_subscription_id) where stripe_subscription_id is not null;

create or replace function public._company_seated(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select s.rn <= s.seat_limit
      from (
        select m.user_id, o.seat_limit,
               row_number() over (order by m.created_at, m.user_id) as rn
          from public.organization_members m
          join public.organizations o on o.id = m.organization_id
         where m.organization_id = (select x.organization_id from public.organization_members x where x.user_id = p_user)
           and o.billing_status in ('active', 'trialing')
      ) s
     where s.user_id = p_user
  ), false);
$$;
revoke all on function public._company_seated(uuid) from public, anon, authenticated;
grant execute on function public._company_seated(uuid) to service_role;

-- The plan the app shows: the person's own plan while it is active or in
-- trial, lifted to Enterprise by a paid company seat.
create or replace function public.my_effective_tier()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_tier text;
begin
  if v_uid is null then return 'free'; end if;
  select s.tier::text into v_tier from public.user_subscriptions s
   where s.user_id = v_uid and s.status in ('active', 'trialing');
  v_tier := coalesce(v_tier, 'free');
  if v_tier in ('free', 'pro') and public._company_seated(v_uid) then
    v_tier := 'enterprise';
  end if;
  return v_tier;
end;
$$;
revoke all on function public.my_effective_tier() from public, anon;
grant execute on function public.my_effective_tier() to authenticated, service_role;

-- Who may be added as a collaborator: a paid company seat counts as paid.
create or replace function public.check_user_collaborator_eligibility(target_user_id uuid)
returns table(user_id uuid, email text, tier text, can_collaborate boolean, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
    return query
    with t as (
      select u.id, u.email::text as email,
             case when coalesce(s.tier::text, 'free') in ('free', 'pro') and public._company_seated(u.id)
                  then 'enterprise' else coalesce(s.tier::text, 'free') end as tier
        from auth.users u
        left join user_subscriptions s on s.user_id = u.id and s.status in ('active', 'trialing')
       where u.id = target_user_id
    )
    select t.id, t.email, t.tier,
           t.tier <> 'free',
           case when t.tier = 'free' then
             'This user is on the Free plan and cannot be added as a collaborator. They need to upgrade to Pro or higher to collaborate on documents.'
           else null end
      from t;
end;
$function$;

-- Every server limit reads this.
CREATE OR REPLACE FUNCTION public.get_user_tier(p_user_id uuid)
 RETURNS subscription_tier
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    user_tier_text TEXT;
BEGIN
    p_user_id := COALESCE(auth.uid(), p_user_id);

    SELECT tier::text INTO user_tier_text
    FROM user_subscriptions
    WHERE user_id = p_user_id;

    user_tier_text := COALESCE(user_tier_text, 'free');
    IF user_tier_text IN ('free', 'pro') AND public._company_seated(p_user_id) THEN
        user_tier_text := 'enterprise';
    END IF;

    RETURN user_tier_text::subscription_tier;
END;
$function$;

-- kal31_accept_document_invite: unchanged except a paid company seat counts as paid.
CREATE OR REPLACE FUNCTION public.kal31_accept_document_invite(invite_token text)
 RETURNS TABLE(status text, document_id uuid, effective_role text, intended_role text, upgrade_required boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
    v_invite       public.document_invites%ROWTYPE;
    v_caller_email TEXT;
    v_caller_tier  TEXT;
    v_final_role   TEXT;
    v_needs_upg    BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'kal31_accept_document_invite: must be authenticated';
    END IF;

    SELECT * INTO v_invite
      FROM public.document_invites di
     WHERE di.token = invite_token
     LIMIT 1;

    IF NOT FOUND THEN
        status := 'invalid';
        document_id := NULL; effective_role := NULL; intended_role := NULL; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_invite.revoked_at IS NOT NULL THEN
        status := 'revoked';
        document_id := v_invite.document_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_invite.expires_at < now() THEN
        status := 'expired';
        document_id := v_invite.document_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_invite.accepted_at IS NOT NULL THEN
        status := 'already_accepted';
        document_id := v_invite.document_id;
        effective_role := v_invite.accepted_role;
        intended_role := v_invite.intended_role;
        upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT u.email::TEXT INTO v_caller_email FROM auth.users u WHERE u.id = auth.uid();
    IF v_invite.target_email IS NOT NULL AND LOWER(v_invite.target_email) <> LOWER(v_caller_email) THEN
        status := 'wrong_account';
        document_id := v_invite.document_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT COALESCE(s.tier, 'free') INTO v_caller_tier
      FROM public.user_subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    v_caller_tier := COALESCE(v_caller_tier, 'free');
    IF v_caller_tier IN ('free', 'pro') AND public._company_seated(auth.uid()) THEN
        v_caller_tier := 'enterprise';
    END IF;

    IF v_invite.intended_role IN ('editor', 'owner') AND v_caller_tier = 'free' THEN
        v_final_role := 'viewer';
        v_needs_upg := TRUE;
    ELSE
        v_final_role := v_invite.intended_role;
    END IF;

    INSERT INTO public.document_collaborators (document_id, user_id, email, role, status, invited_by)
    VALUES (v_invite.document_id, auth.uid(), v_caller_email, v_final_role, 'active', v_invite.created_by)
    ON CONFLICT (document_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active';

    UPDATE public.document_invites di
       SET accepted_at = now(),
           accepted_by = auth.uid(),
           accepted_role = v_final_role
     WHERE di.id = v_invite.id;

    status := 'accepted';
    document_id := v_invite.document_id;
    effective_role := v_final_role;
    intended_role := v_invite.intended_role;
    upgrade_required := v_needs_upg;
    RETURN NEXT;
END;
$function$;

-- kal31_accept_project_invite: unchanged except a paid company seat counts as paid.
CREATE OR REPLACE FUNCTION public.kal31_accept_project_invite(invite_token text)
 RETURNS TABLE(status text, project_id uuid, effective_role text, intended_role text, upgrade_required boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
    v_invite       public.project_invites%ROWTYPE;
    v_caller_email TEXT;
    v_caller_tier  TEXT;
    v_final_role   TEXT;
    v_needs_upg    BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'kal31_accept_project_invite: must be authenticated';
    END IF;

    SELECT * INTO v_invite FROM public.project_invites WHERE token = invite_token LIMIT 1;

    IF NOT FOUND THEN
        status := 'invalid'; project_id := NULL; effective_role := NULL;
        intended_role := NULL; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.revoked_at IS NOT NULL THEN
        status := 'revoked'; project_id := v_invite.project_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.expires_at < now() THEN
        status := 'expired'; project_id := v_invite.project_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.accepted_at IS NOT NULL THEN
        status := 'already_accepted'; project_id := v_invite.project_id;
        effective_role := v_invite.accepted_role; intended_role := v_invite.intended_role;
        upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT email::TEXT INTO v_caller_email FROM auth.users WHERE id = auth.uid();
    IF v_invite.target_email IS NOT NULL AND LOWER(v_invite.target_email) <> LOWER(v_caller_email) THEN
        status := 'wrong_account'; project_id := v_invite.project_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT COALESCE(s.tier::TEXT, 'free') INTO v_caller_tier
      FROM public.user_subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    v_caller_tier := COALESCE(v_caller_tier, 'free');
    IF v_caller_tier IN ('free', 'pro') AND public._company_seated(auth.uid()) THEN
        v_caller_tier := 'enterprise';
    END IF;

    IF v_invite.intended_role IN ('editor', 'owner') AND v_caller_tier = 'free' THEN
        v_final_role := 'viewer';
        v_needs_upg := TRUE;
    ELSE
        v_final_role := v_invite.intended_role;
    END IF;

    INSERT INTO public.project_collaborators (project_id, user_id, email, role, status, invited_by)
    VALUES (v_invite.project_id, auth.uid(), v_caller_email, v_final_role, 'active', v_invite.created_by)
    ON CONFLICT (project_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active';

    UPDATE public.project_invites
       SET accepted_at = now(), accepted_by = auth.uid(), accepted_role = v_final_role
     WHERE id = v_invite.id;

    status := 'accepted';
    project_id := v_invite.project_id;
    effective_role := v_final_role;
    intended_role := v_invite.intended_role;
    upgrade_required := v_needs_upg;
    RETURN NEXT;
END;
$function$;

-- kal31_accept_template_invite: unchanged except a paid company seat counts as paid.
CREATE OR REPLACE FUNCTION public.kal31_accept_template_invite(invite_token text)
 RETURNS TABLE(status text, template_id uuid, effective_role text, intended_role text, upgrade_required boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
#variable_conflict use_column
DECLARE
    v_invite       public.template_invites%ROWTYPE;
    v_caller_email TEXT;
    v_caller_tier  TEXT;
    v_final_role   TEXT;
    v_needs_upg    BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'kal31_accept_template_invite: must be authenticated';
    END IF;

    SELECT * INTO v_invite FROM public.template_invites WHERE token = invite_token LIMIT 1;

    IF NOT FOUND THEN
        status := 'invalid'; template_id := NULL; effective_role := NULL;
        intended_role := NULL; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.revoked_at IS NOT NULL THEN
        status := 'revoked'; template_id := v_invite.template_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.expires_at < now() THEN
        status := 'expired'; template_id := v_invite.template_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF v_invite.accepted_at IS NOT NULL THEN
        status := 'already_accepted'; template_id := v_invite.template_id;
        effective_role := v_invite.accepted_role; intended_role := v_invite.intended_role;
        upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT email::TEXT INTO v_caller_email FROM auth.users WHERE id = auth.uid();
    IF v_invite.target_email IS NOT NULL AND LOWER(v_invite.target_email) <> LOWER(v_caller_email) THEN
        status := 'wrong_account'; template_id := v_invite.template_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT COALESCE(s.tier::TEXT, 'free') INTO v_caller_tier
      FROM public.user_subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    v_caller_tier := COALESCE(v_caller_tier, 'free');
    IF v_caller_tier IN ('free', 'pro') AND public._company_seated(auth.uid()) THEN
        v_caller_tier := 'enterprise';
    END IF;

    IF v_invite.intended_role IN ('editor', 'owner') AND v_caller_tier = 'free' THEN
        v_final_role := 'viewer';
        v_needs_upg := TRUE;
    ELSE
        v_final_role := v_invite.intended_role;
    END IF;

    INSERT INTO public.template_collaborators (template_id, user_id, email, role, status, invited_by)
    VALUES (v_invite.template_id, auth.uid(), v_caller_email, v_final_role, 'active', v_invite.created_by)
    ON CONFLICT (template_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active';

    UPDATE public.template_invites
       SET accepted_at = now(), accepted_by = auth.uid(), accepted_role = v_final_role
     WHERE id = v_invite.id;

    status := 'accepted';
    template_id := v_invite.template_id;
    effective_role := v_final_role;
    intended_role := v_invite.intended_role;
    upgrade_required := v_needs_upg;
    RETURN NEXT;
END;
$function$;
