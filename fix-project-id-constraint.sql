-- Fix project_id constraint to allow NULL values
-- Run this in your Supabase SQL Editor

-- First, check if there are any existing NOT NULL constraints
-- Then drop and recreate the constraint to allow NULL

-- Drop any existing NOT NULL constraint on project_id
ALTER TABLE documents 
  ALTER COLUMN project_id DROP NOT NULL;

-- Verify the change
-- This should now allow NULL values for project_id
-- Documents can exist without being assigned to a project













