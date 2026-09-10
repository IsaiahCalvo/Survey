import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { admitAnnotationGenerationAggregate } from '../supabase/functions/_shared/annotationGenerationAggregateAdmission.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';
import { initializeSurveyCrdtV2, materializeSurveyCrdtV2,
  updateSurveyMarkersV2 } from '../src/services/documentSurveyCrdtV2.js';

const scope = Object.freeze({ documentId: 'a1000000-0000-4000-8000-000000000001',
  generationId: 'a1000000-0000-4000-8000-000000000002',
  actorUserId: 'a1000000-0000-4000-8000-000000000003', contentModelVersion: 2 });
const peerActorUserId = 'a1000000-0000-4000-8000-000000000004';
const secondPeerActorUserId = 'a1000000-0000-4000-8000-000000000005';
const limits = Object.freeze({ maxUpdateBytes: 16_384, maxReaderReplayBytes: 65_536,
  maxFinalStateBytes: 65_536, maxStoredCheckpointBytes: 65_536,
  maxAggregateInputBytes: 131_072, tailPageLimit: 2, maxTailPages: 8 });
const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');
const gzip = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream()
  .pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
const marker = note => ({ annotationId: 'marker-a', pageNumber: 1,
  bounds: { x: 1, y: 1, width: 2, height: 2 }, moduleId: 'module-a', categoryId: 'category-a',
  entityId: 'entity-a', entityName: 'Entity', entityColor: '#ffffff', checklistResponses: {}, note });

async function validAggregateFixture() {
  const base = createDetachedYDoc('aggregate-base');
  initializeSurveyCrdtV2(base, { surveyMarkers: { 'marker-a': marker('a'.repeat(40_000)) }, spaces: [] });
  const snapshot = Y.encodeStateAsUpdate(base), writer = createDetachedYDoc('aggregate-tail-writer');
  Y.applyUpdate(writer, snapshot);
  const rows = [];
  for (const [index, length] of [12_000, 12_001, 12_002].entries()) {
    const vector = Y.encodeStateVector(writer);
    updateSurveyMarkersV2(writer, markers => ({ ...markers, 'marker-a': {
      ...markers['marker-a'], note: String(index).repeat(length),
    } }), { origin: 'peer' });
    rows.push({ seq: String(index + 1), actorUserId: peerActorUserId,
      writerId: `peer-${index + 1}`, clientSeq: '1', update: Y.encodeStateAsUpdate(writer, vector) });
  }
  const vector = Y.encodeStateVector(writer);
  updateSurveyMarkersV2(writer, markers => ({ ...markers, 'marker-a': {
    ...markers['marker-a'], checklistResponses: { accepted: { selection: 'Y' } },
  } }), { origin: 'local' });
  const update = Y.encodeStateAsUpdate(writer, vector);
  const snapshotSha256 = await sha256(snapshot);
  base.destroy(); writer.destroy();
  return { snapshot, snapshotSha256, rows, update };
}

async function smallFixture({ pendingErase = false, label = 'small' } = {}) {
  const base = createDetachedYDoc(`aggregate-${label}`);
  initializeSurveyCrdtV2(base, { surveyMarkers: { 'marker-a': marker(label) }, spaces: [] });
  if (pendingErase) base.getMap('eraseOutbox').set('pending-erase', {
    mutationId: 'pending-erase', actorUserId: scope.actorUserId, status: 'pending',
    committedAt: '2026-09-10T00:00:00.000Z', effects: [{ type: 'trash', targetKey: 'marker-a',
      idempotencyKey: 'pending-erase:trash:marker-a', payload: { before: marker(label) } }],
    acknowledgedEffectKeys: [],
  });
  const snapshot = Y.encodeStateAsUpdate(base), vector = Y.encodeStateVector(base);
  updateSurveyMarkersV2(base, markers => ({ ...markers, 'marker-a': {
    ...markers['marker-a'], checklistResponses: { small: { selection: 'N' } },
  } }), { origin: 'local' });
  const update = Y.encodeStateAsUpdate(base, vector), snapshotSha256 = await sha256(snapshot);
  base.destroy(); return { snapshot, snapshotSha256, rows: [], update };
}

