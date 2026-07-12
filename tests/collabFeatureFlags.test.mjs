import test from 'node:test';
import assert from 'node:assert/strict';

import { isCRDTEnabled } from '../src/lib/collab/crdtFeatureFlag.js';
import { isLegacyBulkUpsertEnabled } from '../src/lib/collab/featureFlags.js';

function withLocalStorage(store, fn) {
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
      },
      setItem(key, value) {
        store[key] = String(value);
      },
      removeItem(key) {
        delete store[key];
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

test('isCRDTEnabled defaults to true', () => {
  withLocalStorage({}, () => {
    assert.equal(isCRDTEnabled(), true);
  });
});

test('isCRDTEnabled honors localStorage kill switch', () => {
  withLocalStorage({ CRDT_LAYER_DISABLED: '1' }, () => {
    assert.equal(isCRDTEnabled(), false);
  });
});

test('isCRDTEnabled survives localStorage throwing', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem() {
        throw new Error('private mode');
      },
    },
  };
  try {
    assert.equal(isCRDTEnabled(), true);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test('isLegacyBulkUpsertEnabled defaults to false', () => {
  withLocalStorage({}, () => {
    assert.equal(isLegacyBulkUpsertEnabled(), false);
  });
});

test('isLegacyBulkUpsertEnabled honors localStorage override', () => {
  withLocalStorage({ pdf_app_legacy_bulk_upsert: 'true' }, () => {
    assert.equal(isLegacyBulkUpsertEnabled(), true);
  });
});

test('isLegacyBulkUpsertEnabled survives localStorage throwing', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem() {
        throw new Error('private mode');
      },
    },
  };
  try {
    assert.equal(isLegacyBulkUpsertEnabled(), false);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
