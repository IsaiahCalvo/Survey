// Owner 2026-10-02 (desktop footer lock): the zoom %, page number and page-fit
// label in the Survey panel's footer row can gain or lose digits without
// moving the minus / plus, the page arrows or the fit icon. Browser proof:
// zooming 10% -> 4000% and paging 1 -> 120 moved none of them by any amount.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const appShell = fs.readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const row = appShell.slice(appShell.indexOf('const footerRowBtn = '), appShell.indexOf('return createPortal(footerRow, railPanelEl);'));

test('numbers sit in fixed boxes sized by their widest value, tabular and centred', () => {
  assert.match(appShell, /const FOOTER_ZOOM_WIDEST = '4000%';/, 'zoom box fits the 4000% desktop maximum');
  assert.match(appShell, /function FooterSlot\(\{ widest, field = null, children = null \}\)/);
  assert.match(appShell, /visibility: 'hidden'/, 'the widest value is laid down invisibly to size the box');
  assert.match(appShell, /justifySelf: 'center'/, 'the value is centred in its box');
  assert.match(appShell, /fontVariantNumeric: 'tabular-nums' \}\}>\s*\{\[\]\.concat\(widest\)/);
  assert.match(appShell, /const pageSlotWidest = '0'\.repeat\(String\(Math\.max\(1, Number\(api\.numPages\) \|\| 0\)\)\.length\);/,
    'page boxes are as wide as this document\'s page count');
  assert.match(appShell, /<FooterSlot widest=\{FOOTER_ZOOM_WIDEST\}>/);
  assert.match(appShell, /<FooterSlot widest=\{FOOTER_ZOOM_WIDEST\} field=\{\(/, 'the zoom edit field fills the same box');
  assert.match(appShell, /<FooterSlot widest=\{pageSlotWidest\} field=\{\(/, 'the page edit field fills the same box');
});

test('the row never squeezes a control and can only overflow to the right', () => {
  assert.match(row, /justifyContent: 'space-between', gap: '3px'/);
  assert.doesNotMatch(row, /justifyContent: 'center', gap/, 'a centred row overflowed out past the panel\'s left edge');
  assert.match(row, /const footerRowBtn = \{ width: '20px', flexShrink: 0 \};/);
  assert.equal((row.match(/\.\.\.footerRowBtn/g) || []).length, 4, 'minus, plus and both page arrows');
  assert.match(row, /<FooterSlot widest=\{pageSlotWidest\}>\{api\.activeSpaceHasNoPages \? 0 : api\.numPages\}<\/FooterSlot>/);
  assert.match(row, /<FooterSlot widest=\{fitLabelWidest\}>\{fitMode === ZOOM_MODES\.MANUAL \? 'Manual' : api\.zoomDropdownLabel\}<\/FooterSlot>/,
    'the fit label is a fixed box; a manual zoom reads "Manual" (the number is in the zoom readout and the tooltip)');
  assert.match(row, /chromeTip\(`Page fit: \$\{api\.zoomDropdownLabel\}`, 'above'\)/);
});
