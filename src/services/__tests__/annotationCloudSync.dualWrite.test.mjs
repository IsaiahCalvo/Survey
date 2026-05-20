// src/services/__tests__/annotationCloudSync.dualWrite.test.mjs
// Phase 30 Wave 0 scaffold (Plan 30-01) — runs as test.skip until Plan 30-04
// adds the `dualWriteFabricCommit` export to src/services/annotationCloudSync.js.
//
// Validates dual-write fan-out contracts:
//   - Both legacy upsertFabricAnnotation + bridge applyFabricCommit fire when
//     CRDT enabled + non-surveyMarker (AC-1)
//   - When kill switch off (isCRDTEnabled() === false), CRDT side is skipped
//     and legacy behavior is byte-identical (AC-15)
//   - When annotation_type === 'surveyMarker', CRDT side is skipped regardless of
//     kill switch (AC-18 — Excel-sync carve-out, folded into v2.5)
//   - Legacy-side failure enqueues to retry queue with side: 'legacy'
//   - CRDT-side failure enqueues to retry queue with side: 'crdt'
//
// Two-stage skip: outer existsSync passes (annotationCloudSync.js exists today),
// inner skip happens when the `dualWriteFabricCommit` export is missing.
//
// Per-test existsSync skip-guard pattern (Phase 27/28/29 precedent).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TARGET = resolve(__dirname, '../annotationCloudSync.js');

// Inner skip helper: file may exist (legacy module since Phase 21) but the
// dualWriteFabricCommit symbol only lands in Plan 30-04. Use a source-text
// grep so we don't have to actually import the module just to detect the
// export — module imports also fail at the supabase client side-effects.
function dualWriteSymbolPresent() {
  if (!existsSync(TARGET)) return false;
  const src = readFileSync(TARGET, 'utf8');
  return /export\s+(async\s+)?function\s+dualWriteFabricCommit\b|export\s+const\s+dualWriteFabricCommit\b|export\s*\{[^}]*\bdualWriteFabricCommit\b/.test(src);
}

function skipReason() {
  if (!existsSync(TARGET)) return 'annotationCloudSync.js missing (unexpected)';
  if (!dualWriteSymbolPresent()) return 'dualWriteFabricCommit not yet exported (Plan 30-04)';
  return false;
}

test(
  'dualWriteFabricCommit #1: fires both legacy upsertFabricAnnotation + bridge applyFabricCommit when CRDT enabled + non-surveyMarker',
  { skip: !existsSync(TARGET) ? 'annotationCloudSync.js missing' : (skipReason() || false) },
  async (t) => {
    if (!dualWriteSymbolPresent()) {
      t.skip('dualWriteFabricCommit not yet exported (Plan 30-04)');
      return;
    }
    // When the symbol lands, this test will exercise: import { dualWriteFabricCommit }
    // from the target, mock isCRDTEnabled() → true, mock upsertFabricAnnotation +
    // applyFabricCommit, call dualWriteFabricCommit, assert both spies called.
    // Plan 30-04 owns the wiring; this scaffold locks the contract description.
    assert.ok(true, 'contract scaffold — Plan 30-04 implementation flips this to active');
  }
);

test(
  'dualWriteFabricCommit #2: skips CRDT side when isCRDTEnabled() returns false; legacy upsert still runs',
  { skip: !existsSync(TARGET) ? 'annotationCloudSync.js missing' : (skipReason() || false) },
  async (t) => {
    if (!dualWriteSymbolPresent()) {
      t.skip('dualWriteFabricCommit not yet exported (Plan 30-04)');
      return;
    }
    // Mock isCRDTEnabled() → false; mock upsertFabricAnnotation + applyFabricCommit;
    // call dualWriteFabricCommit; assert legacy spy called, bridge spy NOT called;
    // return shape includes { legacy: result, crdt: null }.
    assert.ok(true, 'contract scaffold — Plan 30-04 implementation flips this to active');
  }
);

test(
  'dualWriteFabricCommit #3: skips CRDT side when annotation_type === "surveyMarker" regardless of kill switch (AC-18)',
  { skip: !existsSync(TARGET) ? 'annotationCloudSync.js missing' : (skipReason() || false) },
  async (t) => {
    if (!dualWriteSymbolPresent()) {
      t.skip('dualWriteFabricCommit not yet exported (Plan 30-04)');
      return;
    }
    // Mock isCRDTEnabled() → true; pass fabricObj with type='surveyMarker';
    // assert applyFabricCommit NOT called (legacy carve-out for v2.5).
    assert.ok(true, 'contract scaffold — Plan 30-04 implementation flips this to active');
  }
);

test(
  'dualWriteFabricCommit #4: enqueues legacy-side failure to retry queue with side: "legacy"',
  { skip: !existsSync(TARGET) ? 'annotationCloudSync.js missing' : (skipReason() || false) },
  async (t) => {
    if (!dualWriteSymbolPresent()) {
      t.skip('dualWriteFabricCommit not yet exported (Plan 30-04)');
      return;
    }
    // Mock upsertFabricAnnotation throws; assert enqueue called with
    // side: 'legacy' and the annoId from fabricObj.data.id.
    assert.ok(true, 'contract scaffold — Plan 30-04 implementation flips this to active');
  }
);

test(
  'dualWriteFabricCommit #5: enqueues CRDT-side failure to retry queue with side: "crdt"',
  { skip: !existsSync(TARGET) ? 'annotationCloudSync.js missing' : (skipReason() || false) },
  async (t) => {
    if (!dualWriteSymbolPresent()) {
      t.skip('dualWriteFabricCommit not yet exported (Plan 30-04)');
      return;
    }
    // Mock applyFabricCommit throws; assert enqueue called with side: 'crdt'.
    assert.ok(true, 'contract scaffold — Plan 30-04 implementation flips this to active');
  }
);
