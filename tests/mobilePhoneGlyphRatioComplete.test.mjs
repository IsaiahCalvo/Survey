import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * Adversarial verification, 2026-09-16 (verify-r3-ios).
 *
 * tests/mobilePhoneSizing.test.mjs pins four phone tiers to one glyph:control
 * ratio and its own comment states the contract: "0.55-0.60 of the chip on
 * every tier ... Rail 17-in-30, sub-tool 14-in-24, header 15-in-26, dock
 * 17-in-30 - one ratio, all four tiers."
 *
 * That test only checks the four constants it already knows about, so it cannot
 * see a phone control that opts out of the system. The zoom steppers, which the
 * same 2026-09-16 phone pass ADDED ("phone reach pass": minus / live percentage
 * / plus in the header zoom menu), are exactly that control: a hard-coded 34px
 * square - a fifth control height that is not one of the five size tokens -
 * carrying a 15px glyph. 15 / 34 = 0.441, well outside 0.55-0.60, and visibly
 * lighter than the 17-in-30 (0.567) rail and dock chips it sits above.
 *
 * Verified in the iOS Simulator on a booted iPhone 17 Pro (iOS 26.5) against
 * claude/ux-polish @ 4d0c3b0d5: the menu opens from the header page chevron and
 * the minus / plus buttons step the zoom (54% -> 68% -> 54%), so these are real
 * tappable controls on the phone, not decoration.
 *
 * This test states the contract the sizing pass claims, over every phone
 * control that carries a glyph. It FAILS on claude/ux-polish.
 */

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('../src/mobile/mobilePdfViewer.css');
const chrome = read('../src/mobile/MobilePdfViewerChrome.jsx');

const RATIO_MIN = 0.55;
// RULED CHANGE 2026-09-21 (pass 7, boards 1-7). The ceiling is 0.61, not 0.60.
// The approved boards fix BOTH numbers on the rail and header tiers - a 17px
// glyph in a 28px chip - which is 0.607. The band still does its job: it catches
// a glyph drawn at two thirds of its box (0.67), which is what it was written
// for, and every tier still sits inside one narrow band.
const RATIO_MAX = 0.61;

// Pull one declaration block so a size assertion cannot be satisfied by an
// unrelated rule elsewhere in the sheet.
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

const pxValue = (declarations, property) => {
  const match = declarations.match(new RegExp(`(?:^|;|\\n)\\s*${property}\\s*:\\s*(\\d+)px`));
  assert.notEqual(match, null, `expected a literal px ${property} in: ${declarations.trim()}`);
  return Number(match[1]);
};

// `size={15}` or `size={HEADER_GLYPH}`. Resolving a named constant as well as a
// literal is what lets the glyph read its tier's token instead of repeating the
// number - the ratio this file asserts is unchanged either way, and a control
// that names a constant can no longer slip past the check.
const glyphSizeInside = (source, marker, iconName) => {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `missing marker ${marker}`);
  const window = source.slice(at, at + 2000);
  const match = window.match(new RegExp(`<Icon name="${iconName}" size=\\{(\\d+|[A-Z][A-Z0-9_]*)\\}`));
  assert.notEqual(match, null, `missing <Icon name="${iconName}" size={n}> after ${marker}`);
  if (/^\d+$/.test(match[1])) return Number(match[1]);
  const constant = source.match(new RegExp(`const ${match[1]} = (\\d+);`));
  assert.notEqual(constant, null, `missing const ${match[1]} for ${iconName} after ${marker}`);
  return Number(constant[1]);
};

const PHONE_SIZE_TOKENS = [
  '--mobile-rail-chip',
  '--mobile-rail-sub-chip',
  '--mobile-control-h',
  '--mobile-strip-control-h',
  '--mobile-dock-control-h',
];

test('the zoom steppers take a phone size token, not a hard-coded square', () => {
  const root = block(css, ':root');
  const tokens = PHONE_SIZE_TOKENS.map((token) => pxValue(root, token));
  const height = pxValue(block(css, '.mobile-pdf-header__zoom-steppers > button'), 'height');

  assert.ok(
    tokens.includes(height),
    `the zoom stepper is ${height}px, which is not one of the phone size tokens `
    + `${tokens.join('/')}px - the sizing pass says "no control invents its own size"`,
  );
});

test('every phone control that carries a glyph holds one glyph:control ratio', () => {
  const root = block(css, ':root');
  const stepper = pxValue(block(css, '.mobile-pdf-header__zoom-steppers > button'), 'height');
  const constant = (name) => {
    const match = chrome.match(new RegExp(`const ${name} = (\\d+);`));
    assert.notEqual(match, null, `missing const ${name}`);
    return Number(match[1]);
  };

  const rows = [
    { name: 'rail chip', control: pxValue(root, '--mobile-rail-chip'), glyph: constant('RAIL_GLYPH') },
    { name: 'sub-tool chip', control: pxValue(root, '--mobile-rail-sub-chip'), glyph: constant('SUBTOOL_GLYPH') },
    { name: 'header control', control: pxValue(root, '--mobile-control-h'), glyph: constant('HEADER_GLYPH') },
    { name: 'strip control', control: pxValue(root, '--mobile-strip-control-h'), glyph: constant('STRIP_GLYPH') },
    { name: 'zoom stepper (minus)', control: stepper, glyph: glyphSizeInside(chrome, 'aria-label="Zoom out"', 'minus') },
    { name: 'zoom stepper (plus)', control: stepper, glyph: glyphSizeInside(chrome, 'aria-label="Zoom in"', 'plus') },
  ];

  const offenders = rows
    .map((row) => ({ ...row, ratio: row.glyph / row.control }))
    .filter((row) => row.ratio < RATIO_MIN || row.ratio > RATIO_MAX)
    .map((row) => `${row.name}: ${row.glyph}-in-${row.control} = ${row.ratio.toFixed(3)}`);

  assert.deepEqual(
    offenders,
    [],
    `phone controls outside the ${RATIO_MIN}-${RATIO_MAX} glyph:control band - ${offenders.join('; ')}`,
  );
});

test('the dock draws its glyphs larger than the band, by owner ruling', () => {
  // RULED CHANGE 2026-10-01 (owner, iPhone): "The icons for pages, search, and
  // bookmarks, I would prefer them to be bigger. I don't want the actual row
  // that they're in to grow", then "make the Spaces and Survey dock icons
  // match too". Every dock glyph is 20-in-30 (0.667), above the band the other
  // tiers keep; the control itself is unchanged.
  const root = block(css, ':root');
  const control = pxValue(root, '--mobile-dock-control-h');
  const constant = (name) => Number(chrome.match(new RegExp(`const ${name} = (\\d+);`))?.[1]);
  assert.equal(constant('DOCK_GLYPH'), 20);
  assert.equal(constant('DOCK_HUB_GLYPH'), 20);
  assert.equal(control, 30);
});
