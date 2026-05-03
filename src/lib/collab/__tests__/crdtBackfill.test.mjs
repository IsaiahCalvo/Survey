// src/lib/collab/__tests__/crdtBackfill.test.mjs
// Phase 30 Wave 0 scaffold (Plan 30-01) — runs as test.skip until Plan 30-02 lands
// src/lib/collab/crdtBackfill.js.
//
// Validates MIGRATE-01: legacy v2.3 rows backfill into Y.Map with author/device/
// timestamp preservation, idempotency, highlight skip, and the 'crdt-backfill'
// origin tag (so Phase 33 activity log can render the "Document migrated" entry).
//
// Per-test existsSync skip-guard — when Plan 30-02 lands crdtBackfill.js the
// 6 tests below auto-flip from skip → green (pattern locked from Phase 27/28/29).

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TARGET = resolve(__dirname, '../crdtBackfill.js');
const REPO_ROOT = resolve(__dirname, '../../../..');
const YJS_INSTALLED = existsSync(resolve(REPO_ROOT, 'node_modules/yjs/package.json'));

function skipReason() {
  if (!existsSync(TARGET)) return 'crdtBackfill.js not yet present (Plan 30-02)';
  if (!YJS_INSTALLED) return 'yjs not installed yet';
  return false;
}

// Build a tiny Supabase chain mock that returns the rows handed in. The
// production chain shape (per src/lib/collab/crdtBackfill.js Phase 31 hotfix
// 2026-05-03) is:
//   supabase
//     .from('document_annotations')
//     .select('*')
//     .eq('document_id', id)
//     .in('annotation_type', NON_HIGHLIGHT)
//     .order('created_at', { ascending: true })
//     .order('highlight_id', { ascending: true })
//     .range(from, to)
// Each link returns the next builder; .range() is the terminal Promise. The
// .range() implementation slices the fixture rows so the production
// pagination loop sees a final page with `data.length < BACKFILL_PAGE_SIZE`
// and breaks. For test-sized fixtures (< 1000 rows) the first range call
// returns everything and the loop exits after one iteration.
function makeSupabaseMock(rows) {
  const calls = { from: [], select: [], eq: [], in: [], order: [], range: [] };
  const builder = {
    select(cols) { calls.select.push(cols); return builder; },
    eq(col, val) { calls.eq.push([col, val]); return builder; },
    in(col, vals) { calls.in.push([col, vals]); return builder; },
    order(col, opts) { calls.order.push([col, opts]); return builder; },
    range(from, to) {
      calls.range.push([from, to]);
      const slice = rows.slice(from, to + 1);
      return Promise.resolve({ data: slice, error: null });
    },
  };
  const supabase = {
    from(table) { calls.from.push(table); return builder; },
    _calls: calls,
  };
  return supabase;
}

test(
  'crdtBackfill #1: preserves legacy authorId on import (meta.authorId === row.user_id)',
  { skip: !existsSync(TARGET) ? 'crdtBackfill.js not yet present (Plan 30-02)' : (skipReason() || false) },
  async () => {
    const Y = await import('yjs');
    const mod = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMapAnnotations = ydoc.getMap('annotations');
    const supabase = makeSupabaseMock([
      {
        highlight_id: 'anno-A',
        user_id: 'alice',
        document_id: 'doc1',
        annotation_type: 'square',
        created_at: '2026-01-15T10:00:00Z',
        annotation_data: JSON.stringify({ left: 10, top: 20, width: 100, height: 50 }),
      },
    ]);
    await mod.runBackfill({
      ydoc,
      yMapAnnotations,
      supabase,
      documentId: 'doc1',
      userId: 'importer1',
      sessionId: 's1',
      clientID: ydoc.clientID,
    });
    const meta = yMapAnnotations.get('anno-A')?.get('meta');
    assert.ok(meta, 'expected anno-A meta YMap to exist after backfill');
    assert.strictEqual(meta.get('authorId'), 'alice', 'meta.authorId must equal legacy row.user_id');
  }
);

