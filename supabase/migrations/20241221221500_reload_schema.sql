-- This migration triggers a PostgREST schema cache reload
-- by making a small DDL change

COMMENT ON TABLE connected_services IS 'Stores user connections to external services (Microsoft, Google, etc.)';

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
