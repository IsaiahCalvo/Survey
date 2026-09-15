import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentFirstGenerationAdoptionClient } from '../src/services/documentFirstGenerationAdoptionClient.js';
import { createDocumentFirstGenerationAdoptionIntentStore } from '../src/services/documentFirstGenerationAdoptionIntentStore.js';
import { documentFirstGenerationAdoptionBody,
  validateDocumentFirstGenerationAdoptionReceipt } from '../src/services/documentFirstGenerationAdoption.js';

const id = n => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), documentId = id(2);
const sha = char => char.repeat(64);
const ids = Object.freeze({ adoptionOperationId: id(3), sourceId: id(4),
  candidateOperationId: id(5), archiveOperationIds: Object.freeze([id(6), id(7)]) });
const base = (state = 'review', { sidecar = false } = {}) => ({ version: 1, state,
  actor_user_id: actor, owner_user_id: id(8), document_id: documentId,
  adoption_operation_id: ids.adoptionOperationId, source_id: ids.sourceId,
  candidate_operation_id: ids.candidateOperationId,
  offered_archive_operation_ids: [...ids.archiveOperationIds],
  used_archive_operation_ids: ids.archiveOperationIds.slice(0, sidecar ? 2 : 1),
  review_sha256: sha('a'), source_sql_sha256: sha('b'), wal_head: '4',
  objects: [{ kind: 'pdf', byte_length: '120', content_sha256: sha('c') },
    ...(sidecar ? [{ kind: 'sidecar', byte_length: '21', content_sha256: sha('d') }] : [])],
  canonical_annotations: { version: 1, policy: 'legacy-sql-v1', through_seq: '4',
    baseline_sha256: sha('e'), contributors: ['annotation-wal'] },
  entity_catalog: { status: 'accepted', revision: '2', content_sha256: sha('f') },
  survey_definition: { status: 'absent', revision: null, content_sha256: null },
  expires_at: '2026-09-16T12:00:00.000Z',
  ...(state === 'confirmed' || state === 'published'
    ? { confirmed_at: '2026-09-15T12:00:00.000Z' } : {}),
  ...(state === 'published' ? { generation_id: id(9), content_model_version: 2,
    pdf: { byte_length: '120', content_sha256: sha('c') },
    legacy_sidecar_migration: { version: 2, state: 'archived',
      origin: { mode: 'legacy', adoption_operation_id: ids.adoptionOperationId } },
    published_at: '2026-09-15T12:01:00.000Z' } : {}),
});

test('strict receipts accept blank canonical state and reject unknown, aliased, and unbounded input', () => {
  const blank = base();
  blank.canonical_annotations = { ...blank.canonical_annotations, through_seq: '0', contributors: [] };
  assert.equal(validateDocumentFirstGenerationAdoptionReceipt(blank).state, 'review');
  for (const invalid of [
    { ...base(), extra: true },
    { ...base(), wal_head: '9223372036854775808' },
    { ...base(), canonical_annotations: { ...base().canonical_annotations,
      contributors: ['annotation-wal', 'document-annotations'] } },
  ]) assert.throws(() => validateDocumentFirstGenerationAdoptionReceipt(invalid), {
    code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_PROTOCOL',
  });
  assert.throws(() => documentFirstGenerationAdoptionBody.preview({ ...ids,
    archiveOperationIds: [ids.sourceId, id(7)] }, documentId), {
    code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_INPUT',
  });
});

test('durable intent stores IDs before review, consent before confirm, and publication until install', async t => {
  const indexedDB = new IDBFactory();
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB });
  t.after(() => store.close());
  let row = (await store.reserve(actor, documentId, ids)).row;
  assert.equal(row.phase, 'reserved');
  row = await store.putReview(actor, documentId, row.revision, base());
  row = await store.markConsent(actor, documentId, row.revision, sha('a'));
  assert.equal(row.phase, 'consent');
  row = await store.putConfirmed(actor, documentId, row.revision, base('confirmed'));
  row = await store.putPublished(actor, documentId, row.revision, base('published'));
  assert.equal((await store.get(actor, documentId)).phase, 'published');
  store.close();
  const reopened = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB });
  t.after(() => reopened.close());
  assert.equal((await reopened.get(actor, documentId)).receipt.generation_id, id(9));
  await reopened.finish(actor, documentId, row.revision, ids.adoptionOperationId);
  assert.equal(await reopened.get(actor, documentId), null);
});

