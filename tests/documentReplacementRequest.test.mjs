import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import * as Y from 'yjs';
import { syncByPageToDoc } from '../src/services/annotationDocStore.js';
import { initializeSurveyCrdtV2 } from '../src/services/documentSurveyCrdtV2.js';
import { createDocumentReplacementExecutor } from '../src/services/documentReplacementExecutor.js';
import { createDocumentReplacementRequestHandler } from '../src/services/documentReplacementRequest.js';

const id = n => `96100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), documentId = id(2), sourceId = id(3), candidateId = id(4), archiveId = id(5);
const sourceObjectId = id(6), sourceObjectVersion = id(7), generationId = id(8), publishedGenerationId = id(9);
const walHead = '9007199254740993';
const definitionRevision = '2';
const definitionDigest = 'e'.repeat(64);
const operation = Object.freeze({ type: 'move', from: 2, to: 1 });
const body = Object.freeze({ document_id: documentId, generation_id: null, wal_head: walHead,
  operation, source_id: sourceId, candidate_operation_id: candidateId, archive_operation_ids: [archiveId] });
const publication = Object.freeze({ version: 1, operation_id: candidateId, document_id: documentId,
  actor_user_id: actor, source_id: sourceId, generation_id: publishedGenerationId,
  previous_generation_id: null, plan_sha256: 'd'.repeat(64), wal_head: walHead,
  published_at: '2030-01-01T00:00:00.000Z' });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const future = '2030-01-02T00:00:00.000Z';

async function realSourceFixture({ sourceContentModelVersion = 1, checked = false,
  versioned = false } = {}) {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]); pdf.addPage([420, 600]); pdf.addPage([500, 700]);
  const bytes = new Uint8Array(await pdf.save());
  const ydoc = new Y.Doc();
  syncByPageToDoc(ydoc, { 2: { objects: [{ type: 'rect', pageNumber: 2, left: 10, top: 20,
    width: 30, height: 40, data: { id: 'request-mark', pageNumber: 2 }, meta: { authorId: actor } }] } });
  if (sourceContentModelVersion === 2) initializeSurveyCrdtV2(ydoc,
    { surveyMarkers: {}, spaces: [], createId: () => id(90) });
  const snapshot = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('base64'); ydoc.destroy();
  const sourceGenerationId = checked ? generationId : null;
  const sourceObject = { kind: 'pdf', bucket_id: 'documents', path: `${actor}/source/body.pdf`,
    id: sourceObjectId, version: sourceObjectVersion, byte_length: String(bytes.byteLength) };
  const { kind: _kind, ...sourceStorageObject } = sourceObject;
  const visible = { document: { id: documentId, user_id: actor, annotations: {}, page_count: 3,
    current_page: 2, content_sha256: 'a'.repeat(64), file_path: sourceObject.path,
    file_size: sourceObject.byte_length }, sources: { annotation_snapshot: { document_id: documentId,
      at_seq: walHead, writer_epoch: '1', encoding_version: 1, snapshot_base64: snapshot },
    annotation_updates: [], document_annotations: [], doc_yjs_state: null, doc_yjs_updates: [],
    survey_sessions: [], survey_items: [], active_generation: checked ? { baseline: {
      document_id: documentId, generation_id: sourceGenerationId, base_seq: walHead,
      baseline_snapshot_base64: snapshot, baseline_encoding_version: 1,
      content_model_version: sourceContentModelVersion }, snapshot: null, updates: [] } : null },
  compare: { wal_head: walHead, covered_head: walHead }, scope: 'sql-metadata-only' };
  const capture = { version: versioned ? 2 : 1,
    ...(versioned ? { content_model_version: sourceContentModelVersion } : {}),
    source_id: sourceId, actor_user_id: actor, document_id: documentId,
    generation_id: sourceGenerationId, state: 'captured', source_byte_state: 'unverified', source_sql_sha256: 'b'.repeat(64),
    wal_head: walHead, expires_at: future, source_object: { ...sourceObject }, sidecar_objects: [], visible_capture: visible };
  const attestation = state => ({ version: versioned ? 2 : 1,
    ...(versioned ? { content_model_version: sourceContentModelVersion } : {}),
    source_id: sourceId, actor_user_id: actor,
    document_id: documentId, generation_id: sourceGenerationId, source_sql_sha256: capture.source_sql_sha256,
    state, objects: [{ ...sourceObject, content_sha256: state === 'verified' ? hash(bytes) : null }],
    verified_at: state === 'verified' ? '2030-01-01T00:00:00.000Z' : null, expires_at: future });
  const envelope = { version: versioned ? 2 : 1,
    ...(versioned ? { content_model_version: sourceContentModelVersion } : {}),
    actor_user_id: actor, document_id: documentId, source_id: sourceId,
    generation_id: sourceGenerationId, source_sql_sha256: capture.source_sql_sha256, body_sha256: 'c'.repeat(64),
    wal_head: walHead, expires_at: future, source_bytes: attestation('verified'), payload: { semantic: {
      version: versioned ? 2 : 1,
      ...(versioned ? { content_model_version: sourceContentModelVersion } : {}),
      document_id: documentId, generation_id: sourceGenerationId, wal_head: walHead,
      document: visible.document, sources: { annotation_snapshot: checked ? null : visible.sources.annotation_snapshot,
        annotation_updates: [], document_annotations: [], doc_yjs_state: null, doc_yjs_updates: [],
        survey_sessions: [], survey_items: [], generation_snapshot: null, generation_updates: [],
        generation_baseline: checked ? visible.sources.active_generation.baseline : null },
      source_object: sourceStorageObject, sidecar_objects: [], connector_consumed: { head: [], ops: [] } },
    connector_history: { audit: [] }, wal_history: { legacy: [], generation: [] } } };
  return { bytes, sourceObject, capture, attestation, envelope };
}

function realClients(fixture, { alreadyVerified = false } = {}) {
  const calls = [], provider = new Map(), uploads = new Map();
  provider.set(fixture.sourceObject.path, fixture.bytes);
  const note = (name, work) => async (...args) => { calls.push({ name, args }); return work(...args); };
  const stream = value => new ReadableStream({ start(controller) {
    controller.enqueue(value.slice(0, Math.min(17, value.length)));
    controller.enqueue(value.slice(Math.min(17, value.length))); controller.close();
  } });
  const source = {
    begin: note('source.begin', async () => fixture.capture), get: note('source.get', async () => fixture.capture),
    beginV2: note('source.beginV2', async (_actor, _input, contentModelVersion) => {
      assert.equal(contentModelVersion, fixture.capture.content_model_version); return fixture.capture;
    }),
    getV2: note('source.getV2', async (_actor, _input, contentModelVersion) => {
      assert.equal(contentModelVersion, fixture.capture.content_model_version); return fixture.capture;
    }),
    cancel: note('source.cancel', async () => ({ ...fixture.capture, state: 'canceled', source_object: null,
      sidecar_objects: [], visible_capture: null })),
  };
  const verified = fixture.attestation('verified');
  const sourceBytes = {
    get: note('sourceBytes.get', async () => fixture.attestation(alreadyVerified ? 'verified' : 'unverified')),
    getV2: note('sourceBytes.getV2', async (_actor, _source, contentModelVersion) => {
      assert.equal(contentModelVersion, fixture.capture.content_model_version);
      return fixture.attestation(alreadyVerified ? 'verified' : 'unverified');
    }),
    claim: note('sourceBytes.claim', async () => ({ ...fixture.attestation('verifying'),
      verification_claim_id: id(70), verification_claim_expires_at: future })),
    claimV2: note('sourceBytes.claimV2', async (_actor, _source, _claim, contentModelVersion) => {
      assert.equal(contentModelVersion, fixture.capture.content_model_version);
      return { ...fixture.attestation('verifying'), verification_claim_id: id(70),
        verification_claim_expires_at: future };
    }),
    openStream: note('sourceBytes.openStream', async object => stream(provider.get(object.path))),
    record: note('sourceBytes.record', async () => verified), release: note('sourceBytes.release', async () => ({ released: true })),
    recordV2: note('sourceBytes.recordV2', async (_actor, _source, _claim, _objects, contentModelVersion) => {
      assert.equal(contentModelVersion, fixture.capture.content_model_version); return verified;
    }),
    newId: () => id(70),
  };
  const uploadState = new Map();
  const uploadReceipt = (operationId, kind, changes = {}) => {
    const archive = kind === 'archive', sourceBytes = archive ? fixture.bytes : uploads.get(operationId)?.expectedBytes;
    const digest = archive ? hash(fixture.bytes) : uploads.get(operationId)?.contentSha256;
    const length = archive ? String(fixture.bytes.byteLength) : uploads.get(operationId)?.byteLength;
    const path = `${actor}/_generations/${documentId}/${publishedGenerationId}/${operationId}.${archive ? 'bin' : 'pdf'}`;
    return { version: archive ? 3 : 2, operation_id: operationId, actor_user_id: actor, document_id: documentId,
      generation_id: publishedGenerationId, owner_user_id: actor, source_id: sourceId,
      purpose: archive ? 'source-object-archive' : 'candidate-pdf',
      expected_source_generation_id: fixture.capture.generation_id,
      ...(fixture.capture.version === 2 ? { content_model_version: fixture.capture.content_model_version } : {}),
      ...(archive ? { archived_source_object_id: sourceObjectId, source_object: { ...fixture.sourceObject,
        content_sha256: hash(fixture.bytes) } } : {}), path, content_sha256: digest,
      byte_length: length, source_sql_sha256: fixture.capture.source_sql_sha256, expires_at: future,
      state: 'reserved', upload_state: 'reserved', object: null, verified_at: null, rejection: null, ...changes };
  };
  const beginArchive = note('upload.beginArchive', async (_token, input) => {
    uploads.set(input.operation_id, { kind: 'archive', expectedBytes: fixture.bytes,
      contentSha256: hash(fixture.bytes), byteLength: String(fixture.bytes.byteLength) });
    const value = uploadReceipt(input.operation_id, 'archive'); uploadState.set(input.operation_id, value); return value;
  });
  const beginV2 = note('upload.beginV2', async (_token, input) => {
    uploads.set(input.operation_id, { kind: 'candidate', contentSha256: input.content_sha256,
      byteLength: input.byte_length });
    const value = uploadReceipt(input.operation_id, 'candidate'); uploadState.set(input.operation_id, value); return value;
  });
  const beginArchiveV2 = note('upload.beginArchiveV2', async (_token, input, contentModelVersion) => {
    assert.equal(contentModelVersion, fixture.capture.content_model_version);
    uploads.set(input.operation_id, { kind: 'archive', expectedBytes: fixture.bytes,
      contentSha256: hash(fixture.bytes), byteLength: String(fixture.bytes.byteLength) });
    const value = uploadReceipt(input.operation_id, 'archive'); uploadState.set(input.operation_id, value); return value;
  });
  const beginV3 = note('upload.beginV3', async (_token, input, contentModelVersion) => {
    assert.equal(contentModelVersion, fixture.capture.content_model_version);
    uploads.set(input.operation_id, { kind: 'candidate', contentSha256: input.content_sha256,
      byteLength: input.byte_length });
    const value = uploadReceipt(input.operation_id, 'candidate'); uploadState.set(input.operation_id, value); return value;
  });
  const upload = { begin: forbidden('upload.begin'), beginV2, beginV3, beginArchive, beginArchiveV2,
    get: note('upload.get', async (_token, operationId) => uploadState.get(operationId)),
    mint: note('upload.mint', async path => ({ path, token: 'signed-secret', signedUrl: `https://local.invalid/${path}` })),
    cancel: note('upload.cancel', async () => assert.fail('unexpected cancel')),
    claim: note('upload.claim', async (_actor, operationId, claimId) => {
      const prior = uploadState.get(operationId), object = { id: id(operationId === archiveId ? 81 : 82),
        version: id(operationId === archiveId ? 83 : 84), byte_length: prior.byte_length };
      const value = { ...prior, object, verification_claim_id: claimId }; uploadState.set(operationId, value); return value;
    }),
    openStream: note('upload.openStream', async path => stream(provider.get(path))),
    record: note('upload.record', async (_actor, operationId, _claim, objectId, version) => {
      const prior = uploadState.get(operationId), value = { ...prior, state: 'verified', upload_state: 'verified',
        object: { id: objectId, version, byte_length: prior.byte_length }, verified_at: '2030-01-01T00:00:00.000Z' };
      uploadState.set(operationId, value); return value;
    }), reject: forbidden('upload.reject'), release: note('upload.release', async () => ({ released: true })),
    newId: () => id(72),
  };
  const putSignedUpload = note('putSignedUpload', async ({ path }, blob) => {
    const value = new Uint8Array(await blob.arrayBuffer()); provider.set(path, value);
    const entry = [...uploadState.entries()].find(([, receipt]) => receipt.path === path);
    if (entry) uploads.get(entry[0]).expectedBytes = value;
  });
  return { calls, clients: { source, sourceBytes, upload }, putSignedUpload };
}

