import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import * as Y from 'yjs';
import { syncByPageToDoc } from '../src/services/annotationDocStore.js';
import { initializeSurveyCrdtV2 } from '../src/services/documentSurveyCrdtV2.js';
import {
  createDocumentReplacementNodeServer,
  createDocumentReplacementServiceAdapters,
} from '../src/services/documentReplacementNodeServer.js';

const id = n => `95100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), documentId = id(2), generationId = id(3), sourceId = id(4);
const candidateId = id(5), archives = [id(6), id(7)], digest = 'a'.repeat(64);
const body = Object.freeze({ document_id: documentId, generation_id: generationId, wal_head: '7',
  operation: Object.freeze({ type: 'duplicate', page: 1 }), source_id: sourceId,
  candidate_operation_id: candidateId, archive_operation_ids: Object.freeze(archives),
  definition_revision: '2', definition_digest: digest });

const published = Object.freeze({ version: 5, content_model_version: 2,
  aggregate_admission_version: 1, document_id: documentId,
  operation_id: candidateId, actor_user_id: actor, plan_sha256: 'b'.repeat(64),
  source_id: sourceId,
  definition_revision: '2', definition_digest: digest,
  offered_archive_operation_ids: archives, used_archive_operation_ids: archives,
  legacy_sidecar_migration: null, previous_generation_id: generationId,
  generation_id: id(8), wal_head: '7', published_at: '2030-01-01T00:00:00.000Z' });

const journal = Object.freeze({ version: 5, aggregate_admission_version: 1,
  definition_revision: '2', definition_digest: digest, state: 'published',
  actor_user_id: actor, document_id: documentId, source_id: sourceId,
  candidate_operation_id: candidateId, offered_archive_operation_ids: archives,
  used_archive_operation_ids: archives, expected_generation_id: generationId,
  expected_wal_head: '7', prepared_at: '2030-01-01T00:00:00.000Z',
  expires_at: '2030-01-01T00:05:00.000Z', plan: null, publication: published });

function adapters(overrides = {}) {
  const forbidden = name => async () => assert.fail(`unexpected ${name}`);
  return {
    getUser: async token => token === 'session-token' ? { id: actor } : null,
    resolveSourceContentModelVersion: async () => 2,
    privateRpc: async name => name === 'read_document_generation_replacement_v5'
      ? { data: journal, error: null } : assert.fail(`unexpected private RPC ${name}`),
    putSignedUpload: forbidden('putSignedUpload'),
    serviceClients: {
      source: { begin: forbidden('source.begin'), get: forbidden('source.get'), cancel: forbidden('source.cancel'),
        beginV2: forbidden('source.beginV2'), getV2: forbidden('source.getV2') },
      sourceBytes: { get: forbidden('sourceBytes.get'), claim: forbidden('sourceBytes.claim'),
        openStream: forbidden('sourceBytes.openStream'), record: forbidden('sourceBytes.record'),
        release: forbidden('sourceBytes.release'), getV2: forbidden('sourceBytes.getV2'),
        claimV2: forbidden('sourceBytes.claimV2'), recordV2: forbidden('sourceBytes.recordV2') },
      upload: { beginV2: forbidden('upload.beginV2'), beginArchive: forbidden('upload.beginArchive'),
        beginV3: forbidden('upload.beginV3'), beginArchiveV2: forbidden('upload.beginArchiveV2'),
        get: forbidden('upload.get'), mint: forbidden('upload.mint'), claim: forbidden('upload.claim'),
        openStream: forbidden('upload.openStream'), record: forbidden('upload.record'),
        release: forbidden('upload.release'), reject: forbidden('upload.reject') },
    },
    ...overrides,
  };
}

test('disabled Node server fails before body, auth, RPC, storage, or worker setup', async () => {
  let reads = 0, setup = 0;
  const hostile = {};
  Object.defineProperty(hostile, 'document_id', { enumerable: true, get() { reads++; throw new Error('read'); } });
  const server = createDocumentReplacementNodeServer({ enabled: false,
    createAdapters() { setup++; throw new Error('setup'); } });
  const result = await server.handle({ authorization: 'Bearer secret', body: hostile,
    signal: new AbortController().signal });
  assert.equal(result.status, 503);
  assert.equal(reads, 0); assert.equal(setup, 0);
  assert.deepEqual(await result.json(), { error: { code: 'unavailable',
    message: 'Checked document replacement is not enabled.' } });
});

test('oversized request is rejected before auth or RPC', async () => {
  let auth = 0;
  const server = createDocumentReplacementNodeServer({ enabled: true,
    adapters: adapters({ getUser: async () => { auth++; return { id: actor }; } }) });
  const result = await server.handle({ authorization: 'Bearer session-token',
    body: JSON.stringify({ value: 'x'.repeat(17 * 1024) }), signal: new AbortController().signal });
  assert.equal(result.status, 400); assert.equal(auth, 0);
  await server.close();
});

test('server verifies bearer once, resolves exact historic model, and maps V5 published replay', async () => {
  const calls = [];
  const base = adapters({
    getUser: async (token, signal) => { calls.push(['auth', token, signal]); return { id: actor }; },
    resolveSourceContentModelVersion: async (input, signal) => {
      calls.push(['resolve', input, signal]); return 2;
    },
    privateRpc: async (name, params, { signal }) => {
      calls.push(['rpc', name, params, signal]); return { data: journal, error: null };
    },
  });
  const server = createDocumentReplacementNodeServer({ enabled: true, adapters: base });
  const controller = new AbortController();
  const result = await server.handle({ authorization: 'Bearer session-token', body,
    signal: controller.signal });
  assert.equal(result.status, 200);
  assert.equal(calls.filter(([name]) => name === 'auth').length, 1);
  assert.deepEqual(calls[1][1], { actorUserId: actor, documentId, sourceId,
    candidateOperationId: candidateId, expectedGenerationId: generationId });
  assert.deepEqual(calls[2].slice(1, 3), ['read_document_generation_replacement_v5', {
    p_actor: actor, p_document: documentId, p_source: sourceId, p_candidate: candidateId,
    p_archives: archives, p_expected_generation: generationId, p_expected_wal_head: '7',
    p_operation: { type: 'duplicate', page: 1 }, p_expected_definition_revision: '2',
    p_expected_definition_digest: digest,
  }]);
  assert.equal((await result.json()).replacement.version, 5);
  await server.close();
});

test('one server slot rejects a second request before body, auth, RPC, or download', async () => {
  let releaseResolve, authCalls = 0, hostileReads = 0;
  const release = new Promise(resolve => { releaseResolve = resolve; });
  const base = adapters({ getUser: async () => { authCalls++; await release; return { id: actor }; } });
  const server = createDocumentReplacementNodeServer({ enabled: true, adapters: base });
  const first = server.handle({ authorization: 'Bearer session-token', body,
    signal: new AbortController().signal });
  await new Promise(resolve => setImmediate(resolve));
  const hostile = {};
  Object.defineProperty(hostile, 'document_id', { enumerable: true,
    get() { hostileReads++; throw new Error('read'); } });
  const second = await server.handle({ authorization: 'Bearer session-token', body: hostile,
    signal: new AbortController().signal });
  assert.equal(second.status, 503);
  assert.equal((await second.json()).error.code, 'replacement_busy');
  assert.equal(hostileReads, 0); assert.equal(authCalls, 1);
  releaseResolve(); assert.equal((await first).status, 200);
  await server.close();
});

test('whole-request timeout retires stalled auth without leaking identity into the next request', async () => {
  let finishFirst, authCalls = 0, rpcCalls = 0;
  const firstAuth = new Promise(resolve => { finishFirst = resolve; });
  const base = adapters({
    getUser: async () => ++authCalls === 1 ? firstAuth : { id: actor },
    privateRpc: async () => { rpcCalls++; return { data: journal, error: null }; },
  });
  const server = createDocumentReplacementNodeServer({ enabled: true, adapters: base, timeoutMs: 10 });
  const first = await server.handle({ authorization: 'Bearer first-token', body,
    signal: new AbortController().signal });
  assert.equal(first.status, 502); assert.equal(rpcCalls, 0);
  const second = await server.handle({ authorization: 'Bearer session-token', body,
    signal: new AbortController().signal });
  assert.equal(second.status, 200); assert.equal(rpcCalls, 1);
  finishFirst({ id: id(99) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rpcCalls, 1, 'the retired request must not resume after late auth');
  await server.close();
});

test('service adapters expose only fixed public brokers and exact V5 names', async () => {
  const calls = [];
  const rpc = async (name, params) => { calls.push([name, params]); return { data: 2, error: null }; };
  const fake = () => ({ auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    rpc, storage: { from: () => assert.fail('unexpected storage') } });
  const service = createDocumentReplacementServiceAdapters({ url: 'https://db.invalid',
    anonKey: 'anon', serviceKey: 'service', createClient: fake });
  const signal = new AbortController().signal;
  assert.equal(await service.resolveSourceContentModelVersion({ actorUserId: actor, documentId,
    sourceId, candidateOperationId: candidateId, expectedGenerationId: generationId }, signal), 2);
  assert.deepEqual(calls.shift(), ['resolve_document_generation_replacement_source_model_service_v1', {
    p_actor_user_id: actor, p_document_id: documentId, p_source_id: sourceId,
    p_candidate_operation_id: candidateId, p_expected_generation_id: generationId,
  }]);
  await service.privateRpc('read_document_generation_replacement_v5', {
    p_actor: actor, p_document: documentId, p_source: sourceId, p_candidate: candidateId,
    p_archives: archives, p_expected_generation: generationId, p_expected_wal_head: '7',
    p_operation: body.operation, p_expected_definition_revision: '2',
    p_expected_definition_digest: digest,
  }, { signal });
  assert.deepEqual(calls.shift(), ['read_document_generation_replacement_service_v5', {
    p_actor_user_id: actor, p_document_id: documentId, p_source_id: sourceId,
    p_candidate_operation_id: candidateId, p_archive_operation_ids: archives,
    p_expected_generation_id: generationId, p_expected_wal_head: '7',
    p_operation: body.operation, p_expected_definition_revision: '2',
    p_expected_definition_digest: digest,
  }]);
  const bytesReceipt = { version: 2, content_model_version: 2, state: 'verified' };
  calls.length = 0;
  const byteFake = () => ({ auth: { getUser: async () => ({ data: { user: { id: actor } }, error: null }) },
    rpc: async (name, params) => { calls.push([name, params]); return { data: bytesReceipt, error: null }; },
    storage: { from: () => assert.fail('unexpected storage SDK download') } });
  const byteService = createDocumentReplacementServiceAdapters({ url: 'https://db.invalid',
    anonKey: 'anon', serviceKey: 'service', createClient: byteFake });
  assert.equal(await byteService.serviceClients.sourceBytes.getV2(actor, sourceId, 2, signal), bytesReceipt);
  assert.deepEqual(calls.shift(), ['get_document_generation_source_bytes_service_v2', {
    p_actor_user_id: actor, p_source_id: sourceId, p_content_model_version: 2,
  }]);
  await assert.rejects(service.privateRpc('survey_private.anything', {}, { signal }));
  assert.equal(calls.length, 0);
});

test('source and upload reads use a direct bounded stream without SDK Blob buffering or redirects', async () => {
  const calls = [];
  const fake = () => ({ auth: {}, rpc: async () => ({ data: null, error: null }),
    storage: { from: () => assert.fail('SDK storage download must not buffer source bytes') } });
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.close(); } });
  const service = createDocumentReplacementServiceAdapters({ url: 'https://db.invalid', anonKey: 'anon',
    serviceKey: 'service', createClient: fake, fetch: async (url, init) => {
      calls.push([String(url), init]); return new Response(stream, { status: 200 });
    } });
  const signal = new AbortController().signal;
  const received = await service.serviceClients.sourceBytes.openStream({ path: `${actor}/folder/a b.pdf` }, signal);
  assert.equal(received, stream);
  assert.equal(calls[0][0], `https://db.invalid/storage/v1/object/authenticated/documents/${actor}/folder/a%20b.pdf`);
  assert.equal(calls[0][1].redirect, 'error'); assert.equal(calls[0][1].cache, 'no-store');
  assert.equal(calls[0][1].signal, signal);

  let canceled = 0;
  const failedBody = new ReadableStream({ cancel() { canceled++; } });
  const failed = createDocumentReplacementServiceAdapters({ url: 'https://db.invalid', anonKey: 'anon',
    serviceKey: 'service', createClient: fake,
    fetch: async () => new Response(failedBody, { status: 403 }) });
  await assert.rejects(failed.serviceClients.upload.openStream(`${actor}/denied.pdf`, signal));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(canceled, 1);
});

