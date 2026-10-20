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

const sidecarLoader = () => {
  const start = VIEWER_SOURCE.indexOf('const loadSurveyDataFromSupabase = useCallback(');
  assert.notEqual(start, -1, 'loadSurveyDataFromSupabase exists');
  return VIEWER_SOURCE.slice(start, start + 6000);
};

test('the project sidecar never restores Survey Markers onto a cloud document', () => {
  assert.match(sidecarLoader(), /if \(data\.annotations && !doc\.id\) \{\s*setSurveyMarkers\(data\.annotations\);\s*\}/);
});

test('the project sidecar never restores marks, callouts or spaces onto a cloud document', () => {
  const body = sidecarLoader();
  assert.match(body, /const shouldRestoreLegacyAnnotationBlob = !doc\.id;/);
  assert.match(body, /if \(data\.annotationsByPage && shouldRestoreLegacyAnnotationBlob\)/);
  assert.match(body, /if \(data\.callouts && shouldRestoreLegacyAnnotationBlob\)/);
  assert.match(body, /if \(data\.spaces && shouldRestoreLegacyAnnotationBlob\) \{\s*setSpaces\(Array\.isArray\(data\.spaces\) \? data\.spaces : \[\]\);\s*\}/);
});

test('the unreachable empty-cloud guard stays deleted', () => {
  assert.equal(existsSync(resolve(REPO_ROOT, 'src/utils/safeSnapshot.js')), false);
  assert.doesNotMatch(VIEWER_SOURCE, /resolveSafeSnapshot|utils\/safeSnapshot/);
});
