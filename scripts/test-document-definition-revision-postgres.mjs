// Disposable local PostgreSQL only. This script accepts no remote connection.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
import {
  appendReviewedDocumentDefinitionRevision,
  captureReviewedDocumentDefinitionRevision,
  captureReviewedDocumentDefinitionSnapshot,
  createDocumentDefinitionRevisionHistory,
} from '../src/services/documentDefinitionRevisionHistory.js';
import { createDocumentDefinitionRevisionClient }
  from '../src/services/documentDefinitionRevisionClient.js';

assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const entityMigration = fileURLToPath(new URL(
  '../supabase/migrations/20260909105000_document_entity_catalog.sql', import.meta.url));
const surveyMigration = fileURLToPath(new URL(
  '../supabase/migrations/20260909106000_document_survey_definition.sql', import.meta.url));
const revisionMigration = fileURLToPath(new URL(
  '../supabase/migrations/20260915102000_document_definition_revisions.sql', import.meta.url));
const id = n => `10200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), other = id(4);
const hash = value => value.repeat(64);
const item = (itemId = 'check-door', text = 'Door condition', extra = {}) =>
  ({ id: itemId, text, ...extra });
const modules = (items = [item()], categories = null) => [{
  id: 'module-doors', name: 'Doors', categories: categories || [{
    id: 'category-doors', name: 'Door checks', checklist: items,
  }],
}];
const entities = (name = 'Door') => [{
  id: 'entity-door', name, color: '#112233', opacity: 0.35,
  borderColor: null, borderOpacity: null, matchFill: false,
}];
const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
  : JSON.stringify(value);
let count = 0;

await withDisposablePostgres(async ({ sql, scalar, asRole, errorState, applyMigration, quote }) => {
  sql(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE SCHEMA extensions;
    CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${owner}'),('${editor}'),('${viewer}'),('${other}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE TABLE public.documents(
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
      template_id uuid, archived boolean NOT NULL DEFAULT false,
      user_archived_at timestamptz, locked_at timestamptz, title text DEFAULT 'kept');
    CREATE TABLE public.templates(
      id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES auth.users(id),
      config jsonb NOT NULL, updated_at timestamptz NOT NULL,
      archived boolean NOT NULL DEFAULT false, user_archived_at timestamptz);
    ALTER TABLE public.templates ENABLE ROW LEVEL SECURITY;
    CREATE POLICY template_owner_read ON public.templates FOR SELECT TO authenticated
      USING (user_id = auth.uid());
    CREATE TABLE public.document_collaborators(
      document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
      user_id uuid NOT NULL REFERENCES auth.users(id), role text NOT NULL,
      status text NOT NULL, PRIMARY KEY(document_id,user_id));
    CREATE SCHEMA survey_private;
    CREATE TABLE survey_private.account_write_guards(
      user_id uuid PRIMARY KEY, closing boolean NOT NULL DEFAULT false);
    CREATE FUNCTION public.user_can_access_document(doc_id uuid, required_role text DEFAULT 'viewer')
    RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
    DECLARE owner_id uuid; member_role text;
    BEGIN
      SELECT d.user_id INTO owner_id FROM public.documents d WHERE d.id=doc_id;
      IF owner_id IS NULL THEN RETURN false; END IF;
      IF owner_id=auth.uid() THEN RETURN true; END IF;
      SELECT c.role INTO member_role FROM public.document_collaborators c
        WHERE c.document_id=doc_id AND c.user_id=auth.uid() AND c.status='active';
      RETURN CASE required_role WHEN 'viewer' THEN member_role IN('viewer','editor','owner')
        WHEN 'editor' THEN member_role IN('editor','owner')
        WHEN 'owner' THEN member_role='owner' ELSE false END;
    END $$;
    CREATE FUNCTION public.kal49_document_is_locked(doc_id uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
      AS $$SELECT coalesce((SELECT d.locked_at IS NOT NULL FROM public.documents d WHERE d.id=doc_id),true)$$;
    CREATE FUNCTION survey_private.assert_account_open(p_user_id uuid) RETURNS void
      LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
    DECLARE is_closing boolean;
    BEGIN
      INSERT INTO survey_private.account_write_guards VALUES(p_user_id,false) ON CONFLICT DO NOTHING;
      SELECT closing INTO is_closing FROM survey_private.account_write_guards
        WHERE user_id=p_user_id FOR SHARE;
      IF is_closing THEN RAISE EXCEPTION 'ACCOUNT_CLOSING' USING ERRCODE='23514'; END IF;
    END $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    GRANT SELECT ON public.documents,public.templates,public.document_collaborators TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid(),public.user_can_access_document(uuid,text),
      public.kal49_document_is_locked(uuid),survey_private.assert_account_open(uuid)
      TO authenticated;
  `);
  applyMigration(entityMigration);
  applyMigration(surveyMigration);

  const createDocument = n => {
    const documentId = id(100 + n);
    sql(`INSERT INTO public.documents(id,user_id) VALUES('${documentId}','${owner}')`);
    return documentId;
  };
  const createTemplate = (n, {
    surveyModules = modules(), entityValues = entities(),
    updatedAt = `2026-09-${String(15 + Math.floor(n / 20)).padStart(2, '0')}T12:${String(n % 20).padStart(2, '0')}:00Z`, extra = {},
  } = {}) => {
    const templateId = id(200 + n);
    sql(`INSERT INTO public.templates(id,user_id,config,updated_at)
      VALUES('${templateId}','${owner}',${quote(JSON.stringify({
        modules: surveyModules, entities: entityValues, ...extra,
      }))}::jsonb,${quote(updatedAt)})`);
    return templateId;
  };
  const surveyPreview = (actor, documentId, templateId) => JSON.parse(asRole(actor,
    `SELECT public.preview_document_survey_definition_adoption('${documentId}','${templateId}')`).stdout);
  const entityPreview = (actor, documentId, templateId) => JSON.parse(asRole(actor,
    `SELECT public.preview_document_entity_catalog_adoption('${documentId}','${templateId}')`).stdout);
  const adoptBase = (documentId, templateId, n, order = 'survey-first') => {
    const survey = surveyPreview(owner, documentId, templateId);
    const entity = entityPreview(owner, documentId, templateId);
    const adoptSurvey = () => asRole(owner,
      `SELECT public.adopt_document_survey_definition('${documentId}','${templateId}',
        ${quote(survey.source.templateUpdatedAt)}::timestamptz,${quote(survey.source.structureSha256)},
        '${id(300 + n)}',${quote(hash('a'))})`);
    const adoptEntity = () => asRole(owner,
      `SELECT public.adopt_document_entity_catalog('${documentId}','${templateId}',
        ${quote(entity.source.templateUpdatedAt)}::timestamptz,${quote(entity.source.entitiesSha256)},
        '${id(400 + n)}',${quote(hash('b'))})`);
    if (order === 'entity-first') { adoptEntity(); adoptSurvey(); }
    else { adoptSurvey(); adoptEntity(); }
  };

  // This row proves migration-time backfill, not only post-migration triggers.
  const backfilledDocument = createDocument(1);
  const backfilledTemplate = createTemplate(1, {
    surveyModules: modules([item('check-door', 'Door Σ 😀')]),
    entityValues: [{ ...entities()[0], opacity: 1e-7 }],
    extra: { privateOwnerToken: 'never-shared' },
  });
  adoptBase(backfilledDocument, backfilledTemplate, 1);
  applyMigration(revisionMigration);

  const read = (actor, documentId, revision = null, required = true) => {
    const raw = asRole(actor, `SELECT public.read_document_definition_revision(
      '${documentId}',${revision == null ? 'NULL' : revision})`, 'authenticated', required);
    return required ? JSON.parse(raw.stdout) : raw;
  };
  const readAcceptedSurvey = documentId => JSON.parse(asRole(owner,
    `SELECT public.read_document_survey_definition('${documentId}')`).stdout);
  const readAcceptedEntities = documentId => JSON.parse(asRole(owner,
    `SELECT public.read_document_entity_catalog('${documentId}')`).stdout);
  let previewOperation = 600;
  const preview = (actor, documentId, surveyTemplateId, entityTemplateId,
    archives = [], operationId = id(previewOperation++), required = true) => {
    const raw = asRole(actor, `SELECT public.preview_document_definition_revision_upgrade(
      '${documentId}','${surveyTemplateId}','${entityTemplateId}',
      ${quote(JSON.stringify(archives))}::jsonb,'${operationId}')`, 'authenticated', required);
    return required ? JSON.parse(raw.stdout) : raw;
  };
  const applySql = ({ documentId, reviewed, archives = [], operationId, requestSha256 }) =>
    `SELECT public.apply_reviewed_document_definition_revision(
      '${documentId}',${reviewed.current.definitionRevision},${quote(reviewed.current.definitionDigest)},
      '${reviewed.surveyDefinition.source.templateId}',
      ${quote(reviewed.surveyDefinition.source.templateUpdatedAt)}::timestamptz,
      ${quote(reviewed.surveyDefinition.source.structureSha256)},
      '${reviewed.entityCatalog.source.templateId}',
      ${quote(reviewed.entityCatalog.source.templateUpdatedAt)}::timestamptz,
      ${quote(reviewed.entityCatalog.source.entitiesSha256)},
      ${quote(JSON.stringify(archives))}::jsonb,'${operationId}',${quote(requestSha256)})`;
  const apply = (actor, options, required = true) => {
    const raw = asRole(actor, applySql(options), 'authenticated', required);
    return required ? JSON.parse(raw.stdout) : raw;
  };
  const localRevisionRpc = actor => async (name, args) => {
    const exact = keys => assert.deepEqual(Object.keys(args || {}).sort(), [...keys].sort(),
      `unexpected ${name} RPC arguments`);
    let statement;
    switch (name) {
      case 'read_document_definition_revision':
        exact(['p_document_id', 'p_definition_revision']);
        statement = `SELECT public.read_document_definition_revision(
          ${quote(args.p_document_id)},${args.p_definition_revision == null
            ? 'NULL' : quote(args.p_definition_revision)})`;
        break;
      case 'preview_document_definition_revision_upgrade':
        exact(['p_document_id', 'p_survey_template_id', 'p_entity_template_id',
          'p_archived_semantic_ids', 'p_operation_id']);
        statement = `SELECT public.preview_document_definition_revision_upgrade(
          ${quote(args.p_document_id)},${quote(args.p_survey_template_id)},
          ${quote(args.p_entity_template_id)},${quote(JSON.stringify(args.p_archived_semantic_ids))}::jsonb,
          ${quote(args.p_operation_id)})`;
        break;
      case 'apply_reviewed_document_definition_revision':
        exact(['p_document_id', 'p_expected_current_revision', 'p_expected_current_digest',
          'p_survey_template_id', 'p_expected_survey_template_updated_at',
          'p_expected_survey_structure_sha256', 'p_entity_template_id',
          'p_expected_entity_template_updated_at', 'p_expected_entity_entities_sha256',
          'p_archived_semantic_ids', 'p_operation_id', 'p_request_sha256']);
        statement = `SELECT public.apply_reviewed_document_definition_revision(
          ${quote(args.p_document_id)},${quote(args.p_expected_current_revision)},
          ${quote(args.p_expected_current_digest)},${quote(args.p_survey_template_id)},
          ${quote(args.p_expected_survey_template_updated_at)}::timestamptz,
          ${quote(args.p_expected_survey_structure_sha256)},${quote(args.p_entity_template_id)},
          ${quote(args.p_expected_entity_template_updated_at)}::timestamptz,
          ${quote(args.p_expected_entity_entities_sha256)},
          ${quote(JSON.stringify(args.p_archived_semantic_ids))}::jsonb,
          ${quote(args.p_operation_id)},${quote(args.p_request_sha256)})`;
        break;
      default:
        throw new Error(`unexpected document definition revision RPC: ${name}`);
    }
    const result = asRole(actor, statement, 'authenticated', false);
    if (result.status === 0) return { data: JSON.parse(result.stdout), error: null };
    const code = result.stderr.match(/\b([0-9]{2}[0-9A-Z]{3})\b/)?.[1] || 'LOCAL_PG_ERROR';
    return { data: null, error: { code, message: result.stderr } };
  };
  const reviewedApply = (documentId, reviewed) => {
    const archives = reviewed.review.archivedSemanticIds;
    const operationId = reviewed.review.operationId;
    const requestSha256 = reviewed.review.requestSha256;
    return { receipt: apply(owner, { documentId, reviewed, archives, operationId, requestSha256 }),
      operationId, requestSha256 };
  };
  const check = async (name, work) => { await work(); count++; console.log(`PASS ${name}`); };

  await check('migration backfills exact revision one and lets a collaborator read it', async () => {
    sql(`INSERT INTO public.document_collaborators VALUES(
      '${backfilledDocument}','${viewer}','viewer','active')`);
    const ownerRead = read(owner, backfilledDocument);
    const memberRead = read(viewer, backfilledDocument);
    assert.equal(ownerRead.definitionRevision, 1);
    assert.equal(ownerRead.definitionDigest.length, 64);
    assert.deepEqual(memberRead, ownerRead);
    assert.equal(JSON.stringify(ownerRead).includes('never-shared'), false);
    const jsHistory = await createDocumentDefinitionRevisionHistory({
      actorId: owner,
      surveyDefinition: readAcceptedSurvey(backfilledDocument),
      entityCatalog: readAcceptedEntities(backfilledDocument),
    });
    const digestContent = {
      version: 1,
      documentId: ownerRead.documentId,
      definitionRevision: ownerRead.definitionRevision,
      surveyDefinition: ownerRead.surveyDefinition,
      entityCatalog: ownerRead.entityCatalog,
      archivedSemanticIds: ownerRead.archivedSemanticIds,
    };
    const pgCanonical = scalar(`SELECT survey_private.document_definition_stable_json(
      ${quote(JSON.stringify(digestContent))}::jsonb)`);
    assert.equal(pgCanonical, stable(digestContent),
      'SQL and JS stable serializers must match every accepted definition value');
    const pgCanonicalLowDigits = scalar(`SET extra_float_digits=0;
      SELECT survey_private.document_definition_stable_json(
        ${quote(JSON.stringify(digestContent))}::jsonb)`);
    const pgCanonicalHighDigits = scalar(`SET extra_float_digits=3;
      SELECT survey_private.document_definition_stable_json(
        ${quote(JSON.stringify(digestContent))}::jsonb)`);
    assert.equal(pgCanonicalLowDigits, pgCanonicalHighDigits,
      'caller float display settings cannot change canonical definition JSON');
    const combinedDigestCall = `survey_private.document_definition_combined_digest(
      '${ownerRead.documentId}',${ownerRead.definitionRevision},
      ${quote(JSON.stringify(ownerRead.surveyDefinition.source))}::jsonb,
      ${quote(JSON.stringify(ownerRead.surveyDefinition.modules))}::jsonb,
      ${quote(JSON.stringify(ownerRead.entityCatalog.source))}::jsonb,
      ${quote(JSON.stringify(ownerRead.entityCatalog.entities))}::jsonb,
      ${quote(JSON.stringify(ownerRead.archivedSemanticIds))}::jsonb)`;
    const lowDigitsDigest = scalar(`SET extra_float_digits=0; SELECT ${combinedDigestCall}`);
    const highDigitsDigest = scalar(`SET extra_float_digits=3; SELECT ${combinedDigestCall}`);
    assert.equal(lowDigitsDigest, highDigitsDigest,
      'caller float display settings cannot change a real revision digest');
    assert.equal(lowDigitsDigest, ownerRead.definitionDigest);
    assert.equal(ownerRead.definitionDigest, jsHistory.currentDigest,
      'SQL and JS must hash the same revision-1 canonical JSON');
  });

  await check('both post-migration adoption orders seed one combined head', () => {
    for (const [n, order] of [[2, 'survey-first'], [3, 'entity-first']]) {
      const documentId = createDocument(n), templateId = createTemplate(n);
      adoptBase(documentId, templateId, n, order);
      assert.equal(read(owner, documentId).definitionRevision, 1);
      assert.equal(scalar(`SELECT count(*) FROM survey_private.document_definition_revision_heads
        WHERE document_id='${documentId}'`), '1');
    }
  });

  await check('preview strips private Template fields and binds both normalized source digests', () => {
    const templateId = createTemplate(10, { extra: {
      privateOwnerToken: 'survey-secret', privateBillingPlan: 'entity-secret',
    } });
    const value = preview(owner, backfilledDocument, templateId, templateId);
    assert.equal(value.status, 'preview');
    assert.equal(value.current.definitionRevision, 1);
    assert.equal(JSON.stringify(value).includes('secret'), false);
    assert.deepEqual(Object.keys(value.surveyDefinition).sort(), ['modules','source']);
    assert.deepEqual(Object.keys(value.entityCatalog).sort(), ['entities','source']);
  });

  await check('reviewed apply advances the head while the exact old revision remains readable', async () => {
    const templateId = createTemplate(11, {
      surveyModules: modules([item('check-door', 'Door condition revised')]),
      entityValues: entities('Door revised'),
    });
    const reviewed = preview(owner, backfilledDocument, templateId, templateId);
    const { receipt } = reviewedApply(backfilledDocument, reviewed);
    const jsHistory = await createDocumentDefinitionRevisionHistory({
      actorId: owner,
      surveyDefinition: readAcceptedSurvey(backfilledDocument),
      entityCatalog: readAcceptedEntities(backfilledDocument),
    });
    const snapshot = captureReviewedDocumentDefinitionSnapshot({
      documentId: backfilledDocument,
      surveySource: reviewed.surveyDefinition.source,
      surveyTemplate: { modules: reviewed.surveyDefinition.modules },
      entitySource: reviewed.entityCatalog.source,
      entityTemplate: { entities: reviewed.entityCatalog.entities },
    });
    const jsReview = captureReviewedDocumentDefinitionRevision({
      history: jsHistory,
      actorId: owner,
      documentId: backfilledDocument,
      reviewedAt: '2026-09-15T13:00:00Z',
      snapshot,
      archivedSemanticIds: reviewed.review.archivedSemanticIds,
    });
    const jsUpgrade = await appendReviewedDocumentDefinitionRevision({
      history: jsHistory,
      actorId: owner,
      documentId: backfilledDocument,
      expectedCurrentRevision: jsHistory.currentRevision,
      expectedCurrentDigest: jsHistory.currentDigest,
      review: jsReview,
    });
    assert.equal(receipt.definitionRevision, 2);
    assert.equal(receipt.definitionDigest, jsUpgrade.currentDigest,
      'SQL and JS must hash the same reviewed revision canonical JSON');
    assert.equal(read(owner, backfilledDocument).definitionRevision, 2);
    assert.equal(read(owner, backfilledDocument, 1).surveyDefinition.modules[0]
      .categories[0].checklist[0].text, 'Door Σ 😀');
    assert.equal(read(owner, backfilledDocument, 2).surveyDefinition.modules[0]
      .categories[0].checklist[0].text, 'Door condition revised');
  });

  await check('current revision digest and reviewed source changes fail the exact CAS', () => {
    const documentId = createDocument(20), base = createTemplate(20);
    adoptBase(documentId, base, 20);
    const next = createTemplate(21, { surveyModules: modules([item('check-door', 'Next')]) });
    const reviewed = preview(owner, documentId, next, next);
    const archives = reviewed.review.archivedSemanticIds;
    const operationId = reviewed.review.operationId;
    const requestSha256 = reviewed.review.requestSha256;
    const wrongRevision = structuredClone(reviewed);
    wrongRevision.current.definitionRevision = 2;
    errorState(apply(owner, { documentId, reviewed: wrongRevision, archives,
      operationId, requestSha256 }, false), '40001');
    const wrongDigest = structuredClone(reviewed);
    wrongDigest.current.definitionDigest = hash('f');
    errorState(apply(owner, { documentId, reviewed: wrongDigest, archives,
      operationId, requestSha256 }, false), '40001');
    sql(`UPDATE public.templates SET updated_at='2026-09-15T14:00:00Z'
      WHERE id='${next}'`);
    errorState(apply(owner, { documentId, reviewed, archives,
      operationId, requestSha256 }, false), '40001');
  });

  await check('history IDs cannot be deleted or reused under a new parent', () => {
    const removedDoc = createDocument(30), removedBase = createTemplate(30);
    adoptBase(removedDoc, removedBase, 30);
    const removedTemplate = createTemplate(31, { surveyModules: modules([]) });
    const removedReview = preview(owner, removedDoc, removedTemplate, removedTemplate);
    const archives = removedReview.review.archivedSemanticIds;
    const removedOperation = removedReview.review.operationId;
    const removedRequest = removedReview.review.requestSha256;
    const removed = apply(owner, { documentId: removedDoc, reviewed: removedReview, archives,
      operationId: removedOperation, requestSha256: removedRequest }, false);
    errorState(removed, '23514'); assert.match(removed.stderr, /DOCUMENT_DEFINITION_SEMANTIC_ID_REMOVED/);

    const reusedDoc = createDocument(32), reusedBase = createTemplate(32);
    adoptBase(reusedDoc, reusedBase, 32);
    const movedCategories = [
      { id:'category-doors', name:'Door checks', checklist:[] },
      { id:'category-other', name:'Other checks', checklist:[item()] },
    ];
    const reusedTemplate = createTemplate(33, { surveyModules: modules([], movedCategories) });
    const reusedReview = preview(owner, reusedDoc, reusedTemplate, reusedTemplate);
    const reusedOperation = reusedReview.review.operationId;
    const reusedRequest = reusedReview.review.requestSha256;
    const reused = apply(owner, { documentId: reusedDoc, reviewed: reusedReview, archives,
      operationId: reusedOperation, requestSha256: reusedRequest }, false);
    errorState(reused, '23514'); assert.match(reused.stderr, /DOCUMENT_DEFINITION_SEMANTIC_ID_REUSED/);
  });

  await check('reviewed archives stay retained and cumulative without deleting the ID', () => {
    const documentId = createDocument(40), base = createTemplate(40);
    adoptBase(documentId, base, 40);
    const archivedTemplate = createTemplate(41, { surveyModules: modules([item('check-door',
      'Door condition', { archived:true, archivedAt:'2026-09-15T15:00:00Z',
        lastKnownLabel:'Door condition' })]) });
    const archives = [{ kind:'checklistItem', id:'check-door' }];
    const review2 = preview(owner, documentId, archivedTemplate, archivedTemplate, archives);
    const revision2 = reviewedApply(documentId, review2).receipt;
    const nextTemplate = createTemplate(42, { surveyModules: archivedTemplate
      ? modules([item('check-door', 'Door condition archived', { archived:true,
        archivedAt:'2026-09-15T15:00:00Z', lastKnownLabel:'Door condition' })]) : [] });
    const review3 = preview(owner, documentId, nextTemplate, nextTemplate);
    const revision3 = reviewedApply(documentId, review3).receipt;
    assert.deepEqual(revision2.archivedSemanticIds, archives);
    assert.deepEqual(revision3.archivedSemanticIds, archives);
    assert.equal(revision3.surveyDefinition.modules[0].categories[0].checklist[0].id,
      'check-door');
  });

  await check('only the owner writes while active collaborators read old revisions', () => {
    const documentId = createDocument(50), base = createTemplate(50);
    adoptBase(documentId, base, 50);
    sql(`INSERT INTO public.document_collaborators VALUES
      ('${documentId}','${editor}','editor','active'),
      ('${documentId}','${viewer}','viewer','active')`);
    const next = createTemplate(51), reviewed = preview(owner, documentId, next, next);
    errorState(preview(editor, documentId, next, next, [], id(699), false), '42501');
    const archives = reviewed.review.archivedSemanticIds;
    const operationId = reviewed.review.operationId;
    const requestSha256 = reviewed.review.requestSha256;
    errorState(apply(editor, { documentId, reviewed, archives, operationId,
      requestSha256 }, false), '42501');
    assert.equal(read(viewer, documentId, 1).definitionRevision, 1);
    sql(`UPDATE public.document_collaborators SET status='revoked'
      WHERE document_id='${documentId}' AND user_id='${viewer}'`);
    errorState(read(viewer, documentId, 1, false), '42501');
    errorState(read(other, documentId, 1, false), '42501');
  });

  await check('exact operation replay is stable and private rows remain unavailable', () => {
    const documentId = createDocument(60), base = createTemplate(60);
    adoptBase(documentId, base, 60);
    const next = createTemplate(61), reviewed = preview(owner, documentId, next, next);
    const archives = reviewed.review.archivedSemanticIds;
    const operationId = reviewed.review.operationId;
    const requestSha256 = reviewed.review.requestSha256;
    const options = { documentId, reviewed, archives, operationId, requestSha256 };
    const first = apply(owner, options);
    assert.deepEqual(apply(owner, options), first);
    const changedBase = structuredClone(reviewed);
    changedBase.current.definitionDigest = hash('e');
    errorState(apply(owner, { ...options, reviewed: changedBase }, false), '40001');
    const changedSource = structuredClone(reviewed);
    changedSource.surveyDefinition.source.structureSha256 = hash('e');
    errorState(apply(owner, { ...options, reviewed: changedSource }, false), '40001');
    errorState(apply(owner, { ...options,
      archives: [{ kind:'entity', id:'entity-door' }] }, false), '40001');
    errorState(apply(owner, { ...options, requestSha256: hash('e') }, false), '40001');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_definition_revisions
      WHERE document_id='${documentId}'`), '2');

    const laterTemplate = createTemplate(62, { surveyModules: modules([item('check-door', 'Later')]) });
    const laterReview = preview(owner, documentId, laterTemplate, laterTemplate);
    reviewedApply(documentId, laterReview);
    assert.equal(read(owner, documentId).definitionRevision, 3);
    assert.deepEqual(apply(owner, options), first,
      'an exact retry returns its old receipt after a later revision wins');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_definition_revisions
      WHERE document_id='${documentId}'`), '3');
    for (const role of ['authenticated','service_role']) {
      errorState(asRole(owner,
        'SELECT * FROM survey_private.document_definition_revisions', role, false), '42501');
      errorState(asRole(owner,
        'UPDATE survey_private.document_definition_revision_heads SET current_revision=1',
        role, false), '42501');
    }
  });

  await check('real revision client composes current, preview, apply, history, retry, and scope errors', async () => {
    const archiveEntities = [
      { ...entities()[0], id: 'entity-Z', name: 'Zed' },
      { ...entities()[0], id: 'entity-a!', name: 'Aye' },
    ];
    const archiveIds = [
      { kind: 'entity', id: 'entity-a!' },
      { kind: 'entity', id: 'entity-Z' },
    ];
    const documentId = createDocument(70), base = createTemplate(70, {
      entityValues: archiveEntities,
    });
    adoptBase(documentId, base, 70);
    let scopeCurrent = true;
    const client = createDocumentDefinitionRevisionClient({
      enabled: true,
      rpc: localRevisionRpc(owner),
      getActorUserId: () => owner,
      isCurrent: ({ actorUserId, documentId: scopedDocumentId }) => scopeCurrent
        && actorUserId === owner && scopedDocumentId === documentId,
    });
    const initial = await client.readCurrent({ documentId });
    assert.equal(initial.definitionRevision, 1);
    const next = createTemplate(71, {
      surveyModules: modules([item('check-door', 'Client reviewed')]),
      entityValues: [
        { ...archiveEntities[0], name: 'Zed revised' },
        { ...archiveEntities[1], name: 'Aye revised' },
      ],
    });
    const review = await client.preview({ documentId, surveyTemplateId: next,
      entityTemplateId: next, archivedSemanticIds: archiveIds, operationId: id(800) });
    assert.equal(review.currentReceipt.definitionDigest, initial.definitionDigest);
    const accepted = await client.apply({ review });
    assert.equal(accepted.definitionRevision, 2);
    assert.deepEqual(accepted.archivedSemanticIds, [
      { kind: 'entity', id: 'entity-Z' },
      { kind: 'entity', id: 'entity-a!' },
    ], 'the real SQL receipt uses database byte ordering, not locale sorting');
    const old = await client.readRevision({ documentId, definitionRevision: 1,
      expectedDigest: initial.definitionDigest });
    assert.equal(old.definitionRevision, 1);

    const later = createTemplate(72, {
      surveyModules: modules([item('check-door', 'Client later')]),
      entityValues: [
        { ...archiveEntities[0], name: 'Zed later' },
        { ...archiveEntities[1], name: 'Aye later' },
      ],
    });
    const laterReview = await client.preview({ documentId, surveyTemplateId: later,
      entityTemplateId: later, archivedSemanticIds: [], operationId: id(801) });
    assert.equal((await client.apply({ review: laterReview })).definitionRevision, 3);
    assert.deepEqual(await client.apply({ review }), accepted,
      'the client must preserve the exact old server receipt on late retry');

    scopeCurrent = false;
    await assert.rejects(client.readCurrent({ documentId }), {
      code: 'DOCUMENT_DEFINITION_REVISION_STALE',
    });
    const forbidden = createDocumentDefinitionRevisionClient({
      enabled: true,
      rpc: localRevisionRpc(viewer),
      getActorUserId: () => viewer,
      isCurrent: ({ actorUserId, documentId: scopedDocumentId }) => actorUserId === viewer
        && scopedDocumentId === documentId,
    });
    await assert.rejects(forbidden.readCurrent({ documentId }), {
      code: 'DOCUMENT_DEFINITION_REVISION_FORBIDDEN',
    });
  });
}, { name: 'document-definition-revision' });

console.log(`document definition revisions: ${count}/${count} passed; cleanup complete`);
