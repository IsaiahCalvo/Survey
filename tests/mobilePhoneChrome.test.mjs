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

// Pull the declaration block for a selector so a size assertion can't be
// satisfied by an unrelated rule elsewhere in the sheet.
const block = (source, selector) => {
  const at = source.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `missing rule for ${selector}`);
  const open = source.indexOf('{', at);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
};

test('the sheet backdrop dims to 30% black', () => {
  assert.match(css, /\n\.mobile-pdf-sheet-backdrop \{[^}]*background: rgba\(0, 0, 0, 0\.3\)/);
  // The shared colour picker sits ABOVE a sheet, so it keeps its own
  // deliberate never-dim overlay; dimming twice would black out the page.
  assert.match(css, /\.mobile-pdf-colorpicker-backdrop \{[^}]*background: rgba\(0, 0, 0, 0\.01\)/);
});

/*
 * RULED CHANGE 2026-09-21 (pass 7 / DESIGN-SYSTEM.md "Phone bottom panels"):
 * THREE named heights, not two. A browse panel opens at Standard, climbs to
 * Expanded (70dvh) on a pull up and to full screen on a second pull, and a pull
 * down steps back ONE height at a time. The hook's boolean `expanded` became a
 * numbered detent, so the two assertions that read `setExpanded(false)` out of it
 * now read the step instead; what they guard - "a pull down from a tall detent
 * steps back rather than dismissing" - is unchanged.
 */
