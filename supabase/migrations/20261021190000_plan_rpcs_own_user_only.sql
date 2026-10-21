-- Backend security pass: plan and usage RPCs answered for any user id.
--
-- get_user_tier, get_current_usage, is_project_accessible and
-- swap_active_project are SECURITY DEFINER and trusted p_user_id, so any
-- signed-in caller could read another person's plan and counts, and
-- swap_active_project could flip another Free user's active project. They now
-- use the caller's own id whenever there is one, the same rule
-- get_active_document_count / get_actual_storage_usage already follow.
-- get_document_limit, get_project_limit, get_storage_limit and
-- has_feature_access only reach other users through get_user_tier, so they
-- follow along. Server callers (service role, cron, triggers without a
-- signed-in user) have no auth.uid() and keep passing any id.
--
-- Every RLS policy that calls these already passes auth.uid(), so their
-- answers do not change. Signed-out callers lose EXECUTE.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_user_tier(p_user_id uuid)
 RETURNS subscription_tier
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    user_tier_text TEXT;
BEGIN
    p_user_id := COALESCE(auth.uid(), p_user_id);

    SELECT tier::text INTO user_tier_text
    FROM user_subscriptions
    WHERE user_id = p_user_id;

    RETURN COALESCE(user_tier_text, 'free')::subscription_tier;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_current_usage(p_user_id uuid, p_metric_name character varying)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    usage_count BIGINT;
BEGIN
    p_user_id := COALESCE(auth.uid(), p_user_id);

    CASE p_metric_name
        WHEN 'projects_count' THEN
            SELECT COUNT(*) INTO usage_count
            FROM projects
            WHERE user_id = p_user_id
              AND archived = false
              AND user_archived_at IS NULL;

        WHEN 'documents_count' THEN
            SELECT COUNT(*) INTO usage_count
            FROM documents
            WHERE user_id = p_user_id
              AND archived = false
              AND user_archived_at IS NULL;

        WHEN 'storage_bytes' THEN
            SELECT COALESCE(SUM(file_size), 0) INTO usage_count
            FROM documents
            WHERE user_id = p_user_id;

        WHEN 'templates_count' THEN
            SELECT COUNT(*) INTO usage_count
            FROM templates
            WHERE user_id = p_user_id;

        WHEN 'spaces_count' THEN
            SELECT COUNT(DISTINCT s.id) INTO usage_count
            FROM spaces s
            JOIN documents d ON s.document_id = d.id
            WHERE d.user_id = p_user_id;

        ELSE
            usage_count := 0;
    END CASE;

    RETURN usage_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.is_project_accessible(p_project_id uuid, p_user_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    user_tier_text TEXT;
    is_active BOOLEAN;
    project_user_id UUID;
BEGIN
    p_user_id := COALESCE(auth.uid(), p_user_id);

    SELECT user_id INTO project_user_id
    FROM projects
    WHERE id = p_project_id;

    IF project_user_id != p_user_id THEN
        RETURN false;
    END IF;

    user_tier_text := get_user_tier(p_user_id)::text;

    IF user_tier_text IN ('pro', 'enterprise', 'developer') THEN
        RETURN true;
    END IF;

    SELECT COALESCE(ps.is_active, true) INTO is_active
    FROM project_status ps
    WHERE ps.project_id = p_project_id;

    RETURN is_active;
END;
$function$;

CREATE OR REPLACE FUNCTION public.swap_active_project(p_user_id uuid, p_old_project_id uuid, p_new_project_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    user_tier_text TEXT;
    last_swap TIMESTAMP WITH TIME ZONE;
    can_swap BOOLEAN := false;
BEGIN
    p_user_id := COALESCE(auth.uid(), p_user_id);

    user_tier_text := get_user_tier(p_user_id)::text;

    IF user_tier_text IN ('pro', 'enterprise', 'developer') THEN
        can_swap := true;
    ELSE
        SELECT last_active_swap INTO last_swap
        FROM project_status
        WHERE project_id = p_old_project_id;

        IF last_swap IS NULL OR last_swap < NOW() - INTERVAL '30 days' THEN
            can_swap := true;
        END IF;
    END IF;

    IF NOT can_swap THEN
        RAISE EXCEPTION 'You can only change your active project once per month on the Free plan';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM projects WHERE id = p_old_project_id AND user_id = p_user_id
    ) OR NOT EXISTS (
        SELECT 1 FROM projects WHERE id = p_new_project_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Invalid project selection';
    END IF;

    UPDATE project_status
    SET
        is_active = false,
        archived_at = NOW(),
        last_active_swap = NOW()
    WHERE project_id = p_old_project_id;

    UPDATE project_status
    SET
        is_active = true,
        archived_at = NULL,
        last_active_swap = NOW()
    WHERE project_id = p_new_project_id;

    RETURN true;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_user_tier(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_document_limit(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_project_limit(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_storage_limit(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_feature_access(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_project_accessible(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_current_usage(uuid, character varying) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.swap_active_project(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_tier(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_document_limit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_project_limit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_storage_limit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_feature_access(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_project_accessible(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_usage(uuid, character varying) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.swap_active_project(uuid, uuid, uuid) TO authenticated, service_role;

COMMIT;
