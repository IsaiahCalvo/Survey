// tests/phase28/deviceId.test.mjs
// Phase 28 Wave 0 scaffold — runs as test.skip until Plan 28-02 lands deviceId.js.
// Source: .planning/phases/28-transport-spike-auth-validator/28-RESEARCH.md § Pattern 3 (device attribution).
//
// UX/architecture rationale: AUTH-02 — every annotation carries a device id at the
// transaction-origin layer so future "device label" UI (Phase 33) can show "Isaiah's
// MacBook Pro" without the user typing anything. Electron exposes os.hostname() via
// preload; the web fallback is a stable per-browser-install UUID stored in localStorage.
// SSR safety matters because this module gets imported by code paths that may run
// outside a browser (build-time pre-render, node --test).
//
// Skip condition: src/lib/collab/deviceId.js has not been created yet (Plan 28-02
// owns it). Once landed, this scaffold flips automatically from skip → green.

import { test } from 'node:test';
import { strictEqual, ok, notStrictEqual } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const TARGET = resolve(REPO_ROOT, 'src/lib/collab/deviceId.js');

// Each test inlines the skip-guard pattern verbatim so the acceptance-criteria
// grep matches every invocation. Pattern lifted from tests/phase27/schemaPresence.test.mjs.

// Each test installs its own scoped window/localStorage mock so state doesn't bleed
// across tests. The detector restores the previous globals AFTER fn() fully resolves
// (await is required because fn() may be async — without await, finally runs while
// fn's async body is still suspended on its first await, restoring window mid-call
// and breaking any test that calls getDeviceId() across an await boundary).
async function withMockWindow(mockWindow, fn) {
  const savedWindow = globalThis.window;
  const savedLocalStorage = globalThis.localStorage;
  globalThis.window = mockWindow;
  globalThis.localStorage = mockWindow?.localStorage;
  try {
    return await fn();
  } finally {
    if (savedWindow === undefined) delete globalThis.window;
    else globalThis.window = savedWindow;
    if (savedLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = savedLocalStorage;
  }
}

function buildLocalStorageMock(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => {
      store[key] = String(value);
    },
    removeItem: (key) => {
      delete store[key];
    },
    _peek: () => ({ ...store }),
  };
}

test(
  'deviceId: Electron branch returns os.hostname() exactly',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/deviceId.js not yet present (Plan 28-02)' : false },
  async () => {
    const { getDeviceId } = await import(TARGET);
    const fakeHostname = 'Isaiahs-MacBook-Pro.local';
    const ls = buildLocalStorageMock();
    const fakeWindow = {
      electronAPI: { osHostname: () => fakeHostname },
      localStorage: ls,
    };
    await withMockWindow(fakeWindow, async () => {
      const result = await getDeviceId();
      strictEqual(result, fakeHostname, 'Electron branch must return the OS hostname unmodified');
    });
  }
);

test(
  'deviceId: Web branch returns stored device_id from localStorage when present',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/deviceId.js not yet present (Plan 28-02)' : false },
  async () => {
    const { getDeviceId } = await import(TARGET);
    const ls = buildLocalStorageMock({ device_id: 'web-uuid-cached-12345' });
    const fakeWindow = { localStorage: ls };
    await withMockWindow(fakeWindow, async () => {
      const result = await getDeviceId();
      strictEqual(result, 'web-uuid-cached-12345', 'cached device_id must be returned verbatim');
    });
  }
);

test(
  'deviceId: Web branch generates UUID when no localStorage entry, persists it',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/deviceId.js not yet present (Plan 28-02)' : false },
  async () => {
    const { getDeviceId } = await import(TARGET);
    const ls = buildLocalStorageMock();
    const fakeWindow = { localStorage: ls };
    await withMockWindow(fakeWindow, async () => {
      const result = await getDeviceId();
      ok(typeof result === 'string' && result.length > 0, 'must return a non-empty string');
      // Loose UUID v4 shape match; precise format is up to Plan 28-02 (any stable id is acceptable).
      const stored = ls._peek().device_id;
      strictEqual(stored, result, 'generated id must be persisted in localStorage[device_id]');
    });
  }
);

test(
  'deviceId: SSR safety — when typeof window === undefined, returns "unknown-device" without throwing',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/deviceId.js not yet present (Plan 28-02)' : false },
  async () => {
    const { getDeviceId } = await import(TARGET);
    await withMockWindow(undefined, async () => {
      const result = await getDeviceId();
      strictEqual(result, 'unknown-device', 'SSR / non-browser context must return the literal string "unknown-device"');
    });
  }
);

test(
  'deviceId: stable across calls in the same session (no regenerate)',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/deviceId.js not yet present (Plan 28-02)' : false },
  async () => {
    const { getDeviceId } = await import(TARGET);
    const ls = buildLocalStorageMock();
    const fakeWindow = { localStorage: ls };
    await withMockWindow(fakeWindow, async () => {
      const first = await getDeviceId();
      const second = await getDeviceId();
      strictEqual(first, second, 'getDeviceId must be stable within a session — no regeneration');
    });
  }
);
