/**
 * Guards the owner's 2026-09-17 phone-layout rulings:
 *   A. zoom lives in exactly one place — the header zoom menu. The rail's More
 *      (kebab) menu must never grow Zoom in / Zoom out rows again.
 *   B. the dock hub is one tray: Pages, Search and Bookmarks share one height.
 *   C. the sheet has ONE motion source — useMobileSheetMotion's transform
 *      timeline. No CSS keyframe may animate .mobile-pdf-sheet again.
 *
 * Source-assertion style (reads the files as text), matching the other
 * mobile contract tests in this directory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const mobileChrome = read('../src/mobile/MobilePdfViewerChrome.jsx');
const mobileCss = read('../src/mobile/mobilePdfViewer.css');
const sidebar = read('../src/PDFSidebar.jsx');
const sheetMotion = read('../src/mobile/useMobileSheetMotion.js');

test('the rail More menu carries no zoom controls', () => {
  const start = mobileChrome.indexOf("className=\"mobile-pdf-tools__popover is-more\"");
  assert.ok(start > 0, 'expected the More popover to exist');
  // The popover closes at the next sibling section of the footer.
  const end = mobileChrome.indexOf('</aside>', start);
  assert.ok(end > start, 'expected the rail aside to close after the More popover');
  const moreMenu = mobileChrome.slice(start, end);

  assert.doesNotMatch(moreMenu, /Zoom in/);
  assert.doesNotMatch(moreMenu, /Zoom out/);
  assert.doesNotMatch(moreMenu, /zoomIn\?\.\(\)/);
  assert.doesNotMatch(moreMenu, /zoomOut\?\.\(\)/);

  // ...and still carries the items the owner kept.
  assert.match(moreMenu, /Export annotated PDF/);
  assert.match(moreMenu, /Save log/);
});

/*
 * RULED CHANGE 2026-09-21 (pass 7 / DESIGN-SYSTEM.md: "Standard is the starting
 * height for every current phone panel"). This used to guard "Pages, Search and
 * Bookmarks share ONE tray height", the 2026-09-17 ruling that replaced three
 * snug trays with one steady one. Pass 7 extends exactly that reasoning to every
 * panel: there is no per-tab height selector left to inspect, because every
 * panel - including Version history and Spaces, which had their own numbers -
 * opens at the shared Standard token. The stronger form of the same rule.
 */
