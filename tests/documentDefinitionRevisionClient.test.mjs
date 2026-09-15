import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDocumentDefinitionRevisionClient,
  validateDocumentDefinitionRevisionReceipt,
} from '../src/services/documentDefinitionRevisionClient.js';

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333';
const NEXT_TEMPLATE_ID = '44444444-4444-4444-8444-444444444444';
const OPERATION_ID = '55555555-5555-4555-8555-555555555555';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const SHA_E = 'e'.repeat(64);

const modules = text => [{ id:'module-doors', name:'Doors', categories:[{
  id:'category-doors', name:'Door checks', checklist:[{ id:'check-door', text }],
}] }];
const entities = name => [{ id:'entity-door', name, color:'#112233', opacity:0.35,
  borderColor:null, borderOpacity:null, matchFill:false }];
const stable = value => value && typeof value === 'object'
  ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
  : JSON.stringify(value);
const digest = async value => {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};

const revision = async ({ number, surveyText, entityName, archives = [], operationId = null,
  requestSha256 = null, surveyTemplateId = TEMPLATE_ID, entityTemplateId = TEMPLATE_ID } = {}) => {
  const content = {
    version: 1,
    documentId: DOCUMENT_ID,
    definitionRevision: number,
    surveyDefinition: { source: { templateId:surveyTemplateId,
      templateUpdatedAt:'2026-09-15T12:00:00+00:00', structureSha256:SHA_A },
    modules:modules(surveyText) },
    entityCatalog: { source: { templateId:entityTemplateId,
      templateUpdatedAt:'2026-09-15T12:00:00+00:00', entitiesSha256:SHA_B },
    entities:entities(entityName) },
    archivedSemanticIds: archives,
  };
  return { status:'accepted', ...content, definitionDigest:await digest(content),
    review: { reviewedAt:'2026-09-15T13:00:00+00:00', operationId, requestSha256 } };
};

async function scenario() {
  const current = await revision({ number:1, surveyText:'Door condition', entityName:'Door' });
  const archives = [{ kind:'checklistItem', id:'check-door' }];
  const previewWire = { status:'preview', version:1, documentId:DOCUMENT_ID,
    current:{ definitionRevision:1, definitionDigest:current.definitionDigest },
    surveyDefinition:{ source:{ templateId:NEXT_TEMPLATE_ID,
      templateUpdatedAt:'2026-09-15T13:00:00+00:00', structureSha256:SHA_C },
    modules:modules('Door condition revised') },
    entityCatalog:{ source:{ templateId:NEXT_TEMPLATE_ID,
      templateUpdatedAt:'2026-09-15T13:00:00+00:00', entitiesSha256:SHA_D },
    entities:entities('Door revised') },
    review:{ operationId:OPERATION_ID, requestSha256:SHA_E,
      archivedSemanticIds:archives } };
  const accepted = await revision({ number:2, surveyText:'Door condition revised',
    entityName:'Door revised', archives, operationId:OPERATION_ID,
    requestSha256:SHA_E, surveyTemplateId:NEXT_TEMPLATE_ID,
    entityTemplateId:NEXT_TEMPLATE_ID });
  accepted.surveyDefinition.source = previewWire.surveyDefinition.source;
  accepted.entityCatalog.source = previewWire.entityCatalog.source;
  const content = { version:1, documentId:DOCUMENT_ID, definitionRevision:2,
    surveyDefinition:accepted.surveyDefinition, entityCatalog:accepted.entityCatalog,
    archivedSemanticIds:archives };
  accepted.definitionDigest = await digest(content);
  return { current, archives, previewWire, accepted };
}

