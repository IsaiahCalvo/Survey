// tests/annotationIdleRecoveryContracts.test.mjs — KAL-92 regression coverage.
// Pins idle-disappearance safety wiring that NO existing test asserts.
//
// 2026-07-17: the three tests pinning internals of the retired
// useAnnotationCloudSync hook (callout hydrate safety wrap, stale-cache shrink
// suppression, post-suppress re-hydrate signature) were deleted with the hook
// module — the hook was unmounted (pinned by
// tests/annotationInitialHydrationSource.test.mjs) so those contracts never
// executed. The live sidecar guard below is unaffected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const VIEWER_SOURCE = readFileSync(resolve(REPO_ROOT, 'src/PDFViewer.jsx'), 'utf8');

test('local sidecar survey-marker hydrate is safety-wrapped (multi-kind survival)', () => {
  assert.match(
    VIEWER_SOURCE,
    /resolveSafeSnapshot\(\{[\s\S]{0,400}?context:\s*'supabase-storage-survey-markers',?\s*\}\)/
  );
});
