-- Drop and recreate connected_services table to force schema refresh

-- First drop the existing table
DROP TABLE IF EXISTS connected_services CASCADE;

-- Recreate the table
CREATE TABLE connected_services (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    service_name VARCHAR(50) NOT NULL,
    is_connected BOOLEAN DEFAULT true,
    account_id VARCHAR(255),
    account_email VARCHAR(255),
    account_name VARCHAR(255),
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, service_name)
);

-- Create indexes
CREATE INDEX idx_connected_services_user_id ON connected_services(user_id);
CREATE INDEX idx_connected_services_service_name ON connected_services(service_name);

-- Enable RLS
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

-- Force schema reload
NOTIFY pgrst, 'reload schema';
