import test from 'node:test';
import assert from 'node:assert/strict';

import { isSnapshotEnabled } from '../src/lib/collab/snapshotFeatureFlag.js';

function withLocalStorage(store, fn) {
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      },
    },
  };
  try {
    return fn();
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
}

test('isSnapshotEnabled defaults to true (Phase 32 temp default)', () => {
  withLocalStorage({}, () => {
    assert.equal(isSnapshotEnabled(), true);
  });
});

test('isSnapshotEnabled honors localStorage opt-in', () => {
  withLocalStorage({ YDOC_SNAPSHOT_ENABLED: '1' }, () => {
    assert.equal(isSnapshotEnabled(), true);
  });
});

test('isSnapshotEnabled survives localStorage throwing', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem() {
        throw new Error('private mode');
      },
    },
  };
  try {
    assert.equal(isSnapshotEnabled(), true);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
