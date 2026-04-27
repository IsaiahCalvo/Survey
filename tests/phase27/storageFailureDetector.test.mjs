// tests/phase27/storageFailureDetector.test.mjs
// Phase 27 Wave 0 scaffold — runs as test.skip until Plan 27-04 lands the detector.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md § Validation Architecture.
//
// UX/architecture rationale: when IndexedDB is broken (private browsing, quota full,
// corrupted store, version mismatch), the user MUST be told. Silent fallback is
// explicitly forbidden by 27-CONTEXT.md — "if local saving is broken the user MUST
// know — silent fallback is dangerous because if the network drops next, the user
// loses everything without ever knowing why."
//
// The detector listens for the four common IndexedDB failure modes and emits a
// stable code-string per state, which the StorageFailureBanner (Plan 27-05) maps to
// user-facing copy. Tests pin one branch per mode + the detach contract.
//
// Skip condition: src/lib/collab/storageFailureDetector.js has not been created
// yet (Plan 27-04 owns it).

import { test } from 'node:test';
import { strictEqual, deepStrictEqual, ok } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const DETECTOR_FILE = resolve(REPO_ROOT, 'src/lib/collab/storageFailureDetector.js');

const skipReason = !existsSync(DETECTOR_FILE)
  ? 'src/lib/collab/storageFailureDetector.js not yet created (Plan 27-04)'
  : false;

// Helper: builds a fake `window` with addEventListener / removeEventListener
// stubs that record listeners, so we can dispatch synthetic unhandledrejection
// / error events without touching real DOM/IndexedDB.
function buildFakeWindow() {
  const listeners = [];
  return {
    listeners,
    addEventListener(type, handler) {
      listeners.push({ type, handler, removed: false });
    },
    removeEventListener(type, handler) {
      const entry = listeners.find((l) => l.type === type && l.handler === handler && !l.removed);
      if (entry) entry.removed = true;
    },
    dispatch(type, eventLike) {
      for (const entry of listeners) {
        if (entry.type === type && !entry.removed) entry.handler(eventLike);
      }
    },
  };
}

test(
  'emits quota_exceeded on QuotaExceededError',
  { skip: skipReason },
  async () => {
    const { attachStorageFailureDetector } = await import(
      '../../src/lib/collab/storageFailureDetector.js'
    );
    const fakeWindow = buildFakeWindow();
    const states = [];
    const detach = attachStorageFailureDetector({
      windowRef: fakeWindow,
      onState: (s) => states.push(s),
    });
    fakeWindow.dispatch('unhandledrejection', { reason: { name: 'QuotaExceededError' } });
    ok(states.length >= 1, 'expected at least one state emission');
    strictEqual(states[0].code, 'quota_exceeded');
    detach();
  }
);

test(
  'emits invalid_state on InvalidStateError',
  { skip: skipReason },
  async () => {
    const { attachStorageFailureDetector } = await import(
      '../../src/lib/collab/storageFailureDetector.js'
    );
    const fakeWindow = buildFakeWindow();
    const states = [];
    const detach = attachStorageFailureDetector({
      windowRef: fakeWindow,
      onState: (s) => states.push(s),
    });
    fakeWindow.dispatch('unhandledrejection', { reason: { name: 'InvalidStateError' } });
    ok(states.length >= 1, 'expected at least one state emission');
    strictEqual(states[0].code, 'invalid_state');
    detach();
  }
);

test(
  'emits version_mismatch on VersionError',
  { skip: skipReason },
  async () => {
    const { attachStorageFailureDetector } = await import(
      '../../src/lib/collab/storageFailureDetector.js'
    );
    const fakeWindow = buildFakeWindow();
    const states = [];
    const detach = attachStorageFailureDetector({
      windowRef: fakeWindow,
      onState: (s) => states.push(s),
    });
    fakeWindow.dispatch('unhandledrejection', { reason: { name: 'VersionError' } });
    ok(states.length >= 1, 'expected at least one state emission');
    strictEqual(states[0].code, 'version_mismatch');
    detach();
  }
);

test(
  'detach removes all listeners',
  { skip: skipReason },
  async () => {
    const { attachStorageFailureDetector } = await import(
      '../../src/lib/collab/storageFailureDetector.js'
    );
    const fakeWindow = buildFakeWindow();
    const detach = attachStorageFailureDetector({
      windowRef: fakeWindow,
      onState: () => {},
    });
    const addedCount = fakeWindow.listeners.length;
    ok(addedCount > 0, 'detector should have registered at least one listener');
    detach();
    const stillActive = fakeWindow.listeners.filter((l) => !l.removed);
    deepStrictEqual(stillActive, [], 'detach must remove every listener it registered');
  }
);
