// tests/dedupeResyncSafetyBranches.test.mjs — KAL-92 regression coverage.
// COMPLEMENTS src/hooks/__tests__/useAnnotationCloudSync.dedupeResync.test.mjs
// (which pins the combined startup-shrink incident case + the decision-before-
// setter source order). This file covers every OTHER branch of
// shouldApplyDedupeResync, the crdt:dedupe-resync producer contract in
// YDocProvider, and a scoped-slice contract over the hook's handler body so
// the five guard inputs and both Save Log signatures cannot silently un-wire.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { shouldApplyDedupeResync } from '../src/utils/dedupeResyncSafety.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const HOOK_PATH = resolve(REPO_ROOT, 'src/hooks/useAnnotationCloudSync.js');
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

// --- scoped consumer contract: the hook handler wires all five guard inputs -----

test('hook dedupe-resync handler wires all five guard inputs and both Save Log signatures, in order', () => {
  const hookSource = readFileSync(HOOK_PATH, 'utf8');

  const anchor = 'const onDedupeResync = (e) => {';
  const firstAnchor = hookSource.indexOf(anchor);
  assert.notEqual(firstAnchor, -1, 'handler anchor must exist');
  assert.equal(hookSource.indexOf(anchor, firstAnchor + 1), -1, 'handler anchor must be unique');

  const cleanup = "removeEventListener('crdt:dedupe-resync', onDedupeResync)";
  const cleanupIndex = hookSource.indexOf(cleanup, firstAnchor);
  assert.notEqual(cleanupIndex, -1, 'listener cleanup must exist after the handler');

  const slice = hookSource.slice(firstAnchor, cleanupIndex);

  // All five guard inputs wired from live state, inside the handler.
  assert.match(slice, /shouldApplyDedupeResync\(\{\s*currentCount:\s*__currentCount,\s*resyncCount:\s*__resyncCount,\s*removedCount:\s*__removedCount,\s*startupSyncInFlight:\s*startupSyncInFlightRef\.current,\s*hydrated:\s*hydratedRef\.current,?\s*\}\)/);

  // The decision gates the state update, and both diagnostics fire in order:
  // skip-log before restore-log before the setter.
  const gateIndex = slice.indexOf('if (!decision.apply)');
  const skipLogIndex = slice.indexOf('dedupe-resync skipped unsafe shrink');
  const restoreLogIndex = slice.indexOf('dedupe-resync — restoring state');
  const setterIndex = slice.indexOf('setAnnotationsByPage(');
  assert.ok(gateIndex !== -1, 'decision.apply gate must exist in the handler');
  assert.ok(skipLogIndex > gateIndex, 'unsafe-shrink Save Log signature must live inside the gate');
  assert.ok(restoreLogIndex > skipLogIndex, 'restore signature must follow the gate');
  assert.ok(setterIndex > restoreLogIndex, 'state replacement must come after the safety decision and logs');
});
