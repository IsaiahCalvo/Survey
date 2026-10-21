// tests/annotationIdleRecoveryContracts.test.mjs — KAL-92 regression coverage.
// Pins idle-disappearance safety wiring that NO existing test asserts.
//
// 2026-07-17: the three tests pinning internals of the retired
// useAnnotationCloudSync hook (callout hydrate safety wrap, stale-cache shrink
// suppression, post-suppress re-hydrate signature) were deleted with the hook
// module — the hook was unmounted (pinned by
// tests/annotationInitialHydrationSource.test.mjs) so those contracts never
// executed.
//
// KAL-275 (2026-10-13): the "empty-cloud safe-snapshot guard"
// (resolveSafeSnapshot) that this file used to pin was deleted. It wrapped the
// project Storage sidecar's Survey Marker and spaces restores, but both only
// run for a document WITHOUT a cloud id while the guard only acted for a
// cloud-backed one, so it could never fire. What actually keeps a stale (or
// empty) sidecar from blanking a cloud document is that those restores are
// skipped for cloud documents altogether — pinned below. The end-to-end proof
// is debug/scenarios/test-plan/save-gates.spec.mjs (cloud roundtrip with a
// stale empty sidecar served, and a same-file re-upload).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const VIEWER_SOURCE = readFileSync(resolve(REPO_ROOT, 'src/PDFViewer.jsx'), 'utf8');

test('the unreachable empty-cloud guard stays deleted', () => {
  assert.equal(existsSync(resolve(REPO_ROOT, 'src/utils/safeSnapshot.js')), false);
  assert.doesNotMatch(VIEWER_SOURCE, /resolveSafeSnapshot|utils\/safeSnapshot/);
});
