-- Entitlements must reflect both the purchased tier and Stripe's current
-- subscription state. Client roles also need EXECUTE because RLS policies call
-- this helper, so its body must prevent callers from probing another account.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_user_tier(p_user_id uuid)
RETURNS public.subscription_tier
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  user_tier_text text;
  caller_user_id uuid := auth.uid();
  caller_role text := COALESCE(auth.role(), '');
BEGIN
  -- API callers may inspect only their own entitlement. Trusted service calls
  -- and direct database maintenance sessions still need cross-user evaluation
  -- for webhooks, triggers, scheduled work, and administrative views.
  IF caller_role NOT IN ('service_role', 'supabase_admin')
     AND session_user NOT IN ('postgres', 'supabase_admin')
     AND p_user_id IS DISTINCT FROM caller_user_id THEN
    RETURN 'free'::public.subscription_tier;
  END IF;

  SELECT CASE
    WHEN status::text IN ('active', 'trialing') THEN tier::text
    ELSE 'free'
  END
  INTO user_tier_text
  FROM public.user_subscriptions
  WHERE user_id = p_user_id;

  RETURN COALESCE(user_tier_text, 'free')::public.subscription_tier;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_current_usage(
  p_user_id uuid,
  p_metric_name character varying
)
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  usage_count bigint;
  caller_user_id uuid := auth.uid();
  caller_role text := COALESCE(auth.role(), '');
  effective_user_id uuid := p_user_id;
BEGIN
  IF caller_role NOT IN ('service_role', 'supabase_admin')
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    effective_user_id := caller_user_id;
  END IF;
  IF effective_user_id IS NULL THEN
    RETURN 0;
  END IF;

  CASE p_metric_name
    WHEN 'projects_count' THEN
      SELECT count(*) INTO usage_count
      FROM public.projects
      WHERE user_id = effective_user_id;
    WHEN 'documents_count' THEN
      SELECT count(*) INTO usage_count
      FROM public.documents
      WHERE user_id = effective_user_id;
    WHEN 'storage_bytes' THEN
      SELECT COALESCE(sum(file_size), 0) INTO usage_count
      FROM public.documents
      WHERE user_id = effective_user_id;
    WHEN 'templates_count' THEN
      SELECT count(*) INTO usage_count
      FROM public.templates
      WHERE user_id = effective_user_id;
    WHEN 'spaces_count' THEN
      SELECT count(DISTINCT s.id) INTO usage_count
      FROM public.spaces AS s
      JOIN public.documents AS d ON d.id = s.document_id
      WHERE d.user_id = effective_user_id;
    ELSE
      usage_count := 0;
  END CASE;

  RETURN usage_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_active_projects(p_user_id uuid)
RETURNS TABLE (
  project_id uuid,
  project_name character varying,
  is_active boolean,
  archived_at timestamp with time zone
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_user_id uuid := auth.uid();
  caller_role text := COALESCE(auth.role(), '');
  effective_user_id uuid := p_user_id;
BEGIN
  IF caller_role NOT IN ('service_role', 'supabase_admin')
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    effective_user_id := caller_user_id;
  END IF;
  IF effective_user_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    p.name,
    COALESCE(ps.is_active, true),
    ps.archived_at
  FROM public.projects AS p
  LEFT JOIN public.project_status AS ps ON ps.project_id = p.id
  WHERE p.user_id = effective_user_id
    AND (ps.is_active IS NULL OR ps.is_active = true)
  ORDER BY p.updated_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.swap_active_project(
  p_user_id uuid,
  p_old_project_id uuid,
  p_new_project_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_user_id uuid := auth.uid();
  caller_role text := COALESCE(auth.role(), '');
  effective_user_id uuid := p_user_id;
  user_tier_text text;
  last_swap timestamp with time zone;
  can_swap boolean := false;
BEGIN
  IF caller_role NOT IN ('service_role', 'supabase_admin')
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    effective_user_id := caller_user_id;
  END IF;
  IF effective_user_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  user_tier_text := public.get_user_tier(effective_user_id)::text;
  IF user_tier_text IN ('pro', 'enterprise', 'developer') THEN
    can_swap := true;
  ELSE
    SELECT ps.last_active_swap INTO last_swap
    FROM public.project_status AS ps
    WHERE ps.project_id = p_old_project_id;
    can_swap := last_swap IS NULL OR last_swap < now() - interval '30 days';
  END IF;

  IF NOT can_swap THEN
    RAISE EXCEPTION 'You can only change your active project once per month on the Free plan';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_old_project_id AND user_id = effective_user_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = p_new_project_id AND user_id = effective_user_id
  ) THEN
    RAISE EXCEPTION 'Invalid project selection';
  END IF;

  UPDATE public.project_status
  SET is_active = false, archived_at = now(), last_active_swap = now()
  WHERE project_id = p_old_project_id;
  UPDATE public.project_status
  SET is_active = true, archived_at = NULL, last_active_swap = now()
  WHERE project_id = p_new_project_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_project_accessible(
  p_project_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  caller_user_id uuid := auth.uid();
  caller_role text := COALESCE(auth.role(), '');
  effective_user_id uuid := p_user_id;
  user_tier_text text;
  active_state boolean;
  project_user_id uuid;
BEGIN
  IF caller_role NOT IN ('service_role', 'supabase_admin')
     AND session_user NOT IN ('postgres', 'supabase_admin') THEN
    effective_user_id := caller_user_id;
  END IF;
  IF effective_user_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT user_id INTO project_user_id
  FROM public.projects
  WHERE id = p_project_id;
  IF project_user_id IS DISTINCT FROM effective_user_id THEN
    RETURN false;
  END IF;

  user_tier_text := public.get_user_tier(effective_user_id)::text;
  IF user_tier_text IN ('pro', 'enterprise', 'developer') THEN
    RETURN true;
  END IF;

  SELECT COALESCE(ps.is_active, true) INTO active_state
  FROM public.project_status AS ps
  WHERE ps.project_id = p_project_id;
  RETURN COALESCE(active_state, true);
END;
$$;

COMMENT ON FUNCTION public.get_user_tier(uuid) IS
  'Returns a caller-scoped stored tier only for active/trialing subscriptions; cross-account client probes and all other states resolve to free.';
COMMENT ON FUNCTION public.get_current_usage(uuid, character varying) IS
  'Returns usage only for the caller account, except trusted service and database maintenance roles.';
COMMENT ON FUNCTION public.get_active_projects(uuid) IS
  'Returns active projects only for the caller account, except trusted service and database maintenance roles.';
COMMENT ON FUNCTION public.swap_active_project(uuid, uuid, uuid) IS
  'Swaps projects only within the caller account, except trusted service and database maintenance roles.';
COMMENT ON FUNCTION public.is_project_accessible(uuid, uuid) IS
  'Evaluates project access only for the caller identity, except trusted service and database maintenance roles.';

-- Preserve the least-privilege grants used by RLS policy expressions.
REVOKE ALL ON FUNCTION public.get_user_tier(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_tier(uuid) TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_current_usage(uuid, character varying) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_current_usage(uuid, character varying) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_active_projects(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_projects(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.swap_active_project(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.swap_active_project(uuid, uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_project_accessible(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_accessible(uuid, uuid) TO anon, authenticated, service_role;

COMMIT;
