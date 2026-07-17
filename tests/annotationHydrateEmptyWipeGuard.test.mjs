// tests/annotationHydrateEmptyWipeGuard.test.mjs
//
// Empty-wipe safety of the LIVE hydrate path (useAnnotationDoc +
// annotationDocSync), investigated 2026-07-17 after the retired
// useAnnotationCloudSync hook (which wrapped hydrate in resolveSafeSnapshot)
// was deleted. Verdict: the live path needs NO resolveSafeSnapshot guard —
// empty-over-nonempty is impossible BY CONSTRUCTION, because:
//
//   1. The op log (annotation_updates) is append-only (RLS: select+insert only,
//      no update/delete — cleanup is the documents ON DELETE CASCADE), so a
//      missing/corrupt/unreadable snapshot degrades to a FULL-log replay from
//      seq 0, never to an empty doc. An empty tail read means the backend is
//      GENUINELY empty.
//   2. A tail-read error THROWS out of openAnnotationDoc — the hook's catch
//      sets an error status and returns without applying anything.
//   3. The hook's genuinely-empty-store branch does not call
//      setAnnotationsByPage at all — it SEEDS the doc from the viewer's
//      in-memory state (applyByPage), the exact inverse of a wipe.
//   4. Mid-session onChange only fires after successfully APPLYING remote
//      updates (realtime insert / catch-up with applied>0); Yjs remote updates
//      can only empty the map via genuine delete ops, i.e. a legitimate
//      remote delete-all, which MUST apply. Error paths never notify.
//   5. The registry doc can never be silently swapped for a fresh empty one
//      mid-session: releaseYDoc never destroys, and there is no eviction path
//      outside the test-only helper (see src/lib/collab/ydocRegistry.js).
//
// These tests pin each of those branches so a refactor that removes one
// reopens the data-loss review, not production.

import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { openAnnotationDoc, __test } from '../src/services/annotationDocSync.js';
import { getAnnotationsMap, docToByPage } from '../src/services/annotationDocStore.js';

const { bytesToPgHex } = __test;

