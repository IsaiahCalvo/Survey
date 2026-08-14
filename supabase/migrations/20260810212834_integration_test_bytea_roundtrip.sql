CREATE TABLE IF NOT EXISTS public.integration_test_bytea_roundtrip (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payload bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_test_bytea_roundtrip ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.integration_test_bytea_roundtrip FROM anon, authenticated;
GRANT SELECT, INSERT, DELETE ON TABLE public.integration_test_bytea_roundtrip TO service_role;

COMMENT ON TABLE public.integration_test_bytea_roundtrip IS
  'Service-role-only bytea transport fixture. Never contains application data.';;
