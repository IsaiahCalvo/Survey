import test from 'node:test';
import assert from 'node:assert/strict';

import {
  register,
  unregister,
  lookup,
  listRegistered,
} from '../src/utils/contextMenuBridge.js';

test('contextMenuBridge registers, looks up, lists, and unregisters pages', () => {
  const fn = () => {};
  register(3, fn);
  register(1, fn);
  assert.equal(lookup(3), fn);
  assert.deepEqual(listRegistered().sort((a, b) => a - b), [1, 3]);
  unregister(3);
  assert.equal(lookup(3), null);
  assert.deepEqual(listRegistered(), [1]);
  unregister(1);
  assert.deepEqual(listRegistered(), []);
});
