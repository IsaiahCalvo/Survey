-- Migration: Add helper functions for collaborator management
-- Includes RPC to look up users by email and validate collaborator eligibility

-- ============================================
-- RPC: Get user ID by email
-- ============================================
-- This function allows looking up a user's ID by their email
-- Required because auth.users is not directly accessible from client

CREATE OR REPLACE FUNCTION get_user_id_by_email(email_address TEXT)
RETURNS UUID AS $$
DECLARE
    found_user_id UUID;
BEGIN
    SELECT id INTO found_user_id
    FROM auth.users
    WHERE email = email_address;

    RETURN found_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION get_user_id_by_email(TEXT) TO authenticated;

-- ============================================
-- RPC: Check if user can be collaborator
-- ============================================
-- Returns user's subscription tier and whether they can be a collaborator
-- Free tier users cannot be collaborators

CREATE OR REPLACE FUNCTION check_user_collaborator_eligibility(target_user_id UUID)
RETURNS TABLE (
    user_id UUID,
    email TEXT,
    tier TEXT,
    can_collaborate BOOLEAN,
    reason TEXT
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        u.id AS user_id,
        u.email::TEXT AS email,
        COALESCE(s.tier::TEXT, 'free') AS tier,
        CASE
            WHEN COALESCE(s.tier::TEXT, 'free') = 'free' THEN FALSE
            ELSE TRUE
        END AS can_collaborate,
        CASE
            WHEN COALESCE(s.tier::TEXT, 'free') = 'free' THEN
                'This user is on the Free plan and cannot be added as a collaborator. They need to upgrade to Pro or higher to collaborate on documents.'
            ELSE NULL
        END AS reason
    FROM auth.users u
    LEFT JOIN user_subscriptions s ON s.user_id = u.id AND s.status IN ('active', 'trialing')
    WHERE u.id = target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION check_user_collaborator_eligibility(UUID) TO authenticated;

-- ============================================
-- RPC: Check user eligibility by email
-- ============================================
-- Convenience function that combines email lookup with eligibility check

CREATE OR REPLACE FUNCTION check_collaborator_by_email(email_address TEXT)
RETURNS TABLE (
    user_id UUID,
    email TEXT,
    tier TEXT,
    can_collaborate BOOLEAN,
    reason TEXT
) AS $$
DECLARE
    found_user_id UUID;
BEGIN
    -- First look up user by email
    SELECT id INTO found_user_id
    FROM auth.users
    WHERE auth.users.email = email_address;

    IF found_user_id IS NULL THEN
        -- Return a result indicating user not found
        RETURN QUERY
        SELECT
            NULL::UUID AS user_id,
            email_address AS email,
            NULL::TEXT AS tier,
            FALSE AS can_collaborate,
            'User not found. They need to create an account first.'::TEXT AS reason;
        RETURN;
    END IF;

    -- Return eligibility check for found user
    RETURN QUERY
    SELECT * FROM check_user_collaborator_eligibility(found_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION check_collaborator_by_email(TEXT) TO authenticated;

-- ============================================
-- PROJECT COLLABORATORS TABLE
-- ============================================
-- Similar to document_collaborators but for projects

CREATE TABLE IF NOT EXISTS project_collaborators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invited_by UUID REFERENCES auth.users(id),

    -- Permission level
    role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer', 'commenter', 'editor', 'owner')),

    -- Invitation tracking
    email TEXT,  -- For display purposes
    status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'revoked')),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(project_id, user_id)
);

-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_project_collaborators_project ON project_collaborators(project_id);
CREATE INDEX IF NOT EXISTS idx_project_collaborators_user ON project_collaborators(user_id);

-- Enable Row Level Security
ALTER TABLE project_collaborators ENABLE ROW LEVEL SECURITY;

-- Helper function to check project access
CREATE OR REPLACE FUNCTION user_can_access_project(proj_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN AS $$
DECLARE
    proj_owner_id UUID;
    user_role TEXT;
BEGIN
    -- Check if user owns the project
    SELECT user_id INTO proj_owner_id
    FROM projects
    WHERE id = proj_id;

    IF proj_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    -- Check if user is a collaborator with sufficient role
    SELECT role INTO user_role
    FROM project_collaborators
    WHERE project_id = proj_id
    AND user_id = auth.uid()
    AND status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check role hierarchy
    CASE required_role
        WHEN 'viewer' THEN RETURN TRUE;
        WHEN 'commenter' THEN RETURN user_role IN ('commenter', 'editor', 'owner');
        WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner' THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies for project_collaborators
CREATE POLICY "Users can view collaborators on accessible projects"
    ON project_collaborators FOR SELECT
    USING (user_can_access_project(project_id, 'viewer'));

CREATE POLICY "Project owners can add collaborators"
    ON project_collaborators FOR INSERT
    WITH CHECK (user_can_access_project(project_id, 'owner'));

CREATE POLICY "Project owners can update collaborators"
    ON project_collaborators FOR UPDATE
    USING (user_can_access_project(project_id, 'owner'));

CREATE POLICY "Project owners can remove collaborators"
    ON project_collaborators FOR DELETE
    USING (user_can_access_project(project_id, 'owner'));

-- Trigger for updated_at
CREATE TRIGGER trigger_update_project_collaborators_updated_at
    BEFORE UPDATE ON project_collaborators
    FOR EACH ROW
    EXECUTE FUNCTION update_document_tables_updated_at();

-- Auto-add project owner as collaborator
CREATE OR REPLACE FUNCTION add_project_owner_collaborator()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO project_collaborators (project_id, user_id, role, status)
    VALUES (NEW.id, NEW.user_id, 'owner', 'active')
    ON CONFLICT (project_id, user_id) DO NOTHING;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_add_project_owner
    AFTER INSERT ON projects
    FOR EACH ROW
    EXECUTE FUNCTION add_project_owner_collaborator();

COMMENT ON FUNCTION get_user_id_by_email IS 'Look up user ID by email address for collaboration invites';
COMMENT ON FUNCTION check_user_collaborator_eligibility IS 'Check if a user can be added as a collaborator (must be Pro+ tier)';
COMMENT ON FUNCTION check_collaborator_by_email IS 'Combined email lookup and eligibility check for collaborator invites';
COMMENT ON TABLE project_collaborators IS 'Tracks collaborators with access to projects';
