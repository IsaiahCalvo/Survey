import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { shouldApplyDedupeResync } from '../../utils/dedupeResyncSafety.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../useAnnotationCloudSync.js');

test('dedupe resync refuses stale Y.Doc snapshots that shrink more than the dedupe removed', async () => {
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

test('cloud sync hook applies the dedupe resync safety decision before setAnnotationsByPage', () => {
  const source = readFileSync(sourcePath, 'utf8');
  const decisionIndex = source.indexOf('const decision = shouldApplyDedupeResync({');
  const setterIndex = source.indexOf('setAnnotationsByPage(() => {', decisionIndex);
  assert.ok(decisionIndex >= 0, 'expected dedupe resync listener to call the safety helper');
  assert.ok(setterIndex > decisionIndex, 'expected safety decision before dedupe resync state replacement');
});
