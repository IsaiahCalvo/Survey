// Nightly 'selection-count' (Drawboard PDF Pro push 2026-11-12, row B15): the
// selection bar shows how many marks a pick of two or more holds.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('the count chip sits behind its beta flag and shows for two or more marks', () => {
  assert.equal(FEATURE_FLAGS['selection-count']?.stage, 'beta');
  const src = readFileSync(new URL('../src/components/SelectionQuickBar.jsx', import.meta.url), 'utf8');
  assert.match(src, /const \[selectionCountOn\] = useState\(\(\) => isFeatureOn\('selection-count'\)\);/);
  assert.match(src, /if \(selectionCountOn && items\.length > 1\) \{/);
  assert.match(src, /data-selection-count=\{items\.length\}/);
  const mig = readFileSync(new URL('../supabase/migrations/20261112097000_selection_count_flag.sql', import.meta.url), 'utf8');
  assert.match(mig, /'selection-count', 'off'/);
});
