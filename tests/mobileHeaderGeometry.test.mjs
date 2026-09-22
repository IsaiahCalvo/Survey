import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { assetInk, ICON_GRID } from './helpers/iconInk.mjs';
import { pxToken } from './helpers/cssTokens.mjs';

/*
 * Phone header + rich-text strip geometry (owner, 2026-09-17, testing the phone
 * build): "the top bar just looks off. Bold, italics, underline and
 * strikethrough don't look centred in their buttons. The page navigation,
 * '2 / 99', doesn't fit properly; it needs to fit 3 digits, a slash, and 3
 * digits perfectly."
 *
 * Both faults were real and both are measured here rather than eyeballed:
 *   - the 68px page pill WRAPPED on a 99-page document; "/ 99" broke after the
 *     slash and painted two 11px lines inside a 26px control, and
 *   - the four format buttons were plain blocks, so their icons sat on a text
 *     baseline 1.5px above the button's centre, in four different glyph boxes
 *     at four different optical sizes (ink 9.89..12.05px tall at one requested
 *     glyph size).
 *
 * What these tests guard is the RULE behind each fix - the pill is sized from
 * the widest string it can ever show, and one square envelope carries all four
 * letterforms - not the particular pixel that rule happens to produce today.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/mobile/mobilePdfViewer.css');
const icons = read('../src/Icons.jsx');

const block = (source, selector, skip = 0) => {
  let at = -1;
  for (let i = 0; i <= skip; i += 1) {
    at = source.indexOf(`${selector} {`, at + 1);
    assert.notEqual(at, -1, `missing rule ${skip ? `#${skip + 1} ` : ''}for ${selector}`);
  }
  const open = source.indexOf('{', at);
  const close = source.indexOf('}', open);
  return source.slice(open + 1, close);
};

/** Resolve a size token the same way the browser does - see the helper. */
const token = (source, name) => pxToken(source, name);

