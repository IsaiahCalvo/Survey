import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { PDFDocument } from 'pdf-lib';
import * as Y from 'yjs';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { META_MAP } from '../src/services/annotationDocStore.js';
import { createAnnotationOutbox, annotationOutboxRecordKey } from '../src/services/annotationDocOutbox.js';
import { createDetachedYDoc, purgeYDocsByPrefix, summarizeRegisteredYDoc } from '../src/lib/collab/ydocRegistry.js';

const id = n => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), generation = id(2), successor = id(3);
const hex = bytes => `\\x${Buffer.from(bytes).toString('hex')}`;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hexHash = value => digest(Buffer.from(value.slice(2), 'hex'));
const copy = value => JSON.parse(JSON.stringify(value));
const pdfDocument = await PDFDocument.create(); pdfDocument.addPage([612, 792]);
const pdfBytes = await pdfDocument.save();

// Only API/Storage edges are adapted. Reader validation, issued bundle, Yjs,
// generation transport, durable IndexedDB journal and handle are all real.
async function fixture(t) {
  const documentId = crypto.randomUUID(), state = createDetachedYDoc();
  state.getMap(META_MAP).set('baseline', 'checked');
  let snapshot = { at_seq: '3', snapshot: hex(Y.encodeStateAsUpdate(state)),
    encoding_version: 1, writer_id: 'checkpoint-writer', writer_epoch: '7' };
  const rows = [], calls = [], channels = [], handles = [], stores = [];
  let head = 3n, current = generation, rejectAppends = false, downloadCount = 0, tailError = null;
  const path = `${actor}/_generations/${documentId}/${generation}.pdf`;
  const pdf = { bucket_id: 'documents', path, id: id(4), version: id(5),
    byte_length: String(pdfBytes.length), content_sha256: digest(pdfBytes) };
  const publication = { operation_id: id(6), generation_id: generation,
    published_at: '2026-09-09T00:00:00Z', wal_head: '3' };
  const add = (key, value, writer = 'peer') => {
    const vector = Y.encodeStateVector(state); state.getMap(META_MAP).set(key, value);
    const row = { seq: String(++head), client_id: writer, client_seq: String(head),
      actor_user_id: actor, data: hex(Y.encodeStateAsUpdate(state, vector)) };
    rows.push(row); return row;
  };
  add('tail-one', 'accepted'); add('tail-two', 'accepted');
  const invoke = async (name, params, phase) => {
    calls.push({ name, params: copy(params), phase });
    assert.equal(params.p_document_id, documentId);
    if (params.p_generation_id != null && params.p_generation_id !== current) return { error: {
      code: 'SG002', details: JSON.stringify({ document_id: documentId,
        expected_generation_id: params.p_generation_id, current_generation_id: current }),
    } };
    if (name === 'read_document_generation_open') return { data: {
      version: 1, actor_user_id: actor, document_id: documentId, generation_id: current,
      document: { id: documentId, user_id: actor, project_id: null, name: 'Owned checked fixture',
        file_path: path, file_size: String(pdfBytes.length) }, pdf: copy(pdf), publication: copy(publication),
      annotations: { version: 2, document_id: documentId, generation_id: current, wal_head: String(head),
        snapshot: params.p_include_snapshot ? copy(snapshot) : null,
        snapshot_sha256: params.p_include_snapshot ? hexHash(snapshot.snapshot) : null },
    } };
    const envelope = { version: 2, document_id: documentId, generation_id: current };
    let data;
    if (name === 'read_annotation_writer_sequence_v2') data = { client_id: params.p_client_id,
      client_seq: String(rows.filter(row => row.client_id === params.p_client_id)
        .reduce((largest, row) => BigInt(row.client_seq) > largest ? BigInt(row.client_seq) : largest, 0n)) };
    else if (name === 'read_annotation_snapshot_v2') data = { snapshot: copy(snapshot), wal_head: String(head) };
    else if (name === 'read_annotation_updates_v2') {
      if (tailError) { const code = tailError; tailError = null; return { error: { code } }; }
      const frontier = params.p_through_seq ?? String(head);
      const eligible = rows.filter(row => BigInt(row.seq) > BigInt(params.p_after_seq) && BigInt(row.seq) <= BigInt(frontier));
      const page = eligible.slice(0, params.p_limit);
      data = { rows: copy(page), through_seq: frontier, has_more: eligible.length > page.length };
    } else if (name === 'append_annotation_update_v2') {
      if (rejectAppends) return { error: { code: '42501' } };
      let row = rows.find(item => item.client_id === params.p_client_id && item.client_seq === params.p_client_seq);
      if (row && row.data !== params.p_data) return { error: { code: '23505' } };
      if (!row) {
        row = { seq: String(++head), client_id: params.p_client_id, client_seq: params.p_client_seq,
          actor_user_id: actor, data: params.p_data };
        rows.push(row); Y.applyUpdate(state, Buffer.from(row.data.slice(2), 'hex'));
      }
      data = { ...row, accepted: true, data_sha256: hexHash(row.data), is_current: true, current_generation_id: current };
    } else if (name === 'store_annotation_snapshot_v2') {
      const matches = params.p_expected_at_seq === snapshot.at_seq && params.p_at_seq === String(head)
        && params.p_expected_writer_id === snapshot.writer_id && params.p_expected_writer_epoch === snapshot.writer_epoch
        && BigInt(params.p_writer_epoch) > BigInt(snapshot.writer_epoch);
      if (matches) snapshot = { at_seq: params.p_at_seq, snapshot: params.p_snapshot,
        encoding_version: params.p_encoding_version, writer_id: params.p_writer_id, writer_epoch: params.p_writer_epoch };
      data = { stored: matches, at_seq: params.p_at_seq, writer_id: params.p_writer_id,
        writer_epoch: params.p_writer_epoch, encoding_version: params.p_encoding_version,
        ...(matches ? { snapshot_sha256: hexHash(params.p_snapshot) } : {}) };
    } else throw new Error(`Unexpected owned fixture RPC: ${name}`);
    return { data: { ...envelope, ...data }, error: null };
  };
  const client = {
    rpc: (name, params) => invoke(name, params, 'handle'),
    from() { throw new Error('Checked bootstrap must not use unscoped table APIs'); },
    channel(topic) {
      const channel = { topic, handlers: [], on(type, filter, callback) { this.handlers.push({ type, filter, callback }); return this; },
        subscribe(callback) { this.status = callback; return this; } };
      channels.push(channel); return channel;
    },
    removeChannel: async () => {},
  };
  const reader = createDocumentGenerationReader({
    getActorUserId: () => actor,
    request: (name, params) => invoke(name, params, 'reader'),
    download: async () => { downloadCount++; return new Blob([pdfBytes], { type: 'application/pdf' }); },
  });
  const indexedDb = new IDBFactory();
  const store = async () => { const result = await createAnnotationOutbox({ indexedDb }); stores.push(result); return result; };
  t.after(async () => {
    for (const handle of handles) await handle.destroy();
    for (const item of stores) await item.close();
    state.destroy(); purgeYDocsByPrefix(`annoflat:${documentId}:`);
  });
  return { documentId, calls, channels, rows, client, add, store,
    get downloadCount() { return downloadCount; },
    setCurrent: value => { current = value; }, rejectAppends: () => { rejectAppends = true; },
    failNextTail: code => { tailError = code; },
    advanceSnapshot() {
      snapshot = { at_seq: String(head), snapshot: hex(Y.encodeStateAsUpdate(state)),
        encoding_version: 1, writer_id: 'new-checkpoint-writer', writer_epoch: '12' };
    },
    read: () => reader.open({ documentId, actorUserId: actor, pdfGenerationId: generation }),
    async open(checkedBundle, options = {}) {
      const handle = await openAnnotationDoc({ documentId, actorUserId: actor, pdfGenerationId: generation,
        checkedBundle, supabase: client, outboxStore: await store(), enableLocal: false,
        enableRealtime: false, writerId: 'new-open-writer', snapshotRetryDelayMs: 0, ...options });
      handles.push(handle); return handle;
    },
  };
}

