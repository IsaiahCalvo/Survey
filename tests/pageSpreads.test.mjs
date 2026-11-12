// Nightly 'page-spreads' (Drawboard PDF Pro push 2026-11-12, row C17):
// Single / Double / Cover page views.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { buildSpreadRows, placeSpreadPages, rowMembers, steppedSpreadPage } from '../src/utils/pageSpreads.js';
import { buildVisiblePageStack } from '../src/utils/visiblePageLayout.js';

const page = (w = 600, h = 800) => ({ w, h });

test('page-spreads is a Nightly beta flag with an off-by-default row', () => {
  assert.equal(FEATURE_FLAGS['page-spreads']?.stage, 'beta');
  const mig = readFileSync(new URL('../supabase/migrations/20261112161000_page_spreads_flag.sql', import.meta.url), 'utf8');
  assert.match(mig, /'page-spreads', 'off'/);
});

test('rows: Double pairs 1-2, 3-4; Cover puts page 1 alone, then 2-3; hidden pages are skipped', () => {
  const dims = [page(), page(), page(), page(), page()];
  assert.deepEqual(buildSpreadRows(dims, 'single'), [[0], [1], [2], [3], [4]]);
  assert.deepEqual(buildSpreadRows(dims, 'double'), [[0, 1], [2, 3], [4]]);
  assert.deepEqual(buildSpreadRows(dims, 'cover'), [[0], [1, 2], [3, 4]]);
  const withHidden = [page(), { w: 0, h: 0, hidden: true }, page(), page()];
  assert.deepEqual(buildSpreadRows(withHidden, 'double'), [[0, 2], [3]]);
});

test('placement: Cover page 1 sits in the right slot; a row is as tall as its taller page', () => {
  const dims = [page(600, 800), page(600, 900), page(500, 800)];
  const cover = placeSpreadPages(dims, 'cover', 10);
  assert.equal(cover.offsetX[0], 610, 'page 1 on the right of an empty slot');
  assert.deepEqual(cover.stack[0], { w: 1210, h: 800 });
  assert.equal(cover.leader[2], 1);
  assert.equal(cover.offsetX[2], 610);
  assert.deepEqual(cover.stack[1], { w: 1110, h: 900 });
  assert.equal(cover.stack[2].hidden, true);
  assert.equal(placeSpreadPages(dims, 'single', 10), null);
  assert.deepEqual(rowMembers(cover, 2), [1, 2]);
});

test('the page stack: both pages of a row share its top; Single is unchanged', () => {
  const pageSizes = [page(), page(), page()];
  const single = buildVisiblePageStack({ pageSizes, scale: 1, gap: 10 });
  assert.equal(single.place, null);
  assert.equal(single.stack, single.dims);
  assert.deepEqual(single.tops, [10, 820, 1630]);
  const double = buildVisiblePageStack({ pageSizes, scale: 1, gap: 10, spread: 'double' });
  assert.deepEqual(double.tops, [10, 10, 820]);
  assert.equal(double.widestPt, 1210);
  assert.equal(double.height, 1630);
});

test('Next / Previous move a whole row in a spread view', () => {
  const dims = [page(), page(), page(), page(), page()];
  const double = placeSpreadPages(dims, 'double', 0);
  assert.equal(steppedSpreadPage(double, 1, 1), 3);
  assert.equal(steppedSpreadPage(double, 2, 1), 3);
  assert.equal(steppedSpreadPage(double, 4, -1), 1);
  assert.equal(steppedSpreadPage(null, 4, -1), 3);
  const cover = placeSpreadPages(dims, 'cover', 0);
  assert.equal(steppedSpreadPage(cover, 1, 1), 2);
  assert.equal(steppedSpreadPage(cover, 3, 1), 4);
});

test('the viewer and the Page fit card use the setting; the phone keeps one column', () => {
  const viewer = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /const spreadMode = phoneLayout \? 'single' : pageSpreadSetting;/);
  assert.match(viewer, /padTop: metrics\.padTop, gap: metrics\.gap, spread: spreadMode,/);
  const shell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /const \[pageSpreadsOn\] = useState\(\(\) => isFeatureOn\('page-spreads'\)\);/);
  assert.match(shell, /\{pageSpreadsOn && \(/);
});
