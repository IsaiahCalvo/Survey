// tests/dedupeResyncSafetyBranches.test.mjs — KAL-92 regression coverage.
// Covers every branch of shouldApplyDedupeResync (including the startup-shrink
// incident case, moved here 2026-07-17 from the deleted
// useAnnotationCloudSync.dedupeResync.test.mjs) and the crdt:dedupe-resync
// producer contract in YDocProvider.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { shouldApplyDedupeResync } from '../src/utils/dedupeResyncSafety.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const PROVIDER_PATH = resolve(REPO_ROOT, 'src/components/collab/YDocProvider.jsx');

// --- branch coverage for shouldApplyDedupeResync --------------------------------

test('growth is not a shrink — resync applies', () => {
  const d = shouldApplyDedupeResync({ currentCount: 10, resyncCount: 12, removedCount: 0, startupSyncInFlight: false, hydrated: true });
  assert.deepEqual(d, { apply: true, reason: 'not-a-shrink', shrink: -2 });
});

test('equal counts are not a shrink — resync applies', () => {
  const d = shouldApplyDedupeResync({ currentCount: 10, resyncCount: 10, removedCount: 0, startupSyncInFlight: false, hydrated: true });
  assert.deepEqual(d, { apply: true, reason: 'not-a-shrink', shrink: 0 });
});

test('startupSyncInFlight ALONE blocks a shrink even when hydrated', () => {
  const d = shouldApplyDedupeResync({ currentCount: 10, resyncCount: 9, removedCount: 1, startupSyncInFlight: true, hydrated: true });
  assert.equal(d.apply, false);
  assert.equal(d.reason, 'startup-shrink');
  assert.equal(d.shrink, 1);
});

test('un-hydrated state ALONE blocks a shrink even with startup sync settled', () => {
  const d = shouldApplyDedupeResync({ currentCount: 10, resyncCount: 9, removedCount: 1, startupSyncInFlight: false, hydrated: false });
  assert.equal(d.apply, false);
  assert.equal(d.reason, 'startup-shrink');
});

test('hydrated shrink larger than what dedupe removed is refused', () => {
  const d = shouldApplyDedupeResync({ currentCount: 100, resyncCount: 90, removedCount: 3, startupSyncInFlight: false, hydrated: true });
  assert.equal(d.apply, false);
  assert.equal(d.reason, 'shrink-exceeds-dedupe-removal');
  assert.equal(d.shrink, 10);
});

test('hydrated shrink within the dedupe removal is the expected case and applies', () => {
  const d = shouldApplyDedupeResync({ currentCount: 100, resyncCount: 97, removedCount: 3, startupSyncInFlight: false, hydrated: true });
  assert.deepEqual(d, { apply: true, reason: 'expected-dedupe-shrink', shrink: 3 });
});

test('negative removedCount clamps to zero, so ANY hydrated shrink is refused', () => {
  const d = shouldApplyDedupeResync({ currentCount: 10, resyncCount: 9, removedCount: -5, startupSyncInFlight: false, hydrated: true });
  assert.equal(d.apply, false);
  assert.equal(d.reason, 'shrink-exceeds-dedupe-removal');
});

test('no-args / all-defaults call is a 0→0 non-shrink and applies', () => {
  const d = shouldApplyDedupeResync();
  assert.equal(d.apply, true);
  assert.equal(d.reason, 'not-a-shrink');
});

test('all-NaN counts default to zero and apply as a non-shrink', () => {
  const d = shouldApplyDedupeResync({ currentCount: NaN, resyncCount: NaN, removedCount: NaN, startupSyncInFlight: false, hydrated: true });
  assert.equal(d.apply, true);
  assert.equal(d.reason, 'not-a-shrink');
});

test('NaN removedCount clamps to zero — a hydrated shrink with NaN removed is refused', () => {
  // all-NaN returns at the not-a-shrink branch before removed handling, so
  // this case pins the removed-clamp on an actual shrink path.
  const d = shouldApplyDedupeResync({ currentCount: 10, resyncCount: 8, removedCount: NaN, startupSyncInFlight: false, hydrated: true });
  assert.equal(d.apply, false);
  assert.equal(d.reason, 'shrink-exceeds-dedupe-removal');
});

test('KAL-92 safety property: a NaN resync count can never wipe a populated un-hydrated view', () => {
  // NaN resyncCount is treated as 0 — a full shrink — which the startup guard
  // must refuse while hydration is pending.
  const d = shouldApplyDedupeResync({ currentCount: 50, resyncCount: NaN, removedCount: 0, startupSyncInFlight: false, hydrated: false });
  assert.equal(d.apply, false);
  assert.equal(d.reason, 'startup-shrink');
  assert.equal(d.shrink, 50);
});

// --- producer contract: YDocProvider must send the fields the guard consumes ----

test('YDocProvider dispatches crdt:dedupe-resync with documentId + removed, gated on removed > 0', () => {
  const providerSource = readFileSync(PROVIDER_PATH, 'utf8');
  // One scoped match from the gate condition through the dispatch detail —
  // proves the dispatch lives INSIDE the removed > 0 branch, and that the
  // detail carries the exact fields the consumer guard depends on.
  assert.match(
    providerSource,
    /if \(dedupeResult && dedupeResult\.removed > 0[^)]*\) \{\s*window\.dispatchEvent\(new CustomEvent\('crdt:dedupe-resync',\s*\{\s*detail:\s*\{\s*documentId:\s*docId,\s*removed:\s*dedupeResult\.removed,?\s*\},?\s*\}\)\);/,
    'dedupe-resync dispatch must sit inside the removed > 0 gate and carry { documentId, removed }'
  );
});

// --- KAL-92 incident case (moved here 2026-07-17 when the retired
// useAnnotationCloudSync hook and its co-located dedupeResync test were
// deleted; this was the one PURE test in that file worth preserving) --------

test('dedupe resync refuses stale Y.Doc snapshots that shrink more than the dedupe removed (KAL-92 incident case)', () => {
  const decision = shouldApplyDedupeResync({
    currentCount: 529,
    resyncCount: 429,
    removedCount: 1,
    startupSyncInFlight: true,
    hydrated: false,
  });

  assert.equal(decision.apply, false);
  assert.equal(decision.reason, 'startup-shrink');
});

// NOTE (2026-07-17): the scoped consumer-contract test over the retired
// useAnnotationCloudSync hook's onDedupeResync handler was deleted with the
// hook module — the hook was unmounted (pinned by
// tests/annotationInitialHydrationSource.test.mjs) and its handler never ran.
// The YDocProvider producer contract above still holds; the event currently
// has no consumer (dispatch retained pending the pass-2 sweep).
