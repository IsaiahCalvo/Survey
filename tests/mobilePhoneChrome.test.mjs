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
 * RULED CHANGE 2026-10-01 (owner, iPhone: "We have three different heights for
 * the bottom panel; I think we can get away with two: the small one and the big
 * one"). Supersedes pass 7's Standard / Expanded (70dvh) / Full: a browse panel
 * rests at Standard or Full. A release lands on the nearest of the two (where
 * the throw is heading), a firm flick goes the way it was thrown, and a pull
 * down from Full comes back to Standard rather than dismissing (unless the
 * sheet opts into pullDownCloses - the Survey panel).
 */
test('the hub sheet has two heights, Standard and Full', () => {
  assert.match(sheetMotion, /export const SHEET_DETENT_STANDARD = 0;/);
  assert.match(sheetMotion, /export const SHEET_DETENT_FULL = 1;/);
  assert.doesNotMatch(sheetMotion, /SHEET_EXPANDED_HEIGHT|SHEET_DETENT_EXPANDED/);
  // Nearest height to the projected release, flicks go the way they were thrown.
  assert.match(sheetMotion, /if \(-vy > SHEET_DISMISS_VY\) return SHEET_DETENT_FULL;/);
  assert.match(sheetMotion, /const projected = drag\.top \+ Math\.max\(-3, Math\.min\(3, vy\)\) \* SHEET_PROJECT_MS;/);
  // A pull down from Full does not dismiss (unless pullDownCloses).
  assert.match(sheetMotion, /const canClose = !expandable \|\| drag\.start === SHEET_DETENT_STANDARD \|\| pullDownCloses;/);
  assert.doesNotMatch(css, /\.is-expanded \{|--mobile-panel-expanded/);
  // Full screen stops clear of the app's top bar.
  assert.match(css, /--mobile-panel-full: calc\(100dvh - var\(--app-chrome-top, 34px\) - 18px\);/);
  assert.match(css, /\.mobile-pdf-sheet\.is-fullscreen \{[^}]*--mobile-sheet-height: var\(--mobile-panel-full\)/);
  // The browse panels opt in. RULED 2026-09-28 owner: History option A —
  // History is a long feed now, so it opts in too.
  assert.match(sidebar, /const browsePanel = mobileMode;/);
  assert.match(sidebar, /expandable: browsePanel/);
  assert.doesNotMatch(sidebar, /is-expanded/);
  assert.match(sidebar, /sheetFullscreen \? 'is-fullscreen ' : ''/);
  // The inline custom property is what actually takes effect; a stylesheet
  // rule alone would lose to it.
  assert.match(sidebar, /sheetFullscreen \? 'var\(--mobile-panel-full\)' : MOBILE_PANEL_STANDARD/);
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

test('tapping an open tool group closes its strip and hands the tool back to Pan', () => {
  // RULED CHANGE 2026-10-01 (owner): closing a group by tapping its icon used to
  // leave its tool armed, so the icon stayed gold on a closed group.
  assert.match(chrome, /const toggleCategory = \(groupId\) => \{[\s\S]{0,1600}if \(openCategory === groupId\) \{\s*setOpenCategory\(null\);\s*if \(activeGroup === groupId\) selectTool\('pan'\);\s*return;/);
  // An armed survey category / entity disc disarms to Pan on a second tap.
  assert.match(chrome, /const toggleSurveyPick = \(picked, arm\) => \{\s*if \(picked && activeTool === 'survey-marker'\) \{\s*selectTool\('pan'\);\s*return;\s*\}\s*arm\(\);/);
  assert.match(chrome, /toggleSurveyPick\(bottomToolbarApi\.surveyToolbar\.selectedCategoryId === category\.id,/);
  assert.match(chrome, /toggleSurveyPick\(bottomToolbarApi\.surveyToolbar\.selectedEntityId === entity\.id,/);
  // Opening a group still arms its last-used tool.
  assert.match(chrome, /const toggleCategory = \(groupId\) => \{[\s\S]{0,1600}selectTool\(preferred && TOOL_TO_GROUP\[preferred\] === groupId \? preferred : group\.fallback\)/);
});
