// 2026-10-07 (owner-approved: "you can change the save path for the
// first-open import"). The first open of a PDF that carries its own markup
// (Package 2: ~3,000 marks) used to save that markup as ~25 WAL rows on the
// same queue as the user's edits: the first edit was saved only after all of
// them (6 s and more). The import now takes a "bulk lane":
//   * written by its own Yjs client, saved as ONE checkpoint (accepted state
//     plus the import), never as WAL rows;
//   * the user's edits go straight to the WAL meanwhile; only an edit of an
//     imported mark waits for that checkpoint (a row may never name bytes no
//     reader can get);
//   * screens already open learn about it from one small notice row and take
//     the stored checkpoint in;
//   * a reload before the checkpoint was stored saves the device's copy the
//     same way on the next open, with nothing doubled.
// These tests pin each of those, plus the store and worker pieces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { BULK_CHECKPOINT_NOTICE_KEY, openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { getAnnotationsMap, syncByPageToDoc } from '../src/services/annotationDocStore.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import {
  createCheckpointMirror,
  gunzipBytes,
  mergeCheckpointWithUpdate,
  pgHexToBytes,
  runCheckpointRequest,
} from '../src/services/annotationCheckpointCore.js';
import { createCloud, openFor, settle, until } from './helpers/liveSyncFakeCloud.mjs';

let docCounter = 0;
let DOC = '00000000-0000-4000-8000-0000000b01c0';
// A fresh document per test (module-level registries are per document).
const nextDoc = () => { docCounter += 1; DOC = `00000000-0000-4000-8000-${String(0xb01c0 + docCounter).padStart(12, '0')}`; return DOC; };

const importedMark = (page, index) => {
  const id = `pdf-embedded-${page}-${index}`;
  return {
    type: 'rect',
    left: 10 + index,
    top: 20 + page,
    width: 30,
    height: 12,
    fill: 'transparent',
    stroke: '#d81e1e',
    strokeWidth: 1,
    opacity: 1,
    isPdfImported: true,
    pdfAnnotationId: id,
    pdfAnnotationType: 'Square',
    id,
    data: { id, type: 'shape' },
  };
};
const userRect = (id, extra = {}) => ({
  type: 'rect',
  left: 300,
  top: 300,
  width: 80,
  height: 40,
  fill: 'transparent',
  stroke: '#0000ff',
  strokeWidth: 2,
  opacity: 1,
  data: { id, type: 'shape', authorId: 'user-a' },
  ...extra,
});
function importByPage(pages = 3, perPage = 40) {
  const byPage = {};
  for (let page = 1; page <= pages; page += 1) {
    byPage[page] = { objects: Array.from({ length: perPage }, (_, index) => importedMark(page, index)) };
  }
  return byPage;
}
const idsOf = (byPage) => Object.values(byPage || {}).flatMap((page) => (page?.objects || []).map((o) => String(o?.data?.id ?? o?.id)));
const rowHolds = (row, id) => Buffer.from(String(row.data).replace(/^\\x/, ''), 'hex').includes(Buffer.from(id));

// The fake cloud's checkpoint RPC with the real function's compare-and-set
// (supabase/migrations/20260727131230): at_seq must be the log head, and the
// expected base must be the stored row. `gate`: a promise the next write waits for.
function withSnapshotCas(cloud, client) {
  const inner = client.supabase.rpc.bind(client.supabase);
  client.casRefusals = 0;
  client.snapshotWrites = 0;
  client.supabase.rpc = async (name, args) => {
    if (name !== 'store_annotation_snapshot') return inner(name, args);
    client.snapshotWrites += 1;
    if (client.snapshotGate) await client.snapshotGate;
    const current = cloud.snapshot;
    const head = cloud.rows.length;
    const baseMatches = current
      ? (Number(current.at_seq) === Number(args.p_expected_at_seq)
        && (current.writer_id ?? null) === (args.p_expected_writer_id ?? null)
        && Number(current.writer_epoch) === Number(args.p_expected_writer_epoch)
        && Number(current.writer_epoch) < Number(args.p_writer_epoch))
      : (args.p_expected_at_seq == null && Number(args.p_writer_epoch) > 0);
    if (head !== Number(args.p_at_seq) || !baseMatches) {
      client.casRefusals += 1;
      return { data: false, error: null };
    }
    return inner(name, args);
  };
  return client;
}

