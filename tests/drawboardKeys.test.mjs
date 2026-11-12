// Drawboard keys (Nightly flag drawboard-keys): Shift+Up / Down pages,
// Alt+O / Alt+U versions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageStepForKey, steppedPage, steppedVersion, versionStepForKey } from '../src/utils/drawboardKeys.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('Shift+Up / Down step a page; other chords do not', () => {
  assert.equal(pageStepForKey({ key: 'ArrowDown', shiftKey: true }), 1);
  assert.equal(pageStepForKey({ key: 'ArrowUp', shiftKey: true }), -1);
  assert.equal(pageStepForKey({ key: 'ArrowDown' }), 0);
  assert.equal(pageStepForKey({ key: 'ArrowDown', shiftKey: true, ctrlKey: true }), 0);
  assert.equal(pageStepForKey({ key: 'ArrowLeft', shiftKey: true }), 0);
  assert.equal(steppedPage(1, 1, 3), 2);
  assert.equal(steppedPage(3, 1, 3), null);
  assert.equal(steppedPage(1, -1, 3), null);
});

test('Alt+O / Alt+U by key place (a Mac types ø for Alt+O)', () => {
  assert.equal(versionStepForKey({ altKey: true, code: 'KeyO', key: 'ø' }), 1);
  assert.equal(versionStepForKey({ altKey: true, code: 'KeyU', key: '¨' }), -1);
  assert.equal(versionStepForKey({ altKey: true, key: 'o' }), 1);
  assert.equal(versionStepForKey({ code: 'KeyO', key: 'o' }), 0);
  assert.equal(versionStepForKey({ altKey: true, ctrlKey: true, code: 'KeyO' }), 0);
  assert.equal(versionStepForKey({ altKey: true, shiftKey: true, code: 'KeyU' }), 0);
});

test('versions step by number and stop at the ends', () => {
  const versions = [{ id: 'c', versionNumber: 3 }, { id: 'a', versionNumber: 1 }, { id: 'b', versionNumber: 2 }];
  assert.equal(steppedVersion(versions, 'b', 1).id, 'c');
  assert.equal(steppedVersion(versions, 'b', -1).id, 'a');
  assert.equal(steppedVersion(versions, 'c', 1), null);
  assert.equal(steppedVersion(versions, 'a', -1), null);
  assert.equal(steppedVersion(versions, 'zz', 1), null);
});

test('a Nightly beta flag with its row', () => {
  assert.equal(FEATURE_FLAGS['drawboard-keys']?.stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261110181000_drawboard_keys.sql', import.meta.url), 'utf8');
  assert.match(sql, /'drawboard-keys', 'off'/);
});
