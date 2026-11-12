// Page turn keys (Nightly 'page-turn-keys').
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pageTurnStep } from '../src/utils/pageTurnKeys.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('Left / Right and Shift+Up / Down turn; anything else does not', () => {
  assert.equal(pageTurnStep({ key: 'ArrowLeft' }), -1);
  assert.equal(pageTurnStep({ key: 'ArrowRight' }), 1);
  assert.equal(pageTurnStep({ key: 'ArrowUp', shiftKey: true }), -1);
  // With Nightly 'drawboard-keys' on, Shift+Up / Down are its keys.
  assert.equal(pageTurnStep({ key: 'ArrowUp', shiftKey: true }, { shiftArrows: false }), 0);
  assert.equal(pageTurnStep({ key: 'ArrowRight' }, { shiftArrows: false }), 1);
  assert.equal(pageTurnStep({ key: 'ArrowDown', shiftKey: true }), 1);
  assert.equal(pageTurnStep({ key: 'ArrowDown' }), 0);
  assert.equal(pageTurnStep({ key: 'ArrowRight', shiftKey: true }), 0);
  assert.equal(pageTurnStep({ key: 'ArrowRight', ctrlKey: true }), 0);
  assert.equal(pageTurnStep(null), 0);
});

test('flag and wiring: a picked mark or a text selection keeps the arrows', () => {
  assert.equal(FEATURE_FLAGS['page-turn-keys'].stage, 'beta');
  const src = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(src, /isFeatureOn\('page-turn-keys'\)/);
  assert.match(src, /if \(turn && \(hasAnyPageSelection\(\) \|\| \(window\.getSelection\?\.\(\)\?\.isCollapsed === false\)\)\) return;/);
  const migration = readFileSync(new URL('../supabase/migrations/20261112094000_page_turn_keys_flag.sql', import.meta.url), 'utf8');
  assert.match(migration, /'page-turn-keys', 'off'/);
});
