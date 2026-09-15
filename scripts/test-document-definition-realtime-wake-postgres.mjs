// Disposable local PostgreSQL only. This script accepts no remote connection.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';

assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const migration = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const entityMigration = migration('20260909105000_document_entity_catalog.sql');
const surveyMigration = migration('20260909106000_document_survey_definition.sql');
const revisionMigration = migration('20260915102000_document_definition_revisions.sql');
const wakeMigration = migration('20260915105000_document_definition_realtime_wake.sql');
const id = n => `10500000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1);
const quoteJson = value => JSON.stringify(value);
const modules = label => [{ id: 'module-doors', name: 'Doors', categories: [{
  id: 'category-doors', name: 'Door checks', checklist: [{ id: 'check-door', text: label }],
}]}];
const entities = label => [{ id: 'entity-door', name: label, color: '#112233', opacity: 0.35,
  borderColor: null, borderOpacity: null, matchFill: false }];

await withDisposablePostgres(async ({ sql, scalar, asRole, applyMigration, quote }) => {
  sql(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE PUBLICATION supabase_realtime;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${owner}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE public.documents(
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), template_id uuid,
      archived boolean NOT NULL DEFAULT false, user_archived_at timestamptz,
      locked_at timestamptz, title text NOT NULL DEFAULT 'kept',
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
    CREATE TABLE public.templates(
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id), config jsonb NOT NULL,
      updated_at timestamptz NOT NULL, archived boolean NOT NULL DEFAULT false,
      user_archived_at timestamptz);
    CREATE TABLE public.document_collaborators(
      document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id), role text NOT NULL, status text NOT NULL,
      PRIMARY KEY(document_id,user_id));
    CREATE SCHEMA survey_private;
    CREATE TABLE survey_private.account_write_guards(
      user_id uuid PRIMARY KEY, closing boolean NOT NULL DEFAULT false);
    CREATE FUNCTION public.user_can_access_document(doc_id uuid, required_role text DEFAULT 'viewer')
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$SELECT EXISTS(SELECT 1 FROM public.documents d WHERE d.id=doc_id AND d.user_id=auth.uid())$$;
    CREATE FUNCTION public.kal49_document_is_locked(doc_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$SELECT coalesce((SELECT d.locked_at IS NOT NULL FROM public.documents d WHERE d.id=doc_id),true)$$;
    CREATE FUNCTION survey_private.assert_account_open(p_user_id uuid) RETURNS void
    LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
    DECLARE stopped boolean;
    BEGIN
      SELECT closing INTO stopped FROM survey_private.account_write_guards WHERE user_id=p_user_id;
      IF coalesce(stopped,false) THEN RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514'; END IF;
    END $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    GRANT SELECT,UPDATE ON public.documents TO authenticated;
    GRANT SELECT ON public.templates,public.document_collaborators TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid(),public.user_can_access_document(uuid,text),
      public.kal49_document_is_locked(uuid),survey_private.assert_account_open(uuid) TO authenticated;
    ALTER PUBLICATION supabase_realtime ADD TABLE public.documents;
  `);
  applyMigration(entityMigration);
  applyMigration(surveyMigration);

  let next = 100;
  const createDocument = () => {
    const documentId = id(next++);
    sql(`INSERT INTO public.documents(id,user_id,updated_at) VALUES('${documentId}','${owner}','2026-01-01Z')`);
    return documentId;
  };
  const createTemplate = (label, minute) => {
    const templateId = id(next++);
    sql(`INSERT INTO public.templates(id,user_id,config,updated_at) VALUES(
      '${templateId}','${owner}',${quote(quoteJson({ modules: modules(label), entities: entities(label) }))}::jsonb,
      '2026-09-15T12:${String(minute).padStart(2, '0')}:00Z')`);
    return templateId;
  };
  const adopt = (documentId, templateId, operation) => {
    const survey = JSON.parse(asRole(owner,
      `SELECT public.preview_document_survey_definition_adoption('${documentId}','${templateId}')`).stdout);
    const entity = JSON.parse(asRole(owner,
      `SELECT public.preview_document_entity_catalog_adoption('${documentId}','${templateId}')`).stdout);
    asRole(owner, `SELECT public.adopt_document_survey_definition('${documentId}','${templateId}',
      ${quote(survey.source.templateUpdatedAt)}::timestamptz,${quote(survey.source.structureSha256)},
      '${id(operation)}','${'a'.repeat(64)}')`);
    asRole(owner, `SELECT public.adopt_document_entity_catalog('${documentId}','${templateId}',
      ${quote(entity.source.templateUpdatedAt)}::timestamptz,${quote(entity.source.entitiesSha256)},
      '${id(operation + 1)}','${'b'.repeat(64)}')`);
  };

  const documentId = createDocument();
  const otherDocumentId = createDocument();
  const baseTemplate = createTemplate('Door', 1);
  adopt(documentId, baseTemplate, 300);
  applyMigration(revisionMigration);
  applyMigration(wakeMigration);

  assert.equal(scalar(`SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime'`), '1');
  assert.equal(scalar(`SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime'
    AND schemaname='public' AND tablename='documents'`), '1');
  assert.equal(scalar(`SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime'
    AND schemaname='survey_private'`), '0');
  assert.equal(scalar(`SELECT has_function_privilege('anon',
    'survey_private.wake_document_definition_head_change()','EXECUTE')`), 'f');
  assert.equal(scalar(`SELECT has_function_privilege('authenticated',
    'survey_private.wake_document_definition_head_change()','EXECUTE')`), 'f');
  assert.equal(scalar(`SELECT has_function_privilege('service_role',
    'survey_private.wake_document_definition_head_change()','EXECUTE')`), 'f');

  // A future initial accepted head also wakes its exact document. Both adoption
  // writers lock public.documents before their private accepted rows.
  const initialDocumentId = createDocument();
  const initialTemplate = createTemplate('Initial', 2);
  const initialBefore = scalar(`SELECT updated_at::text FROM public.documents WHERE id='${initialDocumentId}'`);
  adopt(initialDocumentId, initialTemplate, 310);
  const initialAfter = scalar(`SELECT updated_at::text FROM public.documents WHERE id='${initialDocumentId}'`);
  assert.notEqual(initialAfter, initialBefore);
  assert.equal(scalar(`SELECT current_revision FROM survey_private.document_definition_revision_heads
    WHERE document_id='${initialDocumentId}'`), '1');

  const changedTemplate = createTemplate('Door revised', 3);
  const review = JSON.parse(asRole(owner, `SELECT public.preview_document_definition_revision_upgrade(
    '${documentId}','${changedTemplate}','${changedTemplate}','[]'::jsonb,'${id(320)}')`).stdout);
  const applySql = `SELECT public.apply_reviewed_document_definition_revision(
    '${documentId}',${review.current.definitionRevision},${quote(review.current.definitionDigest)},
    '${review.surveyDefinition.source.templateId}',
    ${quote(review.surveyDefinition.source.templateUpdatedAt)}::timestamptz,
    ${quote(review.surveyDefinition.source.structureSha256)},
    '${review.entityCatalog.source.templateId}',
    ${quote(review.entityCatalog.source.templateUpdatedAt)}::timestamptz,
    ${quote(review.entityCatalog.source.entitiesSha256)},'[]'::jsonb,'${id(320)}',
    ${quote(review.review.requestSha256)})`;
  const before = scalar(`SELECT updated_at::text FROM public.documents WHERE id='${documentId}'`);
  const otherBefore = scalar(`SELECT updated_at::text FROM public.documents WHERE id='${otherDocumentId}'`);

  // The wake is transactional: a real accepted apply changes it inside the
  // transaction, and rollback restores both the head and public wake row.
  const rolledBack = asRole(owner, `BEGIN; ${applySql};
    SELECT updated_at::text FROM public.documents WHERE id='${documentId}'; ROLLBACK;`).stdout.trim().split('\n').at(-2);
  assert.notEqual(rolledBack, before);
  assert.equal(scalar(`SELECT updated_at::text FROM public.documents WHERE id='${documentId}'`), before);
  assert.equal(scalar(`SELECT current_revision FROM survey_private.document_definition_revision_heads
    WHERE document_id='${documentId}'`), '1');

  const accepted = JSON.parse(asRole(owner, applySql).stdout);
  assert.equal(accepted.definitionRevision, 2);
  const acceptedAt = scalar(`SELECT updated_at::text FROM public.documents WHERE id='${documentId}'`);
  assert.notEqual(acceptedAt, before);
  assert.equal(scalar(`SELECT title FROM public.documents WHERE id='${documentId}'`), 'kept');
  assert.equal(scalar(`SELECT updated_at::text FROM public.documents WHERE id='${otherDocumentId}'`), otherBefore);

  // Exact replay returns before the private head update. A no-op head update is
  // also guarded, so neither emits another public row change.
  const replay = JSON.parse(asRole(owner, applySql).stdout);
  assert.equal(replay.definitionRevision, 2);
  assert.equal(scalar(`SELECT updated_at::text FROM public.documents WHERE id='${documentId}'`), acceptedAt);
  sql(`UPDATE survey_private.document_definition_revision_heads SET current_revision=current_revision,
    current_digest=current_digest WHERE document_id='${documentId}'`);
  assert.equal(scalar(`SELECT updated_at::text FROM public.documents WHERE id='${documentId}'`), acceptedAt);

  // A failed stale apply changes neither document.
  const failed = asRole(owner, applySql.replace(`${review.current.definitionRevision},`, '999,'),
    'authenticated', false);
  assert.notEqual(failed.status, 0);
  assert.equal(scalar(`SELECT updated_at::text FROM public.documents WHERE id='${documentId}'`), acceptedAt);
  assert.equal(scalar(`SELECT updated_at::text FROM public.documents WHERE id='${otherDocumentId}'`), otherBefore);

  console.log('Document definition Realtime wake PostgreSQL checks passed');
}, { name: 'document-definition-realtime-wake' });
