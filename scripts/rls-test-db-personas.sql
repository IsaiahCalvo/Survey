-- ============================================================================
-- Persona seed for survey-test (ref zgdkyslxbkusexmkfvgd).  [FINAL]
-- Inserts the 5 synthetic persona UUIDs the RLS suite (05-10) FKs against.
-- These MUST persist (commit, do NOT roll back) so document_collaborators /
-- document_annotations / document_invites foreign keys to auth.users resolve.
-- Run as a privileged role BEFORE bringUpSql's fixtures are exercised.
-- ON CONFLICT (id) DO NOTHING makes it idempotent.
--
-- Columns: id + the GoTrue NOT-NULL-without-default columns. instance_id,
-- aud, role, email, created_at, updated_at are the always-required minimum;
-- the *_token / confirmation text columns are set to '' defensively because
-- several GoTrue schema versions declare them NOT NULL without a default.
-- Columns NOT listed (email_change_token_current, phone_change,
-- phone_change_token, reauthentication_token, email_change_confirm_status,
-- is_sso_user, is_anonymous, …) carry their own NOT NULL DEFAULT in modern
-- GoTrue, so omitting them is safe. crypt()/gen_salt() come from pgcrypto,
-- which apply-kal307/308a already installed (CREATE EXTENSION IF NOT EXISTS).
-- ============================================================================
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  raw_app_meta_data, raw_user_meta_data, is_super_admin
)
SELECT
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  crypt('survey-test-persona', gen_salt('bf')),
  now(), now(), now(),
  '', '', '', '',
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  false
FROM (VALUES
  ('00000000-0000-0000-0000-000000000001'::uuid, 'persona0001@survey-test.local'),
  ('00000000-0000-0000-0000-000000000002'::uuid, 'persona0002@survey-test.local'),
  ('00000000-0000-0000-0000-000000000003'::uuid, 'persona0003@survey-test.local'),
  ('00000000-0000-0000-0000-000000000004'::uuid, 'persona0004@survey-test.local'),
  ('00000000-0000-0000-0000-000000000005'::uuid, 'persona0005@survey-test.local')
) AS u(id, email)
ON CONFLICT (id) DO NOTHING;

-- NOTE: pgcrypto (crypt/gen_salt) is standard on Supabase. If it is somehow
-- unavailable, replace the encrypted_password expression with a literal, e.g.
-- '$2a$10$abcdefghijklmnopqrstuvCJ8w0n0Qe9b2J0Yb6h2Hh4Wm3jvJ9bC'.