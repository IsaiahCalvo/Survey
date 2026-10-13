// w26 (2026-09-24) — no single save may be huge.
//
// Opening "Package 2 - Rev 4 -- IC.pdf" (3,055 embedded ink marks) ran the
// one-time embedded import. Each page's marks were ONE Yjs transaction, so
// ONE WAL row: 0.8 to 8.8 MB (the old whole-object store: 0.8 to 7.9 MB for
// the same pages — the per-field layout added ~10%). Realtime could not carry
// those rows ("Unexpected end of array" on other screens), reading them back
// in a 1,000-row page hit the database statement timeout (the document then
// could not open at all), and the database went unhealthy.
//
// These tests pin the fix:
//   * splitYjsUpdate cuts an update into parts under the budget that rebuild
//     exactly the same document, at mark boundaries;
//   * the append path sends no row over the budget, whatever the writer
//     (a Package-2-sized import through the real viewer capture path);
//   * the tail read survives rows too big to return together;
//   * a Realtime row delivered without its data is read from the log;
//   * the embedded-import marker can never be seen without every part.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { openAnnotationDoc, __test } from '../src/services/annotationDocSync.js';
import { docToByPage, setMetaValue, getMetaValue } from '../src/services/annotationDocStore.js';
import { writeAnnotationMark, MARKS_MAP, readAnnotationEntry } from '../src/services/annotationMarkStore.js';
import { WAL_UPDATE_MAX_BYTES, splitYjsUpdate } from '../src/services/annotationUpdateSplit.js';
import { EMBEDDED_IMPORT_MARKER_KEY } from '../src/utils/embeddedImportGate.js';

const { bytesToPgHex, pgHexToBytes } = __test;