test('every browse panel opens at Standard; a settings sheet fits its content', () => {
  assert.match(sidebar, /const MOBILE_PANEL_STANDARD = 'var\(--mobile-panel-standard\)';/);
  assert.match(mobileCss, /--mobile-panel-standard: calc\(448px \+ var\(--mobile-bottom-inset\)\)/);
  // Compact exists as a token and is assigned to nothing.
  assert.match(mobileCss, /--mobile-panel-compact: calc\(392px \+ var\(--mobile-bottom-inset\)\)/);
  assert.doesNotMatch(mobileCss, /--mobile-sheet-height:\s*var\(--mobile-panel-compact\)/);
  // No panel names its own pixel height any more.
  assert.doesNotMatch(sidebar, /const MOBILE_HUB_TRAY_HEIGHT/);
  assert.doesNotMatch(sidebar, /activeTab === 'history'\)\s*return\s*\d/);
  assert.doesNotMatch(sidebar, /activeTab === 'spaces'\)\s*\{/);
  // The browse sheets read the Standard token.
  // (2026-10-01: less the safe-area inset, which the dock under the sheet
  // now carries - SHEETS STAND ON THE DOCK.)
  assert.match(mobileCss, /height: calc\(var\(--mobile-sheet-height, var\(--mobile-panel-standard\)\) - var\(--mobile-bottom-inset\)\) !important/);
  assert.match(mobileCss, /\.mobile-pdf-users-sheet \{[\s\S]{0,200}--mobile-sheet-height: var\(--mobile-panel-standard\)/);

  /*
   * RULED CHANGE 2026-09-22 (owner): "a settings sheet is exactly as tall as its
   * content, never taller. The Standard / Expanded / Compact heights stay for
   * browse panels." The two assertions that used to pin the tool "..." sheet and
   * the color picker to Standard are inverted: at Standard both left roughly
   * 110px of empty sheet under their last control. They are `height: auto` now,
   * under the unchanged max-height cap, and must never name a panel height
   * again.
   */
  /*
   * RULED 2026-09-23 (owner: restore the per-tool panels). The tool "..." row
   * sheet (.mobile-pdf-tool-sheet) is gone; "..." opens the restored
   * "<Tool> settings" panel (.mobile-pdf-text-defaults) again. The same
   * content-height contract is asserted on that panel instead: `height: auto`,
   * never a panel height, under the same cap, scrolling inside its body.
   */
  assert.match(mobileCss, /\.mobile-pdf-text-defaults \{[^}]{0,1600}\n  height: auto;/);
  assert.doesNotMatch(mobileCss, /\.mobile-pdf-text-defaults \{[^}]{0,1600}height: var\(--mobile-panel-standard\)/);
  assert.match(mobileCss, /\.mobile-pdf-colorpicker-surface \{[^}]{0,1600}\n  height: auto;/);
  assert.doesNotMatch(mobileCss, /\.mobile-pdf-colorpicker-surface \{[^}]{0,1600}height: var\(--mobile-panel-standard\)/);
  // The cap and the internal scroll are what replace the fixed height.
  assert.match(mobileCss, /\.mobile-pdf-text-defaults \{[^}]{0,1600}max-height: calc\(100dvh/);
  assert.match(mobileCss, /\.mobile-pdf-colorpicker-surface \{[^}]{0,1600}max-height: calc\(100dvh/);
  assert.match(mobileCss, /\.mobile-pdf-text-defaults__scroll \{[^}]{0,400}overflow-y: auto/);
  assert.match(mobileCss, /\.mobile-pdf-colorpicker-surface__body \{[^}]{0,400}overflow-y: auto/);

  // ADDED at the pass-7 integration: the Survey panel is a phone panel too, and
  // it was the last one still measuring its own content (154 + 48 a template,
  // 392 with one chosen, 314 + the checklist window in detail). It sets no height
  // of its own now, which is what leaves .mobile-pdf-sheet's fallback - Standard -
  // in charge, and leaves .is-expanded free to raise it on a pull-up.
  const surveyRail = read('../src/SurveySpacesRail.jsx');
  assert.doesNotMatch(surveyRail, /mobileSurveyPanelBaseHeight/);
  assert.match(surveyRail, /height: mobileMode \? 'var\(--mobile-sheet-height, var\(--mobile-panel-standard\)\)'/);

  // Empty states fill the shared tray instead of leaving a stub sheet.
  assert.match(mobileCss, /\.mobile-search-panel__results \{[\s\S]{0,320}flex-direction: column;/);
  assert.match(mobileCss, /\.mobile-search-empty \{[\s\S]{0,120}flex: 1;/);
  assert.match(mobileCss, /\.mobile-bookmark-empty \{[\s\S]{0,120}flex: 1;/);
});

test('one motion source: the hook owns open, drag and close; no sheet keyframe', () => {
  assert.doesNotMatch(mobileCss, /@keyframes mobilePdfSheetIn/);
  // real declarations only — the comments above still name the retired keyframe.
  assert.doesNotMatch(mobileCss, /^\s*animation: mobilePdfSheetIn/m);

  // Entrance timing sits in the owner's 240-280ms window and decelerates.
  assert.match(sheetMotion, /export const SHEET_OPEN_MS = 2[4-8]\d;/);
  assert.match(sheetMotion, /export const SHEET_OPEN_EASING = 'cubic-bezier\(/);
  // The close finishes before the real unmount fires.
  assert.match(sheetMotion, /export const SHEET_CLOSE_UNMOUNT_MS = SHEET_CLOSE_MS \+ \d+;/);
  // (2026-09-30: a released swipe closes at the finger's speed, so its unmount
  // waits that close's own duration plus the same buffer; a bare close still
  // waits SHEET_CLOSE_UNMOUNT_MS.)
  assert.match(sheetMotion, /: SHEET_CLOSE_UNMOUNT_MS\);/);
  assert.match(sheetMotion, /motion\.ms \+ \(SHEET_CLOSE_UNMOUNT_MS - SHEET_CLOSE_MS\)/);
  // The entrance slides from fully offscreen, not a 24px nudge.
  assert.match(sheetMotion, /enterPhase === 'parked'[\s\S]{0,140}translateY\(100%\)/);
  // Transform/opacity only — never top/height, so pdf.js keeps its frame budget.
  assert.doesNotMatch(sheetMotion, /motionStyle = \{[\s\S]{0,200}(height|top):/);
  // prefers-reduced-motion still short-circuits the easings.
  assert.match(sheetMotion, /prefersReducedMotion\(\) \? null : 'parked'/);

  // Sheets that stay mounted must tell the hook when they are open, or the
  // slide-up never runs.
  assert.match(sidebar, /useMobileSheetMotion\(closePanel, \{[\s\S]{0,200}open: mobileMode && !isCollapsed,/);
});

test('the browse panels keep their taller detents alongside the motion source', () => {
  // RULED CHANGE 2026-09-21 (pass 7): a third step. Drag up past 48px -> 70dvh ->
  // full screen; drag down steps back ONE height at a time before a further pull
  // can dismiss. The boolean `expanded` is a numbered detent now, so the two
  // regexes below read the step rather than setExpanded(false); the behaviour
  // they guard is the same and there is one more of it.
  assert.match(sheetMotion, /export const SHEET_EXPAND_DY = 48;/);
  assert.match(sheetMotion, /export const SHEET_EXPANDED_HEIGHT = '70dvh';/);
  assert.match(sheetMotion, /export const SHEET_DETENT_FULL = 2;/);
  assert.match(sheetMotion, /if \(expandable && travel < 0\)/);
  assert.match(sheetMotion, /if \(detent > SHEET_DETENT_STANDARD\) \{\s*setDetent\(\(current\) => current - 1\);/);
  assert.match(mobileCss, /\.mobile-pdf-sheet\.is-expanded \{[\s\S]{0,160}--mobile-sheet-height: var\(--mobile-panel-expanded\);/);
  assert.match(sidebar, /expandable: browsePanel,/);
  // ...and the taller detent still comes out of CSS height, never the hook's
  // transform, so it cannot compete with the pdf.js render.
  assert.doesNotMatch(sheetMotion, /motionStyle = \{[\s\S]{0,200}(height|top):/);
});

/*
 * Owner 2026-09-30: (1) no close X on any phone bottom sheet - a tap outside or
 * a swipe down closes it; the Pages / Search / Bookmarks row holds only its
 * three tabs. (2) A swipe down that starts ANYWHERE on a sheet drags it, while
 * list scrolling, taps and drag-grip reorders keep working. Proven live in
 * headless Chromium; these pin the wiring.
 */
test('phone sheets have no close X and take a swipe from anywhere', () => {
  const survey = read('../src/SurveySpacesRail.jsx');
  assert.doesNotMatch(sidebar, /mobile-pdf-hub-close|mobile-history-close/);
  assert.doesNotMatch(mobileCss, /\.mobile-pdf-hub-close|\.mobile-history-close/);
  assert.doesNotMatch(mobileChrome, /<button type="button" aria-label="Close (annotation settings|active users)"/);
  assert.match(mobileCss, /\.mobile-survey-sheet \.mobile-survey-close\[aria-label='Close Survey panel'\] \{\s*display: none !important;/);

  // Every sheet spreads the hook's sheetProps (ref + data-mobile-sheet) on its
  // root instead of wiring touch handlers to the grab handle only.
  assert.doesNotMatch(sidebar + mobileChrome + survey, /dragHandlers|DragHandlers\.onTouch/);
  assert.match(sidebar, /\{\.\.\.\(mobileMode \? sheetProps : null\)\}/);
  assert.match(survey, /\{\.\.\.\(mobileMode \? surveySheetProps : null\)\}/);
  assert.equal((mobileChrome.match(/\{\.\.\.(textSheetProps|usersSheetProps|sheetProps)\}/g) || []).length, 4);
  // (2026-10-01: sheetProps also carries data-sheet-swap, the panel-to-panel
  // content fade, so this reads the two original keys and not the object end.)
  assert.match(sheetMotion, /sheetProps: \{\s*ref: sheetRef,\s*'data-mobile-sheet': 'true',/);

  // Native listener so the move can be cancelled once the sheet owns it.
  assert.match(sheetMotion, /addEventListener\('touchmove', onTouchMove, \{ passive: false \}\)/);
  // A grip, a slider or a control with its own touch-action:none keeps its drag.
  assert.match(sheetMotion, /'\[data-drag-rearrange-handle\]'/);
  assert.match(sheetMotion, /'\.mobile-bookmark-grip'/);
  assert.match(sheetMotion, /touchAction === 'none'/);
  // Lists scroll first and hand over at their top; sideways moves are ignored.
  assert.match(sheetMotion, /g\.scrollers\.some\(\(el\) => el\.scrollTop > 0\)/);
  assert.match(sheetMotion, /Math\.abs\(dx\) > Math\.abs\(dy\)/);
});

/*
 * Owner 2026-10-01 (iPhone): (1) closing a sheet from the dock / programmatically
 * was a pop while opening slid - every close now slides down behind the dock on
 * the entrance's own curve, and a dock switch keeps the sheet standing and
 * fades the content; (2) a height change (typing, keyboard, detents, Survey
 * full screen) snapped - it now glides. Proven with frame logs in headless
 * Chromium; these pin the wiring.
 */
test('dock closes slide, dock switches hand over, and height changes glide', () => {
  const survey = read('../src/SurveySpacesRail.jsx');
  const appShell = read('../src/AppShell.jsx');
  // Same curve family both ways.
  assert.match(sheetMotion, /export const SHEET_CLOSE_EASING = SHEET_OPEN_EASING;/);
  // The dock's close goes through the hook, not straight to the collapse.
  assert.match(sidebar, /if \(!isCollapsed && activeTab === panelId\) \{\s*closePanelSmoothly\(\);/);
  assert.match(sidebar, /closePanel: closePanelSmoothly,/);
  assert.match(sidebar, /mobileSheetCloseRef\.current = mobileMode \? requestSheetClose : null;/);
  assert.match(survey, /if \(mobileMode && !isSurveyPanelCollapsed\) \{\s*requestSurveySheetClose\(\);/);
  assert.match(appShell, /closePanel\?\.\(mobileSurveyPanelOpen \? undefined : \{ handover: true \}\)/);
  // Panel to panel: one sheet swaps content in place; two sheets hand over.
  assert.match(sidebar, /contentKey: activeTab === 'spaces' \|\| activeTab === 'history' \? activeTab : 'hub',/);
  assert.match(sheetMotion, /'data-sheet-swap': enterPhase === 'swap'/);
  assert.match(mobileCss, /\[data-mobile-sheet\]\[data-sheet-swap='a'\] > :not\(\.mobile-pdf-sheet__handle\)/);
  // The resize glide owns height: a registered property the sheet reads while
  // it runs, and no CSS height transition on the phone sheets to fight it.
  assert.match(mobileCss, /@property --sheet-glide-height \{\s*syntax: '<length>';/);
  assert.match(mobileCss, /:root \[data-mobile-sheet\]\[data-sheet-glide\] \{\s*height: var\(--sheet-glide-height\) !important;/);
  assert.match(sheetMotion, /'--sheet-glide-height': `\$\{startHeight\}px`/);
  assert.match(sidebar, /transition: mobileMode \? 'none' : 'width 0\.2s ease, height 0\.26s/);
  assert.match(survey, /transition: mobileMode \? 'none' : 'right 0\.2s ease, top 0\.2s ease, height 0\.2s ease'/);
  // The keyboard lift itself stays instant (52a745a): no transition on it.
  assert.doesNotMatch(mobileCss, /html\[data-keyboard-open='true'\] \[data-mobile-sheet\] \{[^}]*transition/);
  // Reduced motion: no glide and no hand-over fade.
  assert.match(sheetMotion, /live\.enterPhase === 'parked' \|\| prefersReducedMotion\(\)/);
  assert.match(sheetMotion, /if \(!tracksOpen \|\| prefersReducedMotion\(\)\) return false;/);
});
