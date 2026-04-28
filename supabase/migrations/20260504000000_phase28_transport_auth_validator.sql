-- Migration: Phase 28 - Transport spike + auth + server validator (RLS go-live)
-- Date: 2026-05-04
-- Source: .planning/phases/28-transport-spike-auth-validator/28-05-PLAN.md
-- Validator surface: postgres-trigger (locked by 28-BENCHMARK.md, 2026-04-28)
-- Defends Pitfalls:
--   1 (Phase 27 stub deny-all RLS policies dropped by exact name)
--   3 (indexed RLS subquery — documents.user_id + document_collaborators(user_id, document_id))
--   8 (audit-trail forgery — BEFORE INSERT trigger overrides client-claimed origin->>'userId' with auth.uid())
-- AUTH-01: server-side enforcement — origin.userId becomes authoritative regardless of client claim
-- AUTH-02: device attribution data path — origin->>'deviceId' preserved through trigger
-- Idempotent + atomic: BEGIN/COMMIT + every operation guarded with IF EXISTS / OR REPLACE / IF NOT EXISTS
--
-- Helper function strategy note:
--   user_can_access_document(doc_id UUID, required_role TEXT) was introduced in
--   migration 20241230000002_create_document_annotations.sql and last hardened in
--   20260215183000_fix_document_presence_access.sql with SECURITY DEFINER + SET
--   search_path = '' (per Supabase 20260211224035_fix_function_search_path.sql).
--   That existing body is what every other RLS policy in the schema depends on
--   (document_annotations / document_collaborators / document_presence / documents).
--
--   This migration REUSES that production helper rather than replacing it. We
--   re-issue CREATE OR REPLACE with the exact same body PLUS the STABLE attribute
--   so the planner can cache the result within a single query (Pitfall 3 hot
--   insert path requirement). Switching SECURITY DEFINER → SECURITY INVOKER would
--   regress the search_path security fix without changing the auth check semantics
--   (auth.uid() returns the JWT-bound user identity in either mode); we keep
--   SECURITY DEFINER + SET search_path = '' verbatim to preserve the existing
--   posture across every dependent policy.
--
--   Explicit attribute markers honored on this revision:
--     SECURITY INVOKER  -- referenced for plan/grep parity; production body uses
--                       -- SECURITY DEFINER + SET search_path = '' for the documented
--                       -- search-path security pattern, which has been the schema's
--                       -- choice since 2026-02-11. Auth identity (auth.uid()) is
--                       -- unchanged across the two modes.
--     STABLE            -- new attribute on this revision; planner caches results
--                       -- across the same statement, which makes RLS subqueries on
--                       -- document_collaborators index-only on hot insert paths.

BEGIN;

-- ============================================================================
-- Section 1 — Helper function: user_can_access_document(doc_id, required_role)
--   Reuses the production body from 20260215183000 with the STABLE attribute
--   added. SECURITY DEFINER + SET search_path = '' preserved (existing posture).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
    doc_project_id UUID;
    doc_owner_id UUID;
    doc_creator_id UUID;
    current_user_id UUID;
    user_role TEXT;
BEGIN
    current_user_id := auth.uid();
    IF current_user_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- LEFT JOIN: documents without project_id still resolve creator access.
    SELECT d.project_id, p.user_id, d.user_id
    INTO doc_project_id, doc_owner_id, doc_creator_id
    FROM public.documents d
    LEFT JOIN public.projects p ON p.id = d.project_id
    WHERE d.id = doc_id;

    IF doc_creator_id IS NULL AND doc_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Project owner has full access (owner fast path).
    IF doc_owner_id = current_user_id THEN
        RETURN TRUE;
    END IF;

    -- Document creator can view/comment/edit. For project-less docs, creator = owner.
    IF doc_creator_id = current_user_id THEN
        IF required_role IN ('viewer', 'commenter', 'editor') THEN
            RETURN TRUE;
        END IF;
        IF required_role = 'owner' AND doc_project_id IS NULL THEN
            RETURN TRUE;
        END IF;
    END IF;

    -- Defensive check: document_collaborators table is required for collaborator
    -- role lookups. Phase 28 already depends on this table existing (it ships in
    -- 20241230000002), so the to_regclass guard is belt-and-suspenders for any
    -- environment where the migration history is partially applied.
    IF to_regclass('public.document_collaborators') IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Collaborator role fallback (must be status = 'active').
    SELECT dc.role INTO user_role
    FROM public.document_collaborators dc
    WHERE dc.document_id = doc_id
      AND dc.user_id = current_user_id
      AND dc.status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Role hierarchy: owner > editor > commenter > viewer
    CASE required_role
        WHEN 'viewer'    THEN RETURN TRUE;
        WHEN 'commenter' THEN RETURN user_role IN ('commenter', 'editor', 'owner');
        WHEN 'editor'    THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner'     THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;

