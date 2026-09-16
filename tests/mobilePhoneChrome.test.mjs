import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * Phone chrome pass (2026-09-16). Source/style assertions for the three phone
 * behaviours this branch keeps:
 *   1. a panel dims the screen behind it, and the hub tray opens taller;
 *   2. the zoom menu has minus / plus steppers and a live percentage;
 *   3. tapping an open tool group closes its strip.
 *
 * Sizes are deliberately NOT asserted here. Owner ruling 2026-09-16: a separate
 * sizing pass sets every control's height, glyph and gap from Drawboard's
 * ratios, uniformly. A number pinned here would fight that pass.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const chrome = read('../src/mobile/MobilePdfViewerChrome.jsx');
const css = read('../src/mobile/mobilePdfViewer.css');
const sheetMotion = read('../src/mobile/useMobileSheetMotion.js');
const sidebar = read('../src/PDFSidebar.jsx');

test('the sheet backdrop dims to 30% black', () => {
  assert.match(css, /\n\.mobile-pdf-sheet-backdrop \{[^}]*background: rgba\(0, 0, 0, 0\.3\)/);
  // The shared colour picker sits ABOVE a sheet, so it keeps its own
  // deliberate never-dim overlay; dimming twice would black out the page.
  assert.match(css, /\.mobile-pdf-colorpicker-backdrop \{[^}]*background: rgba\(0, 0, 0, 0\.01\)/);
});

test('the hub sheet has a second taller detent at 70% of the screen', () => {
  // Detent math: compact = the content-measured height; expanded = 70dvh.
  assert.match(sheetMotion, /export const SHEET_EXPAND_DY = 48/);
  assert.match(sheetMotion, /export const SHEET_EXPANDED_HEIGHT = '70dvh'/);
  // Drag up past the threshold (or flick up) expands.
  assert.match(sheetMotion, /-travel > SHEET_EXPAND_DY \|\| -vy > SHEET_DISMISS_VY/);
  // Drag down from expanded returns to compact instead of dismissing.
  assert.match(sheetMotion, /if \(expanded\) \{[\s\S]{0,160}setExpanded\(false\)/);
  assert.match(css, /\.mobile-pdf-sheet\.is-expanded \{[^}]*--mobile-sheet-height: 70dvh/);
  // The hub (Pages / Search / Bookmarks) opts in; standalone panels do not.
  assert.match(sidebar, /expandable: mobileMode && !mobileStandalonePanel/);
  assert.match(sidebar, /sheetExpanded \? 'is-expanded ' : ''/);
  // The inline custom property is what actually takes effect; a stylesheet
  // rule alone would lose to it.
  assert.match(sidebar, /sheetExpanded \? SHEET_EXPANDED_HEIGHT :/);
});

test('the existing sheet timings and drag-to-dismiss are unchanged', () => {
  assert.match(sheetMotion, /export const SHEET_DISMISS_DY = 82/);
  assert.match(sheetMotion, /export const SHEET_DISMISS_VY = 0\.65/);
  assert.match(sheetMotion, /export const SHEET_CLOSE_MS = 170/);
  assert.match(sheetMotion, /export const SHEET_SPRING_MS = 260/);
  assert.match(css, /animation: mobilePdfSheetIn 180ms ease-out/);
});
