// Smooth tab switches (owner 2026-10-27, docs/TAB-SWITCHING.md): every open
// tab keeps its own rails, only the front tab's rails act on shared state, and
// nothing the switch touches writes a custom property onto :root (each such
// write restyles the whole document). The frame-by-frame check runs in
// tests/e2e-signed-in/tab-switch-smooth.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8');
const shell = read('AppShell.jsx');

test('a hidden rail ignores request bumps and does not replay them when its tab comes back', async () => {
  const { nextActiveOnlyCount } = await import('../src/hooks/useActiveOnlyCounter.js');
  let s = { base: 0, seen: 0, wasActive: true };
  s = nextActiveOnlyCount(s, 1, true);
  assert.equal(s.seen, 1, 'the front tab hears a bump');
  s = nextActiveOnlyCount(s, 1, false);
  s = nextActiveOnlyCount(s, 2, false);
  s = nextActiveOnlyCount(s, 3, false);
  assert.equal(s.seen, 1, 'a hidden tab holds what it last saw');
  s = nextActiveOnlyCount(s, 3, true);
  assert.equal(s.seen, 1, 'coming to the front replays nothing');
  s = nextActiveOnlyCount(s, 4, true);
  assert.equal(s.seen, 2, 'the next bump in front is heard once');
});

test('chrome edges are published to a store and set on the consumers, not on :root', async () => {
  const { publishChromeInset, getChromeInsets, subscribeChromeInsets, chromeInsetVars } = await import('../src/utils/chromeInsets.js');
  let calls = 0;
  const off = subscribeChromeInsets(() => { calls += 1; });
  publishChromeInset('left', '308px');
  publishChromeInset('left', '308px');
  assert.equal(calls, 1, 'an unchanged value is not news');
  publishChromeInset('top', '69px');
  publishChromeInset('nope', '1px');
  assert.deepEqual(chromeInsetVars(getChromeInsets()), { '--app-sidebar-width': '308px', '--app-chrome-top': '69px' });
  assert.deepEqual(chromeInsetVars(getChromeInsets(), ['top']), { '--app-chrome-top': '69px' });
  publishChromeInset('left', null);
  assert.deepEqual(chromeInsetVars(getChromeInsets(), ['left']), {});
  off();

  for (const file of ['AppShell.jsx', 'PDFSidebar.jsx', 'SurveySpacesRail.jsx', 'PDFViewer.jsx']) {
    assert.doesNotMatch(read(file), /setProperty\('--app-(sidebar-width|right-rail-width|banner-top)'/, `${file} writes no rail or banner edge onto :root`);
  }
  // Phone-only CSS still reads the top from :root; only the phone writes it.
  assert.match(shell, /if \(isMobileViewer && document\.documentElement\.style\.getPropertyValue\('--app-chrome-top'\) !== chromeTopPx\)/);
  assert.doesNotMatch(read('PDFViewer.jsx'), /setProperty\('--app-chrome-top'/);
  assert.match(read('components/TextSelectionActionBar.jsx'), /style=\{chromeInsetVars\(chromeInsets, \['top'\]\)\}/);
});

test('the layers opacity is left in place on a switch and only written when it changes', () => {
  const viewer = read('PDFViewer.jsx');
  const at = viewer.indexOf("const pdfOpacityFrontRef = useRef(false);");
  assert.ok(at > 0);
  const block = viewer.slice(at, at + 900);
  assert.match(block, /getPropertyValue\('--survey-pdf-content-opacity'\) !== value/);
  assert.match(block, /if \(pdfOpacityFrontRef\.current\) document\.documentElement\.style\.removeProperty/);
});

test('every open tab keeps its own rails; a switch only flips which slot is shown', () => {
  const slot = read('components/TabChromeSlot.jsx');
  assert.match(slot, /display: active \? 'contents' : 'none'/);
  assert.match(shell, /const railTabs = useMemo\(\(\) => tabs\.filter\(\(tab\) => !tab\.isHome && \(!isNarrowShell \|\| tab\.id === activeTabId\)\)/);
  assert.equal((shell.match(/railTabs\.map\(\(tab\) =>/g) || []).length, 2, 'left and right hosts');
  assert.match(shell, /<MemoPDFSidebar\s+\{\.\.\.api\}\s+tabActive=\{active\}/);
  assert.match(shell, /<RightRailForTab/);
  // Only the front tab's rail publishes widths, listens for keys, or yields.
  const sidebar = read('PDFSidebar.jsx');
  assert.match(sidebar, /if \(!tabActive\) return;\s*publishChromeInset\('left'/);
  const rail = read('SurveySpacesRail.jsx');
  assert.match(rail, /tabActive = true/);
});
