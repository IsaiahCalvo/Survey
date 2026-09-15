import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentDefinitionRevisionClient } from '../src/services/documentDefinitionRevisionClient.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const DOCUMENT = '22222222-2222-4222-8222-222222222222';
const OLD_TEMPLATE = '33333333-3333-4333-8333-333333333333';
const NEW_TEMPLATE = '44444444-4444-4444-8444-444444444444';
const OPERATION = '55555555-5555-4555-8555-555555555555';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const UPDATED = '2026-09-15T12:00:00Z';

const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
  : JSON.stringify(value);

async function sha256(value) {
  const bytes = new TextEncoder().encode(stable(value));
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...result].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const moduleNode = Object.freeze({ id: 'module-old', name: 'Old module', categories: Object.freeze([
  Object.freeze({ id: 'category-old', name: 'Old category', checklist: Object.freeze([
    Object.freeze({ id: 'check-old', text: 'Old check' }),
  ]) }),
]) });

async function receipt({ revision = 1, surveyTemplateId = OLD_TEMPLATE,
  archivedSemanticIds = [], operationId = null, requestSha256 = null } = {}) {
  const content = {
    version: 1,
    documentId: DOCUMENT,
    definitionRevision: revision,
    surveyDefinition: { source: { templateId: surveyTemplateId,
      templateUpdatedAt: UPDATED, structureSha256: SHA_A }, modules: [moduleNode] },
    entityCatalog: { source: { templateId: OLD_TEMPLATE,
      templateUpdatedAt: UPDATED, entitiesSha256: SHA_B }, entities: [] },
    archivedSemanticIds,
  };
  return { status: 'accepted', ...content, definitionDigest: await sha256(content),
    review: { reviewedAt: UPDATED, operationId, requestSha256 } };
}

const rootDescriptor = Object.freeze({ kind: 'module', id: 'module-old', parentId: null,
  label: 'Old module', subtree: Object.freeze([
    Object.freeze({ kind: 'module', id: 'module-old', parentId: null, label: 'Old module' }),
    Object.freeze({ kind: 'category', id: 'category-old', parentId: 'module-old', label: 'Old category' }),
    Object.freeze({ kind: 'checklistItem', id: 'check-old', parentId: 'category-old', label: 'Old check' }),
  ]) });
const roots = Object.freeze([{ kind: 'module', id: 'module-old' }]);
const closure = Object.freeze(rootDescriptor.subtree.map(({ kind, id }) => ({ kind, id })));

test('V2 discovery returns strict server retirement roots without creating a review', async () => {
  const current = await receipt();
  const calls = [];
  const client = createDocumentDefinitionRevisionClient({ enabled: true,
    getActorUserId: () => ACTOR,
    isCurrent: ({ actorUserId, documentId }) => actorUserId === ACTOR && documentId === DOCUMENT,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'read_document_definition_revision') return { data: current };
      return { data: { status: 'retirement-required', version: 2, documentId: DOCUMENT,
        current: { definitionRevision: 1, definitionDigest: current.definitionDigest },
        sourceModes: { survey: 'replace', entity: 'keep' },
        removedRoots: [rootDescriptor], autoRetainedRoots: [], review: null } };
    },
  });
  const result = await client.preview({ version: 2, documentId: DOCUMENT,
    surveyTemplateId: NEW_TEMPLATE, entityTemplateId: null,
    archivedSemanticIds: [], retiredSemanticRoots: [], operationId: OPERATION });
  assert.equal(result.status, 'retirement-required');
  assert.deepEqual(result.removedRoots, [rootDescriptor]);
  assert.deepEqual(calls[1], ['preview_document_definition_revision_upgrade_v2', {
    p_document_id: DOCUMENT, p_survey_template_id: NEW_TEMPLATE, p_entity_template_id: null,
    p_archived_semantic_ids: [], p_retired_semantic_roots: [], p_operation_id: OPERATION,
  }]);
  assert.equal(Object.isFrozen(result.removedRoots[0].subtree), true);
});