test('the page pill is sized from "999 / 999", not from the document in front of it', () => {
  const root = block(css, ':root');

  /*
   * DELIBERATE ASSERTION CHANGE (2026-09-22, owner: "the page pill looks too
   * large"). The pill's face drops from 800 to the strip's 600, so the three
   * faces it is measured from are narrower. The RULE is unchanged and is what
   * this test still guards - the pill is sized from "999 / 999" in whatever
   * face it wears, never from the document in front of it. Only the measured
   * metrics move:  digit 7.602 -> 7.286,  slash 3.852 -> 3.531,
   * space 2.82 -> 2.875.
   */
  // The faces the pill's text is made of, measured in the pill's own font
  // (SF Pro Text 600 11px, tabular numerals, -0.01em) in the browser at both
  // 375 and 390 wide. Tabular numerals are what make one digit width enough
  // for all ten.
  const digit = token(root, '--mobile-page-digit-w');
  const SLASH = 3.531;
  const SPACE = 2.875;
  const FLEX_GAP = 2; // between the ordinal and the "/ N" span
  assert.match(root, new RegExp(`--mobile-page-pill-text:[^;]*${SLASH}px`));
  assert.match(root, new RegExp(`--mobile-page-pill-text:[^;]*${SPACE}px`));

  // The editing state is the wider of the two, so it is the one that sizes the
  // pill: the ordinal becomes a 3-digit input carrying half a pixel over its
  // own digits so rounding cannot shave the last one.
  const input = token(root, '--mobile-page-input-w');
  // Compared with a tolerance, not exactly: 3 * 7.286 + 0.5 is 22.357999999999997
  // in IEEE doubles while the token resolver rounds to 22.358, and the contract
  // is "three digits plus half a pixel", not a float's last bit.
  assert.ok(
    Math.abs(input - ((3 * digit) + 0.5)) < 1e-6,
    `the page input holds three tabular digits (got ${input}, expected ${(3 * digit) + 0.5})`,
  );
  assert.match(block(css, '.mobile-pdf-header__page-input'), /width: var\(--mobile-page-input-w\)/);

  const displayState = (3 * digit) + FLEX_GAP + SLASH + SPACE + (3 * digit); // "999 / 999"
  const editState = input + FLEX_GAP + SLASH + SPACE + (3 * digit);
  assert.ok(editState > displayState, 'the input state is the wider of the two');

  /*
   * DELIBERATE ASSERTION CHANGE (2026-09-22, owner: "the chevron is not centred
   * in its section"). The chevron zone goes to the board's 24 and the pill's own
   * padding drops to 3 a side, so the two cancel: the chrome total is the same
   * 40px, which is why the centred page cluster does not move. The sum is spelt
   * out with the new parts rather than the old ones.
   */
  // Chrome around the text: the fraction's 6px of padding, the pill's 2px flex
  // gap, the 24px chevron zone, the pill's 6px padding and 2px of border.
  const chrome = token(root, '--mobile-page-pill-chrome');
  assert.equal(chrome, 6 + 2 + 24 + 6 + 2);

  const slack = token(root, '--mobile-page-pill-slack');
  const pill = +(editState + chrome + slack).toFixed(6);
  assert.equal(pill, Math.round(pill), 'the pill lands on a whole pixel');
  assert.ok(pill >= displayState + chrome + 1, '"999 / 999" fits with a pixel to spare');
  assert.ok(slack >= 1, 'a pixel of headroom for metric drift between WebKit and Blink');

  // The pill reads the token twice: a width that is right, and a min-width that
  // a flex parent cannot squeeze back into a wrap.
  const pillRule = block(css, '.mobile-pdf-header__page-pill');
  assert.match(pillRule, /width: var\(--mobile-page-pill-w\)/);
  assert.match(pillRule, /min-width: var\(--mobile-page-pill-w\)/);
  assert.doesNotMatch(pillRule, /width: 68px/, 'the 68px pill that wrapped is gone');

  // Belt as well as braces: neither half of the fraction may break a line.
  assert.match(block(css, '.mobile-pdf-header__page-frac'), /white-space: nowrap/);
  assert.match(block(css, '.mobile-pdf-header__page-total'), /white-space: nowrap/);
});

test('the title cap follows the page cluster instead of naming a pixel', () => {
  const root = block(css, ':root');
  // prev + gap + pill + gap + next.
  assert.match(
    root,
    /--mobile-page-cluster-w: calc\(\(2 \* var\(--mobile-control-h\)\) \+ 4px \+ var\(--mobile-page-pill-w\)\)/,
  );

  // The cluster is centred, the title group starts at 7px, and it keeps a 7px
  // gutter before the cluster's left edge: 50% - (cluster / 2 + 14).
  const documentGroup = block(css, '.mobile-pdf-header__document');
  assert.match(documentGroup, /left: 7px/);
  assert.match(documentGroup, /max-width: calc\(50% - \(var\(--mobile-page-cluster-w\) \/ 2 \+ 14px\)\)/);
  // The old literal was correct only for a 124px cluster; a wider pill slid the
  // page chevron under the title.
  assert.doesNotMatch(css, /max-width: calc\(50% - 76px\)/);
});

