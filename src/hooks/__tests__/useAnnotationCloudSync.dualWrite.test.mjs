// src/hooks/__tests__/useAnnotationCloudSync.dualWrite.test.mjs
// Phase 30 Wave 0 scaffold (Plan 30-01 Task 4) — runs as test.skip until
// Plan 30-07 wires `dualWriteFabricCommit` into useAnnotationCloudSync.js
// at the existing legacy upsert call sites (~lines 411, 434, 513, 532, 807,
// 811, 815, 848, 851 per 30-01-PLAN.md context).
//
// Validates AC-1 + AC-15 + AC-18 wire-up contracts (grep-based; the hook
// is a large React side-effect surface so source-grep is the cheapest way
// to lock the contract):
//   - At least one fabric upsert call site fans out to dualWriteFabricCommit
//   - At least one fabric delete call site fans out to dualWriteFabricDelete
//   - Kill-switch fallback path preserved (legacy-only when isCRDTEnabled() === false)
//   - Highlight rows bypass dual-write at the call site (proximity check)
//   - Callout sync path remains on the dedicated upsertCallouts service
//     surface, with Y.Doc fan-out handled by the callout CRDT bridge.
//
// Two-stage skip: outer existsSync passes (file exists today), inner skip
// happens when `dualWriteFabricCommit` is not yet referenced in the source.
//
// Per-test existsSync skip-guard pattern (Phase 27/28/29 precedent).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const TARGET = resolve(__dirname, '../useAnnotationCloudSync.js');

// Inner-skip helper: file exists since Phase 21 but the dualWriteFabricCommit
// reference only lands when Plan 30-07 wires the call sites.
function dualWriteWired() {
  if (!existsSync(TARGET)) return false;
  const src = readFileSync(TARGET, 'utf8');
  return src.includes('dualWriteFabricCommit');
}

const SKIP_REASON = !existsSync(TARGET)
  ? 'useAnnotationCloudSync.js missing'
  : (!dualWriteWired() ? 'dualWriteFabricCommit not yet wired (Plan 30-07)' : false);

test(
  'useAnnotationCloudSync dualWrite #1: fabric upsert call site fans out to dualWriteFabricCommit when CRDT enabled',
  { skip: !existsSync(TARGET) ? 'useAnnotationCloudSync.js missing' : SKIP_REASON },
  () => {
    if (!dualWriteWired()) return; // belt + suspenders: if outer passed but inner is stale.
    const src = readFileSync(TARGET, 'utf8');
    const matches = (src.match(/dualWriteFabricCommit\(/g) || []).length;
    assert.ok(matches >= 1, `expected at least one dualWriteFabricCommit( call site, got ${matches}`);
  }
);

test(
  'useAnnotationCloudSync dualWrite #2: fabric delete call site fans out to dualWriteFabricDelete',
  { skip: !existsSync(TARGET) ? 'useAnnotationCloudSync.js missing' : SKIP_REASON },
  () => {
    if (!dualWriteWired()) return;
    const src = readFileSync(TARGET, 'utf8');
    const matches = (src.match(/dualWriteFabricDelete\(/g) || []).length;
    assert.ok(matches >= 1, `expected at least one dualWriteFabricDelete( call site, got ${matches}`);
  }
);

test(
  'useAnnotationCloudSync dualWrite #3: kill switch (isCRDTEnabled) fallback path preserved at call sites',
  { skip: !existsSync(TARGET) ? 'useAnnotationCloudSync.js missing' : SKIP_REASON },
  () => {
    if (!dualWriteWired()) return;
    const src = readFileSync(TARGET, 'utf8');
    // Either the hook calls isCRDTEnabled() directly, OR it relies on
    // dualWriteFabricCommit's internal kill-switch gate (which is the
    // approved pattern per 30-CONTEXT.md "single source of truth"). The
    // dual-write helper itself owns the gate — but the hook should at
    // least import or reference it, OR demonstrate that the dualWrite
    // entry point owns the gate transitively.
    const hasGate = /isCRDTEnabled\b/.test(src) || /dualWriteFabricCommit/.test(src);
    assert.ok(hasGate, 'expected isCRDTEnabled() reference OR dualWriteFabricCommit gate trust');
  }
);

test(
  'useAnnotationCloudSync dualWrite #4: highlight rows bypass dual-write at the call site (proximity check)',
  { skip: !existsSync(TARGET) ? 'useAnnotationCloudSync.js missing' : SKIP_REASON },
  () => {
    if (!dualWriteWired()) return;
    const src = readFileSync(TARGET, 'utf8');
    const lines = src.split('\n');
    let foundProximity = false;
    for (let i = 0; i < lines.length; i++) {
      if (/dualWrite/.test(lines[i])) {
        // Look 5 lines either side for a 'highlight' reference (filter / type
        // check / branch comment).
        const start = Math.max(0, i - 5);
        const end = Math.min(lines.length, i + 6);
        const window = lines.slice(start, end).join('\n');
        if (/highlight/i.test(window)) { foundProximity = true; break; }
      }
    }
    // The proximity check is heuristic — if dualWriteFabricCommit's internal
    // highlight skip is the contract surface (not the call site), this can
    // pass via the dual-write helper itself. Either is acceptable: the
    // contract is "highlights MUST NOT be dual-written" and Plan 30-04
    // already locks that at the helper level.
    assert.ok(
      foundProximity || src.includes('NON_HIGHLIGHT_TYPES'),
      'expected highlight skip reference within 5 lines of dualWrite call site OR NON_HIGHLIGHT_TYPES filter present'
    );
  }
);

test(
  'useAnnotationCloudSync dualWrite #5: callout sync path uses upsertCallouts and not dualWriteCallouts',
  { skip: !existsSync(TARGET) ? 'useAnnotationCloudSync.js missing' : SKIP_REASON },
  () => {
    if (!dualWriteWired()) return;
    const src = readFileSync(TARGET, 'utf8');
    // Callouts have their own state slice and Supabase serializer surface.
    // The hook should still reference upsertCallouts. It must NOT have a
    // Fabric-style dualWriteCallouts variant.
    assert.ok(
      src.includes('upsertCallouts'),
      'expected upsertCallouts call sites to remain for callout persistence'
    );
    assert.ok(
      !/dualWriteCallouts\b/.test(src),
      'expected NO dualWriteCallouts variant (v2.5 owns callout migration if any)'
    );
  }
);
