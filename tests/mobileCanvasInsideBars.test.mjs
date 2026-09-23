import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * RULED 2026-09-23 (owner: phone canvas sits inside the bars). On the phone the
 * PDF scroll area must stop at the top of the bottom dock's painted bar, so the
 * bottom of the last page can be scrolled fully clear of the dock. The header
 * and the tool rail are in normal flow, so only the bottom edge needs a rule.
 *
 * Measured live 2026-09-23 at 390x844: scroller 34..798, dock bar 798..844,
 * last page ends at 795 when scrolled to the end (before, the scroller ran
 * 34..844, the full height under the dock). With a 34px home-indicator inset the scroller ends at 774, exactly
 * where the 70px bar begins.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/mobile/mobilePdfViewer.css');
const shell = read('../src/AppShell.jsx');
const viewer = read('../src/PDFViewer.jsx');

const block = (selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `missing rule for ${selector}`);
  const open = css.indexOf('{', at);
  return css.slice(open + 1, css.indexOf('}', open));
};

test('the dock bar token is the same sum as the painted dock surface', () => {
  const token = /--mobile-dock-bar-height:\s*([^;]+);/.exec(css);
  assert.ok(token, '--mobile-dock-bar-height must be declared');
  const surface = /height:\s*([^;]+);/.exec(block('.mobile-pdf-dock__surface'));
  assert.ok(surface, '.mobile-pdf-dock__surface must declare a height');
  assert.equal(
    token[1].trim(),
    surface[1].trim(),
    'the page area must stop exactly where the painted dock bar begins',
  );
  assert.match(token[1], /var\(--mobile-bottom-inset\)/, 'the inset must track the iOS safe area');
});

test('the phone pdf.js host stops above the dock bar', () => {
  assert.match(
    block('.mobile-pdf-work-area .pdf-engine-host'),
    /bottom:\s*var\(--mobile-dock-bar-height\)\s*!important;/,
  );
});

test('the rule is scoped to the phone shell only', () => {
  // The work-area class only exists while the phone viewer is showing, which
  // is what keeps the tablet and desktop viewers at their full height.
  assert.match(shell, /className=\{isMobileViewer \? 'mobile-pdf-work-area' : undefined\}/);
  assert.match(shell, /const isMobileViewer = Boolean\(isNarrowShell && isViewerVisible\);/);
  // The host the rule targets is the one wrapping the pdf.js scroller.
  assert.match(viewer, /className="pdf-engine-host"[\s\S]{0,200}<PdfjsViewerContainer/);
});
