import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectDevice,
  detectAppVersion,
  detectUserTier,
  buildDocumentProvenance,
} from '../src/utils/documentProvenance.js';

test('detectUserTier normalizes subscription labels', () => {
  assert.equal(detectUserTier(null), 'free');
  assert.equal(detectUserTier(12), 'free');
  assert.equal(detectUserTier('Pro'), 'pro');
});

test('detectAppVersion returns a string', () => {
  assert.equal(typeof detectAppVersion(), 'string');
});

test('detectDevice reports unknown without window and platform branches with mocks', () => {
  const originalWindow = globalThis.window;
  const originalNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const withNav = (nav, fn) => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
    try {
      return fn();
    } finally {
      if (originalNav) Object.defineProperty(globalThis, 'navigator', originalNav);
      else delete globalThis.navigator;
    }
  };

  try {
    delete globalThis.window;
    assert.equal(detectDevice(), 'unknown');

    // Node has no import.meta.env, so Electron/mobile/web branches are reachable.
    globalThis.window = { electronAPI: {} };
    assert.equal(withNav({ userAgent: 'Mozilla/5.0 Electron', platform: 'MacIntel' }, detectDevice), 'mac');
    assert.equal(withNav({ userAgent: 'Mozilla/5.0 Electron', platform: 'Win32' }, detectDevice), 'windows');
    assert.equal(withNav({ userAgent: 'Mozilla/5.0 Electron', platform: 'Linux x86_64' }, detectDevice), 'linux');
    assert.equal(withNav({ userAgent: 'Mozilla/5.0 Electron', platform: 'FreeBSD' }, detectDevice), 'unknown');

    globalThis.window = {};
    assert.equal(
      withNav({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' }, detectDevice),
      'mobile',
    );
    assert.equal(withNav({ userAgent: 'Mozilla/5.0 (Macintosh)' }, detectDevice), 'web');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalNav) Object.defineProperty(globalThis, 'navigator', originalNav);
    else delete globalThis.navigator;
  }
});
test('buildDocumentProvenance returns the three provenance columns', () => {
  const payload = buildDocumentProvenance({ subscriptionTier: 'Enterprise' });
  assert.equal(payload.first_opened_user_tier, 'enterprise');
  assert.ok('first_opened_device' in payload);
  assert.ok('first_opened_app_version' in payload);
});

test('detectDevice returns unknown when navigator access throws', () => {
  const originalWindow = globalThis.window;
  const originalNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  globalThis.window = { electronAPI: {} };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    get() { throw new Error('nav-boom'); },
  });
  try {
    assert.equal(detectDevice(), 'unknown');
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalNav) Object.defineProperty(globalThis, 'navigator', originalNav);
    else delete globalThis.navigator;
  }
});