const forbidden = name => () => assert.fail(`unexpected ${name}`);
function serviceClients(overrides = {}) {
  const base = {
    source: { begin: forbidden('source.begin'), get: forbidden('source.get'), cancel: forbidden('source.cancel'),
      beginV2: forbidden('source.beginV2'), getV2: forbidden('source.getV2') },
    sourceBytes: { get: forbidden('sourceBytes.get'), claim: forbidden('sourceBytes.claim'),
      openStream: forbidden('sourceBytes.openStream'), record: forbidden('sourceBytes.record'),
      release: forbidden('sourceBytes.release'), getV2: forbidden('sourceBytes.getV2'),
      claimV2: forbidden('sourceBytes.claimV2'), recordV2: forbidden('sourceBytes.recordV2'),
      newId: () => id(70) },
    upload: { begin: forbidden('upload.begin'), beginV2: forbidden('upload.beginV2'),
      beginV3: forbidden('upload.beginV3'), beginArchive: forbidden('upload.beginArchive'),
      beginArchiveV2: forbidden('upload.beginArchiveV2'), get: forbidden('upload.get'), mint: forbidden('upload.mint'),
      cancel: forbidden('upload.cancel'), claim: forbidden('upload.claim'), openStream: forbidden('upload.openStream'),
      record: forbidden('upload.record'), reject: forbidden('upload.reject'), release: forbidden('upload.release'),
      newId: () => id(71) },
  };
  return { ...base, ...overrides, source: { ...base.source, ...overrides.source },
    sourceBytes: { ...base.sourceBytes, ...overrides.sourceBytes }, upload: { ...base.upload, ...overrides.upload } };
}

const journal = (state, changes = {}) => ({ version: 1, state, actor_user_id: actor,
  document_id: state === 'missing' ? null : documentId, source_id: sourceId, candidate_operation_id: candidateId,
  archive_operation_ids: [archiveId], expected_generation_id: null, expected_wal_head: walHead,
  prepared_at: state === 'missing' || state === 'untracked' ? null : '2030-01-01T00:00:00.000Z',
  expires_at: state === 'missing' || state === 'untracked' ? null : future,
  plan: null, publication: state === 'published' ? publication : null, ...changes });

const aggregatePublication = Object.freeze({ ...publication, version: 3, content_model_version: 2,
  aggregate_admission_version: 1 });