test('the hub sheet steps through its three named heights', () => {
  assert.match(sheetMotion, /export const SHEET_EXPAND_DY = 48/);
  assert.match(sheetMotion, /export const SHEET_EXPANDED_HEIGHT = '70dvh'/);
  // Drag up past the threshold (or flick up) climbs one detent, capped at the
  // sheet's own ceiling.
  assert.match(sheetMotion, /-travel > SHEET_EXPAND_DY \|\| -vy > SHEET_DISMISS_VY/);
  assert.match(sheetMotion, /Math\.min\(maxDetent, current \+ 1\)/);
  // Drag down from a tall detent steps back one height instead of dismissing.
  assert.match(sheetMotion, /if \(detent > SHEET_DETENT_STANDARD\) \{[\s\S]{0,120}current - 1/);
  assert.match(css, /\.mobile-pdf-sheet\.is-expanded \{[^}]*--mobile-sheet-height: var\(--mobile-panel-expanded\)/);
  assert.match(css, /--mobile-panel-expanded: 70dvh/);
  // Full screen stops clear of the app's top bar.
  assert.match(css, /\.mobile-pdf-sheet\.is-fullscreen \{[^}]*100dvh/);
  // The browse panels opt in; Version history does not.
  assert.match(sidebar, /const browsePanel = mobileMode && activeTab !== 'history'/);
  assert.match(sidebar, /expandable: browsePanel/);
  assert.match(sidebar, /fullscreenable: browsePanel/);
  assert.match(sidebar, /sheetExpanded \? 'is-expanded ' : ''/);
  assert.match(sidebar, /sheetFullscreen \? 'is-fullscreen ' : ''/);
  // The inline custom property is what actually takes effect; a stylesheet
  // rule alone would lose to it.
  assert.match(sidebar, /sheetExpanded \? SHEET_EXPANDED_HEIGHT :/);
});

// RULED CHANGE 2026-09-17 (owner: "the animation of it panning up and coming
// down sucks"). This test used to pin SHEET_CLOSE_MS = 170 and the
// `animation: mobilePdfSheetIn 180ms ease-out` keyframe as "unchanged". Those
// two were the defect: a CSS keyframe owned the entrance while
// useMobileSheetMotion owned drag and close, and a running keyframe outranks an
// inline transform, so a grab or a close inside the first 180ms was swallowed.
// The keyframe is gone and the hook owns one transform timeline. The
// drag-to-dismiss thresholds this test also guards are genuinely unchanged, so
// they stay exactly as they were; only the two retired constants moved.
test('drag-to-dismiss thresholds hold and the sheet has one motion source', () => {
  assert.match(sheetMotion, /export const SHEET_DISMISS_DY = 82/);
  assert.match(sheetMotion, /export const SHEET_DISMISS_VY = 0\.65/);
  assert.match(sheetMotion, /export const SHEET_SPRING_MS = 260/);
  // Open and close are now the hook's, in the owner's 240-280ms window for the
  // entrance and a close that finishes before the unmount fires.
  assert.match(sheetMotion, /export const SHEET_OPEN_MS = 260/);
  assert.match(sheetMotion, /export const SHEET_CLOSE_MS = 220/);
  assert.match(sheetMotion, /export const SHEET_CLOSE_UNMOUNT_MS = SHEET_CLOSE_MS \+ \d+/);
  // No second engine: the retired keyframe must not come back.
  assert.doesNotMatch(css, /@keyframes mobilePdfSheetIn/);
  assert.doesNotMatch(css, /^\s*animation: mobilePdfSheetIn/m);
});

test('the zoom menu has minus/plus steppers and a live percentage', () => {
  assert.match(chrome, /className="mobile-pdf-header__zoom-steppers"/);
  assert.match(chrome, /aria-label="Zoom out"[\s\S]{0,220}bottomToolbarApi\.zoomOut/);
  assert.match(chrome, /aria-label="Zoom in"[\s\S]{0,220}bottomToolbarApi\.zoomIn/);
  assert.match(chrome, /mobile-pdf-header__zoom-percent/);
  // Live scale comes from the same state the desktop zoom field renders.
  assert.match(chrome, /Number\.parseInt\(bottomToolbarApi\?\.zoomInputValue, 10\)/);
  // Same limits as the desktop toolbar (zoomController clampScale 0.01..40).
  assert.match(chrome, /const MOBILE_ZOOM_MIN_PERCENT = 1;/);
  assert.match(chrome, /const MOBILE_ZOOM_MAX_PERCENT = 4000;/);
  // The three fit modes are still there, in their own listbox.
  assert.match(chrome, /className="mobile-pdf-header__zoom-fits" role="listbox"/);
  // RULED CHANGE 2026-09-16 (r4 phone pass): the steppers take the header
  // control token, not the fit rows' menu-row square. They used to be pinned to
  // the fit rows (34px), which is not one of the five phone size tokens and left
  // the 15px glyph at 0.441 of its control where every other phone tier runs
  // 0.55-0.60 - see tests/mobilePhoneGlyphRatioComplete.test.mjs, which pins the
  // ratio over every phone control and failed on the 34px square. The fit rows
  // keep 34px: they are labelled context-menu rows, and 34px rows are the demo's
  // menu chrome. The assertion moved from "same as the fit rows" to "the header
  // control token", which is the size rule the pass actually claims.
  const steppers = block(css, '.mobile-pdf-header__zoom-steppers > button');
  assert.match(steppers, /width: var\(--mobile-control-h\)/);
  assert.match(steppers, /height: var\(--mobile-control-h\)/);
  // The 26px paint keeps the 34px finger target it had, as a transparent pad.
  assert.match(css, /\.mobile-pdf-header__zoom-steppers > button::after \{[\s\S]{0,160}inset: -4px;/);
});

test('zoomIn and zoomOut still step by the shared 1.25x factor', () => {
  const shared = read('../src/viewerShared.js');
  assert.match(shared, /export const TOOLBAR_ZOOM_STEP_FACTOR = 1\.25;/);
  const viewer = read('../src/PDFViewer.jsx');
  assert.match(viewer, /const zoomIn = useCallback\(\(\) => \{[\s\S]{0,900}basisScale \* TOOLBAR_ZOOM_STEP_FACTOR/);
  assert.match(viewer, /const zoomOut = useCallback\(\(\) => \{[\s\S]{0,900}basisScale \/ TOOLBAR_ZOOM_STEP_FACTOR/);
});

test('tapping an open tool group closes its strip', () => {
  assert.match(chrome, /const toggleCategory = \(groupId\) => \{[\s\S]{0,900}if \(openCategory === groupId\) \{\s*setOpenCategory\(null\);\s*return;/);
  // Opening a group still arms its last-used tool.
  assert.match(chrome, /const toggleCategory = \(groupId\) => \{[\s\S]{0,1600}selectTool\(preferred && TOOL_TO_GROUP\[preferred\] === groupId \? preferred : group\.fallback\)/);
});