function pendingRecord(documentId, status = 'pending') {
  const local = createDetachedYDoc(); local.getMap(META_MAP).set('recovered-local', 'must survive');
  const update = Y.encodeStateAsUpdate(local); local.destroy();
  const record = { documentId, actorUserId: actor, pdfGenerationId: generation,
    writerId: 'previous-open-writer', clientSeq: 1, ordinal: 1, incarnation: 0,
    status, update, checkpointUpdate: new Uint8Array(update), dependsOn: [] };
  record.key = annotationOutboxRecordKey(record); return record;
}

test('checked reader state reaches the durable handle with only a new-tail read', async t => {
  const f = await fixture(t), bundle = await f.read();
  assert.equal(bundle.throughSeq, '5');
  f.add('between-read-and-handle', 'included');
  const handle = await f.open(bundle);
  for (const [key, expected] of [['baseline', 'checked'], ['tail-one', 'accepted'],
    ['tail-two', 'accepted'], ['between-read-and-handle', 'included']]) assert.equal(handle.getMeta(key), expected);
  assert.equal(handle.actorUserId, actor); assert.equal(handle.pdfGenerationId, generation);
  assert.equal(f.downloadCount, 1);
  const handleCalls = f.calls.filter(call => call.phase === 'handle');
  assert.equal(handleCalls.some(call => call.name === 'read_annotation_snapshot_v2'), false,
    'The handle consumes the checked checkpoint instead of downloading it again');
  const tails = handleCalls.filter(call => call.name === 'read_annotation_updates_v2');
  assert.equal(tails.length, 1); assert.equal(tails[0].params.p_after_seq, '5');
  assert.equal((await handle.flushLocalDurability()).pdfGenerationId, generation);
});

