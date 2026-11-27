import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');

test('AuthContext 5-minute subscription tier interval skips hidden tabs and offline browsers', () => {
  const src = read('src/contexts/AuthContext.jsx');
  const idx = src.indexOf('300_000');
  assert.ok(idx > 0, 'expected 5-minute subscription tier interval');
  const block = src.slice(Math.max(0, idx - 320), idx + 40);
  assert.match(block, /fetchSubscriptionTier\(user\.id\)/);
  assert.match(block, /visibilityState\s*===\s*'hidden'/);
  assert.match(block, /navigator\.onLine\s*===\s*false/);
});

test('useTabPendingDualWrite caches auth userId via onAuthStateChange and pauses when tab is hidden', () => {
  const src = read('src/hooks/useTabPendingDualWrite.js');
  assert.match(src, /onAuthStateChange/);
  assert.match(src, /visibilityState\s*===\s*'hidden'/);
  assert.match(src, /addEventListener\('visibilitychange'/);
  assert.match(src, /removeEventListener\('visibilitychange'/);
});

test('useDualWriteQueue pauses 1s polling while tab is hidden and re-checks on visibilitychange', () => {
  const src = read('src/hooks/useDualWriteQueue.js');
  assert.match(src, /visibilityState\s*===\s*'hidden'/);
  assert.match(src, /addEventListener\('visibilitychange'/);
  assert.match(src, /removeEventListener\('visibilitychange'/);
});

test('YDocProvider skips background-tab shared-state polls and caches solo-doc role across steady-state ticks', () => {
  const src = read('src/components/collab/YDocProvider.jsx');
  assert.match(src, /!isActiveRef\.current/);
  assert.match(src, /let cachedRole = undefined/);
  assert.match(src, /collaboratorsKey !== lastCollaboratorsKey/);
  assert.match(src, /setInterval\(refreshSharedState,\s*30_000\)/);
});