test(
  'crdtBackfill #2: sets deviceId to literal "before-v2.4" string for every imported row',
  { skip: !existsSync(TARGET) ? 'crdtBackfill.js not yet present (Plan 30-02)' : (skipReason() || false) },
  async () => {
    const Y = await import('yjs');
    const mod = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMapAnnotations = ydoc.getMap('annotations');
    const supabase = makeSupabaseMock([
      { highlight_id: 'anno-A', user_id: 'alice', document_id: 'doc1', annotation_type: 'square',
        created_at: '2026-01-15T10:00:00Z', annotation_data: '{"left":0,"top":0}' },
      { highlight_id: 'anno-B', user_id: 'bob',   document_id: 'doc1', annotation_type: 'circle',
        created_at: '2026-01-16T10:00:00Z', annotation_data: '{"left":0,"top":0}' },
    ]);
    await mod.runBackfill({ ydoc, yMapAnnotations, supabase, documentId: 'doc1', userId: 'importer1', sessionId: 's1', clientID: ydoc.clientID });
    assert.strictEqual(yMapAnnotations.get('anno-A')?.get('meta')?.get('deviceId'), 'before-v2.4');
    assert.strictEqual(yMapAnnotations.get('anno-B')?.get('meta')?.get('deviceId'), 'before-v2.4');
  }
);

test(
  'crdtBackfill #3: preserves legacy createdAt timestamp (NOT import-time)',
  { skip: !existsSync(TARGET) ? 'crdtBackfill.js not yet present (Plan 30-02)' : (skipReason() || false) },
  async () => {
    const Y = await import('yjs');
    const mod = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMapAnnotations = ydoc.getMap('annotations');
    const legacyTs = '2026-01-15T10:00:00Z';
    const supabase = makeSupabaseMock([
      { highlight_id: 'anno-A', user_id: 'alice', document_id: 'doc1', annotation_type: 'square',
        created_at: legacyTs, annotation_data: '{"left":0,"top":0}' },
    ]);
    await mod.runBackfill({ ydoc, yMapAnnotations, supabase, documentId: 'doc1', userId: 'importer1', sessionId: 's1', clientID: ydoc.clientID });
    const createdAt = yMapAnnotations.get('anno-A')?.get('meta')?.get('createdAt');
    assert.strictEqual(createdAt, Date.parse(legacyTs), 'meta.createdAt must equal Date.parse(row.created_at)');
  }
);

test(
  'crdtBackfill #4: is idempotent across runs (second run produces zero new entries)',
  { skip: !existsSync(TARGET) ? 'crdtBackfill.js not yet present (Plan 30-02)' : (skipReason() || false) },
  async () => {
    const Y = await import('yjs');
    const mod = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMapAnnotations = ydoc.getMap('annotations');
    const supabase = makeSupabaseMock([
      { highlight_id: 'anno-A', user_id: 'alice', document_id: 'doc1', annotation_type: 'square',
        created_at: '2026-01-15T10:00:00Z', annotation_data: '{"left":0,"top":0}' },
    ]);
    await mod.runBackfill({ ydoc, yMapAnnotations, supabase, documentId: 'doc1', userId: 'importer1', sessionId: 's1', clientID: ydoc.clientID });
    const sizeAfterFirst = yMapAnnotations.size;
    await mod.runBackfill({ ydoc, yMapAnnotations, supabase, documentId: 'doc1', userId: 'importer1', sessionId: 's1', clientID: ydoc.clientID });
    const sizeAfterSecond = yMapAnnotations.size;
    assert.strictEqual(sizeAfterSecond, sizeAfterFirst, 'second backfill must not add entries (idempotent by client_anno_id)');
  }
);

test(
  'crdtBackfill #5: skips annotation_type === "highlight" rows via Postgres NOT-IN filter',
  { skip: !existsSync(TARGET) ? 'crdtBackfill.js not yet present (Plan 30-02)' : (skipReason() || false) },
  async () => {
    const Y = await import('yjs');
    const mod = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMapAnnotations = ydoc.getMap('annotations');
    // Highlight row WOULD be in the table but the backfill's WHERE clause must
    // filter it out — the supabase mock records the .in() args; we verify
    // 'highlight' is NOT in the filter list AND no anno-H entry lands.
    const supabase = makeSupabaseMock([
      { highlight_id: 'anno-A', user_id: 'alice', document_id: 'doc1', annotation_type: 'square',
        created_at: '2026-01-15T10:00:00Z', annotation_data: '{"left":0,"top":0}' },
    ]);
    await mod.runBackfill({ ydoc, yMapAnnotations, supabase, documentId: 'doc1', userId: 'importer1', sessionId: 's1', clientID: ydoc.clientID });
    // Verify the filter: at least one .in('annotation_type', [...]) must have been called
    // with a list that does NOT include 'highlight'.
    const inCalls = supabase._calls.in;
    const typeFilters = inCalls.filter((c) => c[0] === 'annotation_type');
    assert.ok(typeFilters.length >= 1, 'expected at least one .in("annotation_type", [...]) Postgres filter');
    for (const [, vals] of typeFilters) {
      assert.ok(!vals.includes('highlight'), 'annotation_type filter list must NOT include "highlight"');
    }
    assert.strictEqual(yMapAnnotations.get('anno-H'), undefined, 'highlight rows must NOT be imported');
  }
);

