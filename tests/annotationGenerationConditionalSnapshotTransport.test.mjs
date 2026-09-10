import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAnnotationGenerationTransport } from '../src/services/annotationGenerationTransport.js';

const id = n => `c1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const documentId = id(1), generationId = id(2), actorUserId = id(3);
const bytes = '\\x01020304';
const snapshotSha256 = createHash('sha256').update(Buffer.from(bytes.slice(2), 'hex')).digest('hex');
const token = Object.freeze({ atSeq: '7', writerId: 'checkpoint-writer', writerEpoch: '4',
  encodingVersion: 1, snapshotSha256 });
const keys = value => Object.keys(value).sort();
const checkpoint = fields => ({ at_seq: '7', writer_id: 'checkpoint-writer', writer_epoch: '4',
  encoding_version: 1, snapshot_sha256: snapshotSha256, snapshot: null, ...fields });
const envelope = fields => ({ version: 3, actor_user_id: actorUserId, document_id: documentId,
  generation_id: generationId, content_model_version: 2, wal_head: '9',
  snapshot_matches: true, checkpoint: checkpoint(), ...fields });

function harness(response, options = {}) {
  const calls = [];
  const transport = createAnnotationGenerationTransport({ documentId, pdfGenerationId: generationId,
    actorUserId, contentModelVersion: 2, ...options,
    request: async (name, params, label) => {
      calls.push({ name, params, label });
      return typeof response === 'function' ? response(calls.length) : { data: response, error: null };
    } });
  return { transport, calls };
}
const protocol = promise => assert.rejects(promise, { code: 'ANNOTATION_GENERATION_PROTOCOL' });
const input = promise => assert.rejects(promise, { code: 'ANNOTATION_GENERATION_INPUT' });

test('exact checkpoint match returns identity without snapshot payload through only the private v3 RPC', async () => {
  const h = harness(envelope());
  const result = await h.transport.conditionalCheckpoint(token);
  assert.deepEqual(result, { matched: true, walHead: 9,
    snapshotIdentity: token, snapshot: null });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].name, 'read_annotation_checkpoint_conditional_v3');
  assert.deepEqual(h.calls[0].params, { p_document_id: documentId, p_generation_id: generationId,
    p_content_model_version: 2, p_expected_at_seq: '7', p_expected_writer_id: 'checkpoint-writer',
    p_expected_writer_epoch: '4', p_expected_encoding_version: 1,
    p_expected_snapshot_sha256: snapshotSha256 });
  assert.equal(typeof h.calls[0].label, 'string');
  assert.deepEqual(keys(envelope()), ['actor_user_id', 'checkpoint', 'content_model_version',
    'document_id', 'generation_id', 'snapshot_matches', 'version', 'wal_head']);
  assert.deepEqual(keys(checkpoint()), ['at_seq', 'encoding_version', 'snapshot',
    'snapshot_sha256', 'writer_epoch', 'writer_id']);
  assert.equal(JSON.stringify(envelope()).includes(bytes), false);
});

test('null expected token forces a full hashed checkpoint at the same fixed WAL head', async () => {
  const response = envelope({ snapshot_matches: false, checkpoint: checkpoint({ snapshot: bytes }) });
  const h = harness(response);
  assert.deepEqual(await h.transport.conditionalCheckpoint(null), {
    matched: false, walHead: 9, snapshotIdentity: token,
    snapshot: { at_seq: '7', writer_id: 'checkpoint-writer', writer_epoch: '4',
      encoding_version: 1, snapshot: bytes } });
  assert.deepEqual(h.calls[0].params, { p_document_id: documentId, p_generation_id: generationId,
    p_content_model_version: 2, p_expected_at_seq: null, p_expected_writer_id: null,
    p_expected_writer_epoch: null, p_expected_encoding_version: null,
    p_expected_snapshot_sha256: null });
  const matchedBytes = Buffer.byteLength(JSON.stringify(envelope()), 'utf8');
  const changedBytes = Buffer.byteLength(JSON.stringify(response), 'utf8');
  assert.ok(changedBytes > matchedBytes);
  const omitted = harness(response);
  assert.equal((await omitted.transport.conditionalCheckpoint()).matched, false);
  assert.deepEqual(omitted.calls[0].params, h.calls[0].params);
});

test('the real baseline null-writer identity can match only with epoch zero', async () => {
  const baselineHash = createHash('sha256').update(Buffer.from('0102', 'hex')).digest('hex');
  const baselineToken = { atSeq: '0', writerId: null, writerEpoch: '0', encodingVersion: 1,
    snapshotSha256: baselineHash };
  const h = harness(envelope({ wal_head: '0', checkpoint: checkpoint({ at_seq: '0', writer_id: null,
    writer_epoch: '0', snapshot_sha256: baselineHash }) }));
  assert.deepEqual((await h.transport.conditionalCheckpoint(baselineToken)).snapshotIdentity, baselineToken);
});

test('wrong digest returns full bytes and validates their SHA-256 before exposing them', async () => {
  const h = harness(envelope({ snapshot_matches: false, checkpoint: checkpoint({ snapshot: bytes }) }));
  const wrong = { ...token, snapshotSha256: 'a'.repeat(64) };
  const result = await h.transport.conditionalCheckpoint(wrong);
  assert.equal(result.matched, false); assert.equal(result.snapshot.snapshot, bytes);
  await protocol(harness(envelope({ snapshot_matches: false,
    checkpoint: checkpoint({ snapshot: '\\x01020305' }) })).transport.conditionalCheckpoint(wrong));
});

test('partial or malformed expected tokens reject before a request and never fall back', async () => {
  for (const value of [{}, { ...token, extra: true }, { ...token, writerId: null }, { ...token, writerEpoch: null },
    { ...token, encodingVersion: 0 }, { ...token, snapshotSha256: 'A'.repeat(64) },
    { ...token, atSeq: '07' }]) {
    const h = harness(null);
    await input(h.transport.conditionalCheckpoint(value));
    assert.deepEqual(h.calls, []);
  }
});

test('expected token is copied before the first await and caller mutation cannot alter request scope', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const expected = { ...token };
  const h = harness(async () => { await gate; return { data: envelope(), error: null }; });
  assert.equal(typeof h.transport.conditionalCheckpoint, 'function');
  const pending = h.transport.conditionalCheckpoint(expected);
  expected.atSeq = '99'; expected.writerId = 'changed'; expected.snapshotSha256 = 'b'.repeat(64);
  release(); await pending;
  assert.equal(h.calls[0].params.p_expected_at_seq, '7');
  assert.equal(h.calls[0].params.p_expected_writer_id, 'checkpoint-writer');
  assert.equal(h.calls[0].params.p_expected_snapshot_sha256, snapshotSha256);
});

test('full response fields are copied before async digest and provider mutation cannot change checked bytes', async t => {
  const probe = harness(envelope());
  assert.equal(typeof probe.transport.conditionalCheckpoint, 'function');
  const originalCrypto = globalThis.crypto;
  let digestStarted, releaseDigest;
  const started = new Promise(resolve => { digestStarted = resolve; });
  const gate = new Promise(resolve => { releaseDigest = resolve; });
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    ...originalCrypto, subtle: { ...originalCrypto.subtle, async digest(name, data) {
      const result = await originalCrypto.subtle.digest(name, data);
      digestStarted(); await gate; return result;
    } } } });
  t.after(() => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto }));
  const response = envelope({ snapshot_matches: false, checkpoint: checkpoint({ snapshot: bytes }) });
  const pending = harness(response).transport.conditionalCheckpoint(null);
  await started;
  response.checkpoint.snapshot = '\\x05060708';
  response.checkpoint.snapshot_sha256 = 'b'.repeat(64);
  response.checkpoint.at_seq = '99';
  releaseDigest();
  const result = await pending;
  assert.equal(result.snapshot.snapshot, bytes);
  assert.deepEqual(result.snapshotIdentity, token);
});

test('accessor and non-ordinary expected tokens reject without getter execution or network', async () => {
  let getters = 0;
  const accessor = { ...token };
  Object.defineProperty(accessor, 'atSeq', { enumerable: true, get() { getters++; return '7'; } });
  for (const value of [accessor, Object.assign(Object.create({}), token), Object.freeze([...Object.values(token)])]) {
    const h = harness(null); await input(h.transport.conditionalCheckpoint(value)); assert.deepEqual(h.calls, []);
  }
  assert.equal(getters, 0);
});

test('legacy, null-generation, and unknown-model transports reject before any request', async () => {
  for (const options of [{ contentModelVersion: undefined }, { pdfGenerationId: null },
    { contentModelVersion: 3 }]) {
    let calls = 0;
    let transport;
    if (options.contentModelVersion === undefined) {
      transport = createAnnotationGenerationTransport({ documentId, pdfGenerationId: generationId,
        actorUserId, request: async () => { calls++; } });
    } else if (options.contentModelVersion === 3) {
      assert.throws(() => harness(null, options), { code: 'ANNOTATION_GENERATION_INPUT' });
      continue;
    } else transport = harness(null, options).transport;
    await input(transport.conditionalCheckpoint(token));
    assert.equal(calls, 0);
  }
});

for (const [label, change] of [
  ['wrong actor', { actor_user_id: id(9) }], ['wrong generation', { generation_id: id(9) }],
  ['wrong model', { content_model_version: 1 }], ['wrong version', { version: 2 }],
  ['numeric head', { wal_head: 9 }], ['match with payload', { checkpoint: checkpoint({ snapshot: bytes }) }],
  ['changed without payload', { snapshot_matches: false }], ['bad hash', { checkpoint: checkpoint({ snapshot_sha256: 'a'.repeat(64) }) }],
  ['empty payload', { snapshot_matches: false, checkpoint: checkpoint({ snapshot: '\\x' }) }],
  ['uppercase payload', { snapshot_matches: false, checkpoint: checkpoint({ snapshot: '\\xAB' }) }],
]) test(`conditional checkpoint rejects ${label} with no fallback`, async () => {
  const h = harness(envelope(change));
  await protocol(h.transport.conditionalCheckpoint(token));
  assert.equal(h.calls.length, 1);
});

test('conditional checkpoint rejects extra or missing response keys', async () => {
  const extra = envelope({ extra: true });
  const missing = envelope(); delete missing.checkpoint;
  const extraCheckpoint = envelope({ checkpoint: checkpoint({ extra: true }) });
  for (const response of [extra, missing, extraCheckpoint]) {
    await protocol(harness(response).transport.conditionalCheckpoint(token));
  }
});

test('oversized full checkpoint rejects before hashing any provider bytes', async t => {
  const originalCrypto = globalThis.crypto; let digests = 0;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
    ...originalCrypto, subtle: { ...originalCrypto.subtle, async digest(...args) {
      digests++; return originalCrypto.subtle.digest(...args);
    } } } });
  t.after(() => Object.defineProperty(globalThis, 'crypto', { configurable: true, value: originalCrypto }));
  const oversized = `\\x${'aa'.repeat(64 * 1024 * 1024 + 1)}`;
  const h = harness(envelope({ snapshot_matches: false, checkpoint: checkpoint({ snapshot: oversized }) }));
  await protocol(h.transport.conditionalCheckpoint(null));
  assert.equal(digests, 0);
});