const aggregatePlan = (sourceContentModelVersion = 1) => ({ version: 3, contentModelVersion: 2,
  aggregateAdmissionVersion: 1, operationId: candidateId,
  source: { documentId, generationId: null, contentModelVersion: sourceContentModelVersion,
    walHead, sourceObject: { path: 'source/body.pdf' } },
  operation, projection: { document: {} }, baseline_base64: 'private-plan', legacy: { documentId } });
const aggregateJournal = (state, changes = {}) => ({ ...journal(state), version: 3,
  aggregate_admission_version: 1,
  publication: state === 'published' ? aggregatePublication : null, ...changes });
const definitionBody = Object.freeze({ ...body, generation_id: generationId,
  definition_revision: definitionRevision, definition_digest: definitionDigest });
const definitionPlan = (sourceContentModelVersion = 2) => ({ ...aggregatePlan(sourceContentModelVersion),
  version: 4, legacySidecarArchive: null,
  source: { ...aggregatePlan(sourceContentModelVersion).source, generationId } });
const definitionPublication = Object.freeze({ ...aggregatePublication, version: 5,
  previous_generation_id: generationId, offered_archive_operation_ids: [archiveId],
  used_archive_operation_ids: [archiveId], legacy_sidecar_migration: null,
  definition_revision: definitionRevision, definition_digest: definitionDigest });
const definitionJournal = (state, changes = {}) => {
  const { archive_operation_ids: _archives, ...base } = journal(state);
  return { ...base, version: 5, aggregate_admission_version: 1,
    document_id: state === 'missing' ? null : documentId,
    expected_generation_id: generationId, offered_archive_operation_ids: [archiveId],
    used_archive_operation_ids: state === 'missing' || state === 'untracked' ? null : [archiveId],
    definition_revision: definitionRevision, definition_digest: definitionDigest,
    publication: state === 'published' ? definitionPublication : null, ...changes };
};

const rpcResult = data => ({ data, error: null });
function harness({ rpc, getUser, clients, executor, putSignedUpload, ...options } = {}) {
  const calls = [];
  const privateRpc = async (...args) => {
    calls.push({ name: 'privateRpc', args });
    return (rpc ?? (async name => rpcResult(name === 'read_document_generation_replacement'
      ? journal('published') : assert.fail(`unexpected RPC ${name}`))))(...args);
  };
  const wrappedUser = async (...args) => {
    calls.push({ name: 'getUser', args });
    return (getUser ?? (async () => ({ id: actor })))(...args);
  };
  const handler = createDocumentReplacementRequestHandler({ enabled: true, getUser: wrappedUser,
    serviceClients: clients ?? serviceClients(), privateRpc,
    putSignedUpload: putSignedUpload ?? forbidden('putSignedUpload'),
    executor: executor ?? { prepare: forbidden('executor.prepare') }, timeoutMs: 10_000, ...options });
  return { calls, handler, async run(input = body, request = {}) {
    const response = await handler(new Request('https://local.invalid/replacement', { method: 'POST',
      headers: { Authorization: 'Bearer exact-token', 'Content-Type': 'application/json' },
      body: JSON.stringify(input), ...request }));
    return { status: response.status, value: response.status === 204 ? null : await response.json(), response };
  } };
}

const rpcNames = h => h.calls.filter(call => call.name === 'privateRpc').map(call => call.args[0]);
const expectedReadParams = { p_actor: actor, p_source: sourceId, p_candidate: candidateId,
  p_archives: [archiveId], p_expected_generation: null, p_expected_wal_head: walHead, p_operation: operation };
const expectedDefinitionParams = { ...expectedReadParams, p_expected_generation: generationId,
  p_expected_definition_revision: definitionRevision,
  p_expected_definition_digest: definitionDigest };
const expectedDefinitionReadParams = { ...expectedDefinitionParams, p_document: documentId };
const assertSafe = value => {
  const text = JSON.stringify(value);
  for (const secret of ['private-plan', 'private-token', 'signed-secret', 'source/body.pdf', 'baseline_base64'])
    assert.equal(text.includes(secret), false, `${secret} leaked`);
};
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject }; };
async function waitFor(check, timeout = 1000) {
  const end = Date.now() + timeout;
  while (!(await check())) { if (Date.now() >= end) assert.fail('timed out waiting for test phase'); await new Promise(resolve => setTimeout(resolve, 2)); }
}

test('public request accepts only POST, auth, the exact seven keys, and bounded scalar input before remote I/O', async () => {
  const invalid = [null, [], {}, { ...body, actor_user_id: actor }, { ...body, plan: {} },
    { ...body, bytes: 'private' }, { ...body, extra: true }, { ...body, document_id: 'bad' },
    { ...body, generation_id: 4 }, { ...body, wal_head: 4 }, { ...body, wal_head: '01' },
    { ...body, operation: { type: 'unknown' } }, { ...body, archive_operation_ids: [] },
    { ...body, archive_operation_ids: [archiveId, id(99)] }];
  for (const value of invalid) {
    const h = harness(); const result = await h.run(value);
    assert.equal(result.status, 400, JSON.stringify(value));
    assert.equal(result.value.error.code, 'invalid_request');
    assert.deepEqual(h.calls, []);
  }
  for (const raw of ['{', ' '.repeat(8193)]) {
    const h = harness(); const result = await h.run(body, { body: raw });
    assert.equal(result.status, 400); assert.deepEqual(h.calls, []);
  }
  const missing = harness(); const noAuth = await missing.run(body, { headers: { 'Content-Type': 'application/json' } });
  assert.equal(noAuth.status, 401); assert.equal(noAuth.value.error.code, 'unauthorized'); assert.deepEqual(missing.calls, []);
  const wrong = harness(); const wrongMethod = await wrong.run(body, { method: 'GET', body: undefined });
  assert.equal(wrongMethod.status, 405); assert.deepEqual(wrong.calls, []);
});

test('published journal replay fixes actor and exact intent, returns only the public receipt, and does no source work', async () => {
  const h = harness({ rpc: async (name, params) => {
    assert.equal(name, 'read_document_generation_replacement'); assert.deepEqual(params, expectedReadParams);
    return rpcResult(journal('published'));
  } });
  const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.value, { replacement: { version: 1, state: 'published', document_id: documentId,
    source_id: sourceId, candidate_operation_id: candidateId, archive_operation_ids: [archiveId],
    previous_generation_id: null, generation_id: publishedGenerationId, wal_head: walHead,
    published_at: publication.published_at } });
  assert.deepEqual(rpcNames(h), ['read_document_generation_replacement']); assertSafe(result.value);
});

test('published replay stays immutable after source expiry or a newer active generation outside this receipt', async () => {
  // Source expiry and a later active head are not fields in this immutable journal receipt.
  // Repeating the exact old request therefore must use only its stored publication.
  for (const stored of [journal('published'), journal('published')]) {
    const h = harness({ rpc: async () => rpcResult(stored) });
    const result = await h.run();
    assert.equal(result.status, 200); assert.deepEqual(rpcNames(h), ['read_document_generation_replacement']);
  }
});

test('aggregate cold published replay uses only v3 lookup even when the configured source model changed', async () => {
  for (const sourceContentModelVersion of [1, 2]) {
    const h = harness({ aggregateAdmissionVersion: 1, sourceContentModelVersion,
      rpc: async (name, params) => {
        assert.equal(name, 'read_document_generation_replacement_v3');
        assert.deepEqual(params, expectedReadParams);
        return rpcResult(aggregateJournal('published'));
      } });
    const result = await h.run();
    assert.equal(result.status, 200);
    assert.deepEqual(result.value.replacement, { version: 3, content_model_version: 2,
      aggregate_admission_version: 1, state: 'published', document_id: documentId,
      source_id: sourceId, candidate_operation_id: candidateId, archive_operation_ids: [archiveId],
      previous_generation_id: null, generation_id: publishedGenerationId, wal_head: walHead,
      published_at: publication.published_at });
    assert.deepEqual(rpcNames(h), ['read_document_generation_replacement_v3']);
  }
});

