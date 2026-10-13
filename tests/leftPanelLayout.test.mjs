/**
 * Chunk D (owner 2026-10-13, Drawboard app-shell audit, scratchpad
 * drawboardDeep/SHELL.md §4): the desktop left rail's panels.
 *
 * Intended UX:
 *   - each panel's right edge resizes it (mouse 8px strip, 24px on touch
 *     screens with an always-drawn grip), inside per-panel limits
 *     (Pages 224 120-480; Search / Bookmarks / Spaces / History 340 280-1200),
 *     never leaving less than 360px of document; double-click (or Enter on the
 *     focused edge) resets;
 *   - every panel keeps its own width, and which panel was open, per user,
 *     across reloads (localStorage, never throwing);
 *   - opening / closing slides the panel with a transform, so the page is not
 *     laid out again every frame: the rail changes width once as a panel opens
 *     and once after the closing slide;
 *   - Esc in the search box hands focus back to the page.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEFT_RAIL_WIDTH,
  MIN_VIEWER_VISIBLE,
  PANEL_WIDTHS,
  DEFAULT_PANEL_LAYOUT,
  clampPanelWidth,
  normalizePanelLayout,
  panelMaxWidth,
  panelWidthSpec,
  readPanelLayout,
  storageKeyForUser,
  widthFromDrag,
  widthFromKey,
  writePanelLayout,
} from '../src/sidebar/panelLayoutStore.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const memoryStorage = () => {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
};

test('per-panel widths: Pages narrow, the reading panels wide (Drawboard)', () => {
  assert.deepEqual({ ...PANEL_WIDTHS.pages }, { initial: 224, min: 120, max: 480 });
  for (const id of ['search', 'bookmarks', 'spaces', 'history']) {
    assert.deepEqual({ ...PANEL_WIDTHS[id] }, { initial: 340, min: 280, max: 1200 }, id);
  }
  assert.equal(panelWidthSpec('nonsense'), PANEL_WIDTHS.pages);
});

test('clamp: inside the limits, and never more than the window leaves room for', () => {
  assert.equal(clampPanelWidth('pages', undefined, 1440), 224);
  assert.equal(clampPanelWidth('search', null, 1440), 340);
  assert.equal(clampPanelWidth('search', 'abc', 1440), 340);
  assert.equal(clampPanelWidth('pages', 50, 1440), 120);
  // A drag that ran off the window's left edge is the narrowest, not a reset.
  assert.equal(clampPanelWidth('pages', -56, 1440), 120);
  assert.equal(clampPanelWidth('pages', 5000, 1440), 480);
  assert.equal(clampPanelWidth('search', 300.6, 1440), 301);
  // 1440 window: 1440 - 48 - 360 = 1032 is the widest a Search panel gets.
  assert.equal(panelMaxWidth('search', 1440), 1440 - LEFT_RAIL_WIDTH - MIN_VIEWER_VISIBLE);
  assert.equal(clampPanelWidth('search', 1200, 1440), 1032);
  // A tiny window still gets the panel's min, never less.
  assert.equal(panelMaxWidth('search', 500), 280);
  assert.equal(clampPanelWidth('search', 900, 500), 280);
  assert.equal(panelMaxWidth('pages', undefined), 480);
});

test('drag: the width follows the pointer from where the press started', () => {
  const drag = { panelId: 'pages', startWidth: 224, startX: 272, viewportWidth: 1440 };
  assert.equal(widthFromDrag({ ...drag, x: 352 }), 304);
  assert.equal(widthFromDrag({ ...drag, x: 200 }), 152);
  assert.equal(widthFromDrag({ ...drag, x: -7 }), 120);
  assert.equal(widthFromDrag({ ...drag, x: 2000 }), 480);
});

test('keyboard on the edge: arrows step, Shift steps more, Home/End, Enter resets', () => {
  const at = (key, width = 340, shiftKey = false) => widthFromKey({ panelId: 'search', width, key, shiftKey, viewportWidth: 1440 });
  assert.equal(at('ArrowRight'), 356);
  assert.equal(at('ArrowLeft'), 324);
  assert.equal(at('ArrowRight', 340, true), 404);
  assert.equal(at('ArrowLeft', 290, true), 280);
  assert.equal(at('Home'), 280);
  assert.equal(at('End'), 1032);
  assert.equal(at('Enter', 600), 340);
  assert.equal(at('a'), null);
  assert.equal(at('ArrowUp'), null);
});

test('storage: per user, round trips, never throws, ignores junk', () => {
  const store = memoryStorage();
  assert.equal(storageKeyForUser('u1'), 'survey.leftPanelLayout.v1:u1');
  assert.equal(storageKeyForUser(null), 'survey.leftPanelLayout.v1:local');
  assert.equal(readPanelLayout(store, 'u1'), DEFAULT_PANEL_LAYOUT);
  assert.equal(writePanelLayout(store, 'u1', { widths: { pages: 300, search: 410.4 }, open: true, panel: 'search' }), true);
  assert.deepEqual(readPanelLayout(store, 'u1'), { widths: { pages: 300, search: 410 }, open: true, panel: 'search' });
  // Another user does not see it.
  assert.equal(readPanelLayout(store, 'u2'), DEFAULT_PANEL_LAYOUT);
  // Junk in storage falls back field by field.
  store.setItem(storageKeyForUser('u3'), JSON.stringify({ widths: { pages: 'x', search: -4, bogus: 500, spaces: 360 }, open: 'yes', panel: 'nope' }));
  assert.deepEqual(readPanelLayout(store, 'u3'), { widths: { spaces: 360 }, open: false, panel: 'pages' });
  store.setItem(storageKeyForUser('u4'), '{not json');
  assert.equal(readPanelLayout(store, 'u4'), DEFAULT_PANEL_LAYOUT);
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

test('wiring: the resize edge - mouse 8px, touch 24px with a drawn grip, drag writes only a CSS variable', () => {
  const sidebar = read('../src/PDFSidebar.jsx');
  const css = read('../src/styles.css');
  assert.match(sidebar, /role="separator"\s*aria-orientation="vertical"/);
  assert.match(sidebar, /onDoubleClick=\{resetPanelWidth\}/);
  assert.match(sidebar, /railElRef\.current\?\.style\.setProperty\('--left-panel-w', `\$\{width\}px`\);/);
  assert.match(css, /\.left-rail__resize \{[^}]*width: 8px;[^}]*cursor: ew-resize;[^}]*touch-action: none;/);
  assert.match(css, /@media \(any-pointer: coarse\) \{\s*\.left-rail__resize \{\s*right: -16px;\s*width: 24px;/);
  assert.match(css, /@media \(pointer: coarse\) \{\s*\.left-rail__resize::after \{\s*opacity: 0\.7;/);
  // The phone keeps its sheet: no handle, no stored open state.
  assert.match(sidebar, /\{!mobileMode && !isCollapsed && \(\s*<div\s*className=\{`left-rail__resize/);
  assert.match(sidebar, /const stored = mobileMode \? DEFAULT_PANEL_LAYOUT : readPanelLayout\(browserStorage\(\), layoutUserKey\);/);
});

test('Esc in the search box hands focus back to the page and keeps the search', () => {
  const panel = read('../src/sidebar/SearchTextPanel.jsx');
  const esc = panel.slice(panel.indexOf("if (e.key === 'Escape' && isInputFocused)"));
  assert.match(esc, /^if \(e\.key === 'Escape' && isInputFocused\) \{\s*e\.preventDefault\(\);\s*e\.stopPropagation\(\);\s*searchInputRef\.current\.blur\(\);\s*\}/);
  assert.doesNotMatch(panel, /clearSearchRef/);
});
