-- Migration: Create tables for real-time multi-user survey collaboration
-- These tables enable bidirectional sync between Survey App and Excel via Supabase Real-time

-- ============================================
-- SURVEY SESSIONS TABLE
-- ============================================
-- Represents an active collaboration session for a survey
CREATE TABLE IF NOT EXISTS survey_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id UUID NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    excel_file_path TEXT,
    excel_file_id TEXT,  -- OneDrive item ID for the linked Excel file
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_survey_sessions_template_id ON survey_sessions(template_id);
CREATE INDEX IF NOT EXISTS idx_survey_sessions_user_id ON survey_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_survey_sessions_active ON survey_sessions(is_active) WHERE is_active = true;
-- Enable Row Level Security
ALTER TABLE survey_sessions ENABLE ROW LEVEL SECURITY;
-- Policies for survey_sessions
CREATE POLICY "Users can view own survey sessions"
    ON survey_sessions FOR SELECT
    USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own survey sessions"
    ON survey_sessions FOR INSERT
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own survey sessions"
    ON survey_sessions FOR UPDATE
    USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own survey sessions"
    ON survey_sessions FOR DELETE
    USING (auth.uid() = user_id);
-- ============================================
-- SURVEY ITEMS TABLE
-- ============================================
-- Normalized representation of highlight annotations for real-time sync
CREATE TABLE IF NOT EXISTS survey_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES survey_sessions(id) ON DELETE CASCADE,
    highlight_id TEXT NOT NULL,
    module_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    name TEXT,
    page_number INTEGER,
    bounds JSONB,
    entity_id TEXT,
    entity_name TEXT,
    changed_by TEXT,
    changed_date TIMESTAMPTZ,
    notes TEXT,
    checklist_responses JSONB DEFAULT '{}',
    excel_row_index INTEGER,  -- Track which Excel row this item corresponds to
    version INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, highlight_id)
);
-- Indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_survey_items_session_id ON survey_items(session_id);
CREATE INDEX IF NOT EXISTS idx_survey_items_module_category ON survey_items(module_id, category_id);
CREATE INDEX IF NOT EXISTS idx_survey_items_highlight ON survey_items(highlight_id);
-- Enable Row Level Security
ALTER TABLE survey_items ENABLE ROW LEVEL SECURITY;
-- Policies for survey_items (access via session ownership)
CREATE POLICY "Users can view survey items via session"
    ON survey_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM survey_sessions
            WHERE survey_sessions.id = survey_items.session_id
            AND survey_sessions.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can insert survey items via session"
    ON survey_items FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM survey_sessions
            WHERE survey_sessions.id = session_id
            AND survey_sessions.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can update survey items via session"
    ON survey_items FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM survey_sessions
            WHERE survey_sessions.id = survey_items.session_id
            AND survey_sessions.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can delete survey items via session"
    ON survey_items FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM survey_sessions
            WHERE survey_sessions.id = survey_items.session_id
            AND survey_sessions.user_id = auth.uid()
        )
    );
-- ============================================
-- EXCEL SCHEMA MAPPING TABLE
-- ============================================
-- Maps Excel worksheet structure to survey modules/categories
CREATE TABLE IF NOT EXISTS excel_schema_mapping (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES survey_sessions(id) ON DELETE CASCADE,
    sheet_name TEXT NOT NULL,
    sheet_index INTEGER,
    module_id TEXT NOT NULL,
    category_id TEXT NOT NULL,
    column_mapping JSONB NOT NULL DEFAULT '{}',
    -- column_mapping format: { "A": "changed_by", "B": "changed_date", "C": "name", "D": "checklist_item_id_1", ... }
    header_row INTEGER DEFAULT 1,
    data_start_row INTEGER DEFAULT 2,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, sheet_name)
);
-- Indexes
CREATE INDEX IF NOT EXISTS idx_excel_schema_session ON excel_schema_mapping(session_id);
-- Enable Row Level Security
ALTER TABLE excel_schema_mapping ENABLE ROW LEVEL SECURITY;
-- Policies for excel_schema_mapping
CREATE POLICY "Users can view excel schema via session"
    ON excel_schema_mapping FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM survey_sessions
            WHERE survey_sessions.id = excel_schema_mapping.session_id
            AND survey_sessions.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can insert excel schema via session"
    ON excel_schema_mapping FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM survey_sessions
            WHERE survey_sessions.id = session_id
            AND survey_sessions.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can update excel schema via session"
    ON excel_schema_mapping FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM survey_sessions
            WHERE survey_sessions.id = excel_schema_mapping.session_id
            AND survey_sessions.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can delete excel schema via session"
    ON excel_schema_mapping FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM survey_sessions
            WHERE survey_sessions.id = excel_schema_mapping.session_id
            AND survey_sessions.user_id = auth.uid()
        )
    );
