import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * REGRESSION GUARD (owner, 2026-09-23 - phone, editing a text box with the
 * Text tool's "Font color" sheet open).
 *
 * 1. The text editor's tick and cross showed ON TOP of the bottom sheet. They
 *    live in a body portal and sat at z-index 2147483000, so they painted over
 *    every bar, sheet and menu in the app. They belong to the page: above the
 *    page and the text box, under every bar, sheet, menu and modal.
 *
 * 2. Tapping the rainbow ("Color spectrum") button closed the whole sheet. The
 *    sheet (MobileColorPickerSurface) portals to document.body, outside the
 *    text strip that carries TextEditOverlay's data-rich-text-toolbar opt-out,
 *    so the first touch anywhere in it hit the editor's document pointerdown
 *    listener, which commits and closes the text box - and the strip and its
 *    sheet unmount with it. Measured live: any tap in the sheet (rainbow, a
 *    swatch, even the title) closed it while a text box was open.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const OVERLAY = read('../src/components/TextEditOverlay.jsx');
const CHROME = read('../src/mobile/MobilePdfViewerChrome.jsx');
const APP_SHELL = read('../src/AppShell.jsx');
const MOBILE_CSS = read('../src/mobile/mobilePdfViewer.css');

const pairZ = () => {
  const match = OVERLAY.match(/const ACTION_PAIR_Z_INDEX = (\d+);/);
  assert.ok(match, 'TextEditOverlay names the tick/cross layer in ACTION_PAIR_Z_INDEX');
  return Number(match[1]);
};

// 2026-10-04 (owner: the pair "lags behind a little bit" when panning): the
// pair moved out of its body portal INTO the page, inside the overlay's own
// wrapper. That puts it inside the viewer tab layer by construction, so it is
// under every bar, sheet and menu without a document-wide level of its own;
// these tests now pin that it stays in the page and that the page layer itself
// is under every chrome layer.
const viewerLayer = () => {
  const match = APP_SHELL.match(/zIndex: isVisible \? (\d+) : \d+/);
  assert.ok(match, 'AppShell still sets the viewer tab wrapper level');
  return Number(match[1]);
};

test('the tick/cross pair uses its named layer, not a top-of-everything z-index', () => {
  const portal = OVERLAY.slice(OVERLAY.indexOf('data-page-anchored-controls-clip'));
  assert.match(portal.slice(0, 400), /zIndex: ACTION_PAIR_Z_INDEX,/);
  assert.doesNotMatch(OVERLAY, /zIndex:\s*2147483\d{3}/);
  // A local level inside the page overlay, not a document-wide one.
  assert.ok(pairZ() < 100, `pair ${pairZ()} is a local level inside the page`);
});

test('the pair lives in the page (the viewer tab layer), not in a body portal', () => {
  assert.doesNotMatch(OVERLAY, /createPortal/);
  assert.doesNotMatch(OVERLAY, /document\.body/);
  // Rendered inside the overlay wrapper (the page's CSS px), after the editor.
  const wrapper = OVERLAY.indexOf('ref={wrapperRef}');
  const pair = OVERLAY.indexOf('data-text-edit-actions\n');
  assert.ok(wrapper > -1 && pair > wrapper, 'the pair renders inside the wrapper');
  assert.ok(viewerLayer() >= 1000, 'the viewer tab layer is a stacking context');
});

test('the page layer that holds the pair stays under every desktop chrome host', () => {
  const hostLevels = [...APP_SHELL.matchAll(/id="chrome-(?:top|left|right|sub-toolbar)-host"[\s\S]{0,900}?zIndex: (\d+)/g)]
    .map(([, z]) => Number(z));
  assert.ok(hostLevels.length >= 2, 'found the desktop chrome host levels');
  for (const z of hostLevels) assert.ok(viewerLayer() < z, `page layer ${viewerLayer()} must be under chrome host ${z}`);
});

test('the page layer that holds the pair stays under every phone bar, sheet and backdrop', () => {
  const selectors = [
    '.mobile-pdf-header', '.mobile-pdf-tools', '.mobile-pdf-dock',
    '.mobile-pdf-colorpicker-surface', '.mobile-pdf-colorpicker-backdrop',
    '.mobile-pdf-text-defaults', '.mobile-pdf-sheet-backdrop',
  ];
  for (const selector of selectors) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const levels = [...MOBILE_CSS.matchAll(new RegExp(`${escaped}\\s*\\{[^}]*?z-index: (\\d+)`, 'g'))]
      .map(([, z]) => Number(z))
      .filter((z) => z >= 1000);
    assert.ok(levels.length > 0, `found the top-level z-index of ${selector}`);
    for (const z of levels) assert.ok(viewerLayer() < z, `page layer ${viewerLayer()} must be under ${selector} (${z})`);
  }
});

test('the phone colour sheet and its backdrop opt out of the text editor commit-on-tap', () => {
  const start = CHROME.indexOf('function MobileColorPickerSurface(');
  const body = CHROME.slice(start, CHROME.indexOf('\n}\n', start));
  assert.match(body, /className="mobile-pdf-colorpicker-backdrop"\s+data-rich-text-toolbar/);
  // (2026-09-30: the sheet root now spans several lines - it carries the shared
  // sheet motion props too.)
  assert.match(body, /className="mobile-pdf-colorpicker-surface"\s+data-rich-text-toolbar/);
  // ...and the editor still honours that opt-out.
  assert.match(OVERLAY, /t\.closest\('\[data-rich-text-toolbar\]'\)/);
});
