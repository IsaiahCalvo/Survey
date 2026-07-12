import test from 'node:test';
import assert from 'node:assert/strict';

import { calloutsInSharedStore } from '../src/lib/calloutSharedStoreFlag.js';

test('calloutsInSharedStore is permanently true', () => {
  assert.equal(calloutsInSharedStore(), true);
});
