// tests/annotationIdleRecoveryContracts.test.mjs — KAL-92 regression coverage.
// Pins idle-disappearance diagnostics and safety wiring that NO existing test
// asserts (verified by grep across tests/ and src/**/__tests__ on 2026-06-10;
// the cutover-recovery probe is deliberately absent here — it is already
// pinned by tests/annotationInitialHydrationSource.test.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const HOOK_SOURCE = readFileSync(resolve(REPO_ROOT, 'src/hooks/useAnnotationCloudSync.js'), 'utf8');
const VIEWER_SOURCE = readFileSync(resolve(REPO_ROOT, 'src/PDFViewer.jsx'), 'utf8');

test('callout hydrate is safety-wrapped by resolveSafeSnapshot (multi-kind survival)', () => {
  // Fabric contexts are pinned by annotationInitialHydrationSource.test.mjs;
  // this pins the CALLOUT kind so a hydrate refactor cannot quietly drop the
  // empty-snapshot guard for callouts while keeping it for fabric. The regex
  // is scoped to the resolveSafeSnapshot call block — a comment or unrelated
  // string mentioning the context cannot false-pass it.
  //
  // R2.3a Slice 5 — callouts hydrate INTO annotationsByPage now (merged via
  // applyCalloutListToByPage inside the single fabric setter), but the list
  // must still pass through resolveSafeSnapshot BEFORE the merge: the guard
  // asserts the safety wrap survives the consolidation, the derived-list
  // `current` sourcing, and the merge call downstream of the wrap.
  assert.match(
    HOOK_SOURCE,
    /resolveSafeSnapshot\(\{[\s\S]{0,400}?context:\s*'initial-hydrate-callouts',?\s*\}\)/
  );
  const wrapIndex = HOOK_SOURCE.indexOf("context: 'initial-hydrate-callouts'");
  assert.ok(wrapIndex > 0, 'expected the initial-hydrate callout safety wrap');
  // current = the callout list the on-screen byPage derives to (not a retired
  // separate-state ref) — pinned within the same resolveSafeSnapshot block.
  const blockStart = HOOK_SOURCE.lastIndexOf('resolveSafeSnapshot({', wrapIndex);
  const blockText = HOOK_SOURCE.slice(blockStart, wrapIndex);
  assert.match(blockText, /current:\s*calloutList/,
    'empty-wipe protection must run on the derived callout list');
  // The safety-resolved list must feed the byPage merge, and the merged value
  // must update lastByPageRef in lockstep (echo suppression on hydrate).
  const afterWrap = HOOK_SOURCE.slice(wrapIndex, wrapIndex + 1400);
  assert.match(afterWrap, /calloutList = safeCallouts\.value/,
    'merged hydrate must apply the safety-resolved callout list');
  assert.match(afterWrap, /applyCalloutListToByPage\(nextFabric, calloutList, readPageSizes\(\)\)/,
    'safety-resolved callout list must merge into the byPage snapshot');
  assert.match(afterWrap, /lastByPageRef\.current = next/,
    'merged hydrate must keep lastByPageRef in lockstep');
});

test('local sidecar survey-marker hydrate is safety-wrapped (multi-kind survival)', () => {
  assert.match(
    VIEWER_SOURCE,
    /resolveSafeSnapshot\(\{[\s\S]{0,400}?context:\s*'supabase-storage-survey-markers',?\s*\}\)/
  );
});

test('stale-cache shrink suppression is wired to its guard and keeps its Save Log signature', () => {
  // The warn must live inside the shouldSuppressStaleCacheShrink(...) branch.
  assert.match(
    HOOK_SOURCE,
    /shouldSuppressStaleCacheShrink\(\{[\s\S]{0,400}?\}\)\)\s*\{\s*console\.warn\('\[CloudSync\]\[hook\] stale-cache shrink suppressed/
  );
});

test('post-suppress re-hydrate keeps its Save Log signature on the debug channel', () => {
  assert.match(
    HOOK_SOURCE,
    /cloudSyncHookDebug\('\[CloudSync\]\[hook\] re-hydrate after suppress — restoring state from Y\.Map /
  );
});