test('aggregate prepared replay validates source policy before the only v3 publish call', async () => {
  const plan = aggregatePlan(1);
  const exact = harness({ aggregateAdmissionVersion: 1, sourceContentModelVersion: 1,
    rpc: async (name, params) => {
      if (name === 'read_document_generation_replacement_v3') {
        assert.deepEqual(params, expectedReadParams);
        return rpcResult(aggregateJournal('prepared', { plan }));
      }
      assert.equal(name, 'publish_document_generation_v3');
      assert.deepEqual(params, { p_actor: actor, p_source: sourceId, p_candidate: candidateId,
        p_archives: [archiveId], p_plan: plan });
      return rpcResult(aggregatePublication);
    } });
  assert.equal((await exact.run()).status, 200);
  assert.deepEqual(rpcNames(exact), ['read_document_generation_replacement_v3',
    'publish_document_generation_v3']);

  const mismatch = harness({ aggregateAdmissionVersion: 1, sourceContentModelVersion: 2,
    rpc: async name => {
      assert.equal(name, 'read_document_generation_replacement_v3');
      return rpcResult(aggregateJournal('prepared', { plan }));
    } });
  const rejected = await mismatch.run();
  assert.equal(rejected.status, 502);
  assert.equal(rejected.value.error.code, 'invalid_receipt');
  assert.deepEqual(rpcNames(mismatch), ['read_document_generation_replacement_v3']);
});

test('definition-bound published replay returns the exact tuple through V5 only', async () => {
  const h = harness({ aggregateAdmissionVersion: 1, sourceContentModelVersion: 2,
    legacySidecarArchiveVersion: 1, definitionBindingVersion: 1,
    rpc: async (name, params) => {
      assert.equal(name, 'read_document_generation_replacement_v5');
      assert.deepEqual(params, expectedDefinitionReadParams);
      return rpcResult(definitionJournal('published'));
    } });
  const result = await h.run(definitionBody);
  assert.equal(result.status, 200, JSON.stringify(result.value));
  assert.deepEqual(result.value.replacement, {
    version: 5, content_model_version: 2, aggregate_admission_version: 1,
    state: 'published', document_id: documentId, source_id: sourceId,
    candidate_operation_id: candidateId, archive_operation_ids: [archiveId],
    definition_revision: definitionRevision, definition_digest: definitionDigest,
    offered_archive_operation_ids: [archiveId], used_archive_operation_ids: [archiveId],
    legacy_sidecar_migration: null, previous_generation_id: generationId,
    generation_id: publishedGenerationId, wal_head: walHead,
    published_at: publication.published_at,
  });
  assert.deepEqual(rpcNames(h), ['read_document_generation_replacement_v5']);
  assertSafe(result.value);
});

test('definition-bound prepared replay publishes the stored V4 plan through V5 only', async () => {
  const plan = definitionPlan(2);
  const h = harness({ aggregateAdmissionVersion: 1, sourceContentModelVersion: 2,
    legacySidecarArchiveVersion: 1, definitionBindingVersion: 1,
    rpc: async (name, params) => {
      if (name === 'read_document_generation_replacement_v5') {
        assert.deepEqual(params, expectedDefinitionReadParams);
        return rpcResult(definitionJournal('prepared', { plan }));
      }
      assert.equal(name, 'publish_document_generation_v5');
      assert.deepEqual(params, { p_actor: actor, p_source: sourceId, p_candidate: candidateId,
        p_archives: [archiveId], p_plan: plan,
        p_expected_definition_revision: definitionRevision,
        p_expected_definition_digest: definitionDigest });
      return rpcResult(definitionPublication);
    } });
  const result = await h.run(definitionBody);
  assert.equal(result.status, 200, JSON.stringify(result.value));
  assert.deepEqual(rpcNames(h), ['read_document_generation_replacement_v5',
    'publish_document_generation_v5']);
});

test('definition binding rejects malformed or changed tuples without legacy fallback', async () => {
  const bound = patch => harness({ aggregateAdmissionVersion: 1, sourceContentModelVersion: 2,
    legacySidecarArchiveVersion: 1, definitionBindingVersion: 1, ...patch });
  for (const input of [
    body,
    { ...definitionBody, definition_revision: 2 },
    { ...definitionBody, definition_revision: '02' },
    { ...definitionBody, definition_revision: '0' },
    { ...definitionBody, definition_revision: '9007199254740992' },
    { ...definitionBody, definition_digest: 'E'.repeat(64) },
    { ...definitionBody, definition_digest: ['e'.repeat(64)] },
    { ...definitionBody, definition_digest: { value: 'e'.repeat(64) } },
    { ...definitionBody, definition_digest: null },
    { ...definitionBody, definition_digest: 1 },
  ]) {
    const h = bound();
    const result = await h.run(input);
    assert.equal(result.status, 400, JSON.stringify(result.value));
    assert.deepEqual(rpcNames(h), []);
    assert.equal(h.calls.some(call => call.name === 'getUser'), false);
  }

  for (const changed of [
    { definition_revision: '3' },
    { definition_digest: 'f'.repeat(64) },
    { publication: { ...definitionPublication, definition_revision: '3' } },
    { publication: { ...definitionPublication, definition_digest: 'f'.repeat(64) } },
  ]) {
    const h = bound({ rpc: async name => {
      assert.equal(name, 'read_document_generation_replacement_v5');
      return rpcResult(definitionJournal('published', changed));
    } });
    const result = await h.run(definitionBody);
    assert.equal(result.status, 502, JSON.stringify(result.value));
    assert.deepEqual(rpcNames(h), ['read_document_generation_replacement_v5']);
  }

  for (const code of ['40001', '23505']) {
    const conflict = bound({ rpc: async name => {
      assert.equal(name, 'read_document_generation_replacement_v5');
      return { data: null, error: { code } };
    } });
    assert.equal((await conflict.run(definitionBody)).status, 409);
    assert.deepEqual(rpcNames(conflict), ['read_document_generation_replacement_v5']);
  }

  const otherDocumentId = id(12);
  const crossDocument = bound({ rpc: async (name, params) => {
    assert.equal(name, 'read_document_generation_replacement_v5');
    assert.deepEqual(params, { ...expectedDefinitionReadParams, p_document: otherDocumentId });
    return { data: null, error: { code: '23505' } };
  } });
  const crossDocumentResult = await crossDocument.run({ ...definitionBody, document_id: otherDocumentId });
  assert.equal(crossDocumentResult.status, 409);
  assert.equal(crossDocumentResult.value.error.code, 'replacement_conflict');
  assert.deepEqual(rpcNames(crossDocument), ['read_document_generation_replacement_v5']);
});

test('aggregate policy and receipts fail closed without legacy lookup or publish fallback', async () => {
  for (const patch of [
    { aggregateAdmissionVersion: 1 },
    { sourceContentModelVersion: 1 },
    { aggregateAdmissionVersion: 2, sourceContentModelVersion: 1 },
    { aggregateAdmissionVersion: 1, sourceContentModelVersion: 3 },
    { definitionBindingVersion: 1 },
    { aggregateAdmissionVersion: 1, sourceContentModelVersion: 1, definitionBindingVersion: 1 },
    { aggregateAdmissionVersion: 1, sourceContentModelVersion: 1,
      legacySidecarArchiveVersion: 1, definitionBindingVersion: 2 },
  ]) assert.throws(() => harness(patch), { code: 'DOCUMENT_REPLACEMENT_REQUEST_INPUT' });

  for (const stored of [
    aggregateJournal('published', { aggregate_admission_version: 2 }),
    aggregateJournal('published', { publication: { ...aggregatePublication, content_model_version: 1 } }),
    aggregateJournal('prepared', { plan: { ...aggregatePlan(1), aggregateAdmissionVersion: 2 } }),
  ]) {
    const h = harness({ aggregateAdmissionVersion: 1, sourceContentModelVersion: 1,
      rpc: async name => {
        assert.equal(name, 'read_document_generation_replacement_v3');
        return rpcResult(stored);
      } });
    const result = await h.run();
    assert.notEqual(result.status, 200);
    assert.deepEqual(rpcNames(h), ['read_document_generation_replacement_v3']);
  }
  const failed = harness({ aggregateAdmissionVersion: 1, sourceContentModelVersion: 1,
    rpc: async name => {
      assert.equal(name, 'read_document_generation_replacement_v3');
      return { data: null, error: { code: 'SG003' } };
    } });
  const result = await failed.run();
  assert.equal(result.status, 409);
  assert.equal(result.value.error.code, 'replacement_conflict');
  assert.deepEqual(rpcNames(failed), ['read_document_generation_replacement_v3']);
});