test('first saved checkpoint keeps the checked snapshot CAS base distinct from the read frontier', async t => {
  const f = await fixture(t), bundle = await f.read();
  assert.deepEqual(bundle.snapshotBase, { atSeq: '3', writerId: 'checkpoint-writer', writerEpoch: '7' });
  assert.equal(bundle.throughSeq, '5');
  const handle = await f.open(bundle);
  handle.setMeta('new-local-edit', 'saved'); await handle.drain();
  assert.equal(await handle.flushSnapshot(), true);
  const writes = f.calls.filter(call => call.name === 'store_annotation_snapshot_v2');
  assert.equal(writes.length, 1, 'Correct initial CAS needs no snapshot conflict retry');
  assert.equal(writes[0].params.p_expected_at_seq, '3');
  assert.equal(writes[0].params.p_expected_writer_id, 'checkpoint-writer');
  assert.equal(writes[0].params.p_expected_writer_epoch, '7');
  assert.equal(writes[0].params.p_at_seq, '6');
  assert.equal(f.calls.some(call => call.phase === 'handle' && call.name === 'read_annotation_snapshot_v2'), false);
});

test('first realtime join catches only missing rows while reconnect refreshes checked state', async t => {
  const f = await fixture(t), bundle = await f.read(), handle = await f.open(bundle, { enableRealtime: true });
  assert.equal(f.channels.length, 1);
  f.add('join-gap', 'kept');
  await f.channels[0].status('SUBSCRIBED');
  assert.equal(handle.getMeta('join-gap'), 'kept');
  assert.equal(f.calls.some(call => call.phase === 'handle' && call.name === 'read_annotation_snapshot_v2'), false);
  assert.deepEqual(f.calls.filter(call => call.phase === 'handle' && call.name === 'read_annotation_updates_v2')
    .map(call => call.params.p_after_seq), ['5', '5']);
  await f.channels[0].status('CHANNEL_ERROR');
  f.add('reconnect-gap', 'kept');
  await f.channels[0].status('SUBSCRIBED');
  assert.equal(handle.getMeta('reconnect-gap'), 'kept');
  assert.equal(f.calls.filter(call => call.phase === 'handle' && call.name === 'read_annotation_snapshot_v2').length, 1);
});