async function storedDoc(cloud) {
  const doc = new Y.Doc();
  const snapshot = cloud.snapshot;
  let after = 0;
  if (snapshot?.snapshot) {
    let bytes = pgHexToBytes(snapshot.snapshot);
    if (snapshot.encoding_version === 2) bytes = await gunzipBytes(bytes);
    Y.applyUpdate(doc, bytes);
    after = Number(snapshot.at_seq) || 0;
  }
  for (const row of cloud.rows.filter((r) => r.seq > after)) Y.applyUpdate(doc, pgHexToBytes(row.data));
  return doc;
}

const openWriter = (cloud, actor, extra = {}) => openFor(withSnapshotCas(cloud, cloud.makeClient(actor)), DOC, extra);

test('the store writes a bulk import in its own transactions and says which marks went that way', { timeout: 30_000 }, () => {
  const doc = new Y.Doc();
  syncByPageToDoc(doc, { 1: { objects: [importedMark(1, 0)] } });
  const origins = [];
  doc.on('update', (_update, origin) => origins.push(origin));
  let lanes = 0;
  const byPage = { 1: { objects: [importedMark(1, 0), importedMark(1, 1), importedMark(1, 2), userRect('mine-1')] } };
  const result = syncByPageToDoc(doc, byPage, {
    bulkKeys: new Set(['pdf-embedded-1-0', 'pdf-embedded-1-1', 'pdf-embedded-1-2']),
    bulkOrigin: 'bulk',
    bulkTransact: (run) => { lanes += 1; run(); },
  });
  // pdf-embedded-1-0 was already stored: never re-written as an import.
  assert.deepEqual(result.bulkWritten, ['pdf-embedded-1-1', 'pdf-embedded-1-2']);
  assert.equal(lanes, 1);
  assert.deepEqual(origins, ['bulk', 'local']);
  assert.equal(getAnnotationsMap(doc).size, 4);
});

test('the checkpoint worker merges an import into the mirror\'s bytes without changing the mirror', { timeout: 30_000 }, async () => {
  const accepted = new Y.Doc();
  syncByPageToDoc(accepted, { 1: { objects: [userRect('a')] } });
  const imported = new Y.Doc();
  syncByPageToDoc(imported, importByPage(2, 5));
  const extra = Y.encodeStateAsUpdate(imported);
  const mirrors = new Map();
  await runCheckpointRequest(mirrors, { op: 'mirror-apply', mirrorId: 'm', update: Y.encodeStateAsUpdate(accepted) });
  const { reply } = await runCheckpointRequest(mirrors, {
    op: 'mirror-checkpoint', mirrorId: 'm', expectedApplied: 1, expectedVector: Y.encodeStateVector(accepted), extraUpdate: extra,
  });
  const out = new Y.Doc();
  Y.applyUpdate(out, await gunzipBytes(pgHexToBytes(reply.hex)));
  assert.equal(getAnnotationsMap(out).size, 11);
  assert.equal(getAnnotationsMap(mirrors.get('m').doc).size, 1, 'the mirror only takes the import in once it is accepted');
  const merged = new Y.Doc();
  Y.applyUpdate(merged, mergeCheckpointWithUpdate(Y.encodeStateAsUpdate(accepted), extra));
  assert.deepEqual(merged.getMap('marks').toJSON(), out.getMap('marks').toJSON());
  assert.ok(createCheckpointMirror());
});

