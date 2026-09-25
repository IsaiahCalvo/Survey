// w35 (2026-09-25): the one-time store compaction (w33) together with live
// edits (w32) and the checkpoint cadence (w33). Each branch was reviewed
// alone; the combined review found:
//   A. the compaction went out as a w32 v2 live edit (whole copies of every
//      compacted mark on a small store), so other screens showed those marks
//      as this screen's in-flight edit: an erase of one was cancelled as a
//      conflict (and their own unsaved change of it reverted) until the row
//      landed;
//   B. a routine checkpoint already encoding when the compaction ran reset
//      the owed flags and its acceptance cleared "must write", so the
//      compaction's own checkpoint was never written (fresh opens kept
//      downloading the big old checkpoint until the next 40-row boundary).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { createCloud, deferred, openFor, until, settle } from './helpers/liveSyncFakeCloud.mjs';
import { openAnnotationDoc } from '../src/services/annotationDocSync.js';
import { createMemoryAnnotationOutbox } from '../src/services/annotationDocOutbox.js';
import { derivePolygonsFromPath } from '../src/services/annotationMarkCodec.js';
import { MARKS_MAP } from '../src/services/annotationMarkStore.js';
import { META_MAP } from '../src/services/annotationDocStore.js';
import { EMBEDDED_IMPORT_MARKER_KEY } from '../src/utils/embeddedImportGate.js';
import { LIVE_EDIT_FLAG } from '../src/services/annotationLiveOverlay.js';
import { buildEraseIntent } from '../src/utils/annotationEraseTransaction.js';
import { prepareEraseIntentForCommit } from '../src/utils/annotationEraseCommitPlan.js';

const square = (s, x = 0) => [['M', x, 0], ['L', x + s, 0], ['L', x + s, s], ['L', x, s], ['Z']];

// An imported ink mark as stores written before w33 hold it: explicit
// derivable polygons and the provenance field.
function legacyInkMark(doc, key, x) {
  const toY = (value) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const map = new Y.Map();
      for (const [k, v] of Object.entries(value)) if (v !== undefined) map.set(k, toY(v));
      return map;
    }
    return structuredClone(value);
  };
  const path = square(10, x);
  const o = new Y.Map();
  o.set('#pointGeometry', { left: x, top: 0, width: 10, height: 10, path });
  o.set('type', 'path');
  o.set('fill', '#ff0000');
  o.set('fillRule', 'nonzero');
  o.set('isPdfImported', true);
  o.set('pdfAnnotationId', `pdf-${key}`);
  o.set('polygons', derivePolygonsFromPath(path, 'nonzero'));
  o.set('data', toY({ id: key, pdfInkSourceGeometry: { kind: 'appearance-path', inkLists: [[1, 2, 3, 4]] } }));
  const mark = new Y.Map();
  mark.set('p', 1);
  mark.set('o', o);
  doc.getMap(MARKS_MAP).set(key, mark);
}

test('the store compaction is never a live message, and another screen can erase those marks meanwhile', async () => {
  const cloud = createCloud('w35-compaction-live');
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, 'w35-compaction-live');
  const b = await openFor(bob, 'w35-compaction-live');
  try {
    assert.ok(await until(() => a.isRealtimeReady() && b.isRealtimeReady()));
    a.doc.transact(() => {
      for (let i = 0; i < 5; i += 1) legacyInkMark(a.doc, `ink${i}`, i * 20);
      a.doc.getMap(META_MAP).set(EMBEDDED_IMPORT_MARKER_KEY, { at: 'x', count: 5 });
    }, 'local');
    await a.drain();
    assert.ok(await until(() => (b.getByPage()?.[1]?.objects || []).length === 5));
    await settle(50);
    cloud.sent.length = 0;

    const gate = deferred();
    alice.appendGate = gate.promise; // the compaction's row is still on its way
    const result = a.compactAnnotationStore();
    assert.ok(result.marksCompacted > 0, 'the pass had work to do');
    await settle(50);
    assert.deepEqual(cloud.sent.map((m) => m.payload?.v), [], 'no live message for the compaction');

    const screen = b.withLiveOverlays(b.getByPage());
    assert.equal(
      screen[1].objects.filter((o) => typeof o?.[LIVE_EDIT_FLAG] === 'string').length,
      0,
      'no mark on the other screen is shown as an in-flight edit',
    );
    const before = screen[1].objects.find((o) => o?.data?.id === 'ink0');
    const intent = prepareEraseIntentForCommit({
      intent: buildEraseIntent({
        mutationId: 'w35-erase-during-compaction',
        pageNumber: 1,
        renderer: 'svg',
        gesture: { points: [{ x: 1, y: 1 }], radius: 4, mode: 'full' },
        targets: [{
          domain: 'page-object', storageKey: 'ink0', kind: 'path', operation: 'delete',
          pageNumber: 1, index: 0, before, after: null,
        }],
      }),
      annotationsByPage: screen,
      userId: 'user-b',
      includeDeleteHistory: true,
    });
    const erase = await b.commitEraseIntent(intent, { permissionContext: { mode: 'local-only' } });
    assert.equal(erase.status, 'committed', `the erase was ${erase.status} (${erase.reason || ''})`);
    gate.resolve();
    alice.appendGate = null;
    await a.drain();
    await b.drain();
    assert.ok(await until(() => !(a.getByPage()?.[1]?.objects || []).some((o) => o?.data?.id === 'ink0')), 'the erase holds on both screens');
    assert.equal((b.getByPage()?.[1]?.objects || []).some((o) => o?.data?.id === 'ink0'), false);
  } finally {
    await Promise.all([a.destroy(), b.destroy()]);
  }
});

