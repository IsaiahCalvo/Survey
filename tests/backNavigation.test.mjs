import test from 'node:test';
import assert from 'node:assert/strict';
import {
  backLayerCount, closeTopBackLayer, nativeBackAction, pushBackLayer, resetBackNavigationForTests,
} from '../src/utils/backNavigation.js';

test('native back: history first, then minimise (flag on) or quit (flag off)', () => {
  assert.equal(nativeBackAction({ canGoBack: true, enabled: true }), 'back');
  assert.equal(nativeBackAction({ canGoBack: true, enabled: false }), 'back');
  assert.equal(nativeBackAction({ canGoBack: false, enabled: true }), 'minimize');
  assert.equal(nativeBackAction({ canGoBack: false, enabled: false }), 'exit');
});

test('back closes the newest layer first, and a removed layer is skipped', () => {
  resetBackNavigationForTests();
  const closed = [];
  pushBackLayer(() => closed.push('a'));
  const removeB = pushBackLayer(() => closed.push('b'));
  pushBackLayer(() => closed.push('c'));
  removeB();
  assert.equal(backLayerCount(), 2);
  assert.equal(closeTopBackLayer(null), true);
  assert.deepEqual(closed, ['c']);
  resetBackNavigationForTests();
  assert.equal(closeTopBackLayer(null), false);
});
