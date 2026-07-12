import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUTH_LOCK_ACQUIRE_TIMEOUT_MS,
  createSafeNavigatorLock,
} from '../src/utils/safeNavigatorLock.js';

test('createSafeNavigatorLock bypasses locks when unavailable', async () => {
  let ran = false;
  const lock = createSafeNavigatorLock(null, {});
  const result = await lock('auth', 5000, () => {
    ran = true;
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(ran, true);
});

test('createSafeNavigatorLock caps acquire timeout and delegates', async () => {
  const calls = [];
  const impl = (name, timeout, cb) => {
    calls.push({ name, timeout });
    return cb();
  };
  const lock = createSafeNavigatorLock(impl, {
    locks: { request() {} },
  });
  await lock('auth', AUTH_LOCK_ACQUIRE_TIMEOUT_MS + 1000, () => 'done');
  assert.deepEqual(calls, [{
    name: 'auth',
    timeout: AUTH_LOCK_ACQUIRE_TIMEOUT_MS,
  }]);
});

test('createSafeNavigatorLock preserves shorter timeouts', async () => {
  const calls = [];
  const impl = (name, timeout, cb) => {
    calls.push(timeout);
    return cb();
  };
  const lock = createSafeNavigatorLock(impl, {
    locks: { request() {} },
  });
  await lock('auth', 500, () => true);
  assert.deepEqual(calls, [500]);
});