test('review sends no local capture as authority and confirm persists consent before HTTP', async t => {
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  let activeActor = actor, current = true, revalidations = 0, retired = 0, installed = 0;
  const calls = [];
  const transport = async ({ body, accessToken }) => {
    calls.push({ body, accessToken, phase: (await store.get(actor, documentId))?.phase });
    const saved = await store.get(actor, documentId);
    assert.equal(Object.hasOwn(body, 'actor_user_id'), false);
    assert.equal(Object.hasOwn(body, 'annotationState'), false);
    if (body.action === 'preview') return { ...base(), adoption_operation_id: saved.ids.adoptionOperationId,
      source_id: saved.ids.sourceId, candidate_operation_id: saved.ids.candidateOperationId,
      offered_archive_operation_ids: [...saved.ids.archiveOperationIds],
      used_archive_operation_ids: [saved.ids.archiveOperationIds[0]] };
    if (body.action === 'confirm') return { ...base('confirmed'),
      adoption_operation_id: saved.ids.adoptionOperationId, source_id: saved.ids.sourceId,
      candidate_operation_id: saved.ids.candidateOperationId,
      offered_archive_operation_ids: [...saved.ids.archiveOperationIds],
      used_archive_operation_ids: [saved.ids.archiveOperationIds[0]] };
    if (body.action === 'publish') return { ...base('published'),
      adoption_operation_id: saved.ids.adoptionOperationId, source_id: saved.ids.sourceId,
      candidate_operation_id: saved.ids.candidateOperationId,
      offered_archive_operation_ids: [...saved.ids.archiveOperationIds],
      used_archive_operation_ids: [saved.ids.archiveOperationIds[0]],
      legacy_sidecar_migration: { version: 2, state: 'archived',
        origin: { mode: 'legacy', adoption_operation_id: saved.ids.adoptionOperationId } } };
    throw new Error('unexpected action');
  };
  const client = createDocumentFirstGenerationAdoptionClient({ store, transport,
    getActorUserId: () => activeActor, getAccessToken: async () => 'token-a',
    isCurrent: () => current,
    reacquire: async () => {
      const saved = await store.get(actor, documentId), receipt = saved.receipt;
      return { mode: 'checked', actorUserId: actor, documentId,
        checkedBundle: { pdfGenerationId: receipt.generation_id, contentModelVersion: 2,
          pdf: { ...receipt.pdf }, legacy_sidecar_migration: receipt.legacy_sidecar_migration } };
    } });
  const reviewed = await client.review({ documentId,
    captureAccepted: async () => ({ localOnly: true }),
    revalidateCapture: async () => { revalidations++; return true; } });
  assert.equal(reviewed.row.phase, 'review');
  const result = await client.confirm({ documentId, reviewSha256: sha('a'),
    retireGeneration: async ({ replacementGenerationId }) => { assert.equal(replacementGenerationId, id(9)); retired++; },
    install: async () => { installed++; return true; } });
  assert.equal(result.publication.state, 'published');
  assert.equal(calls.find(call => call.body.action === 'preview').phase, 'reserved');
  assert.equal(calls.find(call => call.body.action === 'confirm').phase, 'consent');
  assert.deepEqual(calls.map(call => call.body.action), ['preview', 'confirm', 'publish']);
  assert.equal(revalidations, 1); assert.equal(retired, 1); assert.equal(installed, 1);
  assert.equal(await store.get(actor, documentId), null);
});

test('dirty capture and actor change preserve durable raw intent and do not publish', async t => {
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  let actorNow = actor, calls = 0;
  const client = createDocumentFirstGenerationAdoptionClient({ store,
    transport: async () => { calls++; return base(); }, getActorUserId: () => actorNow,
    getAccessToken: async () => 'token', isCurrent: ({ actorUserId }) => actorUserId === actorNow,
    reacquire: async () => null });
  await assert.rejects(client.review({ documentId, captureAccepted: async () => {
    throw Object.assign(new Error('pending edits'), { code: 'ANNOTATION_CAPTURE_NOT_READY' });
  }, revalidateCapture: async () => true }), { code: 'ANNOTATION_CAPTURE_NOT_READY' });
  assert.equal(calls, 0);
  assert.equal((await store.get(actor, documentId)).phase, 'reserved');
  actorNow = id(20);
  assert.equal((await client.resume({ documentId })).noIntent, true);
  assert.equal((await store.get(actor, documentId)).phase, 'reserved');
});

test('a local change after the server preview never leaves an actionable review', async t => {
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  let confirmCalls = 0, previewReturned = false;
  const receiptFor = async state => {
    const saved = await store.get(actor, documentId);
    return { ...base(state), adoption_operation_id: saved.ids.adoptionOperationId,
      source_id: saved.ids.sourceId, candidate_operation_id: saved.ids.candidateOperationId,
      offered_archive_operation_ids: [...saved.ids.archiveOperationIds],
      used_archive_operation_ids: [saved.ids.archiveOperationIds[0]],
      ...(state === 'published' ? { legacy_sidecar_migration: { version: 2, state: 'archived',
        origin: { mode: 'legacy', adoption_operation_id: saved.ids.adoptionOperationId } } } : {}) };
  };
  const client = createDocumentFirstGenerationAdoptionClient({ store,
    transport: async ({ body }) => {
      if (body.action === 'preview') {
        const receipt = await receiptFor('review');
        previewReturned = true;
        return receipt;
      }
      if (body.action === 'confirm') { confirmCalls++; return receiptFor('confirmed'); }
      return receiptFor('published');
    }, getActorUserId: () => actor, getAccessToken: async () => 'token',
    isCurrent: () => true, reacquire: async () => null });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(client.review({ documentId, captureAccepted: async () => ({}),
      revalidateCapture: async () => {
        assert.equal(previewReturned, true, 'the dirty check runs after preview');
        return false;
      } }), {
      code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_CONFLICT',
    });
    assert.equal((await store.get(actor, documentId)).phase, 'reserved');
    await assert.rejects(client.confirm({ documentId, reviewSha256: sha('a') }), {
      code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_CONFLICT',
    });
  }
  assert.equal(confirmCalls, 0);
  assert.equal((await client.review({ documentId, captureAccepted: async () => ({}),
    revalidateCapture: async () => true })).row.phase, 'review');
});