test('mismatched journal and publication identities never become a success receipt', async () => {
  for (const change of [{ document_id: id(40) }, { source_id: id(41) }, { actor_user_id: id(42) },
    { publication: { ...publication, operation_id: id(43) } },
    { publication: { ...publication, actor_user_id: id(45) } },
    { publication: { ...publication, document_id: id(46) } },
    { publication: { ...publication, source_id: id(47) } },
    { publication: { ...publication, previous_generation_id: id(44) } },
    { publication: { ...publication, wal_head: '9007199254740994' } }]) {
    const h = harness({ rpc: async () => rpcResult(journal('published', change)) });
    const result = await h.run(); assert.notEqual(result.status, 200); assertSafe(result.value);
    assert.deepEqual(rpcNames(h), ['read_document_generation_replacement']);
  }
});

test('prepared replay publishes the exact stored plan without reading source, rendering, or staging again', async () => {
  const plan = { version: 1, operationId: candidateId,
    source: { documentId, generationId: null, walHead, sourceObject: { path: 'source/body.pdf' } },
    operation, projection: { document: {} }, baseline_base64: 'private-plan', legacy: { documentId } };
  const h = harness({ rpc: async (name, params) => {
    if (name === 'read_document_generation_replacement') return rpcResult(journal('prepared', { plan }));
    assert.equal(name, 'publish_document_generation');
    assert.deepEqual(params, { p_actor: actor, p_source: sourceId, p_candidate: candidateId,
      p_archives: [archiveId], p_plan: plan });
    return rpcResult(publication);
  } });
  const result = await h.run();
  assert.equal(result.status, 200); assert.deepEqual(rpcNames(h),
    ['read_document_generation_replacement', 'publish_document_generation']);
  assertSafe(result.value);
});

test('untracked and changed same-candidate intents fail closed without source work or private output', async () => {
  for (const [state, expected] of [['untracked', 'replacement_conflict']]) {
    const h = harness({ rpc: async () => rpcResult(journal(state)) });
    const result = await h.run(); assert.equal(result.status, 409); assert.equal(result.value.error.code, expected);
    assert.deepEqual(rpcNames(h), ['read_document_generation_replacement']); assertSafe(result.value);
  }
  const h = harness({ rpc: async () => rpcResult(journal('published', { actor_user_id: id(44) })) });
  const result = await h.run(); assert.equal(result.status, 409); assert.equal(result.value.error.code, 'replacement_conflict');
  assertSafe(result.value);
});

test('only an exact authenticated expired journal returns bounded terminal recovery proof', async () => {
  const h = harness({ rpc: async (name, params) => {
    assert.equal(name, 'read_document_generation_replacement');
    assert.deepEqual(params, expectedReadParams);
    return rpcResult(journal('expired'));
  } });
  const result = await h.run();
  assert.equal(result.status, 409);
  assert.deepEqual(Object.keys(result.value).sort(), ['error', 'terminal']);
  assert.equal(result.value.error.code, 'replacement_expired');
  assert.deepEqual(result.value.terminal, {
    version: 1,
    state: 'expired',
    actor_user_id: actor,
    document_id: documentId,
    source_id: sourceId,
    candidate_operation_id: candidateId,
    archive_operation_ids: [archiveId],
    expected_generation_id: null,
    expected_wal_head: walHead,
    operation,
    prepared_at: '2030-01-01T00:00:00.000Z',
    expires_at: future,
  });
  assert.deepEqual(rpcNames(h), ['read_document_generation_replacement']);
  assertSafe(result.value);
});

test('generic expired errors and non-expired conflict states never mint terminal recovery proof', async () => {
  const cases = [
    async () => rpcResult(journal('untracked')),
    async () => ({ data: null, error: { code: 'expired', message: 'expired request' } }),
  ];
  for (const rpc of cases) {
    const h = harness({ rpc });
    const result = await h.run();
    assert.equal(result.status, 409);
    assert.equal(result.value.error.code, 'replacement_conflict');
    assert.equal(Object.hasOwn(result.value, 'terminal'), false);
    assertSafe(result.value);
  }
  const ambiguous = harness({ rpc: async () => { throw new Error('expired request'); } });
  const result = await ambiguous.run();
  assert.equal(result.status, 502);
  assert.equal(Object.hasOwn(result.value, 'terminal'), false);
  assertSafe(result.value);
});

test('mismatched expired journal identity never becomes terminal reset authority', async () => {
  for (const [change, status, code] of [
    [{ actor_user_id: id(40) }, 409, 'replacement_conflict'],
    [{ document_id: id(41) }, 502, 'invalid_receipt'],
    [{ source_id: id(42) }, 409, 'replacement_conflict'],
    [{ candidate_operation_id: id(43) }, 409, 'replacement_conflict'],
    [{ archive_operation_ids: [id(44)] }, 409, 'replacement_conflict'],
    [{ expected_generation_id: id(45) }, 409, 'replacement_conflict'],
    [{ expected_wal_head: '9007199254740994' }, 409, 'replacement_conflict'],
  ]) {
    const h = harness({ rpc: async () => rpcResult(journal('expired', change)) });
    const result = await h.run();
    assert.equal(result.status, status, JSON.stringify(change));
    assert.equal(result.value.error.code, code, JSON.stringify(change));
    assert.equal(Object.hasOwn(result.value, 'terminal'), false);
    assertSafe(result.value);
  }
});

