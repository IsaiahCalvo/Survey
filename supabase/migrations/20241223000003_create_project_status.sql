-- Create project_status table for managing active/archived projects
-- Used when Free tier users have multiple projects from downgrading

CREATE TABLE project_status (
    project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    is_active BOOLEAN DEFAULT true,
    archived_at TIMESTAMP WITH TIME ZONE,
    archived_reason VARCHAR(100), -- 'downgrade', 'user_action', 'admin_action'
    last_active_swap TIMESTAMP WITH TIME ZONE, -- Track when user last changed active project
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes
CREATE INDEX idx_project_status_is_active ON project_status(is_active);
CREATE INDEX idx_project_status_archived_at ON project_status(archived_at);

-- Enable RLS
ALTER TABLE project_status ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view status of own projects"
    ON project_status FOR SELECT
    USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update status of own projects"
    ON project_status FOR UPDATE
    USING (
        project_id IN (
            SELECT id FROM projects WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "System can insert project status"
    ON project_status FOR INSERT
    WITH CHECK (true); -- Allow inserts from triggers

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_project_status_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_project_status_updated_at
    BEFORE UPDATE ON project_status
    FOR EACH ROW
    EXECUTE FUNCTION update_project_status_updated_at();

-- Auto-create project_status when new project is created
CREATE OR REPLACE FUNCTION create_project_status()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO project_status (project_id, is_active)
    VALUES (NEW.id, true);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trigger_create_project_status
    AFTER INSERT ON projects
    FOR EACH ROW
    EXECUTE FUNCTION create_project_status();

-- Function to get active projects for a user
CREATE OR REPLACE FUNCTION get_active_projects(p_user_id UUID)
RETURNS TABLE (
    project_id UUID,
    project_name VARCHAR,
    is_active BOOLEAN,
    archived_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        p.id,
        p.name,
        COALESCE(ps.is_active, true),
        ps.archived_at
    FROM projects p
    LEFT JOIN project_status ps ON p.id = ps.project_id
    WHERE p.user_id = p_user_id
    AND (ps.is_active IS NULL OR ps.is_active = true)
    ORDER BY p.updated_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to archive projects when user downgrades
CREATE OR REPLACE FUNCTION archive_excess_projects(p_user_id UUID, p_keep_project_id UUID)
RETURNS INTEGER AS $$
DECLARE
    archived_count INTEGER := 0;
BEGIN
    -- Archive all projects except the one to keep
    UPDATE project_status
    SET
        is_active = false,
        archived_at = NOW(),
        archived_reason = 'downgrade'
    WHERE project_id IN (
        SELECT id FROM projects WHERE user_id = p_user_id AND id != p_keep_project_id
    );

    GET DIAGNOSTICS archived_count = ROW_COUNT;

    -- Ensure the kept project is active
    UPDATE project_status
    SET
        is_active = true,
        archived_at = NULL,
        archived_reason = NULL
    WHERE project_id = p_keep_project_id;

    RETURN archived_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to swap active project (Free tier users can do this once per month)
CREATE OR REPLACE FUNCTION swap_active_project(
    p_user_id UUID,
    p_old_project_id UUID,
    p_new_project_id UUID
)
RETURNS BOOLEAN AS $$
DECLARE
    user_tier subscription_tier;
    last_swap TIMESTAMP WITH TIME ZONE;
    can_swap BOOLEAN := false;
BEGIN
    -- Get user tier
    user_tier := get_user_tier(p_user_id);

    -- Pro/Enterprise/Developer users can swap anytime
    IF user_tier IN ('pro', 'enterprise', 'developer') THEN
        can_swap := true;
    ELSE
        -- Free users can swap once per month
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

    -- Verify both projects belong to the user
    IF NOT EXISTS (
        SELECT 1 FROM projects WHERE id = p_old_project_id AND user_id = p_user_id
    ) OR NOT EXISTS (
        SELECT 1 FROM projects WHERE id = p_new_project_id AND user_id = p_user_id
    ) THEN
        RAISE EXCEPTION 'Invalid project selection';
    END IF;

    -- Archive old project
    UPDATE project_status
    SET
        is_active = false,
        archived_at = NOW(),
        last_active_swap = NOW()
    WHERE project_id = p_old_project_id;

    -- Activate new project
    UPDATE project_status
    SET
        is_active = true,
        archived_at = NULL,
        last_active_swap = NOW()
    WHERE project_id = p_new_project_id;

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if project is accessible
CREATE OR REPLACE FUNCTION is_project_accessible(p_project_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
    user_tier subscription_tier;
    is_active BOOLEAN;
    project_user_id UUID;
BEGIN
    -- Check if project belongs to user
    SELECT user_id INTO project_user_id
    FROM projects
    WHERE id = p_project_id;

    IF project_user_id != p_user_id THEN
        RETURN false;
    END IF;

    user_tier := get_user_tier(p_user_id);

    -- Pro/Enterprise/Developer can access all their projects
    IF user_tier IN ('pro', 'enterprise', 'developer') THEN
        RETURN true;
    END IF;

    -- Free users can only access active projects
    SELECT COALESCE(ps.is_active, true) INTO is_active
    FROM project_status ps
    WHERE ps.project_id = p_project_id;

    RETURN is_active;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- View for archived projects summary
CREATE OR REPLACE VIEW archived_projects_summary AS
SELECT
    p.user_id,
    COUNT(*) as archived_count,
    array_agg(p.id) as archived_project_ids,
    array_agg(p.name) as archived_project_names,
    MIN(ps.archived_at) as first_archived_at,
    MAX(ps.archived_at) as last_archived_at
FROM projects p
JOIN project_status ps ON p.id = ps.project_id
WHERE ps.is_active = false
GROUP BY p.user_id;

COMMENT ON TABLE project_status IS 'Tracks which projects are active/archived for tier limit enforcement';
COMMENT ON FUNCTION get_active_projects IS 'Get all active (non-archived) projects for a user';
COMMENT ON FUNCTION archive_excess_projects IS 'Archive all projects except specified one (used during downgrade)';
COMMENT ON FUNCTION swap_active_project IS 'Swap active project (Free users: once per month, Pro+: unlimited)';
COMMENT ON FUNCTION is_project_accessible IS 'Check if user can access a project based on tier and archive status';
COMMENT ON VIEW archived_projects_summary IS 'Summary of archived projects per user';
