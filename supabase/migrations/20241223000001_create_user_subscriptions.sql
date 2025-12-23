-- Create user_subscriptions table for managing subscription tiers
-- Includes developer tier for internal testing without payment

-- Create enum for subscription tiers
CREATE TYPE subscription_tier AS ENUM ('free', 'pro', 'enterprise', 'developer');

-- Create enum for subscription status
CREATE TYPE subscription_status AS ENUM ('active', 'trialing', 'past_due', 'canceled', 'incomplete');

-- Create user_subscriptions table
CREATE TABLE user_subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tier subscription_tier NOT NULL DEFAULT 'free',
    status subscription_status NOT NULL DEFAULT 'active',

    -- Stripe integration fields
    stripe_customer_id VARCHAR(255) UNIQUE,
    stripe_subscription_id VARCHAR(255) UNIQUE,
    stripe_price_id VARCHAR(255),

    -- Trial and period tracking
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    current_period_start TIMESTAMP WITH TIME ZONE,
    current_period_end TIMESTAMP WITH TIME ZONE,

    -- Storage and usage tracking
    storage_used_bytes BIGINT DEFAULT 0,

    -- Metadata
    metadata JSONB DEFAULT '{}',

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    UNIQUE(user_id)
);

-- Create index for faster lookups
CREATE INDEX idx_user_subscriptions_user_id ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_stripe_customer_id ON user_subscriptions(stripe_customer_id);
CREATE INDEX idx_user_subscriptions_tier ON user_subscriptions(tier);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(status);

-- Enable RLS
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own subscription"
    ON user_subscriptions FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscription"
    ON user_subscriptions FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own subscription"
    ON user_subscriptions FOR UPDATE
    USING (auth.uid() = user_id);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION update_user_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_subscriptions_updated_at
    BEFORE UPDATE ON user_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_user_subscriptions_updated_at();

-- Function to create default subscription when user signs up
CREATE OR REPLACE FUNCTION handle_new_user_subscription()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_subscriptions (user_id, tier, status)
    VALUES (NEW.id, 'free', 'active');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to auto-create subscription for new users
CREATE TRIGGER on_auth_user_created_subscription
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION handle_new_user_subscription();

-- Function to get user tier (used in RLS policies)
CREATE OR REPLACE FUNCTION get_user_tier(p_user_id UUID)
RETURNS subscription_tier AS $$
DECLARE
    user_tier subscription_tier;
BEGIN
    SELECT tier INTO user_tier
    FROM user_subscriptions
    WHERE user_id = p_user_id;

    -- Default to free if no subscription found
    RETURN COALESCE(user_tier, 'free');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to check if user has access to a feature
CREATE OR REPLACE FUNCTION has_feature_access(p_user_id UUID, p_feature TEXT)
RETURNS BOOLEAN AS $$
DECLARE
    user_tier subscription_tier;
BEGIN
    user_tier := get_user_tier(p_user_id);

    -- Developer tier has access to everything
    IF user_tier = 'developer' THEN
        RETURN TRUE;
    END IF;

    -- Enterprise has access to everything (including future features)
    IF user_tier = 'enterprise' THEN
        RETURN TRUE;
    END IF;

    -- Pro has access to specific features
    IF user_tier = 'pro' THEN
        RETURN p_feature IN (
            'survey_tools',
            'templates',
            'regions',
            'excel_export',
            'onedrive',
            'advanced_tools',
            'page_operations',
            'unlimited_projects',
            'unlimited_documents'
        );
    END IF;

    -- Free tier has basic features only
    IF user_tier = 'free' THEN
        RETURN p_feature IN (
            'basic_annotations',
            'pdf_viewer',
            'layers'
        );
    END IF;

    RETURN FALSE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get storage limit based on tier
CREATE OR REPLACE FUNCTION get_storage_limit(p_user_id UUID)
RETURNS BIGINT AS $$
DECLARE
    user_tier subscription_tier;
BEGIN
    user_tier := get_user_tier(p_user_id);

    RETURN CASE
        WHEN user_tier = 'free' THEN 104857600 -- 100MB
        WHEN user_tier = 'pro' THEN 10737418240 -- 10GB
        WHEN user_tier = 'enterprise' THEN 1099511627776 -- 1TB
        WHEN user_tier = 'developer' THEN 107374182400 -- 100GB (for testing)
        ELSE 104857600 -- Default to 100MB
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get project limit based on tier
CREATE OR REPLACE FUNCTION get_project_limit(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    user_tier subscription_tier;
BEGIN
    user_tier := get_user_tier(p_user_id);

    RETURN CASE
        WHEN user_tier = 'free' THEN 1
        WHEN user_tier IN ('pro', 'enterprise', 'developer') THEN 999999 -- Effectively unlimited
        ELSE 1
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get document limit based on tier
CREATE OR REPLACE FUNCTION get_document_limit(p_user_id UUID)
RETURNS INTEGER AS $$
DECLARE
    user_tier subscription_tier;
BEGIN
    user_tier := get_user_tier(p_user_id);

    RETURN CASE
        WHEN user_tier = 'free' THEN 5
        WHEN user_tier IN ('pro', 'enterprise', 'developer') THEN 999999 -- Effectively unlimited
        ELSE 5
    END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Insert developer account subscription
-- NOTE: You'll need to replace this email with your actual developer account email
-- This will be set up after you create your developer account
-- Example: INSERT INTO user_subscriptions (user_id, tier, status)
--          SELECT id, 'developer', 'active' FROM auth.users WHERE email = 'your-dev-email@example.com';

COMMENT ON TABLE user_subscriptions IS 'Stores user subscription tiers and Stripe integration data';
COMMENT ON TYPE subscription_tier IS 'Subscription tiers: free (limited), pro (full features), enterprise (team features), developer (testing account)';
COMMENT ON TYPE subscription_status IS 'Subscription status following Stripe conventions';
COMMENT ON FUNCTION has_feature_access IS 'Check if user has access to a specific feature based on their tier';
COMMENT ON FUNCTION get_storage_limit IS 'Get storage limit in bytes based on user tier';
COMMENT ON FUNCTION get_project_limit IS 'Get maximum number of projects allowed for user tier';
COMMENT ON FUNCTION get_document_limit IS 'Get maximum number of documents allowed for user tier';
