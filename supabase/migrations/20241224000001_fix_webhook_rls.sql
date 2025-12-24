-- Fix RLS policies to allow service role (webhooks) to update subscriptions
-- This migration adds explicit policies for the service role to manage user_subscriptions

-- Add policy to allow service role to update any subscription
CREATE POLICY "Service role can update all subscriptions"
    ON user_subscriptions FOR UPDATE
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Add policy to allow service role to insert any subscription
CREATE POLICY "Service role can insert all subscriptions"
    ON user_subscriptions FOR INSERT
    TO service_role
    WITH CHECK (true);

-- Add policy to allow service role to select all subscriptions
CREATE POLICY "Service role can select all subscriptions"
    ON user_subscriptions FOR SELECT
    TO service_role
    USING (true);

-- Ensure service role can also delete if needed
CREATE POLICY "Service role can delete all subscriptions"
    ON user_subscriptions FOR DELETE
    TO service_role
    USING (true);
