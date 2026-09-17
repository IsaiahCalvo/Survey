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

test('Pages, Search and Bookmarks share one hub tray height', () => {
  assert.match(sidebar, /const MOBILE_HUB_TRAY_HEIGHT = 310;/);
  const start = sidebar.indexOf('const mobilePanelBaseHeight = (() => {');
  assert.ok(start > 0, 'expected the mobile sheet height selector to exist');
  const end = sidebar.indexOf('})();', start);
  const selector = sidebar.slice(start, end);

  // No per-tab height for any of the three hub tabs — they fall through to the
  // shared constant.
  assert.doesNotMatch(selector, /activeTab === 'search'\s*\)\s*return\s*\d/);
  assert.doesNotMatch(selector, /activeTab === 'bookmarks'\s*\)\s*return/);
  assert.doesNotMatch(selector, /activeTab === 'pages'/);
  assert.match(selector, /return MOBILE_HUB_TRAY_HEIGHT;/);

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
  assert.match(sidebar, /useMobileSheetMotion\(closePanel, \{ open: mobileMode && !isCollapsed \}\)/);
});
