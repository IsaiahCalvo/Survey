// crdtBackfill.cutoverGate.test.mjs
// Perf #1 (2026-06-03) — the sealed-doc degeneracy probe used to pay a ~7.4s
// exact count(*) on EVERY sealed-doc open, then discard it for the healthy
// already-deduped case. The cheap zero-network health signals were hoisted
// above the count so it only fires when genuinely needed. This branch had ZERO
// test coverage; these tests lock in both the perf win and the wipe-recovery
// safety invariant (a degenerate Y.Map must NEVER be trusted).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { __resetDocumentMetadataCacheForTests } from '../../../services/documentMetadataResolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TARGET = resolve(__dirname, '../crdtBackfill.js');
const REPO_ROOT = resolve(__dirname, '../../../..');
const YJS_INSTALLED = existsSync(resolve(REPO_ROOT, 'node_modules/yjs/package.json'));
const SKIP = !existsSync(TARGET)
  ? 'crdtBackfill.js not present'
  : (!YJS_INSTALLED ? 'yjs not installed' : false);

// Mock that distinguishes the documents-row read (resolver), the exact-count
// HEAD probe (counted), and the paginated import .range(). The count chain ends
// at .in() and is awaited directly, so the annotations builder is a thenable
// that resolves { count } when select() saw the { head:true } options, else the
// import rows. countCalls increments only on the HEAD-count terminal.
function makeSealedMock({ cutoverAt, legacyCount = 0, importRows = [] }) {
  const state = { countCalls: 0 };

  function annotationsBuilder() {
    let isCount = false;
    const b = {
      select(_cols, opts) { if (opts && opts.head) isCount = true; return b; },
      eq() { return b; },
      in() { return b; },
      order() { return b; },
      range(from, to) {
        return Promise.resolve({ data: importRows.slice(from, to + 1), error: null });
      },
      then(resolveFn) {
        if (isCount) { state.countCalls += 1; resolveFn({ count: legacyCount, error: null }); }
        else { resolveFn({ data: importRows, error: null }); }
      },
    };
    return b;
  }

  function documentsBuilder() {
    const row = { user_id: 'owner', cutover_completed_at: cutoverAt ?? null };
    const b = {
      select() { return b; },
      update() { return b; },
      eq() { return b; },
      maybeSingle() { return Promise.resolve({ data: row, error: null }); },
      then(resolveFn) { resolveFn({ error: null }); }, // update().eq() await (seal)
    };
    return b;
  }

  return {
    from(table) { return table === 'documents' ? documentsBuilder() : annotationsBuilder(); },
    _state: state,
  };
}

async function seedYMap(Y, ydoc, { entries = 0, dedupeRan = false, lastGoodSize = 0 }) {
  const yMap = ydoc.getMap('annotations');
  for (let i = 0; i < entries; i++) yMap.set(`seed-${i}`, i);
  const meta = ydoc.getMap('meta');
  if (dedupeRan) meta.set('dedupe_pdf_imports_v1_done', true);
  if (lastGoodSize) meta.set('dedupe_pdf_imports_v1_last_good_size', lastGoodSize);
  return yMap;
}

test('sealed + deduped + healthy anchor: skips the exact count (perf win)', { skip: SKIP }, async () => {
  __resetDocumentMetadataCacheForTests();
  const Y = await import('yjs');
  const mod = await import(TARGET);
  const ydoc = new Y.Doc();
  const yMapAnnotations = await seedYMap(Y, ydoc, { entries: 80, dedupeRan: true, lastGoodSize: 100 });
  const supabase = makeSealedMock({ cutoverAt: '2026-06-03T09:00:00Z', legacyCount: 999 });

  const result = await mod.runBackfill({
    ydoc, yMapAnnotations, supabase, documentId: 'doc-healthy', userId: 'u1',
    sessionId: 's1', clientID: ydoc.clientID, markCutoverComplete: true,
  });

  assert.strictEqual(result.ranAs, 'cutover_already_complete_dedupe_anchor');
  assert.strictEqual(supabase._state.countCalls, 0, 'the ~7.4s exact count must be skipped on a healthy deduped open');
});

test('sealed, no dedupe anchor, Y.Map matches legacy: count IS issued and doc is trusted', { skip: SKIP }, async () => {
  __resetDocumentMetadataCacheForTests();
  const Y = await import('yjs');
  const mod = await import(TARGET);
  const ydoc = new Y.Doc();
  const yMapAnnotations = await seedYMap(Y, ydoc, { entries: 80, dedupeRan: false, lastGoodSize: 0 });
  const supabase = makeSealedMock({ cutoverAt: '2026-06-03T09:00:00Z', legacyCount: 80 });

  const result = await mod.runBackfill({
    ydoc, yMapAnnotations, supabase, documentId: 'doc-nondedupe', userId: 'u1',
    sessionId: 's1', clientID: ydoc.clientID, markCutoverComplete: true,
  });

  assert.strictEqual(result.ranAs, 'cutover_already_complete');
  assert.strictEqual(supabase._state.countCalls, 1, 'a non-deduped sealed doc needs the exact count to confirm health');
});

test('sealed but Y.Map wiped below the last-good anchor: recovery fires WITHOUT the count', { skip: SKIP }, async () => {
  __resetDocumentMetadataCacheForTests();
  const Y = await import('yjs');
  const mod = await import(TARGET);
  const ydoc = new Y.Doc();
  // Known-good anchor of 200 but Y.Map now holds only 3 — a wipe.
  const yMapAnnotations = await seedYMap(Y, ydoc, { entries: 3, dedupeRan: true, lastGoodSize: 200 });
  const importRows = [
    { annotation_id: 'r1', user_id: 'alice', document_id: 'doc-wiped', annotation_type: 'square',
      created_at: '2026-01-15T10:00:00Z', annotation_data: '{"left":0,"top":0}' },
  ];
  const supabase = makeSealedMock({ cutoverAt: '2026-06-03T09:00:00Z', legacyCount: 200, importRows });

  const result = await mod.runBackfill({
    ydoc, yMapAnnotations, supabase, documentId: 'doc-wiped', userId: 'u1',
    sessionId: 's1', clientID: ydoc.clientID, markCutoverComplete: true,
  });

  assert.strictEqual(supabase._state.countCalls, 0, 'the hard-floor wipe is provable without the count');
  assert.notStrictEqual(result.ranAs, 'cutover_already_complete_dedupe_anchor', 'a wiped doc must NOT be trusted as healthy');
  assert.notStrictEqual(result.ranAs, 'cutover_already_complete', 'a wiped doc must NOT be trusted as healthy');
  assert.ok(yMapAnnotations.get('r1'), 'recovery must re-import the missing annotation');
});
