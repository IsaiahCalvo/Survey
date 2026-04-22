-- Ensure subscription enum types exist and remain compatible with tier-limit functions.
-- This fixes runtime failures like: type "subscription_tier" does not exist
-- when document INSERT policies evaluate get_document_limit()/get_storage_limit().

-- Recreate missing enum types (safe no-op if they already exist).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'subscription_tier'
          AND n.nspname = 'public'
    ) THEN
        CREATE TYPE public.subscription_tier AS ENUM ('free', 'pro', 'enterprise', 'developer');
    END IF;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_type t
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typname = 'subscription_status'
          AND n.nspname = 'public'
    ) THEN
        CREATE TYPE public.subscription_status AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'incomplete');
    END IF;
END $$;

ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'free';
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'pro';
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'enterprise';
ALTER TYPE public.subscription_tier ADD VALUE IF NOT EXISTS 'developer';

ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'active';
ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'trialing';
ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'past_due';
ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'canceled';
ALTER TYPE public.subscription_status ADD VALUE IF NOT EXISTS 'incomplete';

-- Normalize helpers to read tier/status as text internally so they still work
-- if columns were migrated to TEXT in some environments.
CREATE OR REPLACE FUNCTION get_user_tier(p_user_id UUID)
RETURNS subscription_tier AS $$
DECLARE
    user_tier_text TEXT;
BEGIN
    SELECT tier::text INTO user_tier_text
    FROM user_subscriptions
    WHERE user_id = p_user_id;

    RETURN COALESCE(user_tier_text, 'free')::subscription_tier;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION has_feature_access(p_user_id UUID, p_feature TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    user_tier_text TEXT;
BEGIN
    user_tier_text := get_user_tier(p_user_id)::text;

    IF user_tier_text = 'developer' THEN
        RETURN TRUE;
    END IF;

    IF user_tier_text = 'enterprise' THEN
        RETURN TRUE;
    END IF;

    IF user_tier_text = 'pro' THEN
        RETURN p_feature IN (
            'survey_tools',
            'templates',
            'regions',
            'excel_export',
            'onedrive',
            'advanced_tools',
            'page_operations',
            'unlimited_projects',
            'unlimited_documents'
        );
    END IF;

    IF user_tier_text = 'free' THEN
        RETURN p_feature IN (
            'basic_annotations',
            'pdf_viewer',
            'layers'
        );
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_storage_limit(p_user_id UUID)
RETURNS BIGINT AS $$
DECLARE
    user_tier_text TEXT;
BEGIN
    user_tier_text := get_user_tier(p_user_id)::text;

    RETURN CASE
        WHEN user_tier_text = 'free' THEN 104857600
        WHEN user_tier_text = 'pro' THEN 10737418240
        WHEN user_tier_text = 'enterprise' THEN 1099511627776
        WHEN user_tier_text = 'developer' THEN 107374182400
        ELSE 104857600
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_project_limit(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    user_tier_text TEXT;
BEGIN
    user_tier_text := get_user_tier(p_user_id)::text;

    RETURN CASE
        WHEN user_tier_text = 'free' THEN 1
        WHEN user_tier_text IN ('pro', 'enterprise', 'developer') THEN 999999
        ELSE 1
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_document_limit(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    user_tier_text TEXT;
BEGIN
    user_tier_text := get_user_tier(p_user_id)::text;

    RETURN CASE
        WHEN user_tier_text = 'free' THEN 5
        WHEN user_tier_text IN ('pro', 'enterprise', 'developer') THEN 999999
        ELSE 5
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Remove direct enum local-variable dependency from these policy helper functions.
CREATE OR REPLACE FUNCTION swap_active_project(
    p_user_id UUID,
    p_old_project_id UUID,
    p_new_project_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    user_tier_text TEXT;
    last_swap TIMESTAMP WITH TIME ZONE;
    can_swap BOOLEAN := false;
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION is_project_accessible(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_tier_text TEXT;
    is_active BOOLEAN;
    project_user_id UUID;
BEGIN
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
$$ LANGUAGE plpgsql SECURITY DEFINER;