-- ============================================
-- SURVEY PRESENCE TABLE
-- ============================================
-- Track which users are currently active in a survey session
CREATE TABLE IF NOT EXISTS survey_presence (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES survey_sessions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_type TEXT NOT NULL CHECK (client_type IN ('app', 'excel', 'web')),
    display_name TEXT,
    cursor_position JSONB,  -- For showing where other users are: {moduleId, categoryId, highlightId}
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, user_id, client_type)
);
-- Indexes
CREATE INDEX IF NOT EXISTS idx_survey_presence_session ON survey_presence(session_id);
CREATE INDEX IF NOT EXISTS idx_survey_presence_last_seen ON survey_presence(last_seen);
-- Enable Row Level Security
ALTER TABLE survey_presence ENABLE ROW LEVEL SECURITY;
-- Policies for survey_presence (users in same session can see each other)
CREATE POLICY "Users can view presence in own sessions"
    ON survey_presence FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM survey_sessions
            WHERE survey_sessions.id = survey_presence.session_id
            AND survey_sessions.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can insert own presence"
    ON survey_presence FOR INSERT
    WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own presence"
    ON survey_presence FOR UPDATE
    USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own presence"
    ON survey_presence FOR DELETE
    USING (auth.uid() = user_id);
-- ============================================
-- SYNC CHANGE LOG TABLE
-- ============================================
-- Optional: Track all changes for debugging and conflict resolution
CREATE TABLE IF NOT EXISTS survey_sync_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES survey_sessions(id) ON DELETE CASCADE,
    item_id UUID REFERENCES survey_items(id) ON DELETE SET NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('insert', 'update', 'delete')),
    source TEXT NOT NULL CHECK (source IN ('app', 'excel')),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    old_values JSONB,
    new_values JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Indexes
CREATE INDEX IF NOT EXISTS idx_sync_log_session ON survey_sync_log(session_id);
CREATE INDEX IF NOT EXISTS idx_sync_log_created ON survey_sync_log(created_at);
-- Enable Row Level Security
ALTER TABLE survey_sync_log ENABLE ROW LEVEL SECURITY;
-- Policy for sync_log
CREATE POLICY "Users can view sync log via session"
    ON survey_sync_log FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM survey_sessions
            WHERE survey_sessions.id = survey_sync_log.session_id
            AND survey_sessions.user_id = auth.uid()
        )
    );
CREATE POLICY "Users can insert sync log via session"
    ON survey_sync_log FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM survey_sessions
            WHERE survey_sessions.id = session_id
            AND survey_sessions.user_id = auth.uid()
        )
    );
-- ============================================
-- TRIGGERS FOR UPDATED_AT
-- ============================================

CREATE OR REPLACE FUNCTION update_survey_tables_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trigger_update_survey_sessions_updated_at
    BEFORE UPDATE ON survey_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_survey_tables_updated_at();
CREATE TRIGGER trigger_update_survey_items_updated_at
    BEFORE UPDATE ON survey_items
    FOR EACH ROW
    EXECUTE FUNCTION update_survey_tables_updated_at();
CREATE TRIGGER trigger_update_excel_schema_updated_at
    BEFORE UPDATE ON excel_schema_mapping
    FOR EACH ROW
    EXECUTE FUNCTION update_survey_tables_updated_at();
-- ============================================
-- ENABLE REAL-TIME
-- ============================================
-- Add tables to real-time publication for live sync
ALTER PUBLICATION supabase_realtime ADD TABLE survey_items;
ALTER PUBLICATION supabase_realtime ADD TABLE survey_presence;
