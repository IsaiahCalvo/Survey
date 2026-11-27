import test from 'node:test';
import assert from 'node:assert/strict';
import { createFocusRefreshGuard } from '../src/utils/focusRefreshGuard.js';

test('focusRefreshGuard coalesces passive focus/visibility storms and skips hidden/offline', async () => {
  let clock = 50_000;
  let visible = true;
  let online = true;
  let calls = 0;
  const guard = createFocusRefreshGuard({
    minIntervalMs: 15_000,
    now: () => clock,
    isVisible: () => visible,
    isOnline: () => online,
  });

  await guard.run(async () => { calls += 1; });
  assert.equal(calls, 1);

  // Within minIntervalMs: passive trigger skipped
  clock += 5_000;
  assert.equal(guard.run(async () => { calls += 1; }), null);
  assert.equal(calls, 1);

  // Hidden or offline: skipped even after interval
  clock += 20_000;
  visible = false;
  assert.equal(guard.run(async () => { calls += 1; }), null);
  visible = true;
  online = false;
  assert.equal(guard.run(async () => { calls += 1; }), null);
  online = true;

  // Explicit force always runs even inside minIntervalMs and chains after in-flight
  let releaseFirst;
  const p1 = guard.run(() => new Promise((r) => { calls += 1; releaseFirst = r; }));
  const p2 = guard.run(async () => { calls += 1; }, { force: true });
  await Promise.resolve();
  assert.equal(calls, 2);
  releaseFirst();
  await Promise.all([p1, p2]);
  assert.equal(calls, 3);
});