test('every text-format glyph sits on one square envelope, centred on the grid', () => {
  const ENVELOPE = 20;
  for (const name of ['text-bold', 'text-italic', 'text-underline', 'text-strikethrough']) {
    const ink = assetInk(new URL(`../src/assets/icons/${name}.svg`, import.meta.url));
    assert.ok(ink.square, `${name}: the viewBox must be square so a square glyph box fits it exactly`);
    // Ink dead centre on the 24 grid - this is the "not centred in their
    // buttons" the owner saw, measured at the source.
    assert.ok(Math.abs(ink.centre[0] - ICON_GRID / 2) <= 0.01, `${name}: ink centre x ${ink.centre[0]}`);
    assert.ok(Math.abs(ink.centre[1] - ICON_GRID / 2) <= 0.01, `${name}: ink centre y ${ink.centre[1]}`);
    // One optical size: every one of the four is exactly 20 units tall.
    assert.ok(Math.abs(ink.height - ENVELOPE) <= 0.01, `${name}: ink height ${ink.height}`);
    assert.ok(ink.width <= ENVELOPE + 0.01, `${name}: ink width ${ink.width} overflows the envelope`);
  }

  // With a square, centred asset a square box is the correct box, so the four
  // per-icon width factors are gone. Reintroducing one puts the row back to
  // four different glyph boxes.
  for (const renderer of ['formatBold', 'formatItalic', 'formatUnderline', 'formatStrikethrough']) {
    assert.match(
      icons,
      new RegExp(`${renderer}: \\(size, color, style, className\\) => renderMaskIcon\\(\\w+, size, color, style, className\\),`),
    );
  }
  for (const url of ['textBoldUrl', 'textItalicUrl', 'textUnderlineUrl', 'textStrikethroughUrl']) {
    assert.doesNotMatch(icons, new RegExp(`renderMaskIcon\\(${url}[^)]*size \\* `));
  }
});

test('every icon button in the header and the rich-text strip centres its glyph on its box', () => {
  // A block button lays its icon out as inline content on a text baseline, so
  // the font's descender - not the box - decides where the glyph lands. Grid
  // with place-items: center has no font metric in the sum.
  for (const selector of [
    '.mobile-pdf-header__icon',
    '.mobile-pdf-header__page-nav',
    '.mobile-pdf-header__page-chevron',
    '.mobile-pdf-properties__format',
    /* RULED CHANGE 2026-09-22: the "Aa" sheet's own copy of B / I / U / S is gone.
       The rebuilt sheet reuses the strip's .mobile-pdf-properties__format group,
       one line above, so there is one rule to centre instead of two. */
  ]) {
    const rule = block(css, selector);
    assert.match(rule, /display: grid/, `${selector} must centre geometrically`);
    assert.match(rule, /place-items: center/, `${selector} must centre geometrically`);
  }

  // The chevron carries a 1px border-left, which is part of its box: an even
  // 5/5 padding centres the caret on the CONTENT box and leaves it 0.5px right
  // of the button the user sees. With the 4/5 split and the board's 24px
  // section, the 11px caret's centre lands on 12 - the section's own centre.
  const chevron = block(css, '.mobile-pdf-header__page-chevron');
  assert.match(chevron, /border-left: 1px solid/);
  assert.match(chevron, /padding: 0 5px 0 4px/);
  const chevronWidth = Number(/min-width:\s*(\d+(?:\.\d+)?)px/.exec(chevron)?.[1]);
  assert.equal(chevronWidth, 24, 'board 1-pen draws the zoom section 24px wide');
  const CARET = 11;
  const caretCentre = 1 + 4 + ((chevronWidth - 1 - 4 - 5) - CARET) / 2 + CARET / 2;
  assert.equal(
    caretCentre,
    chevronWidth / 2,
    `the caret's centre sits at ${caretCentre}px in a ${chevronWidth}px section, not on its centre line`,
  );

  // One box and one radius across the four format buttons - they share a single
  // rule, so there is nowhere for a fifth size to hide.
  // RULED CHANGE 2026-09-22 (the strip must fit at 375px): the four are the strip's
  // own control width, not 28px. Four 28px chips 4px apart are 124px of a 331px
  // band, which is what pushed the live text bar's alignment control off the right
  // edge of every phone we support; at 20px in one group they are 80px.
  const format = block(css, '.mobile-pdf-properties__format');
  assert.match(format, /width: var\(--mobile-strip-control-h\)/);
  assert.match(format, /height: var\(--mobile-strip-control-h\)/);
  assert.match(format, /border-radius: 5px/);
});