for (const alreadyVerified of [false, true]) test(`missing journal uses real handlers and worker with one source transfer (${alreadyVerified ? 'verified recovery' : 'new byte proof'})`, async () => {
  const fixture = await realSourceFixture();
  const boundary = realClients(fixture, { alreadyVerified });
  for (const client of Object.values(boundary.clients)) client.contentModelVersion = 2;
  Object.assign(boundary.clients.source, {
    beginV2: forbidden('source.beginV2'), getV2: forbidden('source.getV2'),
  });
  Object.assign(boundary.clients.sourceBytes, {
    getV2: forbidden('sourceBytes.getV2'), claimV2: forbidden('sourceBytes.claimV2'),
    recordV2: forbidden('sourceBytes.recordV2'),
  });
  Object.assign(boundary.clients.upload, {
    beginV3: forbidden('upload.beginV3'), beginArchiveV2: forbidden('upload.beginArchiveV2'),
  });
  const executor = createDocumentReplacementExecutor({ timeoutMs: 120_000 });
  let preparedPlan;
  const h = harness({ clients: boundary.clients, putSignedUpload: boundary.putSignedUpload, executor,
    rpc: async (name, params) => {
      if (name === 'read_document_generation_replacement') return rpcResult(journal('missing'));
      if (name === 'read_document_generation_transform_source') {
        assert.deepEqual(params, { p_actor_user_id: actor, p_source_id: sourceId }); return rpcResult(fixture.envelope);
      }
      if (name === 'prepare_document_generation_replacement') {
        assert.deepEqual(Object.keys(params).sort(), [...Object.keys(expectedReadParams), 'p_plan'].sort());
        assert.deepEqual(Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'p_plan')), expectedReadParams);
        preparedPlan = structuredClone(params.p_plan);
        return rpcResult(journal('prepared', { plan: preparedPlan }));
      }
      if (name === 'publish_document_generation') {
        assert.deepEqual(params, { p_actor: actor, p_source: sourceId, p_candidate: candidateId,
          p_archives: [archiveId], p_plan: preparedPlan }); return rpcResult(publication);
      }
      assert.fail(`unexpected RPC ${name}`);
    } });
  try {
    const result = await h.run();
    assert.equal(result.status, 200, JSON.stringify({ value: result.value,
      boundary: boundary.calls.map(call => call.name), rpc: rpcNames(h) }));
    assert.equal(result.value.replacement.state, 'published');
    assert.deepEqual(rpcNames(h), ['read_document_generation_replacement',
      'read_document_generation_transform_source', 'prepare_document_generation_replacement',
      'publish_document_generation']);
    assert.equal(boundary.calls.filter(call => call.name === 'sourceBytes.openStream').length, 1,
      'the exact source PDF crosses the provider boundary once');
    assert.deepEqual(boundary.calls.filter(call => call.name === 'putSignedUpload').map(call => call.args[0].path),
      [`${actor}/_generations/${documentId}/${publishedGenerationId}/${archiveId}.bin`,
        `${actor}/_generations/${documentId}/${publishedGenerationId}/${candidateId}.pdf`]);
    const archiveBlob = boundary.calls.find(call => call.name === 'putSignedUpload'
      && call.args[0].path.endsWith('.bin')).args[1];
    const archiveBytes = new Uint8Array(await archiveBlob.arrayBuffer());
    assert.deepEqual(archiveBytes, fixture.bytes); assert.equal(hash(archiveBytes), hash(fixture.bytes));
    const candidateBlob = boundary.calls.find(call => call.name === 'putSignedUpload'
      && call.args[0].path.endsWith('.pdf')).args[1];
    const loaded = await PDFDocument.load(await candidateBlob.arrayBuffer());
    assert.deepEqual(loaded.getPages().map(page => page.getWidth()), [420, 612, 500]);
    assertSafe(result.value);
  } finally { await executor.close(); await executor.close(); }
});

for (const sourceContentModelVersion of [1, 2]) test(`aggregate missing journal composes checked model ${sourceContentModelVersion} through real handlers and worker`, async () => {
  const fixture = await realSourceFixture({ sourceContentModelVersion, checked: true, versioned: true });
  const boundary = realClients(fixture);
  const executor = createDocumentReplacementExecutor({ timeoutMs: 120_000 });
  const checkedBody = { ...body, generation_id: generationId };
  const checkedParams = { ...expectedReadParams, p_expected_generation: generationId };
  const published = { ...aggregatePublication, previous_generation_id: generationId };
  const savedJournal = (state, changes = {}) => ({ ...aggregateJournal(state),
    expected_generation_id: generationId,
    publication: state === 'published' ? published : null,
    ...changes });
  let savedPlan;
  const h = harness({ clients: boundary.clients, putSignedUpload: boundary.putSignedUpload, executor,
    aggregateAdmissionVersion: 1, sourceContentModelVersion,
    rpc: async (name, params) => {
      if (name === 'read_document_generation_replacement_v3') {
        assert.deepEqual(params, checkedParams); return rpcResult(savedJournal('missing'));
      }
      if (name === 'read_document_generation_transform_source_v2') {
        assert.deepEqual(params, { p_actor_user_id: actor, p_source_id: sourceId,
          p_content_model_version: sourceContentModelVersion });
        return rpcResult(fixture.envelope);
      }
      if (name === 'prepare_document_generation_replacement_v3') {
        assert.deepEqual(Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'p_plan')),
          checkedParams);
        savedPlan = structuredClone(params.p_plan);
        assert.deepEqual(Object.keys(savedPlan).sort(), ['version', 'contentModelVersion',
          'aggregateAdmissionVersion', 'operationId', 'source', 'operation', 'projection',
          'baseline_base64', 'legacy'].sort());
        assert.equal(savedPlan.version, 3);
        assert.equal(savedPlan.contentModelVersion, 2);
        assert.equal(savedPlan.aggregateAdmissionVersion, 1);
        assert.equal(savedPlan.source.contentModelVersion, sourceContentModelVersion);
        return rpcResult(savedJournal('prepared', { plan: savedPlan }));
      }
      if (name === 'publish_document_generation_v3') {
        assert.deepEqual(params, { p_actor: actor, p_source: sourceId, p_candidate: candidateId,
          p_archives: [archiveId], p_plan: savedPlan });
        return rpcResult(published);
      }
      assert.fail(`unexpected RPC ${name}`);
    } });
  try {
    const result = await h.run(checkedBody);
    assert.equal(result.status, 200, JSON.stringify(result.value));
    assert.deepEqual(rpcNames(h), ['read_document_generation_replacement_v3',
      'read_document_generation_transform_source_v2',
      'prepare_document_generation_replacement_v3', 'publish_document_generation_v3']);
    const called = boundary.calls.map(call => call.name);
    for (const name of ['source.beginV2', 'sourceBytes.getV2', 'sourceBytes.claimV2',
      'sourceBytes.recordV2', 'upload.beginArchiveV2', 'upload.beginV3']) assert.ok(called.includes(name), name);
    for (const name of ['source.begin', 'sourceBytes.get', 'sourceBytes.claim',
      'sourceBytes.record', 'upload.beginArchive', 'upload.beginV2']) assert.equal(called.includes(name), false, name);
  } finally { await executor.close(); }
});

for (const sourceContentModelVersion of [1, 2]) test(`definition-bound missing journal composes checked model ${sourceContentModelVersion} through V5 only`, async () => {
  const fixture = await realSourceFixture({ sourceContentModelVersion, checked: true, versioned: true });
  const boundary = realClients(fixture);
  const executor = createDocumentReplacementExecutor({ timeoutMs: 120_000 });
  let savedPlan;
  const h = harness({ clients: boundary.clients, putSignedUpload: boundary.putSignedUpload, executor,
    aggregateAdmissionVersion: 1, sourceContentModelVersion, legacySidecarArchiveVersion: 1,
    definitionBindingVersion: 1,
    rpc: async (name, params) => {
      if (name === 'read_document_generation_replacement_v5') {
        assert.deepEqual(params, expectedDefinitionReadParams);
        return rpcResult(definitionJournal('missing'));
      }
      if (name === 'read_document_generation_transform_source_v2') {
        assert.deepEqual(params, { p_actor_user_id: actor, p_source_id: sourceId,
          p_content_model_version: sourceContentModelVersion });
        return rpcResult(fixture.envelope);
      }
      if (name === 'prepare_document_generation_replacement_v5') {
        assert.deepEqual(Object.fromEntries(Object.entries(params).filter(([key]) => key !== 'p_plan')),
          expectedDefinitionParams);
        savedPlan = structuredClone(params.p_plan);
        assert.deepEqual(Object.keys(savedPlan).sort(), ['version', 'contentModelVersion',
          'aggregateAdmissionVersion', 'legacySidecarArchive', 'operationId', 'source',
          'operation', 'projection', 'baseline_base64', 'legacy'].sort());
        assert.equal(savedPlan.version, 4);
        assert.equal(savedPlan.contentModelVersion, 2);
        assert.equal(savedPlan.aggregateAdmissionVersion, 1);
        assert.equal(savedPlan.legacySidecarArchive, null);
        assert.equal(savedPlan.source.contentModelVersion, sourceContentModelVersion);
        return rpcResult(definitionJournal('prepared', { plan: savedPlan }));
      }
      if (name === 'publish_document_generation_v5') {
        assert.deepEqual(params, { p_actor: actor, p_source: sourceId, p_candidate: candidateId,
          p_archives: [archiveId], p_plan: savedPlan,
          p_expected_definition_revision: definitionRevision,
          p_expected_definition_digest: definitionDigest });
        return rpcResult(definitionPublication);
      }
      assert.fail(`unexpected RPC ${name}`);
    } });
  try {
    const result = await h.run(definitionBody);
    assert.equal(result.status, 200, JSON.stringify(result.value));
    assert.equal(result.value.replacement.definition_revision, definitionRevision);
    assert.equal(result.value.replacement.definition_digest, definitionDigest);
    assert.deepEqual(rpcNames(h), ['read_document_generation_replacement_v5',
      'read_document_generation_transform_source_v2',
      'prepare_document_generation_replacement_v5', 'publish_document_generation_v5']);
    assert.equal(rpcNames(h).some(name => /_v[34]$/.test(name)), false);
  } finally { await executor.close(); }
});

