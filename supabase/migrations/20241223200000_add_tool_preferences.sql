-- Migration: Add tool_preferences column to documents table
-- This column stores per-document, per-tool annotation preferences (color, width, opacity, etc.)
-- Format: JSONB with structure { [toolId]: { strokeColor, strokeWidth, strokeOpacity, fillColor, fillOpacity } }

-- Add the column if it doesn't exist
ALTER TABLE documents
ADD COLUMN IF NOT EXISTS tool_preferences JSONB DEFAULT '{}'::jsonb;

-- Add a comment for documentation
COMMENT ON COLUMN documents.tool_preferences IS 'Per-tool annotation preferences for this document. Structure: { [toolId]: { strokeColor, strokeWidth, strokeOpacity, fillColor, fillOpacity } }';

-- Create an index for faster lookups (optional, but useful if you query by tool preferences)
CREATE INDEX IF NOT EXISTS idx_documents_tool_preferences ON documents USING GIN (tool_preferences);