function adapterFor(fixture, { receipt = null, mutatePage } = {}) {
  const calls = { receipt: 0, checkpoint: 0, tail: 0 };
  return { calls, adapter: {
    async lookupReceipt() { calls.receipt += 1; return receipt; },
    async readFixedCheckpoint() { calls.checkpoint += 1; return { ...scope,
      head: '3', baseSeq: '0', checkpoint: { atSeq: '0', writerId: null, writerEpoch: '0',
        encodingVersion: 1, snapshotSha256: fixture.snapshotSha256,
        snapshot: new Uint8Array(fixture.snapshot) } }; },
    async readFixedTailPage({ afterSeq, throughSeq, limit }) {
      calls.tail += 1;
      const start = BigInt(afterSeq), end = BigInt(throughSeq);
      const eligible = fixture.rows.filter(row => BigInt(row.seq) > start && BigInt(row.seq) <= end);
      const rows = eligible.slice(0, limit).map(row => ({ ...row, update: new Uint8Array(row.update) }));
      const result = { ...scope, throughSeq, rows, hasMore: eligible.length > rows.length };
      return mutatePage ? mutatePage(result, calls.tail) : result;
    },
  } };
}

const inputFor = fixture => ({ ...scope, writerId: 'local-writer', clientSeq: '1',
  update: new Uint8Array(fixture.update), checkpointPolicy: 'when-reader-limit' });

