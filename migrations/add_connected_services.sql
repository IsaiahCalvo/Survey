-- Migration: Add connected_services table for persisting external service connections
-- This table stores information about connected services (Microsoft, Google, etc.) for each user

CREATE TABLE IF NOT EXISTS connected_services (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    service_name VARCHAR(50) NOT NULL,  -- 'microsoft', 'google', etc.
    is_connected BOOLEAN DEFAULT true,
    account_id VARCHAR(255),            -- Service-specific account identifier (e.g., MSAL homeAccountId)
    account_email VARCHAR(255),         -- Email associated with the connected account
    account_name VARCHAR(255),          -- Display name from the connected account
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',        -- Additional service-specific data
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, service_name)       -- Each user can have one connection per service
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_connected_services_user_id ON connected_services(user_id);
CREATE INDEX IF NOT EXISTS idx_connected_services_service_name ON connected_services(service_name);

-- Enable Row Level Security
ALTER TABLE connected_services ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own connected services
CREATE POLICY "Users can view own connected services"
    ON connected_services FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can insert their own connected services
CREATE POLICY "Users can insert own connected services"
    ON connected_services FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own connected services
CREATE POLICY "Users can update own connected services"
    ON connected_services FOR UPDATE
    USING (auth.uid() = user_id);

-- Policy: Users can delete their own connected services
CREATE POLICY "Users can delete own connected services"
    ON connected_services FOR DELETE
    USING (auth.uid() = user_id);

-- Create trigger for updating updated_at timestamp
CREATE OR REPLACE FUNCTION update_connected_services_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_connected_services_updated_at
    BEFORE UPDATE ON connected_services
    FOR EACH ROW
    EXECUTE FUNCTION update_connected_services_updated_at();
