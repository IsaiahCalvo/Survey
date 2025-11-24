-- SUPABASE DATABASE SCHEMA
-- Run this in your Supabase SQL Editor (Database → SQL Editor)
-- https://supabase.com/dashboard/project/YOUR_PROJECT/sql

-- Enable Row Level Security
-- This ensures users can only access their own data

-- ============================================
-- USER SETTINGS TABLE
-- ============================================
CREATE TABLE user_settings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  -- View preferences
  default_zoom DECIMAL DEFAULT 100,
  default_view_mode VARCHAR(20) DEFAULT 'single', -- 'single' or 'continuous'
  theme VARCHAR(20) DEFAULT 'light', -- 'light' or 'dark'

  -- Application preferences
  show_toolbar BOOLEAN DEFAULT true,
  show_page_numbers BOOLEAN DEFAULT true,
  auto_save BOOLEAN DEFAULT true,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One settings record per user
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Users can only read/write their own settings
CREATE POLICY "Users can view own settings" ON user_settings
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings" ON user_settings
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings" ON user_settings
  FOR UPDATE USING (auth.uid() = user_id);

-- ============================================
-- PROJECTS TABLE
-- ============================================
CREATE TABLE projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  name VARCHAR(255) NOT NULL,
  description TEXT,
  color VARCHAR(7), -- Hex color for UI display

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Indexes
  INDEX idx_projects_user_id (user_id)
);

-- Enable RLS
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- Users can only access their own projects
CREATE POLICY "Users can view own projects" ON projects
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own projects" ON projects
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects" ON projects
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects" ON projects
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- TEMPLATES TABLE
-- ============================================
CREATE TABLE templates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,

  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- Template configuration (stored as JSON)
  config JSONB, -- Form fields, layout, etc.

  -- Storage
  file_path VARCHAR(500), -- Path in Supabase Storage (if template has a PDF)

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_templates_user_id (user_id)
);

-- Enable RLS
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own templates" ON templates
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own templates" ON templates
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own templates" ON templates
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own templates" ON templates
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- DOCUMENTS TABLE
-- ============================================
CREATE TABLE documents (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
  template_id UUID REFERENCES templates(id) ON DELETE SET NULL, -- Optional template

  name VARCHAR(255) NOT NULL,
  description TEXT,

  -- File storage
  file_path VARCHAR(500) NOT NULL, -- Path in Supabase Storage
  file_size BIGINT, -- Size in bytes
  page_count INTEGER,

  -- Document state
  is_survey_mode BOOLEAN DEFAULT false,
  current_page INTEGER DEFAULT 1,
  zoom_level DECIMAL DEFAULT 100,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_opened_at TIMESTAMPTZ,

  INDEX idx_documents_user_id (user_id),
  INDEX idx_documents_project_id (project_id)
);

-- Enable RLS
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own documents" ON documents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own documents" ON documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own documents" ON documents
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own documents" ON documents
  FOR DELETE USING (auth.uid() = user_id);

-- ============================================
-- SPACES TABLE (page groups within documents)
-- ============================================
CREATE TABLE spaces (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE NOT NULL,

  name VARCHAR(255) NOT NULL, -- e.g., "Phase 1", "Foundation", etc.
  description TEXT,
  color VARCHAR(7), -- Hex color for UI

  -- Page range
  start_page INTEGER NOT NULL,
  end_page INTEGER NOT NULL,

  -- Display order
  sort_order INTEGER DEFAULT 0,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  INDEX idx_spaces_document_id (document_id),

  -- Ensure valid page range
  CHECK (start_page > 0 AND end_page >= start_page)
);

-- Enable RLS (inherit from document)
ALTER TABLE spaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view spaces for own documents" ON spaces
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = spaces.document_id
      AND documents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert spaces for own documents" ON spaces
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = spaces.document_id
      AND documents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update spaces for own documents" ON spaces
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = spaces.document_id
      AND documents.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete spaces for own documents" ON spaces
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM documents
      WHERE documents.id = spaces.document_id
      AND documents.user_id = auth.uid()
    )
  );

-- ============================================
-- STORAGE BUCKETS
-- ============================================
-- Run these commands in the Supabase Storage section
-- Storage → Create new bucket

-- 1. Create 'documents' bucket for PDF files
-- 2. Create 'templates' bucket for template PDFs (optional)
-- 3. Set up RLS policies for each bucket

-- Example RLS policy for documents bucket:
-- Bucket: documents
-- Policy: Users can upload their own files
-- SELECT: (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1])
-- INSERT: (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1])
-- UPDATE: (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1])
-- DELETE: (bucket_id = 'documents' AND auth.uid()::text = (storage.foldername(name))[1])

-- File path structure: {user_id}/{project_id}/{filename}

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply to all tables
CREATE TRIGGER update_user_settings_updated_at BEFORE UPDATE ON user_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_templates_updated_at BEFORE UPDATE ON templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_spaces_updated_at BEFORE UPDATE ON spaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- INITIAL DATA
-- ============================================

-- No initial data needed - users will create their own content
