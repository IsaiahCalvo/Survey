-- Create user_settings table
-- Run this in Supabase SQL Editor: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/sql

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
  ball_in_court_opacity INTEGER DEFAULT 20, -- Opacity for Ball in Court entities (0-100)

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

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON user_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
