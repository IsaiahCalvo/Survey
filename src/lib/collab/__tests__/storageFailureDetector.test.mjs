// src/lib/collab/__tests__/storageFailureDetector.test.mjs
// Phase 27 - Co-located unit tests for storageFailureDetector.
// Public-API tests live at tests/phase27/storageFailureDetector.test.mjs.
import { test, beforeEach, afterEach } from 'node:test';
import { strictEqual, ok } from 'node:assert';

let listeners = [];
let removed = [];
let originalWindow;

beforeEach(() => {
  listeners = [];
  removed = [];
  originalWindow = globalThis.window;
  globalThis.window = {
    addEventListener: (eventName, handler) => listeners.push({ eventName, handler }),
    removeEventListener: (eventName, handler) => removed.push({ eventName, handler }),
  };
});

afterEach(() => {
  globalThis.window = originalWindow;
});

const fireUnhandledRejection = (reason) => {
  const handler = listeners.find((l) => l.eventName === 'unhandledrejection')?.handler;
  if (!handler) throw new Error('test setup: no unhandledrejection listener installed');
  handler({ reason });
};

test('emits code=quota_exceeded on QuotaExceededError', async () => {
  const { attachStorageFailureDetector } = await import('../storageFailureDetector.js');
  let received = null;
  attachStorageFailureDetector({ onState: (s) => { received = s; } });
  fireUnhandledRejection({ name: 'QuotaExceededError' });
  strictEqual(received?.code, 'quota_exceeded');
  strictEqual(received?.message, 'Local storage is full.');
});

test('emits code=invalid_state on InvalidStateError', async () => {
  const { attachStorageFailureDetector } = await import('../storageFailureDetector.js');
  let received = null;
  attachStorageFailureDetector({ onState: (s) => { received = s; } });
  fireUnhandledRejection({ name: 'InvalidStateError' });
  strictEqual(received?.code, 'invalid_state');
});

test('emits code=version_mismatch on VersionError', async () => {
  const { attachStorageFailureDetector } = await import('../storageFailureDetector.js');
  let received = null;
  attachStorageFailureDetector({ onState: (s) => { received = s; } });
  fireUnhandledRejection({ name: 'VersionError' });
  strictEqual(received?.code, 'version_mismatch');
});

test('ignores unrelated errors (TypeError, generic Error)', async () => {
  const { attachStorageFailureDetector } = await import('../storageFailureDetector.js');
  let received = null;
  attachStorageFailureDetector({ onState: (s) => { received = s; } });
  fireUnhandledRejection({ name: 'TypeError' });
  fireUnhandledRejection({ name: 'Error' });
  strictEqual(received, null, 'unrelated errors must NOT fire onState');
});

test('detach() removes the unhandledrejection listener', async () => {
  const { attachStorageFailureDetector } = await import('../storageFailureDetector.js');
  let callCount = 0;
  const { detach } = attachStorageFailureDetector({ onState: () => { callCount++; } });
  fireUnhandledRejection({ name: 'QuotaExceededError' });
  strictEqual(callCount, 1, 'callback fires once before detach');
  detach();
  strictEqual(removed.length, 1, 'detach calls removeEventListener once');
  strictEqual(removed[0].eventName, 'unhandledrejection');
});

test('SSR safety: returns no-op detach when window is undefined', async () => {
  const savedWindow = globalThis.window;
  globalThis.window = undefined;
  const { attachStorageFailureDetector } = await import('../storageFailureDetector.js');
  const result = attachStorageFailureDetector({ onState: () => {} });
  ok(typeof result.detach === 'function', 'returns object with detach function');
  result.detach(); // Must not throw
  globalThis.window = savedWindow;
});

test('throws when onState callback is missing', async () => {
  const { attachStorageFailureDetector } = await import('../storageFailureDetector.js');
  let threw = false;
  try {
    attachStorageFailureDetector({});
  } catch (e) {
    threw = true;
    ok(e.message.includes('onState'));
  }
  strictEqual(threw, true);
});

test('windowRef option overrides global window for testability', async () => {
  // [Rule 3 - Blocking] Plan 27-01 scaffold passes windowRef to inject a fake window.
  // Implementation supports this for parity with the public-API scaffold contract.
  const { attachStorageFailureDetector } = await import('../storageFailureDetector.js');
  const fakeListeners = [];
  const fakeWindow = {
    addEventListener: (eventName, handler) => fakeListeners.push({ eventName, handler }),
    removeEventListener: () => {},
  };
  let received = null;
  attachStorageFailureDetector({ windowRef: fakeWindow, onState: (s) => { received = s; } });
  ok(fakeListeners.length >= 1, 'listener attaches to windowRef, not global window');
  // Fire on the injected window
  fakeListeners[0].handler({ reason: { name: 'QuotaExceededError' } });
  strictEqual(received?.code, 'quota_exceeded');
});
