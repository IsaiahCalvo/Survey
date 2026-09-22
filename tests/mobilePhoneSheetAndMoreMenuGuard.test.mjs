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
test('every phone panel opens at the one Standard height', () => {
  assert.match(sidebar, /const MOBILE_PANEL_STANDARD = 'var\(--mobile-panel-standard\)';/);
  assert.match(mobileCss, /--mobile-panel-standard: calc\(448px \+ var\(--mobile-bottom-inset\)\)/);
  // Compact exists as a token and is assigned to nothing.
  assert.match(mobileCss, /--mobile-panel-compact: calc\(392px \+ var\(--mobile-bottom-inset\)\)/);
  assert.doesNotMatch(mobileCss, /--mobile-sheet-height:\s*var\(--mobile-panel-compact\)/);
  // No panel names its own pixel height any more.
  assert.doesNotMatch(sidebar, /const MOBILE_HUB_TRAY_HEIGHT/);
  assert.doesNotMatch(sidebar, /activeTab === 'history'\)\s*return\s*\d/);
  assert.doesNotMatch(sidebar, /activeTab === 'spaces'\)\s*\{/);
  // The sheet's default and the tool sheets all read the Standard token.
  assert.match(mobileCss, /height: var\(--mobile-sheet-height, var\(--mobile-panel-standard\)\) !important/);
  assert.match(mobileCss, /\.mobile-pdf-tool-sheet \{[\s\S]{0,400}height: var\(--mobile-panel-standard\)/);
  assert.match(mobileCss, /\.mobile-pdf-users-sheet \{[\s\S]{0,200}--mobile-sheet-height: var\(--mobile-panel-standard\)/);
  assert.match(mobileCss, /\.mobile-pdf-colorpicker-surface \{[\s\S]{0,400}height: var\(--mobile-panel-standard\)/);

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
  assert.match(sheetMotion, /\}, SHEET_CLOSE_UNMOUNT_MS\);/);
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