// ---------------------------------------------------------------------------
// A Package-2-shaped imported ink mark (~6 KB stored, like the real ones:
// local path + outline polygons + the PDF appearance source geometry, whose
// paint operation repeats the appearance path twice).
// ---------------------------------------------------------------------------
function noisy(seed, index) {
  return Math.round((Math.sin(seed * 12.9898 + index * 78.233) * 43758.5453 % 1) * 1e13) / 1e10;
}
function inkPath(seed, segments, offset = 0) {
  const path = [['M', noisy(seed, 0) + offset, noisy(seed, 1) + offset]];
  for (let index = 0; index < segments; index += 1) {
    path.push(['C', ...Array.from({ length: 6 }, (_, k) => noisy(seed, index * 6 + k + 2) + offset)]);
  }
  return path;
}
function importedInk(page, index) {
  const seed = page * 10_000 + index;
  const id = `${4000 + seed}R`;
  const appearancePath = inkPath(seed, 14, 200);
  return {
    type: 'path',
    // w33: the store no longer keeps data.pdfInkSourceGeometry (it used to
    // carry most of this fixture's weight), so the stored path is longer to
    // keep each mark ~Package-2 sized in the store.
    path: inkPath(seed, 100),
    left: 600 + noisy(seed, 90), top: 580 + noisy(seed, 91), width: 3.8, height: 1.43,
    stroke: 'transparent', strokeWidth: 0, fill: 'rgba(255, 0, 0, 1)',
    isPdfImported: true, pdfAnnotationId: id, pdfAnnotationType: 'Ink',
    inkGeometrySpace: 'local', pdfInkRenderMode: 'filled-outline', fillRule: 'nonzero',
    layer: 'pdf-annotations', id,
    polygons: [[Array.from({ length: 40 }, (_, k) => [noisy(seed, 200 + k), noisy(seed, 300 + k)])]],
    data: {
      id,
      inkGeometrySpace: 'local',
      pdfInkRenderMode: 'filled-outline',
      pdfInkSourceGeometry: {
        version: 1, kind: 'appearance-path', coordinateSpace: 'pdf',
        inkLists: [Array.from({ length: 13 }, (_, k) => [Math.fround(200 + noisy(seed, 400 + k)), Math.fround(560 + noisy(seed, 500 + k))])],
        appearancePath,
        appearancePaintOperations: [{
          sourcePath: appearancePath, path: appearancePath, stroke: true, fill: true,
          fillRule: 'nonzero', strokeColor: [1, 0, 0], fillColor: [1, 0, 0],
        }],
        appearanceBBox: [202.205, 558.275, 203.637, 562.089],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase double: WAL insert + ordered reads (limit honoured), snapshots,
// one Realtime channel. `maxReadBytes` makes a read whose rows add up to more
// than that fail like Postgres' statement timeout did in production.
// ---------------------------------------------------------------------------
function makeSupabase({ maxReadBytes = Infinity } = {}) {
  const log = [];
  let realtimeCallback = null;
  let subscribeCallback = null;
  const supabase = {
    log,
    snapshot: null,
    reads: [],
    fireRealtime(payload) { realtimeCallback?.(payload); },
    fireSubscribed() { return subscribeCallback?.('SUBSCRIBED'); },
    from(table) {
      if (table === 'annotation_updates') {
        const filters = { gtSeq: null, limit: Infinity };
        const builder = {
          select: () => builder,
          eq: () => builder,
          gt: (_column, value) => { filters.gtSeq = Number(value); return builder; },
          order: () => builder,
          limit: (value) => { filters.limit = Number(value); return builder; },
          insert: (row) => ({
            select: () => ({
              single: async () => {
                const injected = supabase.failInsert?.(row);
                if (injected) return { data: null, error: injected };
                const committed = { ...row, seq: log.length + 1 };
                log.push(committed);
                return { data: { seq: committed.seq }, error: null };
              },
            }),
          }),
          maybeSingle: async () => ({ data: null }),
          then: (resolve) => {
            if (filters.gtSeq === null) { resolve({ data: [], error: null }); return; }
            const injectedRead = supabase.failRead?.(filters);
            if (injectedRead) {
              supabase.reads.push({ gt: filters.gtSeq, limit: filters.limit, rows: 0, bytes: 0, failed: true });
              resolve({ data: null, error: injectedRead });
              return;
            }
            const rows = log.filter((row) => row.seq > filters.gtSeq).slice(0, filters.limit);
            const bytes = rows.reduce((sum, row) => sum + row.data.length / 2, 0);
            supabase.reads.push({ gt: filters.gtSeq, limit: filters.limit, rows: rows.length, bytes });
            if (rows.length > 1 && bytes > maxReadBytes) {
              resolve({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
              return;
            }
            resolve({ data: rows, error: null });
          },
        };
        return builder;
      }
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: supabase.snapshot }) }) }),
          upsert: async (row) => {
            if (supabase.failSnapshots) return { error: { code: '08006', message: 'snapshot store down' } };
            supabase.snapshot = row;
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    channel: () => ({
      on(_event, _filter, callback) { realtimeCallback = callback; return this; },
      subscribe(callback) { subscribeCallback = callback; return this; },
    }),
    removeChannel() {},
  };
  return supabase;
}

function rowBytes(row) {
  return pgHexToBytes(row.data).length;
}

// ---------------------------------------------------------------------------
// splitYjsUpdate
// ---------------------------------------------------------------------------

test('a Package-2-sized page update is cut into parts under the budget that rebuild the same document', () => {
  const source = new Y.Doc();
  let update = null;
  source.on('update', (next) => { update = next; });
  source.transact(() => {
    for (let index = 0; index < 400; index += 1) {
      const mark = importedInk(9, index);
      writeAnnotationMark(source, mark.id, 9, mark);
    }
  });
  assert.ok(update.length > 4 * WAL_UPDATE_MAX_BYTES, `fixture is big (${update.length} bytes)`);

  const parts = splitYjsUpdate(update);
  assert.ok(parts.length > 4, `cut into ${parts.length} parts`);
  for (const part of parts) assert.ok(part.length <= WAL_UPDATE_MAX_BYTES, `part ${part.length} <= budget`);

  const whole = new Y.Doc();
  Y.applyUpdate(whole, update);
  const parted = new Y.Doc();
  // A peer applying the parts one by one never sees half a mark.
  const finalJson = new Map();
  whole.getMap(MARKS_MAP).forEach((_value, key) => finalJson.set(key, JSON.stringify(readAnnotationEntry(whole, key))));
  for (const part of parts) {
    Y.applyUpdate(parted, part);
    parted.getMap(MARKS_MAP).forEach((_value, key) => {
      assert.equal(JSON.stringify(readAnnotationEntry(parted, key)), finalJson.get(key), `mark ${key} is whole`);
    });
  }
  assert.deepEqual(parted.getMap(MARKS_MAP).toJSON(), whole.getMap(MARKS_MAP).toJSON());
  assert.deepEqual(Y.encodeStateVector(parted), Y.encodeStateVector(whole));
});

test('edits and deletes split too; the deletions ride with the last part', () => {
  const source = new Y.Doc();
  source.transact(() => {
    for (let index = 0; index < 120; index += 1) {
      const mark = importedInk(3, index);
      writeAnnotationMark(source, mark.id, 3, mark);
    }
  });
  const peer = new Y.Doc();
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(source));
  let update = null;
  source.on('update', (next) => { update = next; });
  source.transact(() => {
    const marks = source.getMap(MARKS_MAP);
    [...marks.keys()].forEach((key, index) => {
      if (index % 3 === 0) marks.delete(key);
      else {
        const mark = { ...importedInk(3, index + 1000), id: key, data: { ...importedInk(3, index + 1000).data, id: key } };
        writeAnnotationMark(source, key, 3, mark);
      }
    });
  });
  const parts = splitYjsUpdate(update, 64 * 1024);
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(part.length <= 64 * 1024);
  for (const part of parts.slice(0, -1)) {
    assert.equal(Y.decodeUpdate(part).ds.clients.size, 0, 'no deletions before the last part');
  }
  for (const part of parts) Y.applyUpdate(peer, part);
  assert.deepEqual(peer.getMap(MARKS_MAP).toJSON(), source.getMap(MARKS_MAP).toJSON());
});

test('a small update is passed through untouched', () => {
  const doc = new Y.Doc();
  let update = null;
  doc.on('update', (next) => { update = next; });
  writeAnnotationMark(doc, 'one', 1, importedInk(1, 1));
  const parts = splitYjsUpdate(update);
  assert.equal(parts.length, 1);
  assert.equal(parts[0], update);
});

test('a later part (e.g. the import marker) is invisible until every earlier part arrived', () => {
  const source = new Y.Doc();
  const updates = [];
  source.on('update', (next) => { updates.push(next); });
  source.transact(() => {
    for (let index = 0; index < 200; index += 1) {
      const mark = importedInk(6, index);
      writeAnnotationMark(source, mark.id, 6, mark);
    }
  });
  setMetaValue(source, EMBEDDED_IMPORT_MARKER_KEY, { count: 200 });
  const [importUpdate, markerUpdate] = updates;
  const parts = splitYjsUpdate(importUpdate);
  assert.ok(parts.length >= 3);

  const peer = new Y.Doc();
  // Parts arrive with one in the middle missing (a Realtime drop), then the marker.
  parts.forEach((part, index) => { if (index !== 1) Y.applyUpdate(peer, part); });
  Y.applyUpdate(peer, markerUpdate);
  assert.equal(getMetaValue(peer, EMBEDDED_IMPORT_MARKER_KEY), undefined, 'marker held back by the gap');
  assert.ok(peer.getMap(MARKS_MAP).size < 200, 'later parts held back too');
  Y.applyUpdate(peer, parts[1]);
  assert.deepEqual(getMetaValue(peer, EMBEDDED_IMPORT_MARKER_KEY), { count: 200 });
  assert.equal(peer.getMap(MARKS_MAP).size, 200);
});

// ---------------------------------------------------------------------------
// The append path (real openAnnotationDoc + the viewer capture)
// ---------------------------------------------------------------------------

test('importing a Package-2-sized page through the viewer capture writes no WAL row over the budget', async () => {
  const supabase = makeSupabase();
  const handle = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w26-import', supabase, clientId: 'clientA',
    enableLocal: false, enableRealtime: false, doc: new Y.Doc(),
  });
  const objects = Array.from({ length: 400 }, (_, index) => importedInk(9, index));
  handle.applyByPage({ 9: { objects } });
  await handle.drain();

  const sizes = supabase.log.map(rowBytes);
  assert.ok(sizes.length > 4, `the page went out as ${sizes.length} rows`);
  const total = sizes.reduce((sum, size) => sum + size, 0);
  assert.ok(total > 4 * WAL_UPDATE_MAX_BYTES, `the import is big (${total} bytes)`);
  for (const size of sizes) assert.ok(size <= WAL_UPDATE_MAX_BYTES, `row ${size} bytes <= ${WAL_UPDATE_MAX_BYTES}`);
  // Every row has its own writer sequence number, in order.
  const seqs = supabase.log.map((row) => row.client_seq);
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b));
  assert.equal(new Set(seqs).size, seqs.length);

  // A fresh device replays the rows and gets every mark, whole.
  const replay = new Y.Doc();
  for (const row of supabase.log) Y.applyUpdate(replay, pgHexToBytes(row.data));
  const byPage = docToByPage(replay);
  assert.equal(byPage[9].objects.length, 400);
  const first = byPage[9].objects.find((object) => object.id === objects[0].id);
  // w33 (owner ruling 2026-09-24, format change): the store keeps ONE
  // geometry per imported mark. The rendered path must survive the split
  // exactly; the PDF's source geometry (provenance only) is not stored.
  assert.deepEqual(first.path, objects[0].path);
  assert.deepEqual(first.polygons, objects[0].polygons);
  assert.equal(first.data.pdfInkSourceGeometry, undefined);
  await handle.destroy();
});