// A backend with a held snapshot identity read and a held append, so a
// routine checkpoint can be mid-flight while the compaction row is.
function gatedBackend(documentId) {
  const rows = [];
  let snapshot = null;
  const calls = [];
  const gates = { identity: null, append: null };
  const channels = new Set();
  const readBuilder = () => {
    let gtSeq = null; let selected = ''; const filters = new Map();
    const b = {
      select(c) { selected = c; return b; },
      eq(c, v) { filters.set(c, v); return b; },
      gt(_c, v) { gtSeq = Number(v); return b; },
      order() { return b; }, limit() { return b; }, abortSignal() { return b; },
      then(res, rej) {
        let data = rows.filter((row) => [...filters].every(([c, v]) => row[c] === v) && (gtSeq == null || row.seq > gtSeq));
        if (selected === 'client_seq') data = data.map((row) => ({ client_seq: row.client_seq })).sort((x, y) => y.client_seq - x.client_seq);
        return Promise.resolve({ data, error: null }).then(res, rej);
      },
    };
    return b;
  };
  const supabase = {
    async rpc(name, args) {
      if (name === 'append_annotation_update') {
        if (gates.append) await gates.append;
        const existing = rows.find((row) => row.client_id === args.p_client_id && row.client_seq === args.p_client_seq);
        if (existing) return { data: [{ seq: existing.seq }], error: null };
        const row = { document_id: documentId, client_id: args.p_client_id, client_seq: args.p_client_seq, actor_user_id: 'u', data: args.p_data, seq: rows.length + 1 };
        rows.push(row);
        for (const ch of channels) setTimeout(() => ch.deliver({ new: { ...row } }), 1);
        return { data: [{ seq: row.seq }], error: null };
      }
      if (name === 'store_annotation_snapshot') {
        const head = rows.length;
        const baseMatches = snapshot
          ? snapshot.at_seq === args.p_expected_at_seq && snapshot.writer_id === args.p_expected_writer_id
            && snapshot.writer_epoch === args.p_expected_writer_epoch && snapshot.writer_epoch < args.p_writer_epoch
          : (args.p_expected_at_seq == null && args.p_expected_writer_id == null && !args.p_expected_writer_epoch);
        const ok = head === args.p_at_seq && baseMatches;
        calls.push({ atSeq: args.p_at_seq, head, ok });
        if (!ok) return { data: false, error: null };
        snapshot = { snapshot: args.p_snapshot, at_seq: args.p_at_seq, encoding_version: args.p_encoding_version, writer_id: args.p_writer_id, writer_epoch: args.p_writer_epoch };
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${name}`);
    },
    channel() {
      let cb = null;
      const entry = { deliver: (p) => cb?.(p) };
      const channel = {
        __entry: entry,
        on(_e, _f, c) { cb = c; return channel; },
        subscribe(s) { channels.add(entry); setTimeout(() => s?.('SUBSCRIBED'), 0); return channel; },
      };
      return channel;
    },
    removeChannel(ch) { channels.delete(ch?.__entry); return Promise.resolve(); },
    from(table) {
      if (table === 'annotation_updates') return readBuilder();
      return {
        select(columns) {
          const wantsBody = /(^|[,\s])snapshot([,\s]|$)/.test(columns);
          const b = {
            eq() { return b; }, abortSignal() { return b; },
            async maybeSingle() {
              if (!wantsBody && gates.identity) await gates.identity;
              if (!snapshot) return { data: null, error: null };
              if (wantsBody) return { data: { ...snapshot }, error: null };
              const { snapshot: _s, ...identity } = snapshot;
              return { data: identity, error: null };
            },
          };
          return b;
        },
      };
    },
  };
  return { supabase, rows, calls, gates, get snapshot() { return snapshot; } };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const rect = (id) => ({ type: 'rect', left: 1, top: 1, width: 5, height: 5, stroke: '#f00', strokeWidth: 1, fill: 'transparent', data: { id, type: 'rect' } });

for (const race of [false, true]) {
  test(`the store compaction's checkpoint is written ${race ? 'even when a routine one is already running' : '(no race)'}`, async () => {
    const backend = gatedBackend(`w35-compaction-checkpoint-${race}`);
    const h = await openAnnotationDoc({
      documentId: `w35-compaction-checkpoint-${race}`,
      supabase: backend.supabase,
      clientId: 'a',
      actorUserId: 'u',
      enableLocal: false,
      enableRealtime: true,
      doc: new Y.Doc(),
      outboxStore: createMemoryAnnotationOutbox(),
      snapshotRetryDelayMs: 0,
      repairRetryDelayMs: 60_000,
      checkpointPolicy: { everyRows: 3, dueQuietMs: 30, idleMs: 300 },
    });
    try {
      await wait(30);
      // Row 1: a store as older builds left it (old map entries, carried over).
      h.doc.transact(() => {
        const legacy = h.doc.getMap('annotations');
        for (let i = 0; i < 20; i += 1) legacy.set(`old-${i}`, JSON.stringify({ page: 1, obj: rect(`old-${i}`) }));
        h.doc.getMap('annoMeta').set('legacyMarksCarriedIntoMarks', { at: 1 });
      }, 'local');
      await h.drain();
      let releaseIdentity = null;
      if (race) {
        const d = deferred();
        backend.gates.identity = d.promise;
        releaseIdentity = d.resolve;
      }
      // Rows 2-3: row 3 owns a boundary (everyRows 3) -> a due routine checkpoint.
      const mine = [];
      for (const id of ['s1', 's2']) { mine.push(rect(id)); h.applyByPage({ 1: { objects: [...mine] } }); }
      await h.drain();
      await wait(60); // the due timer fires; with the race its identity read is held
      const appendGate = deferred();
      backend.gates.append = appendGate.promise; // the compaction row is in flight
      const result = h.compactAnnotationStore({ notify: false });
      assert.ok(result.batches > 0, 'the pass wrote something');
      if (releaseIdentity) { releaseIdentity(); backend.gates.identity = null; }
      await wait(80); // the routine checkpoint encodes and uploads without the compaction row
      appendGate.resolve();
      backend.gates.append = null;
      await h.drain();
      await wait(700);
      const compactionSeq = backend.rows.length;
      assert.equal(compactionSeq, 4, 'three rows, then the compaction row');
      assert.equal(backend.snapshot?.at_seq, compactionSeq, `the stored checkpoint holds the compaction (calls ${JSON.stringify(backend.calls)})`);
    } finally {
      await h.destroy();
    }
  });
}

test('a recolour of a mark the compaction has not reached writes only its colour', async () => {
  const { readAnnotationEntry, writeAnnotationMark } = await import('../src/services/annotationMarkStore.js');
  const path = square(10);
  const doc = new Y.Doc();
  const o = new Y.Map();
  o.set('#pointGeometry', { left: 0, top: 0, width: 10, height: 10, path });
  o.set('type', 'path');
  o.set('fill', 'red');
  const explicit = derivePolygonsFromPath(path, 'nonzero');
  o.set('polygons', explicit);
  const data = new Y.Map();
  data.set('id', 'm');
  o.set('data', data);
  const mark = new Y.Map();
  mark.set('p', 1);
  mark.set('o', o);
  doc.getMap(MARKS_MAP).set('m', mark);
  const base = readAnnotationEntry(doc, 'm').o;
  const keys = [];
  doc.on('afterTransaction', (tr) => tr.changed.forEach((changed) => changed.forEach((key) => keys.push(key))));
  writeAnnotationMark(doc, 'm', 1, { ...base, fill: 'blue' }, { base, basePage: 1, echoVersions: [base] });
  assert.deepEqual(keys, ['fill']);
  assert.deepEqual(doc.getMap(MARKS_MAP).get('m').get('o').get('polygons'), explicit, 'the explicit array stays for the compaction');
  // A path change still writes its new polygons (w33 review A).
  const moved = square(12);
  const after = readAnnotationEntry(doc, 'm').o;
  writeAnnotationMark(doc, 'm', 1, { ...after, path: moved, polygons: derivePolygonsFromPath(moved, 'nonzero') }, { base: after, basePage: 1 });
  assert.deepEqual(readAnnotationEntry(doc, 'm').o.polygons, derivePolygonsFromPath(moved, 'nonzero'));
});

test('a compaction row that ends in error does not make the screen upload checkpoints forever', async () => {
  // w35 pass C: the owed checkpoint re-arms only while the compaction row is
  // still on its way; a row that ended refused or in error never will be.
  const cloud = createCloud('w35-compaction-row-error');
  const alice = cloud.makeClient('user-a');
  const a = await openFor(alice, 'w35-compaction-row-error', { checkpointPolicy: { dueQuietMs: 50, idleMs: 200 } });
  try {
    assert.ok(await until(() => a.isRealtimeReady()));
    a.doc.transact(() => {
      for (let i = 0; i < 5; i += 1) legacyInkMark(a.doc, `ink${i}`, i * 20);
      a.doc.getMap(META_MAP).set(EMBEDDED_IMPORT_MARKER_KEY, { at: 'x', count: 5 });
    }, 'local');
    await a.drain();
    await settle(400);
    alice.appendError = { code: '23505', message: 'duplicate key' };
    const result = a.compactAnnotationStore();
    assert.ok(result.batches > 0);
    await settle(300);
    alice.appendError = null;
    const before = cloud.snapshotCalls;
    await settle(2_000);
    assert.ok(cloud.snapshotCalls - before <= 1, `${cloud.snapshotCalls - before} checkpoint uploads in 2 s while idle`);
  } finally {
    await a.destroy().catch(() => {});
  }
});