test('cold Node server path runs the real worker and publishes its exact V5 plan', async () => {
  const trace = [];
  const pdf = await PDFDocument.create(); pdf.addPage([612, 792]); pdf.addPage([420, 600]);
  const pdfBytes = new Uint8Array(await pdf.save());
  const sha = bytes => createHash('sha256').update(bytes).digest('hex');
  const ydoc = new Y.Doc();
  syncByPageToDoc(ydoc, { 2: { objects: [{ type: 'rect', pageNumber: 2, left: 1, top: 2,
    width: 3, height: 4, data: { id: 'cold-mark', pageNumber: 2 }, meta: { authorId: actor } }] } });
  initializeSurveyCrdtV2(ydoc, { surveyMarkers: {}, spaces: [], createId: () => id(90) });
  const snapshot = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString('base64'); ydoc.destroy();
  const object = { kind: 'pdf', bucket_id: 'documents', path: `${actor}/source.pdf`, id: id(20),
    version: id(21), byte_length: String(pdfBytes.byteLength), content_sha256: sha(pdfBytes) };
  const sourceObject = Object.fromEntries(Object.entries(object).filter(([key]) => key !== 'content_sha256'));
  const future = '2030-01-02T00:00:00.000Z';
  const capture = { version: 2, content_model_version: 2, source_id: sourceId, actor_user_id: actor,
    document_id: documentId, generation_id: generationId, state: 'captured', source_byte_state: 'unverified',
    source_sql_sha256: 'c'.repeat(64), wal_head: '7', expires_at: future, source_object: sourceObject,
    sidecar_objects: [], visible_capture: { document: { id: documentId, user_id: actor, annotations: {},
      page_count: 2, current_page: 2, content_sha256: 'd'.repeat(64), file_path: object.path,
      file_size: object.byte_length }, sources: { annotation_snapshot: null, annotation_updates: [],
      document_annotations: [], doc_yjs_state: null, doc_yjs_updates: [], survey_sessions: [], survey_items: [],
      active_generation: { baseline: { document_id: documentId, generation_id: generationId, base_seq: '7',
        baseline_snapshot_base64: snapshot, baseline_encoding_version: 1, content_model_version: 2 },
      snapshot: null, updates: [] } }, compare: { wal_head: '7', covered_head: '7' }, scope: 'sql-metadata-only' } };
  const attestation = { version: 2, content_model_version: 2, source_id: sourceId, actor_user_id: actor,
    document_id: documentId, generation_id: generationId, source_sql_sha256: capture.source_sql_sha256,
    state: 'verified', objects: [object], verified_at: '2030-01-01T00:00:00.000Z', expires_at: future };
  const envelope = { version: 2, content_model_version: 2, actor_user_id: actor, document_id: documentId,
    source_id: sourceId, generation_id: generationId, source_sql_sha256: capture.source_sql_sha256,
    body_sha256: 'e'.repeat(64), wal_head: '7', expires_at: future, source_bytes: attestation,
    payload: { semantic: { version: 2, content_model_version: 2, document_id: documentId,
      generation_id: generationId, wal_head: '7', document: capture.visible_capture.document,
      sources: { annotation_snapshot: null, annotation_updates: [], document_annotations: [],
        doc_yjs_state: null, doc_yjs_updates: [], survey_sessions: [], survey_items: [], generation_snapshot: null,
        generation_updates: [], generation_baseline: capture.visible_capture.sources.active_generation.baseline },
      source_object: Object.fromEntries(Object.entries(sourceObject).filter(([key]) => key !== 'kind')),
      sidecar_objects: [], connector_consumed: { head: [], ops: [] } }, connector_history: { audit: [] },
    wal_history: { legacy: [], generation: [] } } };
  const stream = bytes => new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  const provider = new Map([[object.path, pdfBytes]]), uploadState = new Map();
  const uploadReceipt = (input, archive = false) => ({ version: archive ? 3 : 2,
    content_model_version: 2, operation_id: input.operation_id, actor_user_id: actor,
    document_id: documentId, generation_id: id(30), owner_user_id: actor, source_id: sourceId,
    purpose: archive ? 'source-object-archive' : 'candidate-pdf', expected_source_generation_id: generationId,
    ...(archive ? { archived_source_object_id: object.id, source_object: object } : {}),
    path: `${actor}/_generations/${documentId}/${id(30)}/${input.operation_id}.${archive ? 'bin' : 'pdf'}`,
    content_sha256: archive ? object.content_sha256 : input.content_sha256,
    byte_length: archive ? object.byte_length : input.byte_length, source_sql_sha256: capture.source_sql_sha256,
    expires_at: future, state: 'reserved', upload_state: 'reserved', object: null,
    verified_at: null, rejection: null });
  let savedPlan = null, workerCalls = 0;
  const forbidden = async name => assert.fail(`unexpected ${name}`);
  const clients = {
    source: { begin: forbidden, get: forbidden, cancel: forbidden,
      beginV2: async () => { trace.push('source.beginV2'); return capture; }, getV2: async () => capture },
    sourceBytes: { get: forbidden, claim: forbidden, record: forbidden, release: forbidden,
      getV2: async () => { trace.push('bytes.getV2'); return attestation; }, claimV2: forbidden, recordV2: forbidden,
      openStream: async descriptor => { trace.push('bytes.open'); workerCalls++;
        return stream(provider.get(descriptor.path)); } },
    upload: { beginV2: forbidden, beginArchive: forbidden,
      beginV3: async (_token, input) => { trace.push('upload.beginV3'); const value = uploadReceipt(input);
        uploadState.set(input.operation_id, value); return value; },
      beginArchiveV2: async (_token, input) => { trace.push('upload.archiveV2'); const value = uploadReceipt(input, true);
        uploadState.set(input.operation_id, value); return value; },
      get: async (_token, operationId) => uploadState.get(operationId),
      mint: async path => ({ path, token: 'signed-token', signedUrl: 'https://upload.invalid' }),
      claim: async (_actor, operationId, claimId) => {
        const prior = uploadState.get(operationId), value = { ...prior,
          object: { id: id(operationId === archives[0] ? 31 : 33), version: id(32),
            byte_length: prior.byte_length }, verification_claim_id: claimId };
        uploadState.set(operationId, value); return value;
      },
      openStream: async path => stream(provider.get(path)),
      record: async (_actor, operationId, _claim, objectId, version) => {
        const prior = uploadState.get(operationId), value = { ...prior, state: 'verified', upload_state: 'verified',
          object: { id: objectId, version, byte_length: prior.byte_length },
          verified_at: '2030-01-01T00:00:00.000Z' };
        uploadState.set(operationId, value); return value;
      },
      release: async () => ({ released: true }), reject: forbidden },
  };
  const missing = { ...journal, state: 'missing', document_id: null, used_archive_operation_ids: null,
    prepared_at: null, expires_at: null, plan: null, publication: null };
  const rawPublication = { ...published, used_archive_operation_ids: [archives[0]] };
  const boundary = adapters({ serviceClients: clients,
    putSignedUpload: async (upload, blob) => provider.set(upload.path,
      new Uint8Array(await blob.arrayBuffer())),
    privateRpc: async (name, params) => {
      trace.push(name);
      if (name === 'read_document_generation_replacement_v5') return { data: missing, error: null };
      if (name === 'read_document_generation_transform_source_v2') return { data: envelope, error: null };
      if (name === 'prepare_document_generation_replacement_v5') {
        savedPlan = structuredClone(params.p_plan);
        return { data: { ...journal, state: 'prepared', used_archive_operation_ids: [archives[0]],
          plan: savedPlan, publication: null }, error: null };
      }
      if (name === 'publish_document_generation_v5') return { data: rawPublication, error: null };
      return assert.fail(`unexpected RPC ${name}`);
    } });
  const server = createDocumentReplacementNodeServer({ enabled: true, adapters: boundary, timeoutMs: 120000 });
  try {
    const result = await server.handle({ authorization: 'Bearer session-token', body,
      signal: new AbortController().signal });
    const value = await result.json();
    assert.equal(result.status, 200, JSON.stringify({ value, trace, savedPlan }));
    assert.equal(value.replacement.version, 5); assert.equal(workerCalls, 1);
    assert.equal(savedPlan.version, 4); assert.equal(savedPlan.source.contentModelVersion, 2);
    assert.equal(savedPlan.operationId, candidateId);
  } finally { await server.close(); }
});
