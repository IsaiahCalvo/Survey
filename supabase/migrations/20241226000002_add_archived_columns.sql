-- Add archived columns to projects and documents tables
-- Used for handling downgrades from Pro to Free tier

-- ============================================================================
-- ADD ARCHIVED COLUMN TO PROJECTS
-- ============================================================================

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_projects_archived
ON projects(user_id, archived, updated_at DESC);

COMMENT ON COLUMN projects.archived IS 'True if project was archived due to downgrade or user action';

-- ============================================================================
-- ADD ARCHIVED COLUMN TO DOCUMENTS
-- ============================================================================

ALTER TABLE documents
ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_documents_archived
ON documents(user_id, archived, updated_at DESC);

COMMENT ON COLUMN documents.archived IS 'True if document was archived due to downgrade or user action';

-- ============================================================================
-- FUNCTION: Archive excess projects when downgrading to Free tier
-- ============================================================================

CREATE OR REPLACE FUNCTION archive_excess_projects(p_user_id UUID, p_max_projects INTEGER DEFAULT 1)
RETURNS TABLE(archived_project_id UUID, archived_project_name TEXT) AS $$
DECLARE
    v_project_count INTEGER;
    v_to_archive INTEGER;
BEGIN
    -- Count active (non-archived) projects
    SELECT COUNT(*) INTO v_project_count
    FROM projects
    WHERE user_id = p_user_id AND archived = FALSE;

    -- Calculate how many to archive
    v_to_archive := GREATEST(0, v_project_count - p_max_projects);

    IF v_to_archive > 0 THEN
        -- Archive oldest projects (by updated_at), keeping most recent ones
        RETURN QUERY
        UPDATE projects
        SET archived = TRUE
        WHERE id IN (
            SELECT id
            FROM projects
            WHERE user_id = p_user_id AND archived = FALSE
            ORDER BY updated_at ASC  -- Oldest first
            LIMIT v_to_archive
        )
        RETURNING id, name;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- FUNCTION: Archive excess documents when downgrading to Free tier
-- ============================================================================

CREATE OR REPLACE FUNCTION archive_excess_documents(p_user_id UUID, p_max_documents INTEGER DEFAULT 5)
RETURNS TABLE(archived_document_id UUID, archived_document_name TEXT, archived_project_id UUID) AS $$
DECLARE
    v_document_count INTEGER;
    v_to_archive INTEGER;
BEGIN
    -- Count active (non-archived) documents
    SELECT COUNT(*) INTO v_document_count
    FROM documents
    WHERE user_id = p_user_id AND archived = FALSE;

    -- Calculate how many to archive
    v_to_archive := GREATEST(0, v_document_count - p_max_documents);

    IF v_to_archive > 0 THEN
        -- Archive oldest documents (by updated_at), keeping most recent ones
        RETURN QUERY
        UPDATE documents
        SET archived = TRUE
        WHERE id IN (
            SELECT id
            FROM documents
            WHERE user_id = p_user_id AND archived = FALSE
            ORDER BY updated_at ASC  -- Oldest first
            LIMIT v_to_archive
        )
        RETURNING id, name, project_id;
    END IF;

    RETURN;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- FUNCTION: Handle complete downgrade flow
-- ============================================================================

CREATE OR REPLACE FUNCTION handle_downgrade_to_free(p_user_id UUID)
RETURNS JSON AS $$
DECLARE
    v_archived_projects JSON;
    v_archived_documents JSON;
    v_result JSON;
BEGIN
    -- Archive excess projects (Free tier: 1 project)
    WITH archived_projs AS (
        SELECT * FROM archive_excess_projects(p_user_id, 1)
    )
    SELECT json_agg(row_to_json(archived_projs.*)) INTO v_archived_projects
    FROM archived_projs;

    -- Archive excess documents (Free tier: 5 documents)
    WITH archived_docs AS (
        SELECT * FROM archive_excess_documents(p_user_id, 5)
    )
    SELECT json_agg(row_to_json(archived_docs.*)) INTO v_archived_documents
    FROM archived_docs;

    -- Build result JSON
    v_result := json_build_object(
        'user_id', p_user_id,
        'archived_projects', COALESCE(v_archived_projects, '[]'::json),
        'archived_documents', COALESCE(v_archived_documents, '[]'::json),
        'projects_archived_count', COALESCE(json_array_length(v_archived_projects), 0),
        'documents_archived_count', COALESCE(json_array_length(v_archived_documents), 0)
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- UPDATE RLS POLICIES - Archived items are still viewable but read-only
-- ============================================================================

-- Projects: Users can view archived projects but should be warned they're archived
-- (SELECT policy already allows viewing all own projects)

-- Documents: Users can view archived documents but should be warned they're archived
-- (SELECT policy already allows viewing all own documents)

-- For INSERT policies: Don't count archived items toward limits
DROP POLICY IF EXISTS "Users can create projects within limit" ON projects;
CREATE POLICY "Users can create projects within limit"
    ON projects FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND (
            SELECT COUNT(*)
            FROM projects
            WHERE user_id = auth.uid() AND archived = FALSE
        ) < get_project_limit(auth.uid())
    );

DROP POLICY IF EXISTS "Users can upload documents within limits" ON documents;
CREATE POLICY "Users can upload documents within limits"
    ON documents FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        -- Check document count limit (only count non-archived documents)
        AND (
            SELECT COUNT(*)
            FROM documents
            WHERE user_id = auth.uid() AND archived = FALSE
        ) < get_document_limit(auth.uid())
        -- Check storage limit (count all documents including archived for storage)
        AND (
            (SELECT storage_used_bytes FROM user_subscriptions WHERE user_id = auth.uid())
            + COALESCE(file_size, 0)
        ) <= get_storage_limit(auth.uid())
    );

COMMENT ON FUNCTION archive_excess_projects(UUID, INTEGER) IS 'Archives oldest projects when user exceeds their tier limit (keeps most recently updated)';
COMMENT ON FUNCTION archive_excess_documents(UUID, INTEGER) IS 'Archives oldest documents when user exceeds their tier limit (keeps most recently updated)';
COMMENT ON FUNCTION handle_downgrade_to_free(UUID) IS 'Complete downgrade flow: archives excess projects and documents for Free tier';
