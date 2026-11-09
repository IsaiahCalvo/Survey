import test from 'node:test';
import assert from 'node:assert/strict';
import { steppedTabId, tabStepForKey } from '../src/utils/tabKeys.js';

const key = (code, mods = {}) => ({ code, altKey: true, shiftKey: true, metaKey: false, ctrlKey: false, ...mods });

test('Alt+Shift+] / [ step, by key code; anything else does nothing', () => {
  assert.equal(tabStepForKey(key('BracketRight')), 1);
  assert.equal(tabStepForKey(key('BracketLeft')), -1);
  assert.equal(tabStepForKey(key('BracketRight', { ctrlKey: true })), 0);
  assert.equal(tabStepForKey(key('BracketRight', { altKey: false })), 0);
  assert.equal(tabStepForKey(key('KeyA')), 0);
});

test('steps wrap round, and from Home go to the first or last document', () => {
  const ids = ['a', 'b', 'c'];
  assert.equal(steppedTabId(ids, 'a', 1), 'b');
  assert.equal(steppedTabId(ids, 'c', 1), 'a');
  assert.equal(steppedTabId(ids, 'a', -1), 'c');
  assert.equal(steppedTabId(ids, 'home', 1), 'a');
  assert.equal(steppedTabId(ids, 'home', -1), 'c');
  assert.equal(steppedTabId([], 'home', 1), null);
});
