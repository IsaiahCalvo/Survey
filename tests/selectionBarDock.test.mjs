// Nightly 'toolbar-settings' (Drawboard Projects parity VT-52).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DOCKED_BAR_GAP, dockedBarPosition, isSelectionBarDocked, setSelectionBarDocked } from '../src/utils/selectionBarDock.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('a docked bar sits centred along the bottom of the page area', () => {
  const bounds = { left: 100, top: 80, right: 900, bottom: 700 };
  assert.deepEqual(dockedBarPosition(bounds, 300, 40), { left: 350, top: 700 - 40 - DOCKED_BAR_GAP, side: 'docked' });
  // A bar wider than the area keeps its left edge inside.
  assert.equal(dockedBarPosition(bounds, 1200, 40).left, 100);
  assert.equal(dockedBarPosition(null, 10, 10), null);
  assert.equal(dockedBarPosition({ left: 0, top: 0, right: 0, bottom: 10 }, 10, 10), null);
});

test('the dock choice toggles (storage off is fine)', () => {
  setSelectionBarDocked(true);
  assert.equal(isSelectionBarDocked(), true);
  setSelectionBarDocked(false);
  assert.equal(isSelectionBarDocked(), false);
});

test('flag, bar and mark menu are wired, and a migration adds the row', () => {
  assert.equal(FEATURE_FLAGS['toolbar-settings'].stage, 'rollout');
  const bar = read('src/components/SelectionQuickBar.jsx');
  assert.match(bar, /isFeatureOn\('toolbar-settings'\)/);
  assert.match(bar, /dock: dockedNow \? dockedBarPosition\(bounds,/);
  const menu = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(menu, /'Dock bar to bottom', 'dockSelectionBar'/);
  assert.match(menu, /'Float bar by mark', 'floatSelectionBar'/);
  assert.match(menu, /'Edit subject', 'editSubject'/);
  assert.match(read('supabase/migrations/20261115214200_toolbar_settings_flag.sql'), /'toolbar-settings', 'off'/);
});
