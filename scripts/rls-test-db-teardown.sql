-- ============================================================================
-- Teardown for survey-test (ref zgdkyslxbkusexmkfvgd) — reverses bringUpSql +
-- personaSeedSql. Idempotent. Leaves doc_yjs_* / phase27 untouched.  [FINAL]
-- excel_sync_audit is NOT dropped (pre-existing via KAL-309); only RLS/grants
-- are left as bringUp left them (the suite added no audit policies).
-- documents is NOT dropped (pre-existing) — we only drop the policies we added
-- and disable RLS back to a known-clean re-run ground state (RLS off + policies
-- gone). documents.user_id is NOT dropped: apply-kal307/308a may have added it
-- out-of-band and other test lanes depend on it; leaving it is harmless.
-- document_collaborators is NOT dropped (apply-kal307/308a own it); we drop the
-- real policies we added and restore the dc_kal307_test_deny_all stub so the
-- table is left exactly as the apply scripts expect it.
-- ============================================================================

-- 1. Storage policy + bucket
DROP POLICY IF EXISTS "Document collaborators can read accessible document files" ON storage.objects;
DELETE FROM storage.objects WHERE bucket_id = 'documents';
DELETE FROM storage.buckets WHERE id = 'documents';

-- 2. Invite acceptance RPC
DROP FUNCTION IF EXISTS public.kal31_accept_document_invite(TEXT);

-- 3. Triggers
DROP TRIGGER IF EXISTS kal31_guard_last_owner_trg ON public.document_collaborators;
DROP TRIGGER IF EXISTS trg_doc_annotations_changed_ins ON public.document_annotations;
DROP TRIGGER IF EXISTS trg_doc_annotations_changed_upd ON public.document_annotations;
DROP TRIGGER IF EXISTS trg_doc_annotations_changed_del ON public.document_annotations;

-- 4. Policies on the tables we provisioned
DROP POLICY IF EXISTS "Users can view accessible documents" ON public.documents;
DROP POLICY IF EXISTS "Users can update own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can delete own documents" ON public.documents;
DROP POLICY IF EXISTS "Users can insert own documents" ON public.documents;

DROP POLICY IF EXISTS "Document owners can view collaborators" ON public.document_collaborators;
DROP POLICY IF EXISTS "Document owners can add collaborators" ON public.document_collaborators;
DROP POLICY IF EXISTS "Document owners can update collaborators" ON public.document_collaborators;
DROP POLICY IF EXISTS "Document owners can remove collaborators" ON public.document_collaborators;

DROP POLICY IF EXISTS "Users can view annotations on accessible documents" ON public.document_annotations;
DROP POLICY IF EXISTS "Users can insert own annotations on editable documents" ON public.document_annotations;
DROP POLICY IF EXISTS "Users can update own annotations or owners can update any" ON public.document_annotations;
DROP POLICY IF EXISTS "Users can delete own annotations or owners can delete any" ON public.document_annotations;

DROP POLICY IF EXISTS document_invites_owner_select ON public.document_invites;
DROP POLICY IF EXISTS document_invites_owner_insert ON public.document_invites;
DROP POLICY IF EXISTS document_invites_owner_update ON public.document_invites;

-- 4b. Restore the KAL-307 deny-all stub on document_collaborators so the table
--     is left exactly as apply-kal307/apply-kal308a installed it. Idempotent.
DROP POLICY IF EXISTS dc_kal307_test_deny_all ON public.document_collaborators;
CREATE POLICY dc_kal307_test_deny_all ON public.document_collaborators
  FOR ALL USING (FALSE) WITH CHECK (FALSE);

-- 5. Drop the tables we created (absent before bringUp). CASCADE clears FKs.
DROP TABLE IF EXISTS public.document_invites CASCADE;
DROP TABLE IF EXISTS public.document_annotations CASCADE;

-- 6. Helper functions we added (leave user_can_access_document — pre-existing;
--    leave kal49_document_is_locked — apply-kal309 PREREQ owns it).
DROP FUNCTION IF EXISTS public.kal31_guard_last_owner();
DROP FUNCTION IF EXISTS public.bump_doc_annotations_changed_at();

-- 7. Restore documents RLS to a clean OFF re-run ground state (policies dropped
--    above). Re-running bringUp re-enables it; this is the documented safe state.
ALTER TABLE public.documents DISABLE ROW LEVEL SECURITY;

-- 8. Minimal subscriptions helper table we may have created.
DROP TABLE IF EXISTS public.subscriptions CASCADE;

-- 9. Personas (remove last). document_collaborators / document_annotations /
--    document_invites rows that FK'd them were created inside per-test ROLLBACK
--    and never persisted; document_annotations/document_invites are dropped
--    above; any persisted document_collaborators rows referencing personas are
--    cleared here first so the auth.users delete does not hit a NO ACTION FK.
DELETE FROM public.document_collaborators
 WHERE user_id IN (
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000004'::uuid,
  '00000000-0000-0000-0000-000000000005'::uuid
);
DELETE FROM auth.users WHERE id IN (
  '00000000-0000-0000-0000-000000000001'::uuid,
  '00000000-0000-0000-0000-000000000002'::uuid,
  '00000000-0000-0000-0000-000000000003'::uuid,
  '00000000-0000-0000-0000-000000000004'::uuid,
  '00000000-0000-0000-0000-000000000005'::uuid
);
-- ============================================================================
-- END teardownSql
-- ============================================================================
-- minimal user_subscriptions added by provisioning
DROP TABLE IF EXISTS public.user_subscriptions;