test('V2 review trusts only the verified candidate, closes the archive union, and applies with null keep proof', async () => {
  const current = await receipt();
  const previewWire = { status: 'preview', version: 2, documentId: DOCUMENT,
    current: { definitionRevision: 1, definitionDigest: current.definitionDigest },
    sourceModes: { survey: 'replace', entity: 'keep' },
    surveyDefinition: { source: { templateId: NEW_TEMPLATE,
      templateUpdatedAt: UPDATED, structureSha256: SHA_A }, modules: [moduleNode] },
    entityCatalog: current.entityCatalog,
    retirement: { requestedRoots: roots, retiredSemanticIds: closure,
      autoRetainedRoots: [], archivedSemanticIds: closure },
    review: { operationId: OPERATION, requestSha256: SHA_B,
      archivedSemanticIds: [], retiredSemanticRoots: roots } };
  const accepted = await receipt({ revision: 2, surveyTemplateId: NEW_TEMPLATE,
    archivedSemanticIds: closure, operationId: OPERATION, requestSha256: SHA_B });
  const calls = [];
  const client = createDocumentDefinitionRevisionClient({ enabled: true,
    getActorUserId: () => ACTOR,
    isCurrent: ({ actorUserId, documentId }) => actorUserId === ACTOR && documentId === DOCUMENT,
    rpc: async (name, args) => {
      calls.push([name, args]);
      if (name === 'read_document_definition_revision') return { data: current };
      if (name === 'preview_document_definition_revision_upgrade_v2') return { data: previewWire };
      return { data: accepted };
    },
  });
  const review = await client.preview({ version: 2, documentId: DOCUMENT,
    surveyTemplateId: NEW_TEMPLATE, entityTemplateId: null,
    archivedSemanticIds: [], retiredSemanticRoots: roots, operationId: OPERATION });
  assert.equal(review.version, 2);
  assert.notEqual(review.wire, previewWire);
  assert.deepEqual(review.wire, previewWire,
    'validator owns an equal frozen copy of the server candidate');
  const result = await client.apply({ review });
  assert.equal(result.definitionDigest, accepted.definitionDigest);
  const apply = calls.find(([name]) => name === 'apply_reviewed_document_definition_revision_v2');
  assert.ok(apply);
  assert.equal(apply[1].p_entity_template_id, null);
  assert.equal(apply[1].p_expected_entity_template_updated_at, null);
  assert.equal(apply[1].p_expected_entity_entities_sha256, null);
  assert.deepEqual(apply[1].p_retired_semantic_roots, roots);
});

test('V2 rejects a server cumulative archive set that omits a retired descendant', async () => {
  const current = await receipt();
  const bad = { status: 'preview', version: 2, documentId: DOCUMENT,
    current: { definitionRevision: 1, definitionDigest: current.definitionDigest },
    sourceModes: { survey: 'replace', entity: 'keep' },
    surveyDefinition: { source: { templateId: NEW_TEMPLATE,
      templateUpdatedAt: UPDATED, structureSha256: SHA_A }, modules: [moduleNode] },
    entityCatalog: current.entityCatalog,
    retirement: { requestedRoots: roots, retiredSemanticIds: closure,
      autoRetainedRoots: [], archivedSemanticIds: closure.slice(0, 2) },
    review: { operationId: OPERATION, requestSha256: SHA_B,
      archivedSemanticIds: [], retiredSemanticRoots: roots } };
  const client = createDocumentDefinitionRevisionClient({ enabled: true,
    getActorUserId: () => ACTOR, isCurrent: () => true,
    rpc: async name => ({ data: name === 'read_document_definition_revision' ? current : bad }) });
  await assert.rejects(client.preview({ version: 2, documentId: DOCUMENT,
    surveyTemplateId: NEW_TEMPLATE, entityTemplateId: null,
    archivedSemanticIds: [], retiredSemanticRoots: roots, operationId: OPERATION }),
  error => error.code === 'DOCUMENT_DEFINITION_REVISION_INTEGRITY');
});

test('V2 apply revalidates cumulative archives and keep-side content before its RPC', async () => {
  const current = await receipt();
  const wire = { status:'preview', version:2, documentId:DOCUMENT,
    current:{ definitionRevision:1, definitionDigest:current.definitionDigest },
    sourceModes:{ survey:'replace', entity:'keep' },
    surveyDefinition:{ source:{ templateId:NEW_TEMPLATE, templateUpdatedAt:UPDATED,
      structureSha256:SHA_A }, modules:[moduleNode] }, entityCatalog:current.entityCatalog,
    retirement:{ requestedRoots:roots, retiredSemanticIds:closure,
      autoRetainedRoots:[], archivedSemanticIds:closure },
    review:{ operationId:OPERATION, requestSha256:SHA_B,
      archivedSemanticIds:[], retiredSemanticRoots:roots } };
  let applyCalls = 0;
  const client = createDocumentDefinitionRevisionClient({ enabled:true,
    getActorUserId:() => ACTOR, isCurrent:() => true,
    rpc:async name => {
      if (name === 'read_document_definition_revision') return { data:current };
      if (name === 'preview_document_definition_revision_upgrade_v2') return { data:wire };
      applyCalls++;
      return { data:null };
    } });
  const review = await client.preview({ version:2, documentId:DOCUMENT,
    surveyTemplateId:NEW_TEMPLATE, entityTemplateId:null, archivedSemanticIds:[],
    retiredSemanticRoots:roots, operationId:OPERATION });
  const badArchives = structuredClone(review);
  badArchives.wire.retirement.archivedSemanticIds = closure.slice(0, 2);
  badArchives.expectedArchivedSemanticIds = closure.slice(0, 2);
  await assert.rejects(client.apply({ review:badArchives }),
    error => error.code === 'DOCUMENT_DEFINITION_REVISION_INTEGRITY');
  const badKeep = structuredClone(review);
  badKeep.wire.entityCatalog = { ...badKeep.wire.entityCatalog,
    entities:[{ id:'entity-added', name:'Added', color:'#112233',
      opacity:0.5, borderColor:null, borderOpacity:null, matchFill:false }] };
  await assert.rejects(client.apply({ review:badKeep }),
    error => error.code === 'DOCUMENT_DEFINITION_REVISION_INTEGRITY');
  assert.equal(applyCalls, 0);
});
