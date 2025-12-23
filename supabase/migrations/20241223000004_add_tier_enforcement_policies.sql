-- Add RLS policies to enforce tier limits on existing tables
-- This migration updates existing tables: projects, documents, templates, spaces

-- ============================================================================
-- PROJECTS TABLE - Enforce project limits
-- ============================================================================

-- Drop existing policies if they exist (to avoid conflicts)
DROP POLICY IF EXISTS "Users can view own projects" ON projects;
DROP POLICY IF EXISTS "Users can insert own projects" ON projects;
DROP POLICY IF EXISTS "Users can update own projects" ON projects;
DROP POLICY IF EXISTS "Users can delete own projects" ON projects;
DROP POLICY IF EXISTS "Users can create projects within limit" ON projects;

-- SELECT: Users can view all their projects (including archived)
CREATE POLICY "Users can view own projects"
    ON projects FOR SELECT
    USING (auth.uid() = user_id);

-- INSERT: Enforce project limit based on tier
CREATE POLICY "Users can create projects within limit"
    ON projects FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND get_current_usage(auth.uid(), 'projects_count') < get_project_limit(auth.uid())
    );

-- UPDATE: Users can update their own projects (but only active ones for Free tier)
CREATE POLICY "Users can update own projects"
    ON projects FOR UPDATE
    USING (
        auth.uid() = user_id
        AND (
            get_user_tier(auth.uid()) IN ('pro', 'enterprise', 'developer')
            OR is_project_accessible(id, auth.uid())
        )
    );

-- DELETE: Users can delete their own projects
CREATE POLICY "Users can delete own projects"
    ON projects FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- DOCUMENTS TABLE - Enforce document and storage limits
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own documents" ON documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON documents;
DROP POLICY IF EXISTS "Users can update own documents" ON documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON documents;
DROP POLICY IF EXISTS "Users can upload documents within limits" ON documents;

-- SELECT: Users can view all their documents
CREATE POLICY "Users can view own documents"
    ON documents FOR SELECT
    USING (auth.uid() = user_id);

-- INSERT: Enforce document count and storage limits
CREATE POLICY "Users can upload documents within limits"
    ON documents FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        -- Check document count limit
        AND get_current_usage(auth.uid(), 'documents_count') < get_document_limit(auth.uid())
        -- Check storage limit
        AND (
            (SELECT storage_used_bytes FROM user_subscriptions WHERE user_id = auth.uid())
            + COALESCE(file_size, 0)
        ) <= get_storage_limit(auth.uid())
    );

-- UPDATE: Users can update their own documents
CREATE POLICY "Users can update own documents"
    ON documents FOR UPDATE
    USING (auth.uid() = user_id);

-- DELETE: Users can delete their own documents
CREATE POLICY "Users can delete own documents"
    ON documents FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- TEMPLATES TABLE - Only Pro/Enterprise/Developer can create
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own templates" ON templates;
DROP POLICY IF EXISTS "Users can insert own templates" ON templates;
DROP POLICY IF EXISTS "Users can update own templates" ON templates;
DROP POLICY IF EXISTS "Users can delete own templates" ON templates;
DROP POLICY IF EXISTS "Only Pro users can create templates" ON templates;
DROP POLICY IF EXISTS "Only Pro users can edit templates" ON templates;

-- SELECT: Users can view all their templates (even after downgrade to Free)
CREATE POLICY "Users can view own templates"
    ON templates FOR SELECT
    USING (auth.uid() = user_id);

-- INSERT: Only Pro/Enterprise/Developer can create templates
CREATE POLICY "Only Pro users can create templates"
    ON templates FOR INSERT
    WITH CHECK (
        auth.uid() = user_id
        AND has_feature_access(auth.uid(), 'templates')
    );

-- UPDATE: Only Pro/Enterprise/Developer can edit templates
CREATE POLICY "Only Pro users can edit templates"
    ON templates FOR UPDATE
    USING (
        auth.uid() = user_id
        AND has_feature_access(auth.uid(), 'templates')
    );

-- DELETE: Users can delete their own templates
CREATE POLICY "Users can delete own templates"
    ON templates FOR DELETE
    USING (auth.uid() = user_id);

-- ============================================================================
-- SPACES TABLE - Only Pro/Enterprise/Developer can create
-- ============================================================================

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view own spaces" ON spaces;
DROP POLICY IF EXISTS "Users can insert own spaces" ON spaces;
DROP POLICY IF EXISTS "Users can update own spaces" ON spaces;
DROP POLICY IF EXISTS "Users can delete own spaces" ON spaces;
DROP POLICY IF EXISTS "Only Pro users can create spaces" ON spaces;
DROP POLICY IF EXISTS "Only Pro users can edit spaces" ON spaces;

-- SELECT: Users can view spaces for their documents
CREATE POLICY "Users can view own spaces"
    ON spaces FOR SELECT
    USING (
        document_id IN (
            SELECT id FROM documents WHERE user_id = auth.uid()
        )
    );

-- INSERT: Only Pro/Enterprise/Developer can create spaces
CREATE POLICY "Only Pro users can create spaces"
    ON spaces FOR INSERT
    WITH CHECK (
        document_id IN (
            SELECT id FROM documents WHERE user_id = auth.uid()
        )
        AND has_feature_access(auth.uid(), 'regions')
    );

-- UPDATE: Only Pro/Enterprise/Developer can edit spaces
CREATE POLICY "Only Pro users can edit spaces"
    ON spaces FOR UPDATE
    USING (
        document_id IN (
            SELECT id FROM documents WHERE user_id = auth.uid()
        )
        AND has_feature_access(auth.uid(), 'regions')
    );

-- DELETE: Users can delete their own spaces
CREATE POLICY "Users can delete own spaces"
    ON spaces FOR DELETE
    USING (
        document_id IN (
            SELECT id FROM documents WHERE user_id = auth.uid()
        )
    );

-- ============================================================================
-- USER_SETTINGS TABLE - Basic access (no tier restrictions)
-- ============================================================================

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can insert own settings" ON user_settings;
DROP POLICY IF EXISTS "Users can update own settings" ON user_settings;

-- All users can manage their settings regardless of tier
CREATE POLICY "Users can view own settings"
    ON user_settings FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
    ON user_settings FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
    ON user_settings FOR UPDATE
    USING (auth.uid() = user_id);

-- ============================================================================
-- STORAGE BUCKET POLICIES - Enforce storage limits
-- ============================================================================

-- Note: Supabase Storage uses different policy syntax
-- These policies will be created via Supabase Dashboard or separate storage policies

-- For reference, storage policies would look like:
-- CREATE POLICY "Users can upload files within storage limit"
-- ON storage.objects FOR INSERT
-- WITH CHECK (
--     bucket_id = 'documents'
--     AND auth.uid()::text = (storage.foldername(name))[1]
--     AND (SELECT storage_used_bytes FROM user_subscriptions WHERE user_id = auth.uid()) < get_storage_limit(auth.uid())
-- );

COMMENT ON POLICY "Users can create projects within limit" ON projects IS 'Enforces project limit based on subscription tier (Free: 1, Pro+: unlimited)';
COMMENT ON POLICY "Users can upload documents within limits" ON documents IS 'Enforces both document count and storage size limits based on tier';
COMMENT ON POLICY "Only Pro users can create templates" ON templates IS 'Templates require Pro, Enterprise, or Developer tier';
COMMENT ON POLICY "Only Pro users can create spaces" ON spaces IS 'Regions/Spaces require Pro, Enterprise, or Developer tier';