test('an import is saved as one checkpoint, and an edit made meanwhile is saved at once, not behind it', { timeout: 30_000 }, async () => {
  const cloud = createCloud(nextDoc());
  const client = withSnapshotCas(cloud, cloud.makeClient('user-a'));
  const a = await openFor(client, DOC);
  const imported = importByPage(3, 40);
  // Hold the checkpoint upload: the import is "being saved".
  let release;
  client.snapshotGate = new Promise((resolve) => { release = resolve; });
  a.applyByPage(imported, { bulkKeys: new Set(idsOf(imported)) });
  await until(() => client.snapshotWrites > 0);
  // The user draws while the import is still on its way.
  a.applyByPage({ ...a.getByPage(), 1: { objects: [...a.getByPage()[1].objects, userRect('mine-1')] } });
  assert.ok(await until(() => cloud.rows.some((row) => rowHolds(row, 'mine-1')), { timeoutMs: 2_000 }), 'the edit reached the log while the import checkpoint was still uploading');
  assert.equal(cloud.snapshot, null, 'the import is not stored yet');
  release();
  client.snapshotGate = null;
  assert.equal(await a.whenBulkSaved(), true);
  await a.drain();
  // No WAL row carries an imported mark: one checkpoint holds them all.
  for (const id of idsOf(imported)) {
    assert.equal(cloud.rows.some((row) => rowHolds(row, id)), false, `${id} not in a WAL row`);
  }
  // Rows: the user's rectangle and the small notice. The first checkpoint
  // was refused (the rectangle moved the head) and built again.
  assert.ok(cloud.rows.length <= 2, `rows: ${cloud.rows.length}`);
  assert.ok(cloud.rows.every((row) => String(row.data).length < 8_000));
  const stored = await storedDoc(cloud);
  const marks = getAnnotationsMap(stored);
  assert.equal(marks.size, 121);
  const notice = stored.getMap('annoMeta').get(BULK_CHECKPOINT_NOTICE_KEY);
  assert.ok(Array.isArray(notice?.clients) && notice.clients.length === 1);
  // A fresh screen sees every mark exactly once.
  const fresh = await openWriter(cloud, 'user-b');
  const ids = idsOf(fresh.getByPage());
  assert.equal(ids.length, 121);
  assert.equal(new Set(ids).size, 121);
  assert.equal(a.getSyncStatus().queueSize, 0);
  await a.destroy();
  await fresh.destroy();
});

test('an edit of an imported mark waits for the import checkpoint, then is saved', { timeout: 30_000 }, async () => {
  const cloud = createCloud(nextDoc());
  const client = withSnapshotCas(cloud, cloud.makeClient('user-a'));
  const a = await openFor(client, DOC);
  const imported = importByPage(1, 20);
  let release;
  client.snapshotGate = new Promise((resolve) => { release = resolve; });
  a.applyByPage(imported, { bulkKeys: new Set(idsOf(imported)) });
  await until(() => client.snapshotWrites > 0);
  // Recolour an imported mark while its checkpoint is still on the way.
  const screen = a.getByPage();
  a.applyByPage({ 1: { objects: screen[1].objects.map((o) => (o.id === 'pdf-embedded-1-3' ? { ...o, stroke: '#00ff00' } : o)) } });
  await settle(150);
  assert.equal(cloud.rows.length, 0, 'the edit waits: its row would name bytes no reader can get yet');
  assert.equal(a.getSyncStatus().stage, 'pending');
  release();
  client.snapshotGate = null;
  assert.equal(await a.whenBulkSaved(), true);
  await a.drain();
  const stored = await storedDoc(cloud);
  const fresh = await openWriter(cloud, 'user-b');
  const mark = fresh.getByPage()[1].objects.find((o) => (o?.data?.id ?? o?.id) === 'pdf-embedded-1-3');
  assert.equal(mark?.stroke, '#00ff00');
  assert.equal(getAnnotationsMap(stored).size, 20);
  await a.destroy();
  await fresh.destroy();
});

test('a screen already open takes the import in from the checkpoint; every mark once', { timeout: 30_000 }, async () => {
  const cloud = createCloud(nextDoc());
  const b = await openWriter(cloud, 'user-b');
  const a = await openWriter(cloud, 'user-a');
  const imported = importByPage(3, 30);
  a.applyByPage(imported, { bulkKeys: new Set(idsOf(imported)) });
  assert.equal(await a.whenBulkSaved(), true);
  await a.drain();
  assert.ok(await until(() => idsOf(b.getByPage()).length === 90, { timeoutMs: 3_000 }), `B has ${idsOf(b.getByPage()).length} marks`);
  assert.equal(new Set(idsOf(b.getByPage())).size, 90);
  // B builds its next checkpoint on the stored one (no refusal, no re-download).
  b.applyByPage({ ...b.getByPage(), 1: { objects: [...b.getByPage()[1].objects, userRect('b-1')] } });
  await b.drain();
  assert.equal((await b.flushSnapshot()), true);
  const stored = await storedDoc(cloud);
  assert.equal(getAnnotationsMap(stored).size, 91);
  await a.destroy();
  await b.destroy();
});