test('publish lost response returns an unconfirmed same-ID result, and journal replay never renders again', async () => {
  const plan = { version: 1, operationId: candidateId,
    source: { documentId, generationId: null, walHead, sourceObject: { path: 'source/body.pdf' } },
    operation, projection: { document: {} }, baseline_base64: 'private-plan', legacy: { documentId } };
  const publishGate = deferred(); let reads = 0, publishes = 0;
  const h = harness({ maxConcurrent: 2, rpc: async name => {
    if (name === 'read_document_generation_replacement') return rpcResult(++reads === 1
      ? journal('prepared', { plan }) : journal('published'));
    if (name === 'publish_document_generation') { publishes++; return publishGate.promise; }
    assert.fail(`unexpected RPC ${name}`);
  } });
  const controller = new AbortController(); const first = h.run(body, { signal: controller.signal });
  await waitFor(() => publishes === 1); controller.abort();
  const uncertain = await first;
  assert.equal(uncertain.status, 503); assert.equal(uncertain.value.error.code, 'replacement_unconfirmed');
  assert.deepEqual(uncertain.value.intent, { document_id: documentId, source_id: sourceId,
    candidate_operation_id: candidateId, archive_operation_ids: [archiveId] }); assertSafe(uncertain.value);
  const recovered = await h.run(); assert.equal(recovered.status, 200);
  assert.equal(recovered.value.replacement.generation_id, publishedGenerationId);
  assert.equal(publishes, 1, 'a same-ID journal replay must not retry an uncertain publish or render');
  publishGate.resolve(rpcResult(publication));
});

test('aggregate publish lost response recovers only from the same v3 journal intent', async () => {
  const plan = aggregatePlan(1), publishGate = deferred();
  let reads = 0, publishes = 0;
  const h = harness({ maxConcurrent: 2, aggregateAdmissionVersion: 1, sourceContentModelVersion: 1,
    rpc: async name => {
      if (name === 'read_document_generation_replacement_v3') return rpcResult(++reads === 1
        ? aggregateJournal('prepared', { plan }) : aggregateJournal('published'));
      if (name === 'publish_document_generation_v3') { publishes++; return publishGate.promise; }
      assert.fail(`unexpected RPC ${name}`);
    } });
  const controller = new AbortController();
  const first = h.run(body, { signal: controller.signal });
  await waitFor(() => publishes === 1); controller.abort();
  const uncertain = await first;
  assert.equal(uncertain.status, 503);
  assert.equal(uncertain.value.error.code, 'replacement_unconfirmed');
  const recovered = await h.run();
  assert.equal(recovered.status, 200);
  assert.equal(recovered.value.replacement.version, 3);
  assert.equal(publishes, 1);
  assert.deepEqual(rpcNames(h), ['read_document_generation_replacement_v3',
    'publish_document_generation_v3', 'read_document_generation_replacement_v3']);
  publishGate.resolve(rpcResult(aggregatePublication));
});

test('request admission rejects excess valid work before auth and holds capacity until a late provider read settles', async () => {
  const fixture = await realSourceFixture(), boundary = realClients(fixture);
  const readGate = deferred(); let readStarted = false;
  boundary.clients.sourceBytes.openStream = async () => {
    const value = new ReadableStream();
    Object.defineProperty(value, 'getReader', { value: () => ({
      read() { readStarted = true; return readGate.promise; },
      async cancel() {}, releaseLock() {},
    }) });
    return value;
  };
  let journalReads = 0;
  const h = harness({ clients: boundary.clients, putSignedUpload: boundary.putSignedUpload,
    maxConcurrent: 1, rpc: async name => {
      if (name === 'read_document_generation_replacement') return rpcResult(++journalReads === 1
        ? journal('missing') : journal('published'));
      assert.fail(`unexpected RPC ${name}`);
    } });
  const controller = new AbortController(); const first = h.run(body, { signal: controller.signal });
  await waitFor(() => readStarted); controller.abort();
  const uncertain = await first; assert.equal(uncertain.value.error.code, 'replacement_unconfirmed');
  const beforeAuth = h.calls.filter(call => call.name === 'getUser').length;
  const busy = await h.run(); assert.equal(busy.status, 503); assert.equal(busy.value.error.code, 'replacement_busy');
  assert.equal(h.calls.filter(call => call.name === 'getUser').length, beforeAuth, 'busy work cannot authenticate');
  readGate.resolve({ done: true });
  let recovered;
  await waitFor(async () => {
    recovered = await h.run(); return recovered.value?.error?.code !== 'replacement_busy';
  });
  assert.equal(recovered.status, 200);
});

test('a stalled request body reaches its deadline without releasing admission before the read settles', async () => {
  const bodyGate = deferred(); let readStarted = false;
  const stream = new ReadableStream();
  Object.defineProperty(stream, 'getReader', { value: () => ({
    read() { readStarted = true; return bodyGate.promise; }, async cancel() {}, releaseLock() {},
  }) });
  const h = harness({ timeoutMs: 15, maxConcurrent: 1 });
  const stalled = h.run(body, { body: stream, duplex: 'half' });
  await waitFor(() => readStarted);
  const bounded = await Promise.race([stalled.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 100))]);
  assert.equal(bounded, true, 'request body wait must return at its deadline');
  const result = await stalled;
  assert.equal(result.status, 502, JSON.stringify(result.value));
  assert.equal(result.value.error.code, 'replacement_failed');
  const busy = await h.run(); assert.equal(busy.value.error.code, 'replacement_busy');
  bodyGate.resolve({ done: true });
});

test('factory bounds request capacity and timeout with one fixed configuration error', () => {
  const base = { enabled: true, getUser: async () => ({ id: actor }), serviceClients: serviceClients(),
    privateRpc: async () => rpcResult(journal('published')), putSignedUpload: forbidden('put'),
    executor: { prepare: forbidden('prepare') } };
  for (const patch of [null, { timeoutMs: 0 }, { timeoutMs: 2147483648 }, { maxConcurrent: 0 },
    { maxConcurrent: 17 }, { maxConcurrent: 1.5 }, { getUser: null }, { serviceClients: null }]) {
    assert.throws(() => createDocumentReplacementRequestHandler(patch === null ? patch : { ...base, ...patch }), error => {
      assert.equal(error.code, 'DOCUMENT_REPLACEMENT_REQUEST_INPUT');
      assert.deepEqual(Object.keys(error), ['code']); assert.ok(error.message.length < 120); return true;
    });
  }
});