test('wrong actor generation document and forged bundles reject before registry or storage work', async t => {
  const f = await fixture(t), bundle = await f.read();
  for (const changes of [{ actorUserId: id(91) }, { pdfGenerationId: successor },
    { documentId: id(92) }, { pdfGenerationId: null }, { checkedBundle: { ...bundle } },
    { checkedBundle: Object.create(bundle) }]) {
    let storageTouches = 0;
    const untouchedStore = new Proxy({}, { get() { storageTouches++; throw new Error('Rejected bootstrap touched storage'); } });
    const options = { documentId: f.documentId, actorUserId: actor, pdfGenerationId: generation,
      checkedBundle: bundle, supabase: f.client, enableLocal: false, enableRealtime: false,
      outboxStore: untouchedStore, ...changes };
    const registryKey = `annoflat:${options.documentId}:${options.actorUserId}${options.pdfGenerationId === null ? '' : `:pdf-generation:${options.pdfGenerationId}`}`;
    assert.equal(summarizeRegisteredYDoc(registryKey).state, 'absent');
    const count = f.calls.length;
    await assert.rejects(openAnnotationDoc(options), { code: 'DOCUMENT_OPEN_INPUT' });
    assert.equal(storageTouches, 0); assert.equal(f.calls.length, count);
    assert.equal(summarizeRegisteredYDoc(registryKey).state, 'absent');
  }
});

test('mutating public reader bytes cannot poison the private accepted bootstrap', async t => {
  const f = await fixture(t), bundle = await f.read();
  bundle.annotationUpdate.fill(0);
  const handle = await f.open(bundle);
  assert.equal(handle.getMeta('baseline'), 'checked');
  assert.equal(handle.getMeta('tail-one'), 'accepted');
  assert.equal(handle.getMeta('tail-two'), 'accepted');
  assert.equal(handle.doc.store.pendingStructs, null); assert.equal(handle.doc.store.pendingDs, null);
  assert.equal(f.calls.some(call => call.phase === 'handle' && call.name === 'read_annotation_snapshot_v2'), false);
});

for (const alreadyAccepted of [false, true]) test(`checked bootstrap settles the exact ${alreadyAccepted ? 'ambiguous accepted' : 'pending'} operation receipt`, async t => {
  const f = await fixture(t), store = await f.store(), record = pendingRecord(f.documentId, alreadyAccepted ? 'ambiguous' : 'pending');
  await store.put(record);
  if (alreadyAccepted) await f.client.rpc('append_annotation_update_v2', { p_document_id: f.documentId,
    p_generation_id: generation, p_client_id: record.writerId, p_client_seq: '1', p_data: hex(record.update) });
  const bundle = await f.read(), before = f.calls.length;
  const handle = await f.open(bundle);
  assert.equal(handle.getMeta('recovered-local'), 'must survive');
  const replay = f.calls.slice(before).filter(call => call.name === 'append_annotation_update_v2');
  assert.equal(replay.length, 1, 'Bundle state alone is not an operation receipt');
  assert.equal(replay[0].params.p_client_id, record.writerId);
  assert.equal(replay[0].params.p_client_seq, '1'); assert.equal(replay[0].params.p_data, hex(record.update));
  assert.equal(f.rows.filter(row => row.client_id === record.writerId).length, 1, 'Replay does not duplicate an accepted WAL row');
  assert.deepEqual(await store.list(f.documentId, actor, { pdfGenerationId: generation }), []);
  const clean = await store.loadCleanState(f.documentId, actor, { pdfGenerationId: generation });
  assert.ok(clean.acceptedKeys.includes(record.key) || clean.records.some(item => item.key === record.key));
});

test('checked bootstrap quarantines a rejected saved operation without losing accepted content', async t => {
  const f = await fixture(t), store = await f.store(), record = pendingRecord(f.documentId);
  await store.put(record); const bundle = await f.read(); f.rejectAppends();
  const handle = await f.open(bundle);
  assert.equal(handle.getMeta('recovered-local'), undefined);
  assert.equal(handle.getMeta('baseline'), 'checked'); assert.equal(handle.getMeta('tail-two'), 'accepted');
  const quarantined = await store.listQuarantined(f.documentId, actor, { pdfGenerationId: generation });
  assert.ok(quarantined.some(item => item.key === record.key && Buffer.from(item.update).equals(Buffer.from(record.update))));
  assert.equal(f.rows.some(row => row.client_id === record.writerId), false);
  assert.equal(f.calls.filter(call => call.name === 'append_annotation_update_v2').length, 1);
});