const HOOK_SOURCE = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');
const SYNC_SOURCE = readFileSync(new URL('../src/services/annotationDocSync.js', import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Fixture: a source doc with three marks, recorded as individual op-log rows
// (exactly what appendOp persists), plus a full-state snapshot of it.
// ---------------------------------------------------------------------------
function buildBackendFixture() {
  const src = new Y.Doc();
  const updates = [];
  src.on('update', (u) => updates.push(u));
  const map = getAnnotationsMap(src);
  src.transact(() => { map.set('m1', { p: 1, o: { type: 'path', data: { id: 'm1' } } }); });
  src.transact(() => { map.set('m2', { p: 1, o: { type: 'rect', data: { id: 'm2' } } }); });
  src.transact(() => { map.set('m3', { p: 2, o: { type: 'ellipse', data: { id: 'm3' } } }); });
  const rows = updates.map((u, i) => ({ seq: i + 1, data: bytesToPgHex(u), client_id: 'other-client' }));
  const snapshotHex = bytesToPgHex(gzipSync(Y.encodeStateAsUpdate(src)));
  return { rows, snapshotHex, expectedByPage: docToByPage(src) };
}

// Minimal Supabase double for the open/hydrate path. Records every tail-read
// start cursor (the `gt('seq', cursor)` argument) so tests can prove the
// replay really started from seq 0 when the snapshot was unusable.
function makeSupabase({ snapshotResult, updatesRows = [], tailError = null }) {
  const tailCursors = [];
  return {
    tailCursors,
    from(table) {
      if (table === 'annotation_snapshots') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => snapshotResult }) }),
          upsert: async () => ({ error: null }),
        };
      }
      if (table === 'annotation_updates') {
        return {
          select: (cols) => {
            if (cols === 'client_seq') {
              // per-(doc,client) op-counter seed → empty
              const b = {};
              for (const m of ['eq', 'order', 'limit']) b[m] = () => b;
              b.then = (resolve) => resolve({ data: [] });
              return b;
            }
            // snapshot-tail read: select('seq, data')...gt('seq', cursor)...
            let cursor = null;
            const b = {
              eq: () => b,
              gt: (_col, v) => { cursor = v; return b; },
              order: () => b,
              limit: () => b,
              then: (resolve) => {
                tailCursors.push(cursor);
                if (tailError) return resolve({ data: null, error: { message: tailError } });
                return resolve({ data: updatesRows.filter((r) => r.seq > cursor) });
              },
            };
            return b;
          },
          insert: () => ({ select: () => ({ single: async () => ({ data: { seq: 1000 }, error: null }) }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

async function openWith(supabase, documentId) {
  const doc = new Y.Doc();
  return openAnnotationDoc({
    documentId, supabase, clientId: 'local-client',
    enableLocal: false, enableRealtime: false, doc,
  });
}

// ---------------------------------------------------------------------------
// Mode (a): the snapshot fetch FAILS (error result) while the log has content.
// Append-only log ⇒ the tail is re-read from seq 0 and reconstructs the FULL
// doc. Hydrate cannot come up empty unless the log genuinely is.
// ---------------------------------------------------------------------------
test('hydrate mode (a): failed snapshot fetch degrades to a full-log replay from seq 0 — never an empty doc', async () => {
  const { rows, expectedByPage } = buildBackendFixture();
  const supabase = makeSupabase({
    snapshotResult: { data: null, error: { message: 'snapshot fetch failed' } },
    updatesRows: rows,
  });
  const handle = await openWith(supabase, 'doc-mode-a');
  assert.equal(supabase.tailCursors[0], 0, 'tail replay started at seq 0 (no trusted snapshot baseline)');
  assert.deepEqual(handle.getByPage(), expectedByPage, 'every logged mark was reconstructed');
  await handle.destroy();
});

// ---------------------------------------------------------------------------
// Mode (a), error variant: the TAIL read fails → openAnnotationDoc REJECTS.
// No handle exists, so the hook can never apply a partial/empty hydrate; its
// catch sets an error status and returns (pinned in the source tests below).
// ---------------------------------------------------------------------------
test('hydrate mode (a): a failed tail read aborts the open instead of hydrating a partial/empty doc', async () => {
  const { snapshotHex } = buildBackendFixture();
  const supabase = makeSupabase({
    snapshotResult: { data: { snapshot: snapshotHex, at_seq: 3, encoding_version: 2 } },
    tailError: 'network down',
  });
  await assert.rejects(
    () => openWith(supabase, 'doc-mode-a-tail'),
    /tail read: network down/,
    'the open rejects — nothing is ever painted from a doc whose tail could not be read',
  );
});

// ---------------------------------------------------------------------------
// Mode (b): a CORRUPTED gzip snapshot decodes to nothing → the loader nulls the
// bytes, leaves lastSeq at 0, and replays the full log. Content identical to a
// healthy open; the corrupt snapshot cannot manifest as an empty document.
// ---------------------------------------------------------------------------
test('hydrate mode (b): corrupted snapshot bytes fall back to full-log replay (no empty doc, no dropped ops)', async () => {
  const { rows, expectedByPage } = buildBackendFixture();
  const garbage = bytesToPgHex(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  const supabase = makeSupabase({
    // claims at_seq 3 — if the loader trusted it despite the failed gunzip, the
    // tail would skip seq 1..3 and hydrate EMPTY. It must not.
    snapshotResult: { data: { snapshot: garbage, at_seq: 3, encoding_version: 2 } },
    updatesRows: rows,
  });
  const handle = await openWith(supabase, 'doc-mode-b');
  assert.equal(supabase.tailCursors[0], 0, 'at_seq of an undecodable snapshot is NOT trusted — replay starts at 0');
  assert.deepEqual(handle.getByPage(), expectedByPage, 'full state reconstructed from the append-only log');
  await handle.destroy();
});

// Contrast pin: a HEALTHY snapshot is trusted (tail starts at its at_seq) and
// produces the same content — proving the fallback above is the exception path,
// not a behavior change.
test('hydrate steady state: healthy snapshot baseline + tail replay yields the full doc', async () => {
  const { rows, snapshotHex, expectedByPage } = buildBackendFixture();
  const supabase = makeSupabase({
    snapshotResult: { data: { snapshot: snapshotHex, at_seq: 3, encoding_version: 2 } },
    updatesRows: rows,
  });
  const handle = await openWith(supabase, 'doc-steady');
  assert.equal(supabase.tailCursors[0], 3, 'tail read starts after the decoded snapshot at_seq');
  assert.deepEqual(handle.getByPage(), expectedByPage);
  await handle.destroy();
});

// ---------------------------------------------------------------------------
// Legitimately-empty backend: getByPage() is {} and stays {} — the HOOK is the
// layer that must then choose seed-over-paint, pinned on its source below.
// ---------------------------------------------------------------------------
test('hydrate: a genuinely empty backend opens as an empty doc (the hook then seeds, never paints empty)', async () => {
  const supabase = makeSupabase({ snapshotResult: { data: null }, updatesRows: [] });
  const handle = await openWith(supabase, 'doc-empty');
  assert.deepEqual(handle.getByPage(), {});
  await handle.destroy();
});

// ---------------------------------------------------------------------------
// Mode (d): a REAL remote delete-all must still apply (Yjs can only empty the
// map via genuine delete ops — there is no merge artifact that produces {}).
// ---------------------------------------------------------------------------
test('hydrate mode (d): a genuine remote delete-all empties byPage (legitimate empties still apply)', async () => {
  const { rows } = buildBackendFixture();
  const src = new Y.Doc();
  for (const r of rows) {
    const hex = r.data.slice(2);
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    Y.applyUpdate(src, bytes);
  }
  const deletes = [];
  src.on('update', (u) => deletes.push(u));
  src.transact(() => {
    const map = getAnnotationsMap(src);
    for (const key of [...map.keys()]) map.delete(key);
  });
  const allRows = rows.concat(deletes.map((u, i) => ({ seq: rows.length + i + 1, data: bytesToPgHex(u), client_id: 'other-client' })));
  const supabase = makeSupabase({ snapshotResult: { data: null }, updatesRows: allRows });
  const handle = await openWith(supabase, 'doc-mode-d');
  assert.deepEqual(handle.getByPage(), {}, 'the delete-all survived hydrate — legit empties are not "preserved" away');
  await handle.destroy();
});

// ---------------------------------------------------------------------------
// Source pins — the hook-side protective branches (useAnnotationDoc.js).
// ---------------------------------------------------------------------------
test('useAnnotationDoc: the empty-store hydrate branch SEEDS from local state instead of painting empty', () => {
  // The store-wins paint is gated on the store actually having content…
  assert.match(HOOK_SOURCE, /if \(count > 0 \|\| hasMetaCallouts \|\| hasSpaces \|\| hasSurvey\) \{/);
  assert.match(HOOK_SOURCE, /if \(count > 0 \|\| hasMetaCallouts\) \{/);
  assert.match(HOOK_SOURCE, /if \(count > 0 \|\| projectedByPage !== storeByPage\) setAnnotationsByPage\(projectedByPage\);/);
  // …and the empty-store else-branch pushes LOCAL state INTO the doc (the
  // inverse of a wipe) rather than calling setAnnotationsByPage at all.
  const elseBranch = HOOK_SOURCE.match(/\} else \{\s*\n\s*\/\/ Empty store: seed it[\s\S]*?applySurveyMarkers\(curSurvey\);\s*\n\s*\}/);
  assert.ok(elseBranch, 'the empty-store seed branch exists');
  assert.match(elseBranch[0], /if \(curByPage && pageCount\(curByPage\) > 0\) handle\.applyByPage\(curByPage\);/);
  assert.doesNotMatch(elseBranch[0], /setAnnotationsByPage\(/, 'an empty store never overwrites in-memory annotations');
});

test('useAnnotationDoc: a failed open sets an error status and applies NOTHING to viewer state', () => {
  const failPath = HOOK_SOURCE.match(/catch \(err\) \{\s*\n\s*console\.error\('\[useAnnotationDoc\] open failed'[\s\S]*?return;\s*\n\s*\}/);
  assert.ok(failPath, 'the open-failure catch exists');
  assert.match(failPath[0], /setSyncStatus\(\{ stage: 'error', healthy: false/);
  assert.doesNotMatch(failPath[0], /setAnnotationsByPage|setSpaces|setSurveyMarkers/);
});

test('useAnnotationDoc: onChange applies remote state unconditionally (legit remote delete-all must land)', () => {
  assert.match(HOOK_SOURCE, /handle\.onChange\(\(byPage\) => \{[\s\S]*?setAnnotationsByPage\(nextByPage\);/);
});

// ---------------------------------------------------------------------------
// Source pins — the sync-layer branches those guarantees rest on
// (annotationDocSync.js).
// ---------------------------------------------------------------------------
test('annotationDocSync: an undecodable snapshot is discarded and its at_seq is never trusted', () => {
  // gunzip failure nulls the bytes…
  assert.match(SYNC_SOURCE, /snapshot gunzip failed', err\?\.message\); bytes = null; \}/);
  // …and lastSeq only advances when the bytes were actually applied, so the
  // tail read replays the append-only log from seq 0 otherwise.
  assert.match(SYNC_SOURCE, /if \(bytes\) \{\s*\n\s*Y\.applyUpdate\(doc, bytes, HYDRATE_ORIGIN\);\s*\n\s*state\.lastSeq = Number\(snapRow\.at_seq\) \|\| 0;/);
});

test('annotationDocSync: a failed tail read throws (open aborts) instead of hydrating partial state', () => {
  assert.match(SYNC_SOURCE, /if \(error\) throw new Error\(`tail read: \$\{error\.message\}`\);/);
});

test('annotationDocSync: change listeners only fire after remote updates actually APPLIED — error paths never notify', () => {
  // catch-up: notify only when at least one remote op landed in the doc.
  assert.match(SYNC_SOURCE, /if \(applied > 0 && !state\.destroyed\) notifyChange\(state\);/);
  // realtime: an apply failure is swallowed without notifying (no empty/stale echo).
  const realtimeCatch = SYNC_SOURCE.match(/catch \(err\) \{\s*\n\s*console\.warn\('\[annotationDocSync\] remote apply failed', err\?\.message\);\s*\n\s*\}/);
  assert.ok(realtimeCatch, 'the realtime apply-failure catch exists and contains no notifyChange');
});

test('annotationDocSync: snapshot writes capture at_seq and the doc bytes in the same synchronous tick', () => {
  // Pins the invariant that a stored snapshot's bytes always cover its claimed
  // at_seq — the reason a decoded snapshot can never under-represent the log.
  assert.match(SYNC_SOURCE, /const atSeq = state\.lastSeq;\s*\n\s*const epochAtStart = state\.editEpoch;/);
});
