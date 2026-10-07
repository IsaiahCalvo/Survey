// Owner 2026-10-02 ("too loud and bulky ... can they almost fit within the pill
// of the page navigation and then the dropdown, as if it grew out of that"):
// the phone zoom menu grows out of the page pill. Owner 2026-10-02 (later):
// desktop keeps its original footer zoom controls.
// Owner 2026-10-02 (second verdict on the phone): "I want zoom to be in the
// dropdown. Put the chevron back and put the numbers between the minus and
// plus." And: the open is okay, "in reverse it's not. It needs to be
// smoother." So the pill is the page reading + chevron again, the live % sits
// between - and + in the attached menu, and the close is the open's mirror.
// Owner 2026-10-02 (third verdict, on f61671d's 124px menu under a 96px pill):
// "the dropdown doesn't look integrated with the page navigation and chevron.
// It's bigger than it. You had it working before. Put it back." So the menu is
// EXACTLY the pill's width, edges flush; where its rows need more than the
// fraction's 96px, the PILL widens to them, so the two are always equal.
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

  // DELIBERATE ASSERTION CHANGE (2026-10-02, third verdict - see the header):
  // this pinned a menu centred under the pill (left 50% + translateX(-50%)) and
  // wider than it (max-content, 124px under 96). It now pins the menu to the
  // pill's exact border box - left -1px, 100% + 2px wide, nothing wider - with
  // the pill's bottom border as the hairline and only its bottom corners round.
  const menu = block(phoneCss, '.mobile-pdf-header__zoom-menu');
  assert.match(menu, /top: calc\(100% \+ 1px\)/, 'starts right under the pill\'s bottom border');
  assert.match(menu, /left: -1px;/, 'its left edge is the pill\'s left edge');
  assert.match(menu, /width: calc\(100% \+ 2px\);/, 'exactly the pill\'s border-box width');
  assert.doesNotMatch(menu, /max-content|min-width|translateX|left: 50%/, 'never wider than, or centred under, the pill');
  assert.match(menu, /border-top: 0;/, 'the pill\'s bottom border is the hairline');
  assert.match(menu, /background: var\(--panel-bg\)/, 'same surface as the pill');
  assert.match(menu, /border-radius: 0 0 10px 10px/, 'the pill\'s radius, on the bottom corners only');

  // The pill is the wider of what the fraction needs and what the menu's rows
  // need, so the menu (the pill's width) always fits its rows.
  const root = block(phoneCss, ':root');
  assert.match(root, /--mobile-page-menu-w: 112px;/);
  assert.match(root, /--mobile-page-pill-w: max\(calc\(var\(--mobile-page-pill-text\) \+ var\(--mobile-page-pill-chrome\) \+ var\(--mobile-page-pill-slack\)\), var\(--mobile-page-menu-w\)\);/);
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
  // DELIBERATE ASSERTION CHANGE (2026-10-02): the slot was a fixed 54px that
  // set a 124px menu. The menu is now the pill's fixed width, so the reading
  // fills what is left between the steppers (48px at 112) - still fixed, so
  // nothing moves from 1% to 4000% - and a width can no longer push the menu
  // out past the pill.
  assert.match(reading, /flex: 1 1 0;/, 'fills the fixed space between the steppers');
  assert.doesNotMatch(reading, /^\s*width:/m, 'no width of its own that could widen the menu');
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
  // It starts and ends as a zero-tall strip along the pill's bottom edge. The
  // menu is the pill's width, so there is no sideways growth to mirror any
  // more (DELIBERATE ASSERTION CHANGE 2026-10-02: this pinned the clip that
  // widened a 124px menu out of the 96px pill).
  assert.match(closed, /clip-path: inset\(0 -24px 100% -24px\)/);
  assert.match(block(phoneCss, '.mobile-pdf-header__zoom-menu > *'), /transform 180ms cubic-bezier\(1, 0, 0\.8, 1\)/);
  assert.match(block(phoneCss, '.mobile-pdf-header__zoom-menu.is-open > *'), /transform 180ms cubic-bezier\(0\.2, 0, 0, 1\)/);
  // The pill's bottom corners square at once on open and round only at the
  // close's end.
  assert.match(block(phoneCss, '.mobile-pdf-header__page-pill'), /transition: border-radius 0s linear 180ms/);
  assert.match(block(phoneCss, '.mobile-pdf-header__page-pill.is-zoom-open'), /transition: border-radius 0s;/);
  assert.match(phoneCss, /prefers-reduced-motion: reduce\) \{\s*\.mobile-pdf-header__zoom-menu,\s*\.mobile-pdf-header__zoom-menu\.is-open,\s*\.mobile-pdf-header__zoom-menu > \*,\s*\.mobile-pdf-header__page-pill \{\s*transition: visibility 0s !important;/);
});