test('cold status review writes the lost preview locally without confirming it', async t => {
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  await store.reserve(actor, documentId, ids);
  const actions = [];
  const client = createDocumentFirstGenerationAdoptionClient({ store,
    transport: async ({ body }) => { actions.push(body.action); return base('review'); },
    getActorUserId: () => actor, getAccessToken: async () => 'token', isCurrent: () => true,
    reacquire: async () => null });
  const result = await client.resume({ documentId, retireGeneration: async () => {},
    install: async () => true });
  assert.equal(result.needsReview, true);
  assert.equal(result.row.phase, 'review');
  assert.equal((await store.get(actor, documentId)).receipt.review_sha256, sha('a'));
  assert.deepEqual(actions, ['status']);
});

test('a published receipt stays durable when checked reacquisition fails and never falls back', async t => {
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB: new IDBFactory() });
  t.after(() => store.close());
  let reacquires = 0, installs = 0;
  const client = createDocumentFirstGenerationAdoptionClient({ store,
    transport: async ({ body }) => {
      const saved = await store.get(actor, documentId);
      if (body.action === 'preview') return { ...base(), adoption_operation_id: saved.ids.adoptionOperationId,
        source_id: saved.ids.sourceId, candidate_operation_id: saved.ids.candidateOperationId,
        offered_archive_operation_ids: [...saved.ids.archiveOperationIds],
        used_archive_operation_ids: [saved.ids.archiveOperationIds[0]] };
      if (body.action === 'confirm') return { ...base('confirmed'), adoption_operation_id: saved.ids.adoptionOperationId,
        source_id: saved.ids.sourceId, candidate_operation_id: saved.ids.candidateOperationId,
        offered_archive_operation_ids: [...saved.ids.archiveOperationIds],
        used_archive_operation_ids: [saved.ids.archiveOperationIds[0]] };
      return { ...base('published'), adoption_operation_id: saved.ids.adoptionOperationId,
        source_id: saved.ids.sourceId, candidate_operation_id: saved.ids.candidateOperationId,
        offered_archive_operation_ids: [...saved.ids.archiveOperationIds],
        used_archive_operation_ids: [saved.ids.archiveOperationIds[0]],
        legacy_sidecar_migration: { version: 2, state: 'archived',
          origin: { mode: 'legacy', adoption_operation_id: saved.ids.adoptionOperationId } } };
    }, getActorUserId: () => actor, getAccessToken: async () => 'token', isCurrent: () => true,
    reacquire: async () => { reacquires++; return { mode: 'legacy', documentId }; } });
  const reviewed = await client.review({ documentId, captureAccepted: async () => ({}),
    revalidateCapture: async () => true });
  await assert.rejects(client.confirm({ documentId, reviewSha256: reviewed.row.receipt.review_sha256,
    retireGeneration: async () => {}, install: async () => { installs++; return true; } }),
  { code: 'DOCUMENT_FIRST_GENERATION_ADOPTION_STALE' });
  const retained = await store.get(actor, documentId);
  assert.equal(retained.phase, 'published');
  assert.equal(retained.receipt.generation_id, id(9));
  assert.equal(reacquires, 1);
  assert.equal(installs, 0);
});

test('a transport that ignores AbortSignal still stops at the client deadline', async t => {
  const store = createDocumentFirstGenerationAdoptionIntentStore({ indexedDB:new IDBFactory() });
  t.after(() => store.close());
  const never = new Promise(() => {});
  const client = createDocumentFirstGenerationAdoptionClient({ store,transport:async () => never,
    getActorUserId:() => actor,isCurrent:() => true,getAccessToken:async () => 'token',
    reacquire:async () => assert.fail('a timed out preview cannot reacquire'),responseTimeoutMs:5 });
  const started = Date.now();
  await assert.rejects(client.review({ documentId,captureAccepted:async () => ({}),
    revalidateCapture:async () => true }), {
    code:'DOCUMENT_FIRST_GENERATION_ADOPTION_UNCONFIRMED',
  });
  assert.ok(Date.now() - started < 1000);
  assert.equal((await store.get(actor, documentId)).phase, 'reserved');
});