test('account identity comes only from each bearer token and concurrent requests cannot cross actors', async () => {
  const actorB = id(60), seen = [];
  const h = harness({ maxConcurrent: 2, getUser: async token => ({ id: token === 'token-b' ? actorB : actor }),
    rpc: async (name, params) => {
      assert.equal(name, 'read_document_generation_replacement'); seen.push(params);
      return rpcResult({ ...journal('untracked'), actor_user_id: params.p_actor });
    } });
  const make = token => h.handler(new Request('https://local.invalid/replacement', { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  const results = await Promise.all([make('exact-token'), make('token-b')]);
  assert.deepEqual(results.map(result => result.status), [409, 409]);
  assert.deepEqual(new Set(seen.map(value => value.p_actor)), new Set([actor, actorB]));
  assert.ok(seen.every(value => value.p_candidate === candidateId && value.p_source === sourceId));
});

test('adapter failures and malformed private replies use fixed errors without private plan, path, token, or SQL text', async () => {
  const cases = [
    { status: 502, code: 'replacement_failed', rpc: async () => { throw new Error('private-token source/body.pdf SQL'); } },
    { status: 502, code: 'invalid_receipt', rpc: async () => ({ data: { future_private: 'private-token' }, error: null }) },
    { status: 502, code: 'invalid_receipt', rpc: async () => ({ data: null,
      error: { code: 'unknown', message: 'private-token source/body.pdf SQL' } }) },
  ];
  for (const entry of cases) {
    const h = harness({ rpc: entry.rpc }); const result = await h.run();
    assert.equal(result.status, entry.status); assert.equal(result.value.error.code, entry.code); assertSafe(result.value);
  }
});

test('a captured legacy sidecar is unsupported before byte reads, archive staging, or signed PUT', async () => {
  const fixture = await realSourceFixture(), boundary = realClients(fixture);
  boundary.clients.source.begin = async () => ({ ...fixture.capture, sidecar_objects: [{
    bucket_id: 'documents', path: `${actor}/source/legacy_annotations.json`, id: id(61),
    version: id(62), byte_length: '20' }] });
  const h = harness({ clients: boundary.clients, putSignedUpload: boundary.putSignedUpload,
    rpc: async name => rpcResult(name === 'read_document_generation_replacement'
      ? journal('missing') : assert.fail(`unexpected RPC ${name}`)) });
  const result = await h.run(); assert.equal(result.status, 409); assert.equal(result.value.error.code, 'unsupported_source');
  assert.equal(boundary.calls.some(call => call.name === 'sourceBytes.openStream'), false);
  assert.equal(boundary.calls.some(call => call.name === 'putSignedUpload'), false); assertSafe(result.value);
});

test('default local admission prevents a same-intent peer from duplicating source transfer, render, staging, or publication', async () => {
  const fixture = await realSourceFixture(), boundary = realClients(fixture), beginGate = deferred();
  const originalBegin = boundary.clients.source.begin; let beginStarted = false;
  boundary.clients.source.begin = async (...args) => { beginStarted = true; await beginGate.promise; return originalBegin(...args); };
  const concrete = createDocumentReplacementExecutor({ timeoutMs: 120_000 }); let renders = 0;
  const executor = { prepare(...args) { renders++; return concrete.prepare(...args); } };
  let reads = 0, storedPlan, commitDone = false, publishes = 0;
  const h = harness({ clients: boundary.clients, putSignedUpload: boundary.putSignedUpload,
    executor, maxConcurrent: 1, rpc: async (name, params) => {
      if (name === 'read_document_generation_replacement') {
        reads++; return rpcResult(reads === 1 ? journal('missing') : journal('published'));
      }
      if (name === 'read_document_generation_transform_source') return rpcResult(fixture.envelope);
      if (name === 'prepare_document_generation_replacement') {
        assert.equal(boundary.calls.filter(call => call.name === 'upload.record').length, 2,
          'both verified uploads must finish before the journal commit starts');
        storedPlan = structuredClone(params.p_plan); commitDone = true;
        return rpcResult(journal('prepared', { plan: storedPlan }));
      }
      if (name === 'publish_document_generation') {
        assert.equal(commitDone, true, 'journal commit must resolve before publication starts'); publishes++;
        assert.deepEqual(params.p_plan, storedPlan); return rpcResult(publication);
      }
      assert.fail(`unexpected RPC ${name}`);
    } });
  try {
    const first = h.run(); await waitFor(() => beginStarted);
    const peer = await h.run(); assert.equal(peer.status, 503); assert.equal(peer.value.error.code, 'replacement_busy');
    beginGate.resolve(); assert.equal((await first).status, 200);
    const recovered = await h.run(); assert.equal(recovered.status, 200);
    assert.equal(renders, 1); assert.equal(publishes, 1);
    assert.equal(boundary.calls.filter(call => call.name === 'sourceBytes.openStream').length, 1);
    assert.equal(boundary.calls.filter(call => call.name === 'putSignedUpload').length, 2);
  } finally { await concrete.close(); }
});

test('lost journal-commit response keeps admission, then prepared recovery publishes without another render or upload', async () => {
  const fixture = await realSourceFixture(), boundary = realClients(fixture), commitGate = deferred();
  const concrete = createDocumentReplacementExecutor({ timeoutMs: 120_000 }); let renders = 0, commitStarted = false;
  const executor = { prepare(...args) { renders++; return concrete.prepare(...args); } };
  let reads = 0, savedPlan, publishes = 0;
  const h = harness({ clients: boundary.clients, putSignedUpload: boundary.putSignedUpload,
    executor, maxConcurrent: 1, rpc: async (name, params) => {
      if (name === 'read_document_generation_replacement') return rpcResult(++reads === 1
        ? journal('missing') : journal('prepared', { plan: savedPlan }));
      if (name === 'read_document_generation_transform_source') return rpcResult(fixture.envelope);
      if (name === 'prepare_document_generation_replacement') {
        savedPlan = structuredClone(params.p_plan); commitStarted = true; return commitGate.promise;
      }
      if (name === 'publish_document_generation') { publishes++; return rpcResult(publication); }
      assert.fail(`unexpected RPC ${name}`);
    } });
  try {
    const controller = new AbortController(), first = h.run(body, { signal: controller.signal });
    await waitFor(() => commitStarted); controller.abort();
    const uncertain = await first; assert.equal(uncertain.value.error.code, 'replacement_unconfirmed');
    assert.equal((await h.run()).value.error.code, 'replacement_busy');
    commitGate.resolve(rpcResult(journal('prepared', { plan: savedPlan })));
    let recovered;
    await waitFor(async () => { recovered = await h.run(); return recovered.value?.error?.code !== 'replacement_busy'; });
    assert.equal(recovered.status, 200); assert.equal(renders, 1); assert.equal(publishes, 1);
    assert.equal(boundary.calls.filter(call => call.name === 'sourceBytes.openStream').length, 1);
    assert.equal(boundary.calls.filter(call => call.name === 'putSignedUpload').length, 2);
  } finally { await concrete.close(); }
});

test('an aborted late executor cannot release capacity early and its retained source copy is wiped on settle', async () => {
  const fixture = await realSourceFixture(), boundary = realClients(fixture), executorGate = deferred();
  let retained;
  const executor = { prepare(input) { retained = input.objects[0].bytes; return executorGate.promise; } };
  const h = harness({ clients: boundary.clients, putSignedUpload: boundary.putSignedUpload,
    executor, maxConcurrent: 1, rpc: async name => {
      if (name === 'read_document_generation_replacement') return rpcResult(journal('missing'));
      if (name === 'read_document_generation_transform_source') return rpcResult(fixture.envelope);
      assert.fail(`unexpected RPC ${name}`);
    } });
  const controller = new AbortController(), first = h.run(body, { signal: controller.signal });
  await waitFor(() => retained instanceof Uint8Array); controller.abort();
  assert.equal((await first).value.error.code, 'replacement_unconfirmed');
  assert.ok(retained.some(byte => byte !== 0));
  assert.equal((await h.run()).value.error.code, 'replacement_busy');
  executorGate.reject(new Error('private late executor failure'));
  await waitFor(() => retained.every(byte => byte === 0));
});