test(
  'crdtBackfill #6: tags transactions with source: "crdt-backfill" origin',
  { skip: !existsSync(TARGET) ? 'crdtBackfill.js not yet present (Plan 30-02)' : (skipReason() || false) },
  async () => {
    const Y = await import('yjs');
    const mod = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMapAnnotations = ydoc.getMap('annotations');
    const capturedOrigins = [];
    ydoc.on('afterTransaction', (txn) => { capturedOrigins.push(txn.origin); });
    const supabase = makeSupabaseMock([
      { highlight_id: 'anno-A', user_id: 'alice', document_id: 'doc1', annotation_type: 'square',
        created_at: '2026-01-15T10:00:00Z', annotation_data: '{"left":0,"top":0}' },
    ]);
    await mod.runBackfill({ ydoc, yMapAnnotations, supabase, documentId: 'doc1', userId: 'importer1', sessionId: 's1', clientID: ydoc.clientID });
    const hasBackfillOrigin = capturedOrigins.some((o) => o && typeof o === 'object' && o.source === 'crdt-backfill');
    assert.ok(hasBackfillOrigin, 'at least one transaction origin must carry source: "crdt-backfill"');
  }
);

test(
  'crdtBackfill #7 (Phase 31 hotfix 2026-05-03): paginated SELECT covers >1000 rows so PostgREST default cap does not silently truncate the import',
  { skip: !existsSync(TARGET) ? 'crdtBackfill.js not yet present (Plan 30-02)' : (skipReason() || false) },
  async () => {
    const Y = await import('yjs');
    const mod = await import(TARGET);
    const ydoc = new Y.Doc();
    const yMapAnnotations = ydoc.getMap('annotations');

    // 2,500 rows = three pages: 1000 + 1000 + 500.
    const BIG_FIXTURE_SIZE = 2500;
    const rows = [];
    for (let i = 0; i < BIG_FIXTURE_SIZE; i++) {
      const idStr = String(i).padStart(6, '0');
      rows.push({
        highlight_id: `anno-${idStr}`,
        user_id: 'alice',
        document_id: 'doc1',
        annotation_type: 'square',
        created_at: '2026-01-15T10:00:00Z',
        annotation_data: '{"left":0,"top":0,"width":10,"height":10}',
      });
    }
    const supabase = makeSupabaseMock(rows);

    const result = await mod.runBackfill({
      ydoc, yMapAnnotations, supabase,
      documentId: 'doc1', userId: 'importer1', sessionId: 's1', clientID: ydoc.clientID,
    });

    // Three pages of fetch (1000 + 1000 + 500). Pre-hotfix the SELECT was
    // unpaginated and the `_calls.range` array would have zero entries
    // (and the loop would have processed only the first ~1000 rows).
    const rangeCalls = supabase._calls.range;
    assert.strictEqual(rangeCalls.length, 3, `expected exactly 3 paginated .range() fetches for 2500 rows; got ${rangeCalls.length}`);
    assert.deepStrictEqual(rangeCalls[0], [0, 999], 'first page must request rows [0, 999]');
    assert.deepStrictEqual(rangeCalls[1], [1000, 1999], 'second page must request rows [1000, 1999]');
    assert.deepStrictEqual(rangeCalls[2], [2000, 2999], 'third page must request rows [2000, 2999] and short-circuit on partial fill');

    // All 2500 annotations must land in the Y.Map. Pre-hotfix size was 1000.
    assert.strictEqual(yMapAnnotations.size, BIG_FIXTURE_SIZE,
      `expected all ${BIG_FIXTURE_SIZE} rows in Y.Map after paginated import; got ${yMapAnnotations.size}`);
    assert.strictEqual(result.imported, BIG_FIXTURE_SIZE,
      `expected runBackfill to report imported=${BIG_FIXTURE_SIZE}; got ${result.imported}`);
  },
);
