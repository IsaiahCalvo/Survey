# Area 12 — Supabase / storage / RLS / functions · **PASS**

## `user_can_access_document` RPC

- Signature: `user_can_access_document(doc_id uuid, required_role text DEFAULT 'viewer')`.
- Probed via authenticated anon client (`scripts/area-12-supabase-checks.mjs`):
  - Owner (pro) → `rpc.value=true`, `select.rows=1` ✓
  - Unauthorized (free) → `rpc.value=false`, `select.rows=0` ✓
  - Unauthorized (enterprise, before invite) → `rpc.value=false`, `select.rows=0` ✓
  - Collaborator (enterprise, viewer role) → `rpc.value=true`, `select.rows=1` ✓
  - Junk UUID → `rpc.value=false` ✓
- No `42703` column error, no `created_by` reference.

## `documents` table schema

Columns confirmed on remote: `id, user_id, project_id, template_id, name, description, file_path, file_size, page_count, is_survey_mode, current_page, zoom_level, created_at, updated_at, last_opened_at, tool_preferences, archived, first_opened_device, first_opened_user_tier, first_opened_app_version, cutover_completed_at, locked_at, locked_by, locked_label`.

- Note: `user_id` (not `created_by`) — confirms the migration rename is durable.
- `locked_at / locked_by / locked_label` already exist (area 8).

## `projects` schema

`id, user_id, name, description, color, created_at, updated_at, archived` — also `user_id` (not `owner_id`).

## Edge functions

`send-email` Resend-backed function reachable:
- `OPTIONS` → 200 (CORS preflight OK)
- `POST {}` → 400 `{"error":"Missing required fields: to, subject, template"}`
- `POST {to: ...}` → 400 same error from the function body, proving the Deno code is running.

Resend API path is wired. Real email delivery not exercised (would require RESEND_API_KEY hit + real recipient).

Tracked logs: `logs/area-12-supabase.json`, `logs/area-12-functions.json`.
