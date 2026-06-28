-- scripts/rls-test-db-provision.sql
-- Provision a DEDICATED Supabase TEST project (survey-test) so the RLS regression
-- suite (tests/phase28/rls/05-10) runs LIVE instead of skipping. Idempotent + safe to
-- re-run. NEVER run against production. Apply via psql -f, or POST each section to the
-- Supabase Management API /database/query. Verified 2026-06-28: all of 05-10 LIVE-PASS.
-- Derived from supabase/migrations/* (the source of truth) — re-derive if migrations
-- change materially. After this, also run scripts/rls-test-db-personas.sql.
-- Teardown: scripts/rls-test-db-teardown.sql.

-- ============================================================================
-- LANE B — survey-test (ref zgdkyslxbkusexmkfvgd) RLS provisioning  [FINAL]
-- Brings survey-test up to the schema the Phase 28 RLS suite tests/phase28/rls/05-10
-- assert against. DDL sourced verbatim from supabase/migrations.
-- 100% idempotent / re-runnable. Run as a privileged (postgres/owner) role.
-- DO NOT TOUCH doc_yjs_state / doc_yjs_updates or any phase27/28 CRDT object.
-- Run personaSeedSql (separately, committed) BEFORE this so FKs resolve.
--
-- FINAL adversarial-review fixes folded in:
--   * Section 0 now ADDs documents.user_id (and project_id) IF NOT EXISTS so this
--     script is self-sufficient and does NOT depend on a prior
--     apply-kal307/308a run having added the canonical owner column. The bootstrap
--     stub (scripts/bootstrap-test-db.sql) creates documents WITHOUT user_id;
--     every policy + user_can_access_document() reads it, so it MUST exist here.
--   * Section 4b now DROPs the persistent dc_kal307_test_deny_all stub policy that
--     apply-kal307/apply-kal308a install on document_collaborators, before
--     creating the real prod policies. (That stub is PERMISSIVE FOR ALL
--     USING(FALSE) WITH CHECK(FALSE); permissive policies OR-combine so it does
--     not actually block the real policies — but it is a dead, confusing stub and
--     dropping it makes this bring-up faithful to prod and future-proof against a
--     RESTRICTIVE flip.)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Defensive columns on the pre-existing public.documents table.
--    Tests/policies/helpers reference these; ADD IF NOT EXISTS is a no-op when
--    they already exist. The bootstrap stub has only (id,name,created_by,
--    created_at) — so user_id MUST be added here for the policies to resolve.
--    Sourced from: bootstrap-test-db.sql (stub), apply-kal307 PREREQ (user_id),
--    20260522000000_kal49 (locked_*), 20260603130000 (annotations_changed_at),
--    plus title/file_path/archived/project_id used by tests 05/09 + policies.
-- ----------------------------------------------------------------------------
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS user_id UUID;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS project_id UUID;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_path TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS file_size BIGINT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS locked_by UUID;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS locked_label TEXT;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS annotations_changed_at TIMESTAMPTZ;

-- ----------------------------------------------------------------------------
-- 1. HELPER FUNCTIONS (CREATE OR REPLACE — canonical bodies)
-- ----------------------------------------------------------------------------

-- 1a. user_can_access_document — canonical user_id-based body
--     (verbatim from 20260527130000_restore_user_can_access_helpers.sql and
--     byte-identical to apply-kal307/308a PREREQ). CREATE OR REPLACE keeps it
--     canonical; any doc_yjs_* policy that calls it retains identical semantics.
CREATE OR REPLACE FUNCTION public.user_can_access_document(doc_id UUID, required_role TEXT DEFAULT 'viewer')
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    doc_owner_id UUID;
    user_role TEXT;
BEGIN
    SELECT user_id INTO doc_owner_id
      FROM public.documents
     WHERE id = doc_id;

    IF doc_owner_id IS NULL THEN
        RETURN FALSE;
    END IF;

    IF doc_owner_id = auth.uid() THEN
        RETURN TRUE;
    END IF;

    SELECT role INTO user_role
      FROM public.document_collaborators
     WHERE document_id = doc_id
       AND user_id = auth.uid()
       AND status = 'active';

    IF user_role IS NULL THEN
        RETURN FALSE;
    END IF;

    CASE required_role
        WHEN 'viewer' THEN RETURN user_role IN ('viewer', 'editor', 'owner');
        WHEN 'editor' THEN RETURN user_role IN ('editor', 'owner');
        WHEN 'owner'  THEN RETURN user_role = 'owner';
        ELSE RETURN FALSE;
    END CASE;
END;
$$;
GRANT EXECUTE ON FUNCTION public.user_can_access_document(UUID, TEXT) TO authenticated;

-- 1b. kal49_document_is_locked — annotation write policies (07) depend on it.
--     Verbatim from 20260522000000_kal49_document_lock_state.sql (and apply-kal309 PREREQ).
CREATE OR REPLACE FUNCTION public.kal49_document_is_locked(doc_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE((SELECT locked_at FROM public.documents WHERE id = doc_id), NULL) IS NOT NULL;
$$;
GRANT EXECUTE ON FUNCTION public.kal49_document_is_locked(UUID) TO authenticated;

-- 1c. kal31_guard_last_owner — last-owner trigger fn (tests 05 sec C, 06 O-Q).
--     Verbatim from 20260521000000_kal31_remove_commenter_role.sql.
CREATE OR REPLACE FUNCTION public.kal31_guard_last_owner()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    remaining_owners INT;
    target_doc UUID;
    affected_old_role TEXT;
BEGIN
    IF (TG_OP = 'UPDATE') THEN
        affected_old_role := OLD.role;
        target_doc := OLD.document_id;
        IF affected_old_role = 'owner' AND NEW.role <> 'owner' THEN
            SELECT COUNT(*) INTO remaining_owners
              FROM public.document_collaborators
             WHERE document_id = target_doc
               AND role = 'owner'
               AND status = 'active'
               AND user_id <> OLD.user_id;
            IF remaining_owners < 1 THEN
                RAISE EXCEPTION 'kal31_guard_last_owner: at least one owner must remain on document %', target_doc
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    ELSIF (TG_OP = 'DELETE') THEN
        affected_old_role := OLD.role;
        target_doc := OLD.document_id;
        IF affected_old_role = 'owner' THEN
            SELECT COUNT(*) INTO remaining_owners
              FROM public.document_collaborators
             WHERE document_id = target_doc
               AND role = 'owner'
               AND status = 'active'
               AND user_id <> OLD.user_id;
            IF remaining_owners < 1 THEN
                RAISE EXCEPTION 'kal31_guard_last_owner: cannot remove last owner of document %', target_doc
                    USING ERRCODE = 'check_violation';
            END IF;
        END IF;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

-- 1d. bump_doc_annotations_changed_at — STATEMENT trigger fn for annotations.
--     Verbatim from 20260603130000_db_sync_annotations_changed_at.sql.
--     SET search_path='' is correct: transition table 'changed' is resolvable
--     without a schema prefix (statement-level transition tables are special).
CREATE OR REPLACE FUNCTION public.bump_doc_annotations_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.documents d
  SET annotations_changed_at = now()
  FROM (SELECT DISTINCT document_id FROM changed WHERE document_id IS NOT NULL) c
  WHERE d.id = c.document_id;
  RETURN NULL;
END;
$$;

-- 1e. generic updated_at bump fn (used by collaborator/annotation triggers).
CREATE OR REPLACE FUNCTION public.update_document_tables_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2. CREATE ABSENT TABLES (exact columns/constraints from migrations)
-- ----------------------------------------------------------------------------

-- 2a. document_annotations — base table (20241230000002) + annotation_id rename
--     (20260519010000) + annotation_data (20260425121704) + changed_at
--     (20260603130000) + final form-field CHECK (20260602000000).
CREATE TABLE IF NOT EXISTS public.document_annotations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    annotation_id TEXT NOT NULL,
    annotation_type TEXT NOT NULL DEFAULT 'survey-marker',
    page_number INTEGER NOT NULL,
    bounds JSONB NOT NULL,
    category_id TEXT,
    module_id TEXT,
    space_id TEXT,
    name TEXT,
    notes TEXT,
    ball_in_court_entity_id TEXT,
    ball_in_court_name TEXT,
    checklist_responses JSONB DEFAULT '{}',
    changed_by TEXT,
    changed_date TIMESTAMPTZ,
    color TEXT DEFAULT '#FFFF00',
    opacity REAL DEFAULT 0.3,
    stroke_width REAL,
    font_size INTEGER,
    annotation_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    version INTEGER DEFAULT 1,
    last_modified_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(document_id, annotation_id)
);

-- Ensure the final widened annotation_type CHECK (20260602000000) is present
-- (idempotent: drop the constraint name then re-add).
ALTER TABLE public.document_annotations
  DROP CONSTRAINT IF EXISTS document_annotations_annotation_type_check;
ALTER TABLE public.document_annotations
  ADD CONSTRAINT document_annotations_annotation_type_check
  CHECK (annotation_type IN (
    'survey-marker','ink','freetext','square','circle','line','polyline',
    'polygon','stamp','sticky_note','callout','counter','eraser','form-field'
  ));

CREATE INDEX IF NOT EXISTS idx_document_annotations_document ON public.document_annotations(document_id);
CREATE INDEX IF NOT EXISTS idx_document_annotations_user ON public.document_annotations(user_id);
CREATE INDEX IF NOT EXISTS idx_document_annotations_page ON public.document_annotations(document_id, page_number);

-- 2b. document_invites — verbatim from 20260521000100_kal31_invite_tokens.sql.
CREATE TABLE IF NOT EXISTS public.document_invites (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id    UUID NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    token          TEXT NOT NULL UNIQUE,
    role           TEXT NOT NULL CHECK (role IN ('viewer', 'editor', 'owner')),
    target_email   TEXT,
    intended_role  TEXT NOT NULL CHECK (intended_role IN ('viewer', 'editor', 'owner')),
    created_by     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at     TIMESTAMPTZ NOT NULL,
    revoked_at     TIMESTAMPTZ,
    accepted_at    TIMESTAMPTZ,
    accepted_by    UUID REFERENCES auth.users(id),
    accepted_role  TEXT CHECK (accepted_role IN ('viewer', 'editor', 'owner'))
);
CREATE INDEX IF NOT EXISTS idx_document_invites_document_id ON public.document_invites(document_id);
CREATE INDEX IF NOT EXISTS idx_document_invites_token       ON public.document_invites(token);
CREATE INDEX IF NOT EXISTS idx_document_invites_target_email ON public.document_invites(target_email);

-- 2c. document_collaborators — ensure status column + KAL-31 role CHECK present.
--     The apply-kal307/308a PREREQ already creates this table on survey-test;
--     these are defensive no-ops that also tighten the role CHECK to the prod
--     set (matches 20260521000000) and make it self-sufficient if absent.
CREATE TABLE IF NOT EXISTS public.document_collaborators (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID        NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    email       TEXT,
    role        TEXT        NOT NULL DEFAULT 'editor',
    status      TEXT        NOT NULL DEFAULT 'active',
    invited_by  UUID,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (document_id, user_id)
);
ALTER TABLE public.document_collaborators ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.document_collaborators ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE public.document_collaborators ADD COLUMN IF NOT EXISTS invited_by UUID;
ALTER TABLE public.document_collaborators DROP CONSTRAINT IF EXISTS document_collaborators_role_check;
ALTER TABLE public.document_collaborators
  ADD CONSTRAINT document_collaborators_role_check CHECK (role IN ('viewer', 'editor', 'owner'));

-- ----------------------------------------------------------------------------
-- 3. ENABLE ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
ALTER TABLE public.documents               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_collaborators  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_annotations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_invites        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.excel_sync_audit        ENABLE ROW LEVEL SECURITY;  -- already ON via KAL-309

-- excel_sync_audit is policy-less / default-deny for clients; REVOKE is the gate
-- (verbatim intent from 20260625120000). Idempotent.
REVOKE ALL ON public.excel_sync_audit FROM authenticated, anon;

-- ----------------------------------------------------------------------------
-- 4. POLICIES (DROP IF EXISTS then CREATE — fully idempotent)
-- ----------------------------------------------------------------------------

-- 4a. documents SELECT (owner OR collaborator) — 20260513013000.
DROP POLICY IF EXISTS "Users can view accessible documents" ON public.documents;
DROP POLICY IF EXISTS "Users can view own documents" ON public.documents;
CREATE POLICY "Users can view accessible documents"
  ON public.documents FOR SELECT
  USING (
    auth.uid() = user_id
    OR public.user_can_access_document(id, 'viewer')
  );

-- documents UPDATE / DELETE — owner-only (auth.uid()=user_id), 20241223000004.
DROP POLICY IF EXISTS "Users can update own documents" ON public.documents;
CREATE POLICY "Users can update own documents"
  ON public.documents FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
CREATE POLICY "Users can delete own documents"
  ON public.documents FOR DELETE
  USING (auth.uid() = user_id);

-- documents INSERT — owner-self (simplified, no tier/usage helpers needed for
-- the RLS suite; tests insert documents only via the privileged fixture role).
DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;
CREATE POLICY "Users can insert own documents"
  ON public.documents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- 4b. document_collaborators — drop the persistent KAL-307 deny-all test stub,
--     then install the REAL prod policies: SELECT viewer / write owner
--     (20241230000002). Dropping the stub is required for fidelity to prod and
--     removes a dead permissive FOR ALL USING(FALSE) policy that would otherwise
--     linger alongside the real ones.
DROP POLICY IF EXISTS dc_kal307_test_deny_all ON public.document_collaborators;

DROP POLICY IF EXISTS "Document owners can view collaborators" ON public.document_collaborators;
CREATE POLICY "Document owners can view collaborators"
  ON public.document_collaborators FOR SELECT
  USING (public.user_can_access_document(document_id, 'viewer'));

DROP POLICY IF EXISTS "Document owners can add collaborators" ON public.document_collaborators;
CREATE POLICY "Document owners can add collaborators"
  ON public.document_collaborators FOR INSERT
  WITH CHECK (public.user_can_access_document(document_id, 'owner'));

DROP POLICY IF EXISTS "Document owners can update collaborators" ON public.document_collaborators;
CREATE POLICY "Document owners can update collaborators"
  ON public.document_collaborators FOR UPDATE
  USING (public.user_can_access_document(document_id, 'owner'));

DROP POLICY IF EXISTS "Document owners can remove collaborators" ON public.document_collaborators;
CREATE POLICY "Document owners can remove collaborators"
  ON public.document_collaborators FOR DELETE
  USING (public.user_can_access_document(document_id, 'owner'));

-- 4c. document_annotations — fix-26 + KAL-49 lock contract (20260513010000 / 20260522000000).
DROP POLICY IF EXISTS "Users can view annotations on accessible documents" ON public.document_annotations;
CREATE POLICY "Users can view annotations on accessible documents"
  ON public.document_annotations FOR SELECT
  USING (public.user_can_access_document(document_id, 'viewer'));

DROP POLICY IF EXISTS "Users can insert own annotations on editable documents" ON public.document_annotations;
CREATE POLICY "Users can insert own annotations on editable documents"
  ON public.document_annotations FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND public.user_can_access_document(document_id, 'editor')
    AND NOT public.kal49_document_is_locked(document_id)
  );

DROP POLICY IF EXISTS "Users can update own annotations or owners can update any" ON public.document_annotations;
CREATE POLICY "Users can update own annotations or owners can update any"
  ON public.document_annotations FOR UPDATE
  USING (
    (
      (auth.uid() = user_id AND public.user_can_access_document(document_id, 'editor'))
      OR public.user_can_access_document(document_id, 'owner')
    )
    AND NOT public.kal49_document_is_locked(document_id)
  )
  WITH CHECK (
    (
      (auth.uid() = user_id AND public.user_can_access_document(document_id, 'editor'))
      OR public.user_can_access_document(document_id, 'owner')
    )
    AND NOT public.kal49_document_is_locked(document_id)
  );

DROP POLICY IF EXISTS "Users can delete own annotations or owners can delete any" ON public.document_annotations;
CREATE POLICY "Users can delete own annotations or owners can delete any"
  ON public.document_annotations FOR DELETE
  USING (
    (
      (auth.uid() = user_id AND public.user_can_access_document(document_id, 'editor'))
      OR public.user_can_access_document(document_id, 'owner')
    )
    AND NOT public.kal49_document_is_locked(document_id)
  );

-- 4d. document_invites — owner SELECT/INSERT/UPDATE; no DELETE (20260521000100).
DROP POLICY IF EXISTS document_invites_owner_select ON public.document_invites;
CREATE POLICY document_invites_owner_select
  ON public.document_invites FOR SELECT
  USING (public.user_can_access_document(document_id, 'owner'));

DROP POLICY IF EXISTS document_invites_owner_insert ON public.document_invites;
CREATE POLICY document_invites_owner_insert
  ON public.document_invites FOR INSERT
  WITH CHECK (
    public.user_can_access_document(document_id, 'owner')
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS document_invites_owner_update ON public.document_invites;
CREATE POLICY document_invites_owner_update
  ON public.document_invites FOR UPDATE
  USING (public.user_can_access_document(document_id, 'owner'))
  WITH CHECK (public.user_can_access_document(document_id, 'owner'));

-- ----------------------------------------------------------------------------
-- 5. TRIGGERS
-- ----------------------------------------------------------------------------

-- 5a. kal31 last-owner guard on document_collaborators (20260521000000).
DROP TRIGGER IF EXISTS kal31_guard_last_owner_trg ON public.document_collaborators;
CREATE TRIGGER kal31_guard_last_owner_trg
  BEFORE UPDATE OR DELETE ON public.document_collaborators
  FOR EACH ROW EXECUTE FUNCTION public.kal31_guard_last_owner();

-- 5b. annotations_changed_at STATEMENT triggers (20260603130000).
DROP TRIGGER IF EXISTS trg_doc_annotations_changed_ins ON public.document_annotations;
CREATE TRIGGER trg_doc_annotations_changed_ins
  AFTER INSERT ON public.document_annotations
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_doc_annotations_changed_at();
DROP TRIGGER IF EXISTS trg_doc_annotations_changed_upd ON public.document_annotations;
CREATE TRIGGER trg_doc_annotations_changed_upd
  AFTER UPDATE ON public.document_annotations
  REFERENCING NEW TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_doc_annotations_changed_at();
DROP TRIGGER IF EXISTS trg_doc_annotations_changed_del ON public.document_annotations;
CREATE TRIGGER trg_doc_annotations_changed_del
  AFTER DELETE ON public.document_annotations
  REFERENCING OLD TABLE AS changed
  FOR EACH STATEMENT EXECUTE FUNCTION public.bump_doc_annotations_changed_at();

-- ----------------------------------------------------------------------------
-- 6. INVITE ACCEPTANCE RPC (test 08 group 6) — 20260521000100.
--    The RPC reads public.subscriptions(tier); ensure a minimal table exists so
--    the RPC body resolves (survey-test may not have it). Idempotent.
--    NOTE: prod's tier table is public.user_subscriptions; the invite RPC
--    migration reads public.subscriptions. We mirror the RPC's expectation here
--    (this stub is dropped in teardown).
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscriptions (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    tier    TEXT DEFAULT 'free'
);

CREATE OR REPLACE FUNCTION public.kal31_accept_document_invite(invite_token TEXT)
RETURNS TABLE (
    status           TEXT,
    document_id      UUID,
    effective_role   TEXT,
    intended_role    TEXT,
    upgrade_required BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    invite_row     public.document_invites%ROWTYPE;
    caller_email   TEXT;
    caller_tier    TEXT;
    final_role     TEXT;
    needs_upgrade  BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'kal31_accept_document_invite: must be authenticated';
    END IF;

    SELECT * INTO invite_row
      FROM public.document_invites
     WHERE token = invite_token
     LIMIT 1;

    IF NOT FOUND THEN
        status := 'invalid';
        document_id := NULL; effective_role := NULL; intended_role := NULL; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF invite_row.revoked_at IS NOT NULL THEN
        status := 'revoked';
        document_id := invite_row.document_id; effective_role := NULL;
        intended_role := invite_row.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF invite_row.expires_at < now() THEN
        status := 'expired';
        document_id := invite_row.document_id; effective_role := NULL;
        intended_role := invite_row.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    IF invite_row.accepted_at IS NOT NULL THEN
        status := 'already_accepted';
        document_id := invite_row.document_id;
        effective_role := invite_row.accepted_role;
        intended_role := invite_row.intended_role;
        upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT email::TEXT INTO caller_email FROM auth.users WHERE id = auth.uid();
    IF invite_row.target_email IS NOT NULL AND LOWER(invite_row.target_email) <> LOWER(caller_email) THEN
        status := 'wrong_account';
        document_id := invite_row.document_id; effective_role := NULL;
        intended_role := invite_row.intended_role; upgrade_required := FALSE;
        RETURN NEXT; RETURN;
    END IF;

    SELECT COALESCE(s.tier, 'free') INTO caller_tier
      FROM public.subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    caller_tier := COALESCE(caller_tier, 'free');

    IF invite_row.intended_role IN ('editor', 'owner') AND caller_tier = 'free' THEN
        final_role := 'viewer';
        needs_upgrade := TRUE;
    ELSE
        final_role := invite_row.intended_role;
    END IF;

    INSERT INTO public.document_collaborators (document_id, user_id, email, role, status, invited_by)
    VALUES (invite_row.document_id, auth.uid(), caller_email, final_role, 'active', invite_row.created_by)
    ON CONFLICT (document_id, user_id) DO UPDATE
       SET role = EXCLUDED.role, status = 'active';

    UPDATE public.document_invites
       SET accepted_at = now(), accepted_by = auth.uid(), accepted_role = final_role
     WHERE id = invite_row.id;

    status := 'accepted';
    document_id := invite_row.document_id;
    effective_role := final_role;
    intended_role := invite_row.intended_role;
    upgrade_required := needs_upgrade;
    RETURN NEXT;
END;
$$;
GRANT EXECUTE ON FUNCTION public.kal31_accept_document_invite(TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. STORAGE — 'documents' bucket (private) + collaborator-read SELECT policy.
--    Verbatim policy from 20260513003000 (keys on documents.file_path). Idempotent.
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
  VALUES ('documents', 'documents', false)
  ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Document collaborators can read accessible document files" ON storage.objects;
CREATE POLICY "Document collaborators can read accessible document files"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1
      FROM public.documents d
      WHERE d.file_path = storage.objects.name
        AND public.user_can_access_document(d.id, 'viewer')
    )
  );

-- ============================================================================
-- END bringUpSql — re-runnable; touches no doc_yjs_* / phase27 objects.
-- ============================================================================

-- ============================================================================
-- user_subscriptions — minimal table the kal31 accept-invite RPC reads (tier).
-- Empty table => COALESCE(tier,'free') => 'free' (the default the tests assume).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  user_id uuid PRIMARY KEY,
  tier    text NOT NULL DEFAULT 'free'
);
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;


-- ============================================================================
-- kal31_accept_document_invite — CORRECTED version (verbatim from migration
-- 20260521030000_kal31_use_column_pref.sql). The base migration (20260521000100)
-- has an ambiguous-column bug fixed by 20260521020000 + 030000; provisioning must
-- use this final version or test 08 errors with 42702.
-- ============================================================================
-- KAL-31 hotfix — the ambiguous-column error persisted after renaming the
-- locals because PL/pgSQL's default `#variable_conflict error` policy treats
-- the OUT parameter name `document_id` (declared in the RETURNS TABLE list)
-- as a variable in scope inside the body. Even when we write column names
-- explicitly in INSERT / ON CONFLICT clauses, PostgreSQL refuses to choose.
-- The supported fix is to flip the policy to `use_column` so inside INSERT
-- column lists and predicates the column reference always wins.

BEGIN;

CREATE OR REPLACE FUNCTION public.kal31_accept_document_invite(invite_token TEXT)
RETURNS TABLE (
    status           TEXT,
    document_id      UUID,
    effective_role   TEXT,
    intended_role    TEXT,
    upgrade_required BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
#variable_conflict use_column
DECLARE
    v_invite       public.document_invites%ROWTYPE;
    v_caller_email TEXT;
    v_caller_tier  TEXT;
    v_final_role   TEXT;
    v_needs_upg    BOOLEAN := FALSE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'kal31_accept_document_invite: must be authenticated';
    END IF;

    SELECT * INTO v_invite
      FROM public.document_invites di
     WHERE di.token = invite_token
     LIMIT 1;

    IF NOT FOUND THEN
        status := 'invalid';
        document_id := NULL; effective_role := NULL; intended_role := NULL; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_invite.revoked_at IS NOT NULL THEN
        status := 'revoked';
        document_id := v_invite.document_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_invite.expires_at < now() THEN
        status := 'expired';
        document_id := v_invite.document_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF v_invite.accepted_at IS NOT NULL THEN
        status := 'already_accepted';
        document_id := v_invite.document_id;
        effective_role := v_invite.accepted_role;
        intended_role := v_invite.intended_role;
        upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT u.email::TEXT INTO v_caller_email FROM auth.users u WHERE u.id = auth.uid();
    IF v_invite.target_email IS NOT NULL AND LOWER(v_invite.target_email) <> LOWER(v_caller_email) THEN
        status := 'wrong_account';
        document_id := v_invite.document_id; effective_role := NULL;
        intended_role := v_invite.intended_role; upgrade_required := FALSE;
        RETURN NEXT;
        RETURN;
    END IF;

    SELECT COALESCE(s.tier, 'free') INTO v_caller_tier
      FROM public.user_subscriptions s
     WHERE s.user_id = auth.uid()
     LIMIT 1;
    v_caller_tier := COALESCE(v_caller_tier, 'free');

    IF v_invite.intended_role IN ('editor', 'owner') AND v_caller_tier = 'free' THEN
        v_final_role := 'viewer';
        v_needs_upg := TRUE;
    ELSE
        v_final_role := v_invite.intended_role;
    END IF;

    INSERT INTO public.document_collaborators (document_id, user_id, email, role, status, invited_by)
    VALUES (v_invite.document_id, auth.uid(), v_caller_email, v_final_role, 'active', v_invite.created_by)
    ON CONFLICT (document_id, user_id) DO UPDATE
       SET role = EXCLUDED.role,
           status = 'active';

    UPDATE public.document_invites di
       SET accepted_at = now(),
           accepted_by = auth.uid(),
           accepted_role = v_final_role
     WHERE di.id = v_invite.id;

    status := 'accepted';
    document_id := v_invite.document_id;
    effective_role := v_final_role;
    intended_role := v_invite.intended_role;
    upgrade_required := v_needs_upg;
    RETURN NEXT;
END;
$$;

GRANT EXECUTE ON FUNCTION public.kal31_accept_document_invite(TEXT) TO authenticated;

COMMIT;