test('client composes current read, server proof preview, exact apply, and old revision read', async () => {
  const { current, archives, previewWire, accepted } = await scenario();
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, args]);
    if (name === 'read_document_definition_revision') return { data:current };
    if (name === 'preview_document_definition_revision_upgrade') return { data:previewWire };
    if (name === 'apply_reviewed_document_definition_revision') return { data:accepted };
    throw new Error('unexpected RPC');
  };
  const client = createDocumentDefinitionRevisionClient({ enabled:true, rpc,
    getActorUserId:() => ACTOR_ID,
    isCurrent:({ actorUserId, documentId }) => actorUserId === ACTOR_ID
      && documentId === DOCUMENT_ID });

  const review = await client.preview({ documentId:DOCUMENT_ID,
    surveyTemplateId:NEXT_TEMPLATE_ID, entityTemplateId:NEXT_TEMPLATE_ID,
    archivedSemanticIds:archives, operationId:OPERATION_ID });
  const applied = await client.apply({ review });
  const old = await client.readRevision({ documentId:DOCUMENT_ID,
    definitionRevision:1, expectedDigest:current.definitionDigest });

  assert.deepEqual(applied, await validateDocumentDefinitionRevisionReceipt(accepted, DOCUMENT_ID));
  assert.equal(old.definitionRevision, 1);
  assert.deepEqual(calls.map(([name]) => name), [
    'read_document_definition_revision',
    'preview_document_definition_revision_upgrade',
    'apply_reviewed_document_definition_revision',
    'read_document_definition_revision',
  ]);
  assert.deepEqual(calls[2][1], {
    p_document_id:DOCUMENT_ID,
    p_expected_current_revision:1,
    p_expected_current_digest:current.definitionDigest,
    p_survey_template_id:NEXT_TEMPLATE_ID,
    p_expected_survey_template_updated_at:'2026-09-15T13:00:00+00:00',
    p_expected_survey_structure_sha256:SHA_C,
    p_entity_template_id:NEXT_TEMPLATE_ID,
    p_expected_entity_template_updated_at:'2026-09-15T13:00:00+00:00',
    p_expected_entity_entities_sha256:SHA_D,
    p_archived_semantic_ids:archives,
    p_operation_id:OPERATION_ID,
    p_request_sha256:SHA_E,
  });
});

test('strict receipt validation rejects changed content, extra fields, and wrong history digest', async () => {
  const { current } = await scenario();
  const changed = structuredClone(current);
  changed.entityCatalog.entities[0].name = 'Changed without a new digest';
  await assert.rejects(validateDocumentDefinitionRevisionReceipt(changed, DOCUMENT_ID),
    error => error.code === 'DOCUMENT_DEFINITION_REVISION_INTEGRITY');
  const extra = structuredClone(current);
  extra.surveyDefinition.privateTemplateToken = 'never-shared';
  await assert.rejects(validateDocumentDefinitionRevisionReceipt(extra, DOCUMENT_ID),
    error => error.code === 'DOCUMENT_DEFINITION_REVISION_INTEGRITY');

  const client = createDocumentDefinitionRevisionClient({ enabled:true,
    rpc:async () => ({ data:current }), getActorUserId:() => ACTOR_ID,
    isCurrent:() => true });
  await assert.rejects(client.readRevision({ documentId:DOCUMENT_ID,
    definitionRevision:1, expectedDigest:SHA_E }),
  error => error.code === 'DOCUMENT_DEFINITION_REVISION_CONFLICT');
});

test('preview rejects a proof that drifted from its exact current read or request', async () => {
  const { current, archives, previewWire } = await scenario();
  for (const wire of [
    { ...previewWire, current:{ ...previewWire.current, definitionDigest:SHA_E } },
    { ...previewWire, review:{ ...previewWire.review,
      operationId:'66666666-6666-4666-8666-666666666666' } },
  ]) {
    let calls = 0;
    const client = createDocumentDefinitionRevisionClient({ enabled:true,
      rpc:async name => ({ data:name === 'read_document_definition_revision' ? current : wire }),
      getActorUserId:() => ACTOR_ID, isCurrent:() => true });
    await assert.rejects(client.preview({ documentId:DOCUMENT_ID,
      surveyTemplateId:NEXT_TEMPLATE_ID, entityTemplateId:NEXT_TEMPLATE_ID,
      archivedSemanticIds:archives, operationId:OPERATION_ID }), error => {
      calls++;
      return error.code === 'DOCUMENT_DEFINITION_REVISION_CONFLICT';
    });
    assert.equal(calls, 1);
  }
});

