// Owner 2026-10-02 ("too loud and bulky ... can they almost fit within the pill
// of the page navigation and then the dropdown, as if it grew out of that"):
// the zoom reading is a segment of the page pill and its menu grows out of the
// pill, on the phone header and in the desktop rail footer alike.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const chrome = read('../src/mobile/MobilePdfViewerChrome.jsx');
const phoneCss = read('../src/mobile/mobilePdfViewer.css');
const appShell = read('../src/AppShell.jsx');
const styles = read('../src/styles.css');
const block = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `missing ${selector}`);
  return css.slice(at, css.indexOf('}', at));
};

test('phone: the zoom reading is the pill\'s segment and the menu hangs off the pill', () => {
  const pillStart = chrome.indexOf('mobile-pdf-header__page-pill${');
  const nextPage = chrome.indexOf('aria-label="Next page"', pillStart);
  const pill = chrome.slice(pillStart, nextPage);
  assert.match(pill, /className="mobile-pdf-header__zoom-readout"/);
  assert.match(pill, /mobile-pdf-header__zoom-percent/);
  assert.match(pill, /mobile-pdf-header__zoom-menu/, 'the menu is a child of the pill');
  assert.doesNotMatch(chrome, /mobile-pdf-header__page-chevron/, 'the bare chevron is gone');

  const menu = block(phoneCss, '.mobile-pdf-header__zoom-menu');
  assert.match(menu, /top: calc\(100% \+ 1px\)/);
  assert.match(menu, /left: -1px/);
  assert.match(menu, /background: var\(--surface-1\)/, 'same surface as the pill');
  assert.match(menu, /border-radius: 0 0 10px 10px/, 'same radius as the pill');
  assert.match(block(phoneCss, '.mobile-pdf-header__zoom-menu.is-open'), /clip-path 180ms/);
  assert.match(block(phoneCss, '.mobile-pdf-header__zoom-fits > button'), /font: var\(--sheet-row-text\)/);
  assert.doesNotMatch(block(phoneCss, '.mobile-pdf-header__zoom-fits > button.is-active'), /accent/, 'no gold');
  assert.doesNotMatch(block(phoneCss, '.mobile-pdf-header__zoom-readout'), /accent/, 'no gold');
  assert.match(phoneCss, /prefers-reduced-motion: reduce\) \{\s*\.mobile-pdf-header__zoom-menu,/);
});

test('desktop: the expanded rail footer is one page + zoom pill with a menu growing out of it', () => {
  const start = appShell.indexOf('const footerRow = (');
  const row = appShell.slice(start, appShell.indexOf('return createPortal(footerRow, railPanelEl);', start));
  assert.match(row, /ref=\{api\.zoomMenuRef\} data-zoom-pill="true" className=\{`rail-zoom-pill/);
  assert.match(row, /className="rail-zoom-pill__zoom"[\s\S]{0,80}onClick=\{api\.toggleZoomMenu\}/);
  // Every zoom action is still there, now inside the menu.
  for (const call of ['api.zoomOut', 'api.zoomIn', 'api.handleZoomModeSelect(option.id)', 'api.goToPreviousPage', 'api.goToNextPage']) {
    assert.ok(row.includes(call), `${call} is wired`);
  }
  assert.match(row, /\{zoomValue\}/, 'the typed zoom field is in the menu');
  assert.match(row, /<DismissBarrier active=\{zoomMenuOpen\}/);
  const menu = block(styles, '.rail-zoom-menu');
  assert.match(menu, /bottom: calc\(100% \+ 1px\)/);
  assert.match(menu, /background: var\(--surface-1\)/);
  assert.match(menu, /border-radius: 10px 10px 0 0/);
  assert.match(block(styles, '.rail-zoom-menu__row'), /min-height: var\(--menu-item-h\)/);
  assert.match(block(styles, '.rail-zoom-menu__row'), /font: 400 12px/);
  assert.doesNotMatch(block(styles, '.rail-zoom-pill__zoom'), /accent/);
  assert.match(styles, /prefers-reduced-motion: reduce\) \{\s*\.rail-zoom-pill,/);
});
