// Owner 2026-10-02 ("too loud and bulky ... can they almost fit within the pill
// of the page navigation and then the dropdown, as if it grew out of that"):
// the phone zoom menu grows out of the page pill. Owner 2026-10-02 (later):
// desktop keeps its original footer zoom controls.
// Owner 2026-10-02 (second verdict on the phone): "I want zoom to be in the
// dropdown. Put the chevron back and put the numbers between the minus and
// plus." And: the open is okay, "in reverse it's not. It needs to be
// smoother." So the pill is the page reading + chevron again, the live % sits
// between - and + in the attached menu, and the close is the open's mirror.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const chrome = read('../src/mobile/MobilePdfViewerChrome.jsx');
const phoneCss = read('../src/mobile/mobilePdfViewer.css');
const block = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `missing ${selector}`);
  return css.slice(at, css.indexOf('}', at));
};

test('phone: the pill is the page reading and the chevron; the menu hangs off the pill', () => {
  const pillStart = chrome.indexOf('mobile-pdf-header__page-pill${');
  const nextPage = chrome.indexOf('aria-label="Next page"', pillStart);
  const pill = chrome.slice(pillStart, nextPage);
  assert.match(pill, /className="mobile-pdf-header__page-chevron"[\s\S]{0,200}onClick=\{toggleZoom\}/);
  assert.match(pill, /<Icon name="chevronDown" size=\{11\}/);
  assert.match(pill, /mobile-pdf-header__zoom-menu/, 'the menu is a child of the pill');
  assert.doesNotMatch(chrome, /mobile-pdf-header__zoom-readout/, 'no zoom % segment in the pill');
  assert.doesNotMatch(phoneCss, /zoom-readout|--mobile-page-zoom-w/);

  const menu = block(phoneCss, '.mobile-pdf-header__zoom-menu');
  assert.match(menu, /top: 100%/, 'its top border lies on the pill\'s bottom border');
  assert.match(menu, /left: 50%/);
  assert.match(menu, /transform: translateX\(-50%\)/, 'centred under the pill');
  assert.match(menu, /background: var\(--surface-1\)/, 'same surface as the pill');
  assert.match(menu, /border-radius: 10px/, 'same radius as the pill');
  assert.match(block(phoneCss, '.mobile-pdf-header__zoom-fits > button'), /font: var\(--sheet-row-text\)/);
  assert.doesNotMatch(block(phoneCss, '.mobile-pdf-header__zoom-fits > button.is-active'), /accent/, 'no gold');
});

test('phone: the live zoom % sits between minus and plus, quiet and tabular', () => {
  const steppers = chrome.slice(
    chrome.indexOf('className="mobile-pdf-header__zoom-steppers"'),
    chrome.indexOf('className="mobile-pdf-header__zoom-fits"'),
  );
  const out = steppers.indexOf('aria-label="Zoom out"');
  const pct = steppers.indexOf('className="mobile-pdf-header__zoom-percent"');
  const inn = steppers.indexOf('aria-label="Zoom in"');
  assert.ok(out >= 0 && pct > out && inn > pct, 'order is [-] 53% [+]');
  assert.match(steppers, /\{`\$\{zoomPercent\}%`\}/);

  const reading = block(phoneCss, '.mobile-pdf-header__zoom-percent');
  assert.match(reading, /font: var\(--sheet-row-text\)/, 'same quiet face as the fit rows');
  assert.match(reading, /font-variant-numeric: tabular-nums/, 'digits do not jiggle');
  assert.match(reading, /text-align: center/);
  assert.match(reading, /width: 54px/, 'a fixed slot, so the steppers and menu never move');
  assert.doesNotMatch(reading, /accent/, 'no gold');
  assert.match(block(phoneCss, '.mobile-pdf-header__zoom-steppers'), /justify-content: space-between/);
});

test('phone: the close is the open played backwards', () => {
  const closed = block(phoneCss, '.mobile-pdf-header__zoom-menu');
  const open = block(phoneCss, '.mobile-pdf-header__zoom-menu.is-open');
  // Open: clip 180ms ease-out, fade over the first 80ms.
  assert.match(open, /clip-path 180ms cubic-bezier\(0\.2, 0, 0, 1\)/);
  assert.match(open, /opacity 80ms linear,/);
  // Close: same properties, same 180ms, the curve reflected through its centre
  // ((x1, y1, x2, y2) -> (1 - x2, 1 - y2, 1 - x1, 1 - y1)), the fade over the
  // LAST 80ms, and the menu stays visible until the motion has ended.
  assert.match(closed, /clip-path 180ms cubic-bezier\(1, 0, 0\.8, 1\)/);
  assert.match(closed, /opacity 80ms linear 100ms/);
  assert.match(closed, /visibility 0s linear 180ms/);
  // It starts and ends as exactly the pill's footprint, so the width grows out
  // of the pill and folds back into it.
  assert.match(closed, /clip-path: inset\(0 calc\(50% - \(var\(--mobile-page-pill-w\) \/ 2\)\) 100% calc\(50% - \(var\(--mobile-page-pill-w\) \/ 2\)\)\)/);
  assert.match(block(phoneCss, '.mobile-pdf-header__zoom-menu > *'), /transform 180ms cubic-bezier\(1, 0, 0\.8, 1\)/);
  assert.match(block(phoneCss, '.mobile-pdf-header__zoom-menu.is-open > *'), /transform 180ms cubic-bezier\(0\.2, 0, 0, 1\)/);
  // The pill's bottom corners square at once on open and round only at the
  // close's end.
  assert.match(block(phoneCss, '.mobile-pdf-header__page-pill'), /transition: border-radius 0s linear 180ms/);
  assert.match(block(phoneCss, '.mobile-pdf-header__page-pill.is-zoom-open'), /transition: border-radius 0s;/);
  assert.match(phoneCss, /prefers-reduced-motion: reduce\) \{\s*\.mobile-pdf-header__zoom-menu,\s*\.mobile-pdf-header__zoom-menu\.is-open,\s*\.mobile-pdf-header__zoom-menu > \*,\s*\.mobile-pdf-header__page-pill \{\s*transition: visibility 0s !important;/);
});