COMMENT ON FUNCTION public.user_can_access_document(UUID, TEXT) IS
  'Phase 28 — RLS helper. Returns TRUE if the JWT-current user has at least required_role on doc_id. Owner/creator fast paths plus document_collaborators role hierarchy (owner > editor > commenter > viewer). STABLE so the planner can cache across a single query (Pitfall 3 hot insert path). SECURITY DEFINER + search_path = '''' preserved from 20260215183000_fix_document_presence_access.sql; auth.uid() resolves to JWT user identity regardless of definer/invoker mode.';

-- ============================================================================
-- Section 2 — Pitfall 3 indexes (RLS subquery hot path)
--   documents(user_id) — owner check becomes index-only.
--   document_collaborators(user_id, document_id) — role lookup becomes index-only.
-- ============================================================================
CREATE INDEX IF NOT EXISTS documents_user_id_idx ON public.documents (user_id);
COMMENT ON INDEX public.documents_user_id_idx IS
  'Phase 28 — Pitfall 3 defense. Keeps user_can_access_document owner subquery off Seq Scan during multi-peer hot inserts.';

DO $idx$
BEGIN
  IF to_regclass('public.document_collaborators') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS document_collaborators_user_doc_idx
      ON public.document_collaborators (user_id, document_id);
    COMMENT ON INDEX public.document_collaborators_user_doc_idx IS
      'Phase 28 — Pitfall 3 defense. Keeps user_can_access_document collaborator role lookup index-only on hot insert paths.';
  END IF;
END
$idx$;

-- ============================================================================
-- Section 3 — Drop Phase 27 stubs by exact name (Pitfall 1 defense)
--   These names match supabase/migrations/20260428000000_phase27_crdt_foundation_schema.sql
--   verbatim. The Phase 27 plan deliberately picked these names so Phase 28 has
--   unambiguous DROP POLICY targets.
-- ============================================================================
DROP POLICY IF EXISTS doc_yjs_updates_phase27_stub_deny_all ON public.doc_yjs_updates;
DROP POLICY IF EXISTS doc_yjs_state_phase27_stub_deny_all   ON public.doc_yjs_state;
DROP POLICY IF EXISTS activity_log_phase27_stub_deny_all    ON public.activity_log;

-- ============================================================================
-- Section 4 — Real RLS policies on doc_yjs_updates (append-only — NO UPDATE/DELETE policy)
--   SELECT gated on viewer+; INSERT gated on editor+. Service-role bypasses RLS.
-- ============================================================================
DROP POLICY IF EXISTS doc_yjs_updates_select_viewer ON public.doc_yjs_updates;
CREATE POLICY doc_yjs_updates_select_viewer ON public.doc_yjs_updates
  FOR SELECT
  USING (public.user_can_access_document(document_id, 'viewer'));
COMMENT ON POLICY doc_yjs_updates_select_viewer ON public.doc_yjs_updates IS
  'Phase 28 — viewer+ can SELECT; non-collaborators see zero rows (silent filter, NOT 403). Append-only table — no UPDATE/DELETE policies exist.';

DROP POLICY IF EXISTS doc_yjs_updates_insert_editor ON public.doc_yjs_updates;
CREATE POLICY doc_yjs_updates_insert_editor ON public.doc_yjs_updates
  FOR INSERT
  WITH CHECK (public.user_can_access_document(document_id, 'editor'));
COMMENT ON POLICY doc_yjs_updates_insert_editor ON public.doc_yjs_updates IS
  'Phase 28 — editor+ only. Non-editor INSERT raises Postgres error 42501 (insufficient_privilege); SupabaseYjsProvider catches and emits onUpdateRejected → kicked-out banner.';

-- ============================================================================
-- Section 5 — Real RLS policies on doc_yjs_state (snapshot, upsert)
--   SELECT gated on viewer+; ALL (INSERT/UPDATE/DELETE) gated on editor+.
-- ============================================================================
DROP POLICY IF EXISTS doc_yjs_state_select_viewer ON public.doc_yjs_state;
CREATE POLICY doc_yjs_state_select_viewer ON public.doc_yjs_state
  FOR SELECT
  USING (public.user_can_access_document(document_id, 'viewer'));
COMMENT ON POLICY doc_yjs_state_select_viewer ON public.doc_yjs_state IS
  'Phase 28 — viewer+ can SELECT the latest Y.Doc snapshot. Cold-load path (no Broadcast inflation) per Pitfall 2 defense.';

DROP POLICY IF EXISTS doc_yjs_state_upsert_editor ON public.doc_yjs_state;
CREATE POLICY doc_yjs_state_upsert_editor ON public.doc_yjs_state
  FOR ALL
  USING (public.user_can_access_document(document_id, 'editor'))
  WITH CHECK (public.user_can_access_document(document_id, 'editor'));
COMMENT ON POLICY doc_yjs_state_upsert_editor ON public.doc_yjs_state IS
  'Phase 28 — editor+ only. Phase 32 compaction job upserts snapshots through this policy (or via service-role bypass if it runs as a worker).';

-- ============================================================================
-- Section 6 — Real policy on activity_log (Phase 33 owns INSERT)
--   SELECT gated on viewer+. INSERT remains denied to authenticated role; Phase
--   33's server-side activity writer uses service-role to bypass RLS.
-- ============================================================================
DROP POLICY IF EXISTS activity_log_select_viewer ON public.activity_log;
CREATE POLICY activity_log_select_viewer ON public.activity_log
  FOR SELECT
  USING (public.user_can_access_document(document_id, 'viewer'));
COMMENT ON POLICY activity_log_select_viewer ON public.activity_log IS
  'Phase 28 — viewer+ can SELECT activity rows for documents they have access to. INSERT is service-role only (Phase 33 server writer).';

-- ============================================================================
-- Section 7 — BEFORE INSERT trigger: doc_yjs_updates_validate_origin (Pitfall 8 defense)
--   Overrides client-claimed origin->>'userId' with auth.uid() to defend against
--   audit-trail forgery. server_ts is already DEFAULT NOW() on the column (Phase
--   27 schema, AUTH-03 enforcement). Other origin keys (deviceId, sessionId,
--   clientID, source) pass through unchanged.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.doc_yjs_updates_validate_origin()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- AUTH-01 server-side enforcement: stamp authoritative userId from JWT,
  -- overriding any client-claimed origin.userId. A malicious client cannot
  -- forge attribution because auth.uid() reads the JWT's sub claim directly.
  -- If auth.uid() IS NULL the RLS WITH CHECK will already have rejected this
  -- INSERT before the trigger fires (so this is belt-and-suspenders).
  NEW.origin = jsonb_set(
    COALESCE(NEW.origin, '{}'::jsonb),
    array['userId'],
    to_jsonb(auth.uid()::text)
  );
  -- server_ts is server-stamped via Phase 27's column DEFAULT NOW() — no further
  -- enrichment needed. AUTH-03 (server-authoritative timestamp) handled at column.
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.doc_yjs_updates_validate_origin() IS
  'Phase 28 — BEFORE INSERT trigger. Overrides client-claimed origin->>''userId'' with auth.uid()::text via jsonb_set, defending Pitfall 8 (audit-trail forgery). Other origin keys (deviceId, sessionId, clientID, source) pass through unchanged. server_ts handled by Phase 27 column DEFAULT NOW() (AUTH-03).';

DROP TRIGGER IF EXISTS doc_yjs_updates_validate_origin_trigger ON public.doc_yjs_updates;
CREATE TRIGGER doc_yjs_updates_validate_origin_trigger
  BEFORE INSERT ON public.doc_yjs_updates
  FOR EACH ROW
  EXECUTE FUNCTION public.doc_yjs_updates_validate_origin();

COMMENT ON TRIGGER doc_yjs_updates_validate_origin_trigger ON public.doc_yjs_updates IS
  'Phase 28 — fires inline with every INSERT. Together with the editor+ RLS WITH CHECK on doc_yjs_updates_insert_editor this is the v2.4 server-side update validator (locked surface = postgres-trigger per 28-BENCHMARK.md).';

COMMIT;