test('valid model 2 aggregate admits a final-fit update and emits a reader-limit checkpoint', async () => {
  const fixture = await validAggregateFixture();
  assert.ok(fixture.rows.every(row => row.update.byteLength <= limits.maxUpdateBytes));
  assert.ok(fixture.snapshot.byteLength + fixture.rows.reduce((sum, row) => sum + row.update.byteLength, 0)
    > limits.maxReaderReplayBytes);
  const state = createDetachedYDoc('aggregate-proof');
  Y.applyUpdate(state, fixture.snapshot); for (const row of fixture.rows) Y.applyUpdate(state, row.update);
  assert.equal(state.store.pendingStructs, null); assert.equal(state.store.pendingDs, null);
  assert.equal(materializeSurveyCrdtV2(state).surveyMarkers['marker-a'].note.length, 12_002);
  assert.ok(Y.encodeStateAsUpdate(state).byteLength <= limits.maxFinalStateBytes); state.destroy();

  const harness = adapterFor(fixture);
  const result = await admitAnnotationGenerationAggregate(inputFor(fixture), harness.adapter, limits);
  assert.equal(result.kind, 'admitted'); assert.equal(result.expectedHead, '3');
  assert.equal(result.nextSeq, '4'); assert.deepEqual(result.update, fixture.update);
  assert.ok(result.finalState.byteLength <= limits.maxFinalStateBytes);
  assert.match(result.finalState.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.checkpoint.reason, 'reader-replay-limit');
  assert.equal(result.checkpoint.atSeq, '4'); assert.ok(result.checkpoint.bytes instanceof Uint8Array);
  assert.equal(await sha256(result.checkpoint.bytes), result.checkpoint.snapshotSha256);
  const checkpointBytes = result.checkpoint.encodingVersion === 2
    ? new Uint8Array(await new Response(new Blob([result.checkpoint.bytes]).stream()
      .pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
    : result.checkpoint.bytes;
  const checkpointDoc = createDetachedYDoc('aggregate-collaboration-checkpoint');
  Y.applyUpdate(checkpointDoc, checkpointBytes);
  const checkpointMarker = materializeSurveyCrdtV2(checkpointDoc).surveyMarkers['marker-a'];
  assert.equal(checkpointMarker.note.length, 12_002, 'peer history survives caller admission');
  assert.deepEqual(checkpointMarker.checklistResponses, { accepted: { selection: 'Y' } },
    'caller update composes with peer history');
  checkpointDoc.destroy();
  assert.deepEqual(result.sourceCheckpoint, { documentId: scope.documentId,
    generationId: scope.generationId, contentModelVersion: 2, atSeq: '0', writerId: null,
    writerEpoch: '0', encodingVersion: 1, snapshotSha256: fixture.snapshotSha256 });
  assert.deepEqual(harness.calls, { receipt: 1, checkpoint: 1, tail: 2 });
});

test('an exact historical receipt owns its bytes and skips every aggregate read', async () => {
  const fixture = await validAggregateFixture(), input = inputFor(fixture);
  input.update = new Uint8Array(limits.maxUpdateBytes + 1).fill(7);
  const receipt = { ...scope, writerId: input.writerId, clientSeq: input.clientSeq,
    seq: '91', update: new Uint8Array(input.update) };
  const harness = adapterFor(fixture, { receipt });
  const result = await admitAnnotationGenerationAggregate(input, harness.adapter, limits);
  assert.equal(result.kind, 'accepted-retry'); assert.equal(result.receipt.seq, '91');
  assert.equal(result.receipt.updateSha256, await sha256(input.update));
  assert.deepEqual(harness.calls, { receipt: 1, checkpoint: 0, tail: 0 });
  receipt.update.fill(0); input.update.fill(0);
  assert.notEqual(result.receipt.updateSha256, await sha256(input.update));
});

test('a historical receipt collision rejects before fixed checkpoint or tail reads', async () => {
  const fixture = await validAggregateFixture(), input = inputFor(fixture);
  const receipt = { ...scope, writerId: input.writerId, clientSeq: input.clientSeq,
    seq: '4', update: new Uint8Array(input.update).fill(9) };
  const harness = adapterFor(fixture, { receipt });
  await assert.rejects(admitAnnotationGenerationAggregate(input, harness.adapter, limits), { code: '23505' });
  assert.deepEqual(harness.calls, { receipt: 1, checkpoint: 0, tail: 0 });
});

test('tail gaps and incomplete model 2 history reject without mutating owned inputs', async () => {
  const fixture = await validAggregateFixture(), input = inputFor(fixture);
  const original = new Uint8Array(input.update), snapshot = new Uint8Array(fixture.snapshot);
  const gap = adapterFor(fixture, { mutatePage(result, page) {
    if (page === 1) result.rows[0].seq = '2'; return result;
  } });
  await assert.rejects(admitAnnotationGenerationAggregate(input, gap.adapter, limits),
    { code: 'ANNOTATION_AGGREGATE_STATE' });
  assert.deepEqual(input.update, original); assert.deepEqual(fixture.snapshot, snapshot);

  const missing = adapterFor(fixture, { mutatePage(result, page) {
    if (page === 1) result.rows.shift(); return result;
  } });
  await assert.rejects(admitAnnotationGenerationAggregate(input, missing.adapter, limits),
    { code: 'ANNOTATION_AGGREGATE_STATE' });
  assert.deepEqual(input.update, original);
});

test('an ordinary small append preserves a valid pending erase envelope without a checkpoint', async () => {
  const fixture = await smallFixture({ pendingErase: true }), harness = adapterFor(fixture);
  harness.adapter.readFixedCheckpoint = async () => { harness.calls.checkpoint += 1; return { ...scope,
    head: '0', baseSeq: '0', checkpoint: { atSeq: '0', writerId: null, writerEpoch: '0',
      encodingVersion: 1, snapshotSha256: fixture.snapshotSha256,
      snapshot: new Uint8Array(fixture.snapshot) } }; };
  const result = await admitAnnotationGenerationAggregate(inputFor(fixture), harness.adapter, limits);
  assert.equal(result.kind, 'admitted'); assert.equal(result.expectedHead, '0');
  assert.equal(result.nextSeq, '1'); assert.equal(result.checkpoint, null);
  const final = createDetachedYDoc('aggregate-small-result');
  Y.applyUpdate(final, fixture.snapshot); Y.applyUpdate(final, result.update);
  assert.equal(final.getMap('eraseOutbox').get('pending-erase').actorUserId, scope.actorUserId);
  assert.equal(final.getMap('eraseOutbox').get('pending-erase').status, 'pending'); final.destroy();
});

for (const field of ['actorUserId', 'generationId', 'contentModelVersion']) {
  test(`a wrong ${field} in fixed checkpoint or tail rejects as protocol state`, async () => {
    const fixture = await validAggregateFixture();
    const checkpoint = adapterFor(fixture);
    const originalCheckpoint = checkpoint.adapter.readFixedCheckpoint;
    checkpoint.adapter.readFixedCheckpoint = async input => ({ ...await originalCheckpoint(input),
      [field]: field === 'contentModelVersion' ? 1 : `wrong-${field}` });
    await assert.rejects(admitAnnotationGenerationAggregate(inputFor(fixture), checkpoint.adapter, limits),
      { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
    const tail = adapterFor(fixture, { mutatePage(result) {
      result[field] = field === 'contentModelVersion' ? 1 : `wrong-${field}`; return result;
    } });
    await assert.rejects(admitAnnotationGenerationAggregate(inputFor(fixture), tail.adapter, limits),
      { code: 'ANNOTATION_AGGREGATE_PROTOCOL' });
  });
}

test('a malformed historical row actor rejects while a valid peer actor is accepted', async () => {
  const fixture = await validAggregateFixture();
  const malformed = adapterFor(fixture, { mutatePage(result, page) {
    if (page === 1) result.rows[0].actorUserId = 'not-a-uuid'; return result;
  } });
  await assert.rejects(admitAnnotationGenerationAggregate(inputFor(fixture), malformed.adapter, limits),
    { code: 'ANNOTATION_AGGREGATE_STATE' });
  const valid = await admitAnnotationGenerationAggregate(inputFor(fixture),
    adapterFor(fixture).adapter, limits);
  assert.equal(valid.kind, 'admitted');
});

test('historical receipt keys are actor scoped while same-actor duplicates reject', async () => {
  const fixture = await validAggregateFixture();
  fixture.rows[0] = { ...fixture.rows[0], actorUserId: peerActorUserId,
    writerId: 'local-writer', clientSeq: '1' };
  fixture.rows[1] = { ...fixture.rows[1], actorUserId: peerActorUserId,
    writerId: 'shared-writer', clientSeq: '7' };
  fixture.rows[2] = { ...fixture.rows[2], actorUserId: secondPeerActorUserId,
    writerId: 'shared-writer', clientSeq: '7' };
  const admitted = await admitAnnotationGenerationAggregate(inputFor(fixture),
    adapterFor(fixture).adapter, limits);
  assert.equal(admitted.kind, 'admitted', 'peer may share caller or another actor receipt key');

  const duplicate = await validAggregateFixture();
  duplicate.rows[0] = { ...duplicate.rows[0], actorUserId: peerActorUserId,
    writerId: 'shared-writer', clientSeq: '7' };
  duplicate.rows[1] = { ...duplicate.rows[1], actorUserId: peerActorUserId,
    writerId: 'shared-writer', clientSeq: '7' };
  await assert.rejects(admitAnnotationGenerationAggregate(inputFor(duplicate),
    adapterFor(duplicate).adapter, limits), { code: 'ANNOTATION_AGGREGATE_STATE' });
});

test('same-head changed snapshot content produces a different exact source checkpoint token', async () => {
  const first = await smallFixture({ label: 'snapshot-a' });
  const second = await smallFixture({ label: 'snapshot-b' });
  const firstHarness = adapterFor(first), secondHarness = adapterFor(second);
  for (const [fixture, harness] of [[first, firstHarness], [second, secondHarness]]) {
    const read = harness.adapter.readFixedCheckpoint;
    harness.adapter.readFixedCheckpoint = async input => ({ ...await read(input), head: '0',
      checkpoint: { atSeq: '0', writerId: null, writerEpoch: '0', encodingVersion: 1,
        snapshotSha256: fixture.snapshotSha256, snapshot: new Uint8Array(fixture.snapshot) } });
  }
  const a = await admitAnnotationGenerationAggregate(inputFor(first), firstHarness.adapter, limits);
  const b = await admitAnnotationGenerationAggregate(inputFor(second), secondHarness.adapter, limits);
  assert.equal(a.sourceCheckpoint.atSeq, b.sourceCheckpoint.atSeq);
  assert.notEqual(a.sourceCheckpoint.snapshotSha256, b.sourceCheckpoint.snapshotSha256);
});

test('input bytes are captured before the first deferred adapter await', async () => {
  const fixture = await smallFixture(), input = inputFor(fixture), expected = new Uint8Array(input.update);
  let release; const gate = new Promise(resolve => { release = resolve; });
  const harness = adapterFor(fixture), lookup = harness.adapter.lookupReceipt;
  const read = harness.adapter.readFixedCheckpoint;
  harness.adapter.readFixedCheckpoint = async value => ({ ...await read(value), head: '0' });
  harness.adapter.lookupReceipt = async identity => { await gate; return lookup(identity); };
  const pending = admitAnnotationGenerationAggregate(input, harness.adapter, limits);
  input.update.fill(0); release();
  const result = await pending;
  assert.deepEqual(result.update, expected); assert.notDeepEqual(result.update, input.update);
});

test('gzip expanded and stored checkpoint limits distinguish exact from plus one', async () => {
  const fixture = await smallFixture(), compressed = await gzip(fixture.snapshot);
  fixture.snapshotSha256 = await sha256(compressed);
  const make = () => { const harness = adapterFor(fixture), read = harness.adapter.readFixedCheckpoint;
    harness.adapter.readFixedCheckpoint = async value => { const result = await read(value);
      return { ...result, head: '0', checkpoint: { ...result.checkpoint,
        encodingVersion: 2, snapshotSha256: fixture.snapshotSha256,
        snapshot: new Uint8Array(compressed) } }; };
    return harness; };
  const exact = { ...limits, maxStoredCheckpointBytes: compressed.length,
    maxFinalStateBytes: fixture.snapshot.length + fixture.update.length + 1_000 };
  assert.equal((await admitAnnotationGenerationAggregate(inputFor(fixture), make().adapter, exact)).kind,
    'admitted');
  await assert.rejects(admitAnnotationGenerationAggregate(inputFor(fixture), make().adapter,
    { ...exact, maxStoredCheckpointBytes: compressed.length - 1 }), error =>
    error?.code === 'ANNOTATION_AGGREGATE_WORK_LIMIT' && error.reason === 'checkpoint-stored-bytes');
  await assert.rejects(admitAnnotationGenerationAggregate(inputFor(fixture), make().adapter,
    { ...exact, maxFinalStateBytes: fixture.snapshot.length - 1 }), error =>
    error?.code === 'ANNOTATION_AGGREGATE_WORK_LIMIT' && error.reason === 'checkpoint-expanded-bytes');
});

test('final encoded state exact limit passes and plus one is logical SG004', async () => {
  const fixture = await smallFixture(), make = () => { const harness = adapterFor(fixture);
    const read = harness.adapter.readFixedCheckpoint;
    harness.adapter.readFixedCheckpoint = async value => ({ ...await read(value), head: '0' }); return harness; };
  const measured = await admitAnnotationGenerationAggregate(inputFor(fixture), make().adapter, limits);
  const exact = { ...limits, maxFinalStateBytes: measured.finalState.byteLength };
  assert.equal((await admitAnnotationGenerationAggregate(inputFor(fixture), make().adapter, exact)).kind,
    'admitted');
  await assert.rejects(admitAnnotationGenerationAggregate(inputFor(fixture), make().adapter,
    { ...exact, maxFinalStateBytes: measured.finalState.byteLength - 1 }), error =>
    error?.code === 'SG004' && error.reason === 'final-state-bytes');
});

test('tail page work ceiling stops before another adapter read', async () => {
  const fixture = await validAggregateFixture(), harness = adapterFor(fixture);
  await assert.rejects(admitAnnotationGenerationAggregate(inputFor(fixture), harness.adapter,
    { ...limits, maxTailPages: 1 }), error => error?.code === 'ANNOTATION_AGGREGATE_WORK_LIMIT'
      && error.reason === 'tail-pages' && error.maintenanceNeeded === true);
  assert.deepEqual(harness.calls, { receipt: 1, checkpoint: 1, tail: 1 });
});

test('aggregate input work exact boundary passes and plus one fails as maintenance', async () => {
  const fixture = await validAggregateFixture();
  const aggregateBytes = fixture.snapshot.length + fixture.update.length
    + fixture.rows.reduce((sum, row) => sum + row.update.length, 0);
  assert.equal((await admitAnnotationGenerationAggregate(inputFor(fixture),
    adapterFor(fixture).adapter, { ...limits, maxAggregateInputBytes: aggregateBytes })).kind,
  'admitted');
  await assert.rejects(admitAnnotationGenerationAggregate(inputFor(fixture),
    adapterFor(fixture).adapter, { ...limits, maxAggregateInputBytes: aggregateBytes - 1 }),
  error => error?.code === 'ANNOTATION_AGGREGATE_WORK_LIMIT'
    && error.reason === 'aggregate-input-bytes' && error.maintenanceNeeded === true);
});

test('abort after a deferred receipt lookup prevents all fixed-state reads', async () => {
  const fixture = await smallFixture(), harness = adapterFor(fixture), controller = new AbortController();
  let release; const gate = new Promise(resolve => { release = resolve; });
  harness.adapter.lookupReceipt = async () => { harness.calls.receipt += 1; await gate; return null; };
  const pending = admitAnnotationGenerationAggregate({ ...inputFor(fixture), signal: controller.signal },
    harness.adapter, limits);
  controller.abort(); release();
  await assert.rejects(pending, { code: 'ANNOTATION_AGGREGATE_ABORTED' });
  assert.deepEqual(harness.calls, { receipt: 1, checkpoint: 0, tail: 0 });
});

test('maximum sequence head rejects before tail reads', async () => {
  const fixture = await smallFixture(), harness = adapterFor(fixture);
  const read = harness.adapter.readFixedCheckpoint;
  harness.adapter.readFixedCheckpoint = async value => ({ ...await read(value),
    head: '9223372036854775807' });
  await assert.rejects(admitAnnotationGenerationAggregate(inputFor(fixture), harness.adapter, limits),
    { code: '22003', reason: 'sequence-exhausted' });
  assert.deepEqual(harness.calls, { receipt: 1, checkpoint: 1, tail: 0 });
});

async function racedReceiptFixture(secondReceipt) {
  const fixture = await validAggregateFixture(), input = inputFor(fixture);
  fixture.rows.push({ seq: '4', actorUserId: scope.actorUserId, writerId: input.writerId,
    clientSeq: input.clientSeq, update: new Uint8Array(input.update) });
  const harness = adapterFor(fixture), read = harness.adapter.readFixedCheckpoint;
  harness.adapter.readFixedCheckpoint = async value => ({ ...await read(value), head: '4' });
  harness.adapter.lookupReceipt = async () => {
    harness.calls.receipt += 1;
    if (harness.calls.receipt === 1) return null;
    return typeof secondReceipt === 'function' ? secondReceipt({ fixture, input }) : secondReceipt;
  };
  return { fixture, input, harness };
}

test('a raced exact receipt observed in the fixed tail returns accepted-retry before final capacity', async () => {
  const race = await racedReceiptFixture(({ input }) => ({ ...scope, writerId: input.writerId,
    clientSeq: input.clientSeq, seq: '4', update: new Uint8Array(input.update) }));
  const result = await admitAnnotationGenerationAggregate(race.input, race.harness.adapter,
    { ...limits, maxFinalStateBytes: 1 });
  assert.deepEqual(result, { kind: 'accepted-retry', receipt: { seq: '4',
    actorUserId: scope.actorUserId, writerId: race.input.writerId,
    clientSeq: race.input.clientSeq, updateSha256: await sha256(race.input.update) } });
  assert.equal(Object.hasOwn(result, 'expectedHead'), false);
  assert.equal(race.harness.calls.receipt, 2);
});

test('a raced receipt with different bytes rejects as collision after the fixed tail', async () => {
  const race = await racedReceiptFixture(({ input }) => { const update = new Uint8Array(input.update);
    update[update.length - 1] ^= 1; return { ...scope, writerId: input.writerId,
      clientSeq: input.clientSeq, seq: '4', update }; });
  await assert.rejects(admitAnnotationGenerationAggregate(race.input, race.harness.adapter, limits),
    { code: '23505' });
  assert.equal(race.harness.calls.receipt, 2);
});

test('a raced own tail row without one exact second receipt fails closed', async () => {
  for (const [second, code] of [[null, 'ANNOTATION_AGGREGATE_STATE'],
  [({ input }) => ({ ...scope, writerId: input.writerId,
    clientSeq: input.clientSeq, seq: '5', update: new Uint8Array(input.update) }),
  'ANNOTATION_AGGREGATE_STATE'],
  [({ input }) => ({ ...scope, writerId: input.writerId, clientSeq: input.clientSeq,
    seq: '4', update: new Uint8Array(input.update), extra: true }),
  'ANNOTATION_AGGREGATE_PROTOCOL']]) {
    const race = await racedReceiptFixture(second);
    await assert.rejects(admitAnnotationGenerationAggregate(race.input, race.harness.adapter, limits),
      { code });
    assert.equal(race.harness.calls.receipt, 2);
  }
});

test('a duplicate same-actor receipt key on a later tail page rejects before re-probe', async () => {
  const race = await racedReceiptFixture(({ input }) => ({ ...scope, writerId: input.writerId,
    clientSeq: input.clientSeq, seq: '4', update: new Uint8Array(input.update) }));
  race.fixture.rows.push({ ...race.fixture.rows.at(-1), seq: '5' });
  const read = race.harness.adapter.readFixedCheckpoint;
  race.harness.adapter.readFixedCheckpoint = async value => ({ ...await read(value), head: '5' });
  await assert.rejects(admitAnnotationGenerationAggregate(race.input, race.harness.adapter, limits),
    { code: 'ANNOTATION_AGGREGATE_STATE' });
  assert.equal(race.harness.calls.receipt, 1);
});