test('a tail of rows too big to read together still opens (pages shrink instead of failing)', async () => {
  // Rows written before this fix: several ~1 MB rows. The fake database
  // refuses any read over 1.5 MB, like the production statement timeout.
  const supabase = makeSupabase({ maxReadBytes: 1.5 * 1024 * 1024 });
  const writer = new Y.Doc();
  for (let page = 1; page <= 4; page += 1) {
    let update = null;
    const listener = (next) => { update = next; };
    writer.on('update', listener);
    writer.transact(() => {
      for (let index = 0; index < 180; index += 1) {
        const mark = importedInk(page, index);
        writeAnnotationMark(writer, mark.id, page, mark);
      }
    });
    writer.off('update', listener);
    supabase.log.push({ seq: supabase.log.length + 1, data: bytesToPgHex(update), client_id: 'legacy', client_seq: page });
  }
  assert.ok(supabase.log.every((row) => rowBytes(row) > 900 * 1024), 'legacy rows are ~1 MB each');

  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w26-tail', supabase, clientId: 'clientB',
    enableLocal: false, enableRealtime: false, doc,
  });
  const byPage = handle.getByPage();
  assert.deepEqual(
    [1, 2, 3, 4].map((page) => byPage[page]?.objects?.length || 0),
    [180, 180, 180, 180],
  );
  assert.ok(supabase.reads.some((read) => read.rows === 1), 'fell back to one row per read');
  await handle.destroy();
});

