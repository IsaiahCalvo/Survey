-- Migration: Fix document RLS policies to allow project owners direct access
-- This fixes the issue where project owners are denied access even though they own the document

-- ============================================
-- RE-RUN BACKFILL FOR DOCUMENT COLLABORATORS
-- ============================================
-- Ensure all document owners have proper collaborator entries

INSERT INTO document_collaborators (document_id, user_id, role, status)
SELECT
    d.id AS document_id,
    p.user_id AS user_id,
    'owner' AS role,
    'active' AS status
FROM documents d
JOIN projects p ON d.project_id = p.id
WHERE NOT EXISTS (
    SELECT 1 FROM document_collaborators dc
    WHERE dc.document_id = d.id
    AND dc.user_id = p.user_id
)
ON CONFLICT (document_id, user_id) DO NOTHING;

-- Also ensure document creators have access
INSERT INTO document_collaborators (document_id, user_id, role, status)
SELECT
    d.id AS document_id,
    d.user_id AS user_id,
    'editor' AS role,
    'active' AS status
FROM documents d
WHERE d.user_id IS NOT NULL
AND NOT EXISTS (
    SELECT 1 FROM document_collaborators dc
    WHERE dc.document_id = d.id
    AND dc.user_id = d.user_id
)
ON CONFLICT (document_id, user_id) DO NOTHING;

-- ============================================
-- UPDATE user_can_access_document FUNCTION
-- ============================================
-- Add a more robust check that doesn't solely rely on document_collaborators

CREATE OR REPLACE FUNCTION user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN AS $$
DECLARE
    doc_owner_id UUID;
    doc_creator_id UUID;
    user_role TEXT;
BEGIN
    -- Get both project owner and document creator
    SELECT p.user_id, d.user_id INTO doc_owner_id, doc_creator_id
    FROM documents d
    JOIN projects p ON d.project_id = p.id
    WHERE d.id = doc_id;

    -- Project owner always has full access
    IF doc_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    -- Document creator has editor access
    IF doc_creator_id = auth.uid() THEN
        -- Creator can do everything except owner-only operations
        IF required_role IN ('viewer', 'commenter', 'editor') THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- Check if user is a collaborator with sufficient role
    SELECT role INTO user_role
    FROM document_collaborators
    WHERE document_id = doc_id
    AND user_id = auth.uid()
    AND status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check role hierarchy: owner > editor > commenter > viewer
    CASE required_role
        WHEN 'viewer' THEN RETURN TRUE;
        WHEN 'commenter' THEN RETURN user_role IN ('commenter', 'editor', 'owner');
        WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner' THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- DROP AND RECREATE RLS POLICIES WITH SIMPLER CHECK
-- ============================================

-- Drop existing policies for document_annotations
DROP POLICY IF EXISTS "Users can view annotations on accessible documents" ON document_annotations;
DROP POLICY IF EXISTS "Users can insert annotations on editable documents" ON document_annotations;
DROP POLICY IF EXISTS "Users can update annotations on editable documents" ON document_annotations;
DROP POLICY IF EXISTS "Users can delete annotations on editable documents" ON document_annotations;

-- Recreate with simpler, more permissive policies
CREATE POLICY "Users can view annotations on accessible documents"
    ON document_annotations FOR SELECT
    USING (user_can_access_document(document_id, 'viewer'));

CREATE POLICY "Users can insert annotations on editable documents"
    ON document_annotations FOR INSERT
    WITH CHECK (user_can_access_document(document_id, 'editor'));

CREATE POLICY "Users can update annotations on editable documents"
    ON document_annotations FOR UPDATE
    USING (user_can_access_document(document_id, 'editor'));

CREATE POLICY "Users can delete annotations on editable documents"
    ON document_annotations FOR DELETE
    USING (user_can_access_document(document_id, 'editor'));

-- Drop existing policies for document_presence
DROP POLICY IF EXISTS "Users can view presence on accessible documents" ON document_presence;
DROP POLICY IF EXISTS "Users can insert own presence" ON document_presence;
DROP POLICY IF EXISTS "Users can update own presence" ON document_presence;
DROP POLICY IF EXISTS "Users can delete own presence" ON document_presence;

-- Recreate with simpler policies
CREATE POLICY "Users can view presence on accessible documents"
    ON document_presence FOR SELECT
    USING (user_can_access_document(document_id, 'viewer'));

CREATE POLICY "Users can insert own presence"
    ON document_presence FOR INSERT
    WITH CHECK (user_can_access_document(document_id, 'viewer'));

CREATE POLICY "Users can update own presence"
    ON document_presence FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own presence"
    ON document_presence FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================
-- COMMENT
-- ============================================
COMMENT ON FUNCTION user_can_access_document IS 'Check if current user can access a document with required role level. Project owners and document creators get automatic access.';
