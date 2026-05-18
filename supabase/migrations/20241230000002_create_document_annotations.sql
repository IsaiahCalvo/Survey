-- Migration: Create document-based annotation tables for real-time sync
-- This replaces template-based sync with document-based sync

-- ============================================
-- DOCUMENT ANNOTATIONS TABLE
-- ============================================
-- Individual annotation records for real-time multi-user sync
CREATE TABLE IF NOT EXISTS document_annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Annotation identity
    highlight_id TEXT NOT NULL,  -- Client-side ID for this highlight
    annotation_type TEXT NOT NULL DEFAULT 'highlight' CHECK (annotation_type IN ('highlight', 'callout', 'text', 'shape', 'stamp')),

    -- Location data
    page_number INTEGER NOT NULL,
    bounds JSONB NOT NULL,  -- { x, y, width, height, rotation? }

    -- Survey-specific fields
    category_id TEXT,
    module_id TEXT,
    space_id TEXT,
    name TEXT,
    notes TEXT,

    -- Entity tracking
    entity_id TEXT,
    entity_name TEXT,

    -- Checklist responses for survey items
    checklist_responses JSONB DEFAULT '{}',  -- { [itemId]: { selection, note } }

    -- Change tracking
    changed_by TEXT,
    changed_date TIMESTAMPTZ,

    -- Visual properties
    color TEXT DEFAULT '#FFFF00',
    opacity REAL DEFAULT 0.3,
    stroke_width REAL,
    font_size INTEGER,

    -- Collaboration metadata
    version INTEGER DEFAULT 1,
    last_modified_by UUID REFERENCES auth.users(id),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    -- Ensure unique highlight per document
    UNIQUE(document_id, highlight_id)
);
-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_document_annotations_document ON document_annotations(document_id);
CREATE INDEX IF NOT EXISTS idx_document_annotations_user ON document_annotations(user_id);
CREATE INDEX IF NOT EXISTS idx_document_annotations_page ON document_annotations(document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_document_annotations_category ON document_annotations(document_id, category_id);
CREATE INDEX IF NOT EXISTS idx_document_annotations_type ON document_annotations(annotation_type);
CREATE INDEX IF NOT EXISTS idx_document_annotations_updated ON document_annotations(updated_at);
-- Enable Row Level Security
ALTER TABLE document_annotations ENABLE ROW LEVEL SECURITY;
-- ============================================
-- DOCUMENT COLLABORATORS TABLE
-- ============================================
-- Track who has access to collaborate on a document
CREATE TABLE IF NOT EXISTS document_collaborators (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    invited_by UUID REFERENCES auth.users(id),

    -- Permission level
    role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer', 'commenter', 'editor', 'owner')),

    -- Invitation tracking
    email TEXT,  -- For pending invitations
    status TEXT DEFAULT 'active' CHECK (status IN ('pending', 'active', 'revoked')),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(document_id, user_id)
);
-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_document_collaborators_document ON document_collaborators(document_id);
CREATE INDEX IF NOT EXISTS idx_document_collaborators_user ON document_collaborators(user_id);
-- Enable Row Level Security
ALTER TABLE document_collaborators ENABLE ROW LEVEL SECURITY;
-- ============================================
-- DOCUMENT PRESENCE TABLE
-- ============================================
-- Track who is currently viewing/editing a document
CREATE TABLE IF NOT EXISTS document_presence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

    -- Client info
    client_type TEXT NOT NULL DEFAULT 'app' CHECK (client_type IN ('app', 'excel', 'web')),
    display_name TEXT,

    -- Cursor/selection state
    current_page INTEGER,
    cursor_position JSONB,  -- { x, y, pageNumber }
    selected_annotation_id TEXT,

    last_seen TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(document_id, user_id, client_type)
);
-- Index for lookups
CREATE INDEX IF NOT EXISTS idx_document_presence_document ON document_presence(document_id);
CREATE INDEX IF NOT EXISTS idx_document_presence_last_seen ON document_presence(last_seen);
-- Enable Row Level Security
ALTER TABLE document_presence ENABLE ROW LEVEL SECURITY;
-- ============================================
-- RLS POLICIES FOR DOCUMENT ANNOTATIONS
-- ============================================