test('a Realtime row that arrives without its data is read from the log instead', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w26-realtime', supabase, clientId: 'clientC',
    enableLocal: false, enableRealtime: true, doc,
  });
  await supabase.fireSubscribed();
  const other = new Y.Doc();
  let update = null;
  other.on('update', (next) => { update = next; });
  const mark = importedInk(2, 7);
  writeAnnotationMark(other, mark.id, 2, mark);
  const row = { seq: supabase.log.length + 1, data: bytesToPgHex(update), client_id: 'other', client_seq: 1 };
  supabase.log.push(row);
  // Over Realtime's limit: the record comes with an error and no data.
  supabase.fireRealtime({ new: { ...row, data: null }, errors: ['Error 413: Payload Too Large'] });
  const deadline = Date.now() + 3000;
  while (!handle.getByPage()[2] && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(handle.getByPage()[2]?.objects?.length, 1, 'the mark arrived through an ordered read');
  await handle.destroy();
});

test('a snapshot write that times out but still lands never makes a reopen show 0 marks', async () => {
  const supabase = makeSupabase();
  // The upload lands in the database but answers after the client gave up.
  const baseFrom = supabase.from.bind(supabase);
  supabase.from = (table) => {
    const target = baseFrom(table);
    if (table !== 'annotation_snapshots') return target;
    return {
      ...target,
      upsert: async (row) => {
        supabase.snapshot = row;
        await new Promise((resolve) => setTimeout(resolve, 250));
        return { error: null };
      },
    };
  };
  const writer = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w26-snapshot', supabase, clientId: 'clientD',
    enableLocal: false, enableRealtime: false, doc: new Y.Doc(), requestTimeoutMs: 60,
    snapshotRetryDelayMs: 1,
  });
  const objects = Array.from({ length: 120 }, (_, index) => importedInk(11, index));
  writer.applyByPage({ 11: { objects } });
  await writer.drain();
  await writer.flushSnapshot().catch(() => {});
  assert.ok(supabase.snapshot, 'a snapshot row landed despite the client-side timeout');
  // More work after the ambiguous snapshot.
  writer.applyByPage({ 11: { objects }, 12: { objects: [importedInk(12, 1)] } });
  await writer.drain();
  await writer.destroy();

  const reader = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w26-snapshot', supabase, clientId: 'clientE',
    enableLocal: false, enableRealtime: false, doc: new Y.Doc(),
  });
  const byPage = reader.getByPage();
  assert.equal(byPage[11]?.objects?.length, 120);
  assert.equal(byPage[12]?.objects?.length, 1);
  await reader.destroy();
});

