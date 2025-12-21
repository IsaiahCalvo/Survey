-- Drop existing table and recreate cleanly to fix 406 error
DROP TABLE IF EXISTS connected_services CASCADE;

-- Create connected_services table for persisting external service connections
CREATE TABLE connected_services (
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

-- Create indexes
CREATE INDEX idx_connected_services_user_id ON connected_services(user_id);
CREATE INDEX idx_connected_services_service_name ON connected_services(service_name);

-- Enable Row Level Security
ALTER TABLE connected_services ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own connected services"
    ON connected_services FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own connected services"
    ON connected_services FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own connected services"
    ON connected_services FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own connected services"
    ON connected_services FOR DELETE
    USING (auth.uid() = user_id);

-- Trigger for updated_at
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