-- Helper function to check if user has access to document
CREATE OR REPLACE FUNCTION user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN AS $$
DECLARE
    doc_owner_id UUID;
    user_role TEXT;
BEGIN
    -- Check if user owns the document (via project ownership)
    SELECT p.user_id INTO doc_owner_id
    FROM documents d
    JOIN projects p ON d.project_id = p.id
    WHERE d.id = doc_id;

    IF doc_owner_id = auth.uid() THEN
        RETURN TRUE;
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
-- Policies for document_annotations
CREATE POLICY "Users can view annotations on accessible documents"
    ON document_annotations FOR SELECT
    USING (user_can_access_document(document_id, 'viewer'));
CREATE POLICY "Users can insert annotations on editable documents"
    ON document_annotations FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND
        user_can_access_document(document_id, 'editor')
    );
CREATE POLICY "Users can update annotations on editable documents"
    ON document_annotations FOR UPDATE
    USING (user_can_access_document(document_id, 'editor'));
CREATE POLICY "Users can delete annotations on editable documents"
    ON document_annotations FOR DELETE
    USING (user_can_access_document(document_id, 'editor'));
-- ============================================
-- RLS POLICIES FOR DOCUMENT COLLABORATORS
-- ============================================

-- Document owners can manage collaborators
CREATE POLICY "Document owners can view collaborators"
    ON document_collaborators FOR SELECT
    USING (user_can_access_document(document_id, 'viewer'));
CREATE POLICY "Document owners can add collaborators"
    ON document_collaborators FOR INSERT
    WITH CHECK (user_can_access_document(document_id, 'owner'));
CREATE POLICY "Document owners can update collaborators"
    ON document_collaborators FOR UPDATE
    USING (user_can_access_document(document_id, 'owner'));
CREATE POLICY "Document owners can remove collaborators"
    ON document_collaborators FOR DELETE
    USING (user_can_access_document(document_id, 'owner'));
-- ============================================
-- RLS POLICIES FOR DOCUMENT PRESENCE
-- ============================================

CREATE POLICY "Users can view presence on accessible documents"
    ON document_presence FOR SELECT
    USING (user_can_access_document(document_id, 'viewer'));
CREATE POLICY "Users can insert own presence"
    ON document_presence FOR INSERT
    WITH CHECK (
        auth.uid() = user_id AND
        user_can_access_document(document_id, 'viewer')
    );
CREATE POLICY "Users can update own presence"
    ON document_presence FOR UPDATE
    USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own presence"
    ON document_presence FOR DELETE
    USING (auth.uid() = user_id);
-- ============================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================

CREATE OR REPLACE FUNCTION update_document_tables_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trigger_update_document_annotations_updated_at
    BEFORE UPDATE ON document_annotations
    FOR EACH ROW
    EXECUTE FUNCTION update_document_tables_updated_at();
CREATE TRIGGER trigger_update_document_collaborators_updated_at
    BEFORE UPDATE ON document_collaborators
    FOR EACH ROW
    EXECUTE FUNCTION update_document_tables_updated_at();
-- ============================================
-- ENABLE REAL-TIME
-- ============================================
-- Add tables to real-time publication for live sync
ALTER PUBLICATION supabase_realtime ADD TABLE document_annotations;
ALTER PUBLICATION supabase_realtime ADD TABLE document_presence;
-- ============================================
-- ADD OWNER COLLABORATOR TRIGGER
-- ============================================
-- Automatically add document creator as owner collaborator
CREATE OR REPLACE FUNCTION add_document_owner_collaborator()
RETURNS TRIGGER AS $$
DECLARE
    owner_id UUID;
BEGIN
    -- Get the project owner
    SELECT user_id INTO owner_id
    FROM projects
    WHERE id = NEW.project_id;

    -- Add owner as collaborator
    IF owner_id IS NOT NULL THEN
        INSERT INTO document_collaborators (document_id, user_id, role, status)
        VALUES (NEW.id, owner_id, 'owner', 'active')
        ON CONFLICT (document_id, user_id) DO NOTHING;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trigger_add_document_owner
    AFTER INSERT ON documents
    FOR EACH ROW
    EXECUTE FUNCTION add_document_owner_collaborator();