test('a newer checkpoint after bundle issuance refreshes CAS without losing the local edit', async t => {
  const f = await fixture(t), bundle = await f.read();
  f.add('new-peer-checkpoint', 'preserved'); f.advanceSnapshot();
  const handle = await f.open(bundle);
  assert.equal(handle.getMeta('new-peer-checkpoint'), 'preserved');
  handle.setMeta('local-after-new-checkpoint', 'preserved'); await handle.drain();
  assert.equal(await handle.flushSnapshot(), true);
  const writes = f.calls.filter(call => call.name === 'store_annotation_snapshot_v2');
  assert.equal(writes.length, 2);
  assert.deepEqual(writes.map(call => [call.params.p_expected_at_seq, call.params.p_expected_writer_id,
    call.params.p_expected_writer_epoch]), [['3', 'checkpoint-writer', '7'], ['6', 'new-checkpoint-writer', '12']]);
  assert.ok(writes.every(call => call.params.p_at_seq === '7'));
  assert.equal(handle.getMeta('local-after-new-checkpoint'), 'preserved');
  assert.equal(handle.getMeta('new-peer-checkpoint'), 'preserved');
});

test('failed first-join delta keeps saved state and a later reconnect can recover', async t => {
  const f = await fixture(t), bundle = await f.read(), handle = await f.open(bundle, { enableRealtime: true });
  f.add('join-recovery', 'eventually visible'); f.failNextTail('40001');
  await f.channels[0].status('SUBSCRIBED');
  assert.equal(handle.getMeta('join-recovery'), undefined);
  assert.equal(handle.getMeta('baseline'), 'checked'); assert.equal(handle.getSyncStatus().healthy, false);
  assert.equal(f.calls.some(call => call.phase === 'handle' && call.name === 'read_annotation_snapshot_v2'), false);
  await f.channels[0].status('CHANNEL_ERROR'); await f.channels[0].status('SUBSCRIBED');
  assert.equal(handle.getMeta('join-recovery'), 'eventually visible');
  assert.equal(handle.getSyncStatus().healthy, true);
  assert.equal(f.calls.filter(call => call.phase === 'handle' && call.name === 'read_annotation_snapshot_v2').length, 1);
});

test('generation replacement before the bootstrap tail rejects open and preserves queued recovery', async t => {
  const f = await fixture(t), store = await f.store(), record = pendingRecord(f.documentId);
  await store.put(record); const bundle = await f.read(), rpc = f.client.rpc;
  f.client.rpc = async (name, params) => {
    const result = await rpc(name, params);
    if (name === 'read_annotation_writer_sequence_v2') f.setCurrent(successor);
    return result;
  };
  await assert.rejects(f.open(bundle), { code: 'SG002' });
  assert.ok(f.calls.some(call => call.phase === 'handle' && call.name === 'read_annotation_updates_v2'));
  assert.equal(f.calls.some(call => call.name === 'append_annotation_update_v2' || call.name === 'store_annotation_snapshot_v2'), false);
  const recovery = await store.readRetiredScope(f.documentId, actor, 0, { pdfGenerationId: generation });
  assert.equal(recovery.retirement.replacementGenerationId, successor);
  assert.equal(recovery.quarantined.length, 1); assert.equal(recovery.quarantined[0].key, record.key);
  assert.deepEqual(recovery.quarantined[0].update, record.update);
});

test('malformed intervening tail cannot install partial accepted bootstrap bytes', async t => {
  const f = await fixture(t), store = await f.store(), bundle = await f.read();
  const before = await store.loadCleanState(f.documentId, actor, { pdfGenerationId: generation });
  f.add('first-new-row', 'must not install alone');
  f.add('bad-new-row', 'invalid').data = '\\xff';
  await assert.rejects(f.open(bundle), { code: 'ANNOTATION_GENERATION_STATE' });
  assert.deepEqual(await store.loadCleanState(f.documentId, actor, { pdfGenerationId: generation }), before);
  assert.equal(f.calls.some(call => call.name === 'append_annotation_update_v2' || call.name === 'store_annotation_snapshot_v2'), false);
});