test('apply supports exact retry but rejects any accepted receipt outside the frozen review', async () => {
  const { current, archives, previewWire, accepted } = await scenario();
  let bad = false;
  const client = createDocumentDefinitionRevisionClient({ enabled:true,
    rpc:async name => {
      if (name === 'read_document_definition_revision') return { data:current };
      if (name === 'preview_document_definition_revision_upgrade') return { data:previewWire };
      if (bad) {
        const wrong = structuredClone(accepted);
        wrong.review.requestSha256 = SHA_A;
        return { data:wrong };
      }
      return { data:accepted };
    },
    getActorUserId:() => ACTOR_ID, isCurrent:() => true });
  const review = await client.preview({ documentId:DOCUMENT_ID,
    surveyTemplateId:NEXT_TEMPLATE_ID, entityTemplateId:NEXT_TEMPLATE_ID,
    archivedSemanticIds:archives, operationId:OPERATION_ID });
  assert.deepEqual(await client.apply({ review }), await client.apply({ review }));
  bad = true;
  await assert.rejects(client.apply({ review }),
    error => error.code === 'DOCUMENT_DEFINITION_REVISION_INTEGRITY');
});

test('abort, actor drift, forbidden, missing, and stale CAS errors fail closed', async () => {
  const { current } = await scenario();
  const controller = new AbortController();
  controller.abort();
  let actor = ACTOR_ID;
  let rpcCalls = 0;
  const client = createDocumentDefinitionRevisionClient({ enabled:true,
    rpc:async () => { rpcCalls++; return { data:current }; },
    getActorUserId:() => actor, isCurrent:({ actorUserId }) => actorUserId === actor });
  await assert.rejects(client.readCurrent({ documentId:DOCUMENT_ID,
    signal:controller.signal }), error => error.code === 'DOCUMENT_DEFINITION_REVISION_STALE');
  assert.equal(rpcCalls, 0);

  actor = ACTOR_ID;
  const beforeDispatch = client.readCurrent({ documentId:DOCUMENT_ID });
  actor = '77777777-7777-4777-8777-777777777777';
  await assert.rejects(beforeDispatch,
    error => error.code === 'DOCUMENT_DEFINITION_REVISION_STALE');
  assert.equal(rpcCalls, 0);

  const drift = createDocumentDefinitionRevisionClient({ enabled:true,
    rpc:async () => { actor = '77777777-7777-4777-8777-777777777777'; return { data:current }; },
    getActorUserId:() => actor, isCurrent:({ actorUserId }) => actorUserId === actor });
  actor = ACTOR_ID;
  await assert.rejects(drift.readCurrent({ documentId:DOCUMENT_ID }),
    error => error.code === 'DOCUMENT_DEFINITION_REVISION_STALE');

  for (const [rpcError, code] of [
    [{ code:'42501' }, 'DOCUMENT_DEFINITION_REVISION_FORBIDDEN'],
    [{ code:'P0002' }, 'DOCUMENT_DEFINITION_REVISION_NOT_FOUND'],
    [{ code:'40001' }, 'DOCUMENT_DEFINITION_REVISION_CONFLICT'],
  ]) {
    actor = ACTOR_ID;
    const mapped = createDocumentDefinitionRevisionClient({ enabled:true,
      rpc:async () => ({ error:rpcError }), getActorUserId:() => actor,
      isCurrent:() => true });
    await assert.rejects(mapped.readCurrent({ documentId:DOCUMENT_ID }),
      error => error.code === code);
  }
});

test('scope is checked after async receipt hashing for reads and apply', async () => {
  const { current, archives, previewWire, accepted } = await scenario();
  let actor = ACTOR_ID;
  let delayNext = false;
  let release;
  const delayedCrypto = { subtle:{
    async digest(...args) {
      if (delayNext) {
        delayNext = false;
        await new Promise(resolve => { release = resolve; });
      }
      return crypto.subtle.digest(...args);
    },
  } };
  const client = createDocumentDefinitionRevisionClient({ enabled:true, cryptoImpl:delayedCrypto,
    rpc:async name => ({ data:name === 'read_document_definition_revision' ? current
      : name === 'preview_document_definition_revision_upgrade' ? previewWire : accepted }),
    getActorUserId:() => actor, isCurrent:({ actorUserId }) => actorUserId === actor });

  delayNext = true;
  const reading = client.readCurrent({ documentId:DOCUMENT_ID });
  await new Promise(resolve => setImmediate(resolve));
  actor = '77777777-7777-4777-8777-777777777777';
  release();
  await assert.rejects(reading,
    error => error.code === 'DOCUMENT_DEFINITION_REVISION_STALE');

  actor = ACTOR_ID;
  const review = await client.preview({ documentId:DOCUMENT_ID,
    surveyTemplateId:NEXT_TEMPLATE_ID, entityTemplateId:NEXT_TEMPLATE_ID,
    archivedSemanticIds:archives, operationId:OPERATION_ID });
  delayNext = true;
  const applying = client.apply({ review });
  await new Promise(resolve => setImmediate(resolve));
  actor = '77777777-7777-4777-8777-777777777777';
  release();
  await assert.rejects(applying,
    error => error.code === 'DOCUMENT_DEFINITION_REVISION_STALE');
});