// ---------------------------------------------------------------------------
// Review fixes (two adversarial passes, 2026-09-24)
// ---------------------------------------------------------------------------

async function waitFor(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
  return check();
}

function smallRect(id, extra = {}) {
  return { id, type: 'rect', left: 1, top: 2, width: 5, height: 5, data: { id }, ...extra };
}

test('a later part (even a delete-set-only tail) never reaches the log ahead of a part that failed', async () => {
  const BUDGET = 1024;
  const supabase = makeSupabase();
  supabase.failSnapshots = true; // no checkpoint can paper over the gap
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w26-chain', supabase, clientId: 'clientF',
    enableLocal: false, enableRealtime: false, doc, walUpdateMaxBytes: BUDGET,
    snapshotRetryDelayMs: 1, repairRetryDelayMs: 60_000,
  });
  doc.transact(() => {
    for (let index = 0; index < 300; index += 1) writeAnnotationMark(doc, `m${index}`, 1, smallRect(`m${index}`, { left: index }));
  }, 'local');
  await handle.drain();
  const accepted = supabase.log.length;
  const lastSeq = Math.max(...supabase.log.map((row) => row.client_seq));

  let update = null;
  const probe = (next, origin) => { if (origin === 'local' && !update) update = next; };
  doc.on('update', probe);
  doc.transact(() => {
    const marks = doc.getMap(MARKS_MAP);
    for (let index = 0; index < 300; index += 2) marks.delete(`m${index}`);
    for (let index = 0; index < 6; index += 1) writeAnnotationMark(doc, `n${index}`, 1, smallRect(`n${index}`, { note: 'x'.repeat(120) }));
  }, 'local');
  doc.off('update', probe);
  const parts = splitYjsUpdate(update, BUDGET);
  const tail = Y.decodeUpdate(parts.at(-1));
  assert.ok(parts.length >= 3);
  assert.equal(tail.structs.length, 0, 'the fixture ends with a delete-set-only part');
  const failing = lastSeq + parts.length - 1; // the part right before the tail
  supabase.failInsert = (row) => (row.client_seq === failing ? { code: '08006', message: 'network down' } : null);
  await handle.drain().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 100));

  const newSeqs = supabase.log.slice(accepted).map((row) => row.client_seq);
  assert.ok(newSeqs.every((seq) => seq < failing), `nothing after the failed part was stored (stored ${newSeqs})`);
  await handle.destroy().catch(() => {});
});