test('a reload before the import checkpoint was stored saves the device copy once, with nothing doubled', { timeout: 30_000 }, async () => {
  const previousIndexedDb = globalThis.indexedDB;
  globalThis.indexedDB = {};
  try {
    const cloud = createCloud(nextDoc());
    // This device's IndexedDB copy and outbox survive the reload.
    const deviceCopy = new Y.Doc();
    const outbox = createMemoryAnnotationOutbox();
    const local = {
      outboxStore: outbox,
      enableLocal: true,
      walUpdateMaxBytes: 4_096,
      localPersistenceFactory: async (_name, target) => {
        Y.applyUpdate(target, Y.encodeStateAsUpdate(deviceCopy));
        target.on('update', (update) => Y.applyUpdate(deviceCopy, update));
        return { synced: true, destroy() {} };
      },
      legacyPersistenceFactory: async () => ({ synced: true, destroy() {}, async clearDocument() {} }),
    };
    const first = withSnapshotCas(cloud, cloud.makeClient('user-a'));
    let killFirst;
    // The tab dies before its checkpoint is stored.
    first.snapshotGate = new Promise((_resolve, reject) => { killFirst = reject; });
    first.snapshotGate.catch(() => {});
    const a = await openFor(first, DOC, { ...local, requestTimeoutMs: 60_000 });
    const imported = importByPage(3, 40);
    a.applyByPage(imported, { bulkKeys: new Set(idsOf(imported)) });
    a.applyByPage({ ...a.getByPage(), 1: { objects: [...a.getByPage()[1].objects, userRect('mine-1')] } });
    assert.ok(await until(() => cloud.rows.some((row) => rowHolds(row, 'mine-1'))));
    assert.ok(await until(() => first.snapshotWrites > 0));
    first.online = false; // reload: this tab is gone
    assert.equal(cloud.snapshot, null);
    assert.equal(getAnnotationsMap(deviceCopy).size, 121, 'the device copy holds the import');

    const second = withSnapshotCas(cloud, cloud.makeClient('user-a'));
    const reopened = await openFor(second, DOC, local);
    // The screen shows the marks at once (the device copy), and saves them.
    assert.equal(idsOf(reopened.getByPage()).length, 121);
    assert.equal(await reopened.whenBulkSaved(), true);
    await reopened.drain();
    // The reopened screen's own import pass finds every mark there already.
    const again = reopened.applyByPage({ ...reopened.getByPage() }, { bulkKeys: new Set(idsOf(imported)) });
    assert.equal(again.bulkWritten, undefined);
    await reopened.drain();
    for (const id of idsOf(imported)) {
      assert.equal(cloud.rows.some((row) => rowHolds(row, id)), false, `${id} not in a WAL row`);
    }
    globalThis.indexedDB = previousIndexedDb; // another device, no local copy
    const fresh = await openWriter(cloud, 'user-b');
    const ids = idsOf(fresh.getByPage());
    assert.equal(ids.length, 121);
    assert.equal(new Set(ids).size, 121);
    const expected = new Y.Doc();
    syncByPageToDoc(expected, { ...imported, 1: { objects: [...imported[1].objects, userRect('mine-1')] } });
    const plain = (doc) => Object.fromEntries([...getAnnotationsMap(doc).entries()].map(([key, value]) => [key, value.toJSON().o]));
    assert.deepEqual(plain(await storedDoc(cloud)), plain(expected), 'the saved bytes decode to the same marks');
    await reopened.destroy();
    await fresh.destroy();
    // The dead tab's handle: its requests fail now, so it winds down.
    first.supabase.rpc = async () => ({ data: null, error: { message: 'tab gone', code: 'XX000' } });
    killFirst(new Error('tab gone'));
    await a.destroy();
  } finally {
    globalThis.indexedDB = previousIndexedDb;
  }
});

test('a refused import checkpoint is built again and stored; nothing is lost', { timeout: 30_000 }, async () => {
  const cloud = createCloud(nextDoc());
  const other = await openWriter(cloud, 'user-b');
  const client = withSnapshotCas(cloud, cloud.makeClient('user-a'));
  const a = await openFor(client, DOC);
  const imported = importByPage(2, 25);
  let release;
  client.snapshotGate = new Promise((resolve) => { release = resolve; });
  a.applyByPage(imported, { bulkKeys: new Set(idsOf(imported)) });
  await until(() => client.snapshotWrites > 0);
  // Another screen writes while the upload is on its way: the head moves.
  other.applyByPage({ 1: { objects: [userRect('theirs-1')] } });
  await other.drain();
  release();
  client.snapshotGate = null;
  assert.equal(await a.whenBulkSaved(), true);
  await a.drain();
  assert.ok(client.casRefusals >= 1, 'the first upload was refused');
  const stored = await storedDoc(cloud);
  assert.equal(getAnnotationsMap(stored).size, 51);
  await a.destroy();
  await other.destroy();
});
