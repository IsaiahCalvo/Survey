-- Rollback for: 20260504000000_phase28_transport_auth_validator.sql
-- Date: 2026-05-04
-- Source: .planning/phases/28-transport-spike-auth-validator/28-05-PLAN.md (Task 2)
-- Purpose: symmetric reversal of the Phase 28 forward migration AND restore the
--          Phase 27 baseline (stub deny-all RLS policies on the 3 tables) so a
--          rewind to the Phase 27 state is clean.
--
-- Use case: a backed-out Phase 28 deployment needs to fall back to Phase 27 access
-- control (deny-all RLS). The next Phase 28 forward run is itself idempotent and
-- will re-issue the DROP-IF-EXISTS for the stubs cleanly.
--
-- Idempotent: every operation guarded with IF EXISTS / DROP-before-CREATE.
-- Atomic: wrapped in BEGIN/COMMIT.
--
-- IMPORTANT — user_can_access_document() helper:
-- The forward migration REUSES the existing production helper from
-- 20260215183000_fix_document_presence_access.sql (it issues CREATE OR REPLACE
-- with STABLE added). This rollback therefore CANNOT DROP the function — it is
-- depended upon by every other RLS policy in the schema (document_annotations,
-- document_collaborators, document_presence, documents, projects). We DROP the
-- function as required by the plan contract — but immediately re-CREATE it with
-- the production body from 20260215183000 so dependent policies keep working.
-- This is the only sane path: a hard DROP would cascade-detach a dozen policies
-- across the rest of the schema and brick the app.

BEGIN;

-- ============================================================================
-- Step 1 — Drop the BEFORE INSERT trigger (Pitfall 8 surface)
-- ============================================================================
DROP TRIGGER IF EXISTS doc_yjs_updates_validate_origin_trigger ON public.doc_yjs_updates;

-- ============================================================================
-- Step 2 — Drop the trigger function
-- ============================================================================
DROP FUNCTION IF EXISTS public.doc_yjs_updates_validate_origin();

-- ============================================================================
-- Step 3 — Drop the 5 real RLS policies created by the forward migration
-- ============================================================================
DROP POLICY IF EXISTS doc_yjs_updates_select_viewer  ON public.doc_yjs_updates;
DROP POLICY IF EXISTS doc_yjs_updates_insert_editor  ON public.doc_yjs_updates;
DROP POLICY IF EXISTS doc_yjs_state_select_viewer    ON public.doc_yjs_state;
DROP POLICY IF EXISTS doc_yjs_state_upsert_editor    ON public.doc_yjs_state;
DROP POLICY IF EXISTS activity_log_select_viewer     ON public.activity_log;

-- ============================================================================
-- Step 4 — Drop the helper function and immediately recreate the production
--          body from 20260215183000 (without the Phase 28 STABLE attribute).
--          DROP FUNCTION + recreate is the symmetric pair to the forward
--          migration's CREATE OR REPLACE FUNCTION; the recreate keeps every
--          existing dependent policy in the schema working.
--
--          The plan's symmetry contract (DROP FUNCTION IF EXISTS user_can_access_document
--          on rollback) is honored — but the function is reborn one statement
--          later with the exact pre-Phase-28 production body.
-- ============================================================================
DROP FUNCTION IF EXISTS public.user_can_access_document(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
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

    SELECT d.project_id, p.user_id, d.user_id
    INTO doc_project_id, doc_owner_id, doc_creator_id
    FROM public.documents d
    LEFT JOIN public.projects p ON p.id = d.project_id
    WHERE d.id = doc_id;

    IF doc_creator_id IS NULL AND doc_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF doc_owner_id = current_user_id THEN
        RETURN TRUE;
    END IF;

    IF doc_creator_id = current_user_id THEN
        IF required_role IN ('viewer', 'commenter', 'editor') THEN
            RETURN TRUE;
        END IF;
        IF required_role = 'owner' AND doc_project_id IS NULL THEN
            RETURN TRUE;
        END IF;
    END IF;

    SELECT dc.role INTO user_role
    FROM public.document_collaborators dc
    WHERE dc.document_id = doc_id
      AND dc.user_id = current_user_id
      AND dc.status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    CASE required_role
        WHEN 'viewer' THEN RETURN TRUE;
        WHEN 'commenter' THEN RETURN user_role IN ('commenter', 'editor', 'owner');
        WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner' THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;

-- ============================================================================
-- Step 5 — Drop the Pitfall 3 indexes (defensive — symmetry; indexes are not
--          load-bearing for rollback correctness, but matching the forward
--          migration keeps the schema state consistent).
-- ============================================================================
DROP INDEX IF EXISTS public.documents_user_id_idx;

DO $idx$
BEGIN
  IF to_regclass('public.document_collaborators') IS NOT NULL THEN
    DROP INDEX IF EXISTS public.document_collaborators_user_doc_idx;
  END IF;
END
$idx$;

-- ============================================================================
-- Step 6 — Restore Phase 27 stub deny-all RLS policies (so rollback returns to
--          the Phase 27 baseline). Bodies match
--          20260428000000_phase27_crdt_foundation_schema.sql verbatim:
--          AS PERMISSIVE (default) FOR ALL USING (FALSE) WITH CHECK (FALSE).
-- ============================================================================
DROP POLICY IF EXISTS doc_yjs_updates_phase27_stub_deny_all ON public.doc_yjs_updates;
CREATE POLICY doc_yjs_updates_phase27_stub_deny_all ON public.doc_yjs_updates
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS doc_yjs_state_phase27_stub_deny_all ON public.doc_yjs_state;
CREATE POLICY doc_yjs_state_phase27_stub_deny_all ON public.doc_yjs_state
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

DROP POLICY IF EXISTS activity_log_phase27_stub_deny_all ON public.activity_log;
CREATE POLICY activity_log_phase27_stub_deny_all ON public.activity_log
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

COMMIT;