test('the viewer is read-only while the store is unavailable (nothing drawn then can be lost)', async () => {
  const { readFileSync } = await import('node:fs');
  const hook = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');
  assert.match(hook, /import \{ claimBodyReadOnly \} from '\.\.\/utils\/readOnlyBodyReasons\.js';/);
  assert.match(
    hook,
    /const storeUnavailable = initialHydration\?\.source === ANNOTATION_HYDRATION_UNAVAILABLE_SOURCE[\s\S]*?return claimBodyReadOnly\(/,
  );
});

test('a Realtime row without data is read from that row on (not the whole tail), and health is red until it is in', async () => {
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  for (let index = 0; index < 20; index += 1) {
    const other = new Y.Doc();
    let update = null;
    other.on('update', (next) => { update = next; });
    writeAnnotationMark(other, `early-${index}`, 1, smallRect(`early-${index}`));
    supabase.log.push({ seq: supabase.log.length + 1, data: bytesToPgHex(update), client_id: `o${index}`, client_seq: 1 });
  }
  const handle = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w26-recover-from', supabase, clientId: 'clientG',
    enableLocal: false, enableRealtime: true, doc,
  });
  await supabase.fireSubscribed();
  const other = new Y.Doc();
  let update = null;
  other.on('update', (next) => { update = next; });
  writeAnnotationMark(other, 'late', 3, smallRect('late'));
  const row = { seq: supabase.log.length + 1, data: bytesToPgHex(update), client_id: 'late', client_seq: 1 };
  supabase.log.push(row);
  // The row can not be read at first (a statement timeout, even alone).
  supabase.failRead = (filters) => (filters.gtSeq === row.seq - 1
    ? { code: '57014', message: 'canceling statement due to statement timeout' }
    : null);
  const readsBefore = supabase.reads.length;
  supabase.fireRealtime({ new: { ...row, data: null }, errors: ['Error 413: Payload Too Large'] });
  assert.equal(handle.getSyncStatus().healthy, false, 'red at once');
  assert.ok(await waitFor(() => supabase.reads.length > readsBefore + 2, 5000), 'recovery tried');
  assert.equal(handle.getSyncStatus().healthy, false, 'still red while the row cannot be read');
  assert.equal(handle.getByPage()[3], undefined);
  supabase.failRead = null;
  assert.ok(await waitFor(() => handle.getByPage()[3]?.objects?.length === 1, 8000), 'the row arrived');
  assert.ok(await waitFor(() => handle.getSyncStatus().healthy === true, 2000), 'green again');
  const recoveryReads = supabase.reads.slice(readsBefore);
  // From the missing row on (then onward page by page) — never the whole tail again.
  assert.ok(recoveryReads.length > 0 && recoveryReads[0].gt === row.seq - 1);
  assert.ok(recoveryReads.every((read) => read.gt >= row.seq - 1), `no recovery read goes back before the missing row (${recoveryReads.map((read) => read.gt)})`);
  await handle.destroy();
});