test('archive receipt order is server-owned while cumulative membership stays exact', async () => {
  const first = { kind:'entity', id:'entity-a!' };
  const second = { kind:'entity', id:'entity-Z' };
  const current = await revision({ number:1, surveyText:'Door condition', entityName:'Door',
    archives:[first] });
  const content = { version:1, documentId:DOCUMENT_ID, definitionRevision:2,
    surveyDefinition:{ source:{ templateId:NEXT_TEMPLATE_ID,
      templateUpdatedAt:'2026-09-15T13:00:00+00:00', structureSha256:SHA_C },
    modules:modules('Door condition revised') },
    entityCatalog:{ source:{ templateId:NEXT_TEMPLATE_ID,
      templateUpdatedAt:'2026-09-15T13:00:00+00:00', entitiesSha256:SHA_D },
    entities:entities('Door revised') },
    archivedSemanticIds:[second, first],
  };
  const accepted = { status:'accepted', ...content, definitionDigest:await digest(content),
    review:{ reviewedAt:'2026-09-15T13:00:00+00:00', operationId:OPERATION_ID,
      requestSha256:SHA_E } };
  const wire = { status:'preview', version:1, documentId:DOCUMENT_ID,
    current:{ definitionRevision:1, definitionDigest:current.definitionDigest },
    surveyDefinition:content.surveyDefinition, entityCatalog:content.entityCatalog,
    review:{ operationId:OPERATION_ID, requestSha256:SHA_E,
      archivedSemanticIds:[second] } };
  const client = createDocumentDefinitionRevisionClient({ enabled:true,
    rpc:async name => ({ data:name === 'read_document_definition_revision' ? current
      : name === 'preview_document_definition_revision_upgrade' ? wire : accepted }),
    getActorUserId:() => ACTOR_ID, isCurrent:() => true });
  const review = await client.preview({ documentId:DOCUMENT_ID,
    surveyTemplateId:NEXT_TEMPLATE_ID, entityTemplateId:NEXT_TEMPLATE_ID,
    archivedSemanticIds:[second], operationId:OPERATION_ID });
  const result = await client.apply({ review });
  assert.deepEqual(result.archivedSemanticIds, [second, first]);
});

test('a hung RPC exits on abort or deadline and removes the caller abort listener', async () => {
  let listener;
  let activeListeners = 0;
  const signal = {
    aborted:false,
    addEventListener(_name, value) { listener = value; activeListeners++; },
    removeEventListener(_name, value) {
      if (listener === value) { listener = null; activeListeners--; }
    },
  };
  const makeClient = requestTimeoutMs => createDocumentDefinitionRevisionClient({ enabled:true,
    requestTimeoutMs, rpc:async () => new Promise(() => {}),
    getActorUserId:() => ACTOR_ID, isCurrent:() => true });
  const aborted = makeClient(1000).readCurrent({ documentId:DOCUMENT_ID, signal });
  await new Promise(resolve => setImmediate(resolve));
  signal.aborted = true;
  listener();
  await assert.rejects(aborted,
    error => error.code === 'DOCUMENT_DEFINITION_REVISION_STALE');
  assert.equal(activeListeners, 0);

  await assert.rejects(makeClient(5).readCurrent({ documentId:DOCUMENT_ID }),
    error => error.code === 'DOCUMENT_DEFINITION_REVISION_UNAVAILABLE');
});
