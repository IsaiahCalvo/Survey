-- Migration: Backfill document_collaborators for existing documents
-- This ensures all document owners have proper collaborator entries for RLS to work

-- ============================================
-- BACKFILL DOCUMENT COLLABORATORS
-- ============================================
-- For any documents that don't have a collaborator entry for their project owner,
-- add one. This handles documents created before the trigger was added.

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

-- ============================================
-- ALSO ADD DOCUMENT CREATOR AS COLLABORATOR
-- ============================================
-- Some documents might have a different user_id than the project owner
-- (e.g., if someone else creates a document in a shared project)
-- Add the document's user_id as an editor if not already present

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
ON CONFLICT (document_id, user_id) DO UPDATE SET
    role = CASE
        WHEN EXCLUDED.role = 'owner' THEN 'owner'
        WHEN document_collaborators.role = 'owner' THEN 'owner'
        ELSE GREATEST(document_collaborators.role, EXCLUDED.role)
    END;

-- ============================================
-- UPDATE TRIGGER TO ALSO ADD DOCUMENT CREATOR
-- ============================================
-- Modify the trigger function to add both project owner AND document creator

CREATE OR REPLACE FUNCTION add_document_owner_collaborator()
RETURNS TRIGGER AS $$
DECLARE
    owner_id UUID;
BEGIN
    -- Get the project owner
    SELECT user_id INTO owner_id
    FROM projects
    WHERE id = NEW.project_id;

    -- Add project owner as owner-level collaborator
    IF owner_id IS NOT NULL THEN
        INSERT INTO document_collaborators (document_id, user_id, role, status)
        VALUES (NEW.id, owner_id, 'owner', 'active')
        ON CONFLICT (document_id, user_id) DO NOTHING;
    END IF;

    -- Also add the document's user_id (creator) as editor if different from owner
    IF NEW.user_id IS NOT NULL AND NEW.user_id != owner_id THEN
        INSERT INTO document_collaborators (document_id, user_id, role, status)
        VALUES (NEW.id, NEW.user_id, 'editor', 'active')
        ON CONFLICT (document_id, user_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- ADD COMMENT
-- ============================================
COMMENT ON FUNCTION add_document_owner_collaborator IS 'Adds project owner as owner and document creator as editor to document_collaborators on document creation';