test('tail reads start small, and a document whose rows timed out is read in small pages from then on', async () => {
  const fresh = makeSupabase();
  const first = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w26-page-default', supabase: fresh, clientId: 'clientH',
    enableLocal: false, enableRealtime: false, doc: new Y.Doc(),
  });
  assert.equal(fresh.reads[0].limit, 16, 'a page is 16 rows (~4 MB at most for new rows)');
  await first.destroy();

  const supabase = makeSupabase({ maxReadBytes: 1.5 * 1024 * 1024 });
  const writer = new Y.Doc();
  for (let page = 1; page <= 3; page += 1) {
    let update = null;
    const listener = (next) => { update = next; };
    writer.on('update', listener);
    writer.transact(() => {
      for (let index = 0; index < 180; index += 1) {
        const mark = importedInk(page, index);
        writeAnnotationMark(writer, mark.id, page, mark);
      }
    });
    writer.off('update', listener);
    supabase.log.push({ seq: supabase.log.length + 1, data: bytesToPgHex(update), client_id: 'legacy', client_seq: page });
  }
  const open1 = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w26-page-learn', supabase, clientId: 'clientI',
    enableLocal: false, enableRealtime: false, doc: new Y.Doc(),
  });
  const failedFirstOpen = supabase.reads.filter((read) => read.rows > 1 && read.bytes > 1.5 * 1024 * 1024).length;
  assert.ok(failedFirstOpen >= 1);
  await open1.destroy();
  const readsBefore = supabase.reads.length;
  const open2 = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w26-page-learn', supabase, clientId: 'clientJ',
    enableLocal: false, enableRealtime: false, doc: new Y.Doc(),
  });
  const second = supabase.reads.slice(readsBefore);
  assert.ok(second[0].limit <= 4, `reopen starts with the learned small page (${second[0].limit})`);
  assert.equal(second.filter((read) => read.rows > 1 && read.bytes > 1.5 * 1024 * 1024).length, 0, 'no repeat of the failing big read');
  assert.equal(Object.values(open2.getByPage()).reduce((sum, bucket) => sum + bucket.objects.length, 0), 540);
  await open2.destroy();
});

test('a part never goes over the budget after an unfinished mark is carried into it', () => {
  const doc = new Y.Doc();
  let update = null;
  doc.on('update', (next) => { update = next; });
  doc.transact(() => {
    for (let index = 0; index < 40; index += 1) writeAnnotationMark(doc, `s${index}`, 1, importedInk(1, index));
    writeAnnotationMark(doc, 'big', 1, {
      ...smallRect('big'), a: 'a'.repeat(137 * 1024), b: 'b'.repeat(137 * 1024),
    });
    for (let index = 40; index < 60; index += 1) writeAnnotationMark(doc, `s${index}`, 1, importedInk(1, index));
  });
  const parts = splitYjsUpdate(update);
  for (const part of parts) {
    const structs = Y.decodeUpdate(part).structs.length;
    assert.ok(part.length <= WAL_UPDATE_MAX_BYTES || structs === 1, `part ${part.length} bytes with ${structs} structs`);
  }
  const rebuilt = new Y.Doc();
  for (const part of parts) Y.applyUpdate(rebuilt, part);
  assert.deepEqual(rebuilt.getMap(MARKS_MAP).toJSON(), doc.getMap(MARKS_MAP).toJSON());
});

test('a permission denial on one part of a split edit, after earlier parts were accepted, asks for a full history reset', async () => {
  const BUDGET = 1024;
  const supabase = makeSupabase();
  const doc = new Y.Doc();
  const handle = await openAnnotationDoc({
    actorUserId: 'owner', documentId: 'doc-w26-partial-deny', supabase, clientId: 'clientK',
    enableLocal: false, enableRealtime: false, doc, walUpdateMaxBytes: BUDGET,
  });
  const events = [];
  handle.onHistoryQuarantine((event) => events.push(event));
  supabase.failInsert = (row) => (row.client_seq === 3 ? { code: '42501', message: 'permission denied' } : null);
  doc.transact(() => {
    for (let index = 0; index < 80; index += 1) writeAnnotationMark(doc, `q${index}`, 1, smallRect(`q${index}`, { left: index }));
  }, { historyTag: { mutationId: 'erase-1', historyKind: 'erase' } });
  await handle.drain().catch(() => {});
  await waitFor(() => events.length > 0, 2000);
  assert.ok(supabase.log.length >= 2, 'the parts before the denied one were accepted');
  const event = events.at(-1);
  assert.equal(event.requiresFullHistoryReset, true);
  assert.deepEqual([...event.mutationIds], ['erase-1'], 'the mutation is named once');
  await handle.destroy().catch(() => {});
});
