/**
 * The desktop left rail's panels (Pages, Search, Bookmarks, Spaces, History).
 *
 * Intended UX:
 *   - owner 2026-10-14 ("It can barely be resized ... just pick one size ...
 *     the smallest size that makes sense for all the tabs"): every panel is
 *     one fixed width. Owner 2026-10-28: 320px, the Survey panel's width, so
 *     the page sits on the tool bar's centre line with both sides open
 *     (History's colour key needs 252, the widest need of the tabs). No drag edge, no remembered width (an old saved width is
 *     ignored).
 *   - a small window may narrow it: it never leaves less than 400px of
 *     document beside whatever covers the right side (the right rail, the
 *     Survey panel), and in Survey never reaches into the survey bar's centre
 *     group (batch-7 tablet check) - never below 200px. On a 1180px iPad and
 *     wider it is always 320.
 *   - which panel was open, and whether, comes back per user across reloads
 *     (localStorage, never throwing) - Chunk D, 2026-10-13;
 *   - opening / closing slides the panel with a transform, so the page is not
 *     laid out again every frame: the rail changes width once as a panel opens
 *     and once after the closing slide;
 *   - Esc in the search box hands focus back to the page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as store from '../src/sidebar/panelLayoutStore.js';

const {
  LEFT_RAIL_WIDTH,
  LEFT_PANEL_WIDTH,
  LEFT_PANEL_MIN_WIDTH,
  MIN_VIEWER_VISIBLE,
  SURVEY_CENTRE_CLEARANCE,
  getSideRoom,
  publishSideRoom,
  subscribeSideRoom,
  DEFAULT_PANEL_LAYOUT,
  leftPanelWidth,
  normalizePanelLayout,
  readPanelLayout,
  storageKeyForUser,
  writePanelLayout,
} = store;

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const memoryStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
};

test('one fixed width: every panel is 320px, the Survey panel width (owner 2026-10-14, 2026-10-28)', () => {
  assert.equal(LEFT_PANEL_WIDTH, 320);
  assert.equal(LEFT_RAIL_WIDTH, 48);
  // Desktop windows and the 1180px iPad: always the one width, Survey or not.
  for (const vw of [1180, 1280, 1366, 1440, 1920, 2560]) {
    assert.equal(leftPanelWidth(vw), 320, `${vw}`);
    assert.equal(leftPanelWidth(vw, { rightCover: 48, surveyCentreX: null }), 320, `${vw} rail only`);
    assert.equal(leftPanelWidth(vw, { rightCover: 368, surveyCentreX: vw / 2 }), 320, `${vw} Survey panel open`);
  }
  // No width given (server render, a test): the one width.
  assert.equal(leftPanelWidth(undefined), 320);
  assert.equal(leftPanelWidth(0), 320);
  // The resize feature is gone: no per-panel limits, drag or key handlers.
  for (const gone of ['PANEL_WIDTHS', 'panelWidthSpec', 'panelMaxWidth', 'clampPanelWidth', 'widthFromDrag', 'widthFromKey', 'KEYBOARD_STEP']) {
    assert.equal(gone in store, false, gone);
  }
});

test('a small window narrows the panel so the document and the survey bar keep room', () => {
  // iPad 1024 with the Survey panel open (48 rail + 320 panel): 1024 - 48 - 368 - 400.
  assert.equal(MIN_VIEWER_VISIBLE, 400);
  assert.equal(leftPanelWidth(1024, { rightCover: 368, surveyCentreX: 512 }), 208);
  // Survey panel closed: the survey bar's centre spot is the limit (it stops
  // SURVEY_CENTRE_CLEARANCE short: start piece, gutter, 4 chips + "All N").
  assert.equal(SURVEY_CENTRE_CLEARANCE, 176);
  assert.equal(leftPanelWidth(1024, { rightCover: 48, surveyCentreX: 512 }), 512 - 48 - 176);
  assert.equal(leftPanelWidth(900, { rightCover: 48, surveyCentreX: 450 }), 450 - 48 - 176);
  // Not in Survey on a 1024 iPad: the full width.
  assert.equal(leftPanelWidth(1024, { rightCover: 48, surveyCentreX: null }), 320);
  // Never below the floor, however little room.
  assert.equal(LEFT_PANEL_MIN_WIDTH, 200);
  assert.equal(leftPanelWidth(500, { rightCover: 368 }), 200);
});

test('side room store: merges, whole px, notifies only on a change', () => {
  const start = getSideRoom();
  let calls = 0;
  const off = subscribeSideRoom(() => { calls += 1; });
  try {
    assert.equal(publishSideRoom({ rightCover: 368.4 }), true);
    assert.equal(getSideRoom().rightCover, 368);
    assert.equal(publishSideRoom({ rightCover: 368 }), false);
    assert.equal(publishSideRoom({ surveyCentreX: 511.6 }), true);
    assert.deepEqual({ ...getSideRoom() }, { rightCover: 368, surveyCentreX: 512 });
    assert.equal(publishSideRoom({ surveyCentreX: null }), true);
    assert.equal(getSideRoom().surveyCentreX, null);
    assert.equal(publishSideRoom({ surveyCentreX: 'x' }), false);
    assert.equal(calls, 3);
  } finally {
    off();
    publishSideRoom(start);
  }
});

test('wiring: the right rail and the survey bar publish their room; the sidebar reads it', () => {
  const sidebar = read('../src/PDFSidebar.jsx');
  const rail = read('../src/SurveySpacesRail.jsx');
  const fit = read('../src/hooks/useSurveyBarFit.js');
  assert.match(sidebar, /useSyncExternalStore\(subscribeSideRoom, getSideRoom, getSideRoom\)/);
  assert.match(sidebar, /const panelWidth = leftPanelWidth\(viewportWidth, sideRoom\);/);
  assert.match(rail, /publishSideRoom\(\{ rightCover: mobileMode \? 0 : \(desktopSurveyPanelShown \? 48 \+ 320 : 48\) \}\)/);
  assert.match(fit, /publishSideRoom\(\{ surveyCentreX: barRect\.left \+ centre \}\)/);
  assert.match(fit, /publishSideRoom\(\{ surveyCentreX: null \}\)/);
});

test('storage: per user, round trips, never throws, ignores junk', () => {
  const mem = memoryStorage();
  assert.equal(storageKeyForUser('u1'), 'survey.leftPanelLayout.v1:u1');
  assert.equal(storageKeyForUser(null), 'survey.leftPanelLayout.v1:local');
  assert.equal(readPanelLayout(mem, 'u1'), DEFAULT_PANEL_LAYOUT);
  // A width handed in (or saved by the old resizable panel) is not kept.
  assert.equal(writePanelLayout(mem, 'u1', { widths: { pages: 300, search: 410.4 }, open: true, panel: 'search' }), true);
  assert.deepEqual(JSON.parse(mem.map.get(storageKeyForUser('u1'))), { open: true, panel: 'search' });
  assert.deepEqual(readPanelLayout(mem, 'u1'), { open: true, panel: 'search' });
  // Another user does not see it.
  assert.equal(readPanelLayout(mem, 'u2'), DEFAULT_PANEL_LAYOUT);
  // Junk in storage falls back field by field.
  mem.setItem(storageKeyForUser('u3'), JSON.stringify({ widths: { pages: 'x', search: -4, bogus: 500, spaces: 360 }, open: 'yes', panel: 'nope' }));
  assert.deepEqual(readPanelLayout(mem, 'u3'), { open: false, panel: 'pages' });
  mem.setItem(storageKeyForUser('u4'), '{not json');
  assert.equal(readPanelLayout(mem, 'u4'), DEFAULT_PANEL_LAYOUT);
  // Blocked storage (private window / quota) never throws.
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
  assert.equal(readPanelLayout(blocked, 'u1'), DEFAULT_PANEL_LAYOUT);
  assert.equal(writePanelLayout(blocked, 'u1', DEFAULT_PANEL_LAYOUT), false);
  assert.equal(readPanelLayout(null, 'u1'), DEFAULT_PANEL_LAYOUT);
  assert.equal(writePanelLayout(undefined, 'u1', DEFAULT_PANEL_LAYOUT), false);
  assert.deepEqual(normalizePanelLayout(null), DEFAULT_PANEL_LAYOUT);
});

test('wiring: the rail slides its panel by transform and changes width once per open / close', () => {
  const sidebar = read('../src/PDFSidebar.jsx');
  const css = read('../src/styles.css');
  // No width tween on the rail any more.
  assert.doesNotMatch(sidebar, /'width 0\.2s ease/);
  // Laid out open from the moment a panel opens until the closing slide ends.
  assert.match(sidebar, /const layoutOpen = !mobileMode && \(!isCollapsed \|\| panelLeaving\);/);
  assert.match(sidebar, /\(layoutOpen \? `calc\(\$\{LEFT_RAIL_W\}px \+ var\(--left-panel-w\)\)` : `\$\{LEFT_RAIL_W\}px`\)/);
  assert.match(sidebar, /window\.setTimeout\(\(\) => setPanelLeaving\(false\), PANEL_SLIDE_MS\)/);
  assert.match(sidebar, /const PANEL_SLIDE_MS = 200;/);
  // Reduced motion: the panel leaves at once.
  assert.match(sidebar, /if \(prefersReducedMotion\(\)\) \{\s*setPanelLeaving\(false\);/);
  assert.match(sidebar, /className: `left-rail__panel\$\{isCollapsed \? ' is-leaving' : ''\}`/);
  assert.match(css, /@keyframes leftRailPanelIn \{\s*from \{ transform: translateX\(-100%\); \}/);
  assert.match(css, /\.left-rail__panel\.is-leaving \{\s*animation: leftRailPanelOut 200ms cubic-bezier\(0\.4, 0, 0\.2, 1\) forwards;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.left-rail__panel,\s*\.left-rail__panel\.is-leaving \{\s*animation: none;/);
  // The viewer hears the layout state plus the open panel's width.
  assert.match(sidebar, /onToggleCollapseRef\.current\(layoutCollapsed, panelWidth\);/);
  const viewer = read('../src/PDFViewer.jsx');
  assert.match(viewer, /insetLeft: isLeftSidebarCollapsed \? 0 : leftRailPanelWidth,/);
  assert.match(viewer, /'--survey-bar-inset-l': isLeftSidebarCollapsed \? '0px' : `\$\{leftRailPanelWidth\}px`,/);
  assert.match(viewer, /const handleLeftRailToggleCollapse = useCallback\(\(isCollapsed, panelWidth\) => \{/);
});

test('wiring: no resize edge, no remembered width; the phone keeps its sheet', () => {
  const sidebar = read('../src/PDFSidebar.jsx');
  const css = read('../src/styles.css');
  assert.doesNotMatch(sidebar, /left-rail__resize|role="separator"|onDoubleClick=\{resetPanelWidth\}|is-resizing-side-panel|panelWidths/);
  assert.doesNotMatch(css, /\.left-rail__resize|is-resizing-side-panel/);
  // Only which panel and whether it was open are saved.
  assert.match(sidebar, /writePanelLayout\(browserStorage\(\), layoutUserKey, \{ open: !isCollapsed, panel: activeTab \}, layoutDocumentKey\);/);
  // The rail is the 48px column plus the one panel width while laid out open,
  // and the width published for the storage notice's left edge says the same
  // (chromeInsets.js, not a :root custom property).
  assert.match(sidebar, /'--left-panel-w': mobileMode \? undefined : `\$\{panelWidth\}px`,/);
  assert.match(sidebar, /publishChromeInset\('left', mobileMode \? '44px' : `\$\{layoutOpen \? LEFT_RAIL_W \+ panelWidth : LEFT_RAIL_W\}px`\)/);
  // The phone keeps its sheet: no stored open state.
  assert.match(sidebar, /const stored = mobileMode \? DEFAULT_PANEL_LAYOUT : readPanelLayout\(browserStorage\(\), layoutUserKey, layoutDocumentKey\);/);
});

test('Esc in the search box hands focus back to the page and keeps the search', () => {
  const panel = read('../src/sidebar/SearchTextPanel.jsx');
  const esc = panel.slice(panel.indexOf("if (e.key === 'Escape' && isInputFocused)"));
  assert.match(esc, /^if \(e\.key === 'Escape' && isInputFocused\) \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*searchInputRef\.current\.blur\(\);\s*\}/);
  assert.doesNotMatch(panel, /clearSearchRef/);
});


test('document panels start closed and restore only their own saved layout', () => {
  const mem = memoryStorage();
  writePanelLayout(mem, 'owner', { open: true, panel: 'spaces' }, 'doc-a');
  assert.deepEqual(readPanelLayout(mem, 'owner', 'doc-a'), { open: true, panel: 'spaces' });
  assert.equal(readPanelLayout(mem, 'owner', 'doc-b'), DEFAULT_PANEL_LAYOUT);
  assert.equal(readPanelLayout(mem, 'other-user', 'doc-a'), DEFAULT_PANEL_LAYOUT);
  writePanelLayout(mem, 'owner', { open: true, panel: 'history' });
  assert.equal(readPanelLayout(mem, 'owner', 'doc-new'), DEFAULT_PANEL_LAYOUT);
});
