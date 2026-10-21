-- Backend cost pass (2026-10-21): fixes from the Supabase performance advisor.
--
-- 1. Index every foreign key that had no covering index. Most point at
--    auth.users (created_by, invited_by, ...), so deleting an account had to
--    scan each table in full to clear or cascade them.
-- 2. Drop one of the two identical indexes on documents(user_id).
-- 3. RLS policies that called auth.uid() / is_agent_session() bare re-ran the
--    call for every row. Wrapping it in (select ...) runs it once per query.
--    Same rules, same roles; only the call shape changes.

-- Prod and a fresh replay of this folder differ slightly (some columns exist
-- only on prod), so each index is created only where its column exists.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('document_annotations', 'last_modified_by'),
    ('document_collaborators', 'invited_by'),
    ('document_history_events', 'user_id'),
    ('document_invites', 'accepted_by'),
    ('document_invites', 'created_by'),
    ('document_presence', 'user_id'),
    ('document_revisions', 'created_by'),
    ('document_templates', 'linked_by'),
    ('documents', 'locked_by'),
    ('documents', 'template_id'),
    ('documents', 'user_archived_by'),
    ('excel_sync_audit', 'actor_id'),
    ('excel_sync_changesets', 'actor_id'),
    ('excel_workbook_registrations', 'registered_by'),
    ('excel_workbook_registrations', 'revoked_by'),
    ('feature_flags', 'updated_by'),
    ('project_collaborators', 'invited_by'),
    ('project_invites', 'accepted_by'),
    ('project_invites', 'created_by'),
    ('projects', 'user_archived_by'),
    ('survey_presence', 'user_id'),
    ('survey_sessions', 'document_id'),
    ('template_collaborators', 'invited_by'),
    ('template_invites', 'accepted_by'),
    ('template_invites', 'created_by'),
    ('templates', 'user_archived_by')
  ) AS v(tbl, col) LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = r.tbl AND column_name = r.col) THEN
      EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (%I)',
                     'idx_' || r.tbl || '_' || r.col || '_fk', r.tbl, r.col);
    END IF;
  END LOOP;
END
$$;

DROP INDEX IF EXISTS public.idx_documents_user_id;

ALTER POLICY agent_links_owner_read ON public.agent_links
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY "People read their agents' identities" ON public.agent_identities
  USING (user_id = (SELECT auth.uid()) AND NOT (SELECT public.is_agent_session()));

ALTER POLICY "People read their agents' activity" ON public.agent_activity
  USING (user_id = (SELECT auth.uid()) AND NOT (SELECT public.is_agent_session())
         AND created_at > now() - interval '90 days');

ALTER POLICY account_kits_owner_read ON public.account_kits
  USING (user_id = (SELECT auth.uid()));

ALTER POLICY kits_assigned_read ON public.kits
  USING (EXISTS (
    SELECT 1 FROM public.account_kits ak
     WHERE ak.user_id = (SELECT auth.uid())
       AND ak.kit_id = kits.id
       AND ak.kit_version = kits.version));

ALTER POLICY document_templates_insert ON public.document_templates
  WITH CHECK (linked_by = (SELECT auth.uid())
              AND public.user_can_access_template(template_id, 'owner')
              AND public.user_can_access_document(document_id, 'editor'));
