import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICON_GRID, inkBox, renderer } from './helpers/iconInk.mjs';

const appShell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const sidebar = readFileSync(new URL('../src/PDFSidebar.jsx', import.meta.url), 'utf8');

/*
 * Desktop sweep, 2026-09-17. Three chrome contracts, each measured at 1440x900
 * and 1280x800 in the pane with a document open.
 *
 * 1. A glyph that CSS mirrors must be centred on the grid first. Undo and Redo
 *    are authored off-centre and flipped by `transform: rotate(180deg)
 *    scaleX(-1)`, which put their ink 1.13px LOW in a 34px button - against
 *    Draw at -0.37 and Export at 0.00 in the same row, a 1.5px disagreement
 *    between neighbours. Centred, both now measure 0.00.
 * 2. The Fit control's glyph keeps its square whatever its label does. It is a
 *    flex row of glyph + variable-length label, and an <svg> is a flex item
 *    with flex-shrink 1: at 1280x800 with the label "Manual 88%" the 14x14
 *    glyph rendered 12.34 x 14.00. Now 14.00 x 14.00.
 * 3. The four panel tabs are one control whether the panel is open or closed.
 *    The collapsed rail draws them at RAIL_GLYPH (18) and the expanded strip
 *    drew a literal 16.
 */

const MIRRORED = ['undo', 'redo'];

test('a mirrored arrow is centred on the grid before CSS flips it', () => {
  for (const name of MIRRORED) {
    const box = inkBox(name);
    assert.match(
      renderer(name),
      /transform: 'rotate\(180deg\) scaleX\(-1\)'/,
      `${name} is expected to be the mirrored glyph this contract is about`,
    );
    for (const [axis, centre] of [['x', box.centre[0]], ['y', box.centre[1]]]) {
      assert.ok(
        Math.abs(centre - ICON_GRID / 2) <= 0.05,
        `${name}'s ink centre is ${centre} on ${axis}, not the grid's ${ICON_GRID / 2}. This mark `
        + 'is mirrored by a CSS transform, and a flip about the grid centre only leaves the ink '
        + 'centred if it started centred - otherwise the arrow sits low in its button while every '
        + 'other glyph in the row sits on the centre line.',
      );
    }
  }
});

test('the Fit glyph cannot be squeezed by the label beside it', () => {
  const helper = /const renderFitIcon = \(m, size = \d+\) => \{[\s\S]*?\n  \};/.exec(appShell);
  assert.notEqual(helper, null, 'renderFitIcon not found in AppShell.jsx');
  assert.match(
    helper[0],
    /flexShrink: 0/,
    'the Fit glyph sits in a flex row with a variable-length label, so without flex-shrink: 0 '
    + '(and an explicit min-width, since a flex item\'s min-width is auto) a long label squeezes '
    + 'it horizontally and it stops being square',
  );
  assert.match(helper[0], /minWidth: `\$\{size\}px`/, 'the Fit glyph needs an explicit min-width');
});

test('the Fit menu is the same kind of menu as its two siblings', () => {
  const menu = /const fitMenu = \(anchorStyle\) => \([\s\S]*?\n              \);/.exec(appShell);
  assert.notEqual(menu, null, 'fitMenu not found in AppShell.jsx');
  assert.match(menu[0], /minHeight: 'var\(--chrome-menu-row-h\)'/, 'its rows take the shared row height');
  assert.match(menu[0], /renderFitIcon\(option\.id, RAIL_CONTROL_GLYPH\)/, 'its glyph is the token, not a literal');
  assert.match(menu[0], /borderRadius: 'var\(--chrome-radius\)'/, 'its container takes the shared radius');
  assert.doesNotMatch(menu[0], /padding: '6px 8px'/, 'its row inset matches the other menus (4px 9px)');
});

test('the panel tabs are one glyph size, open or collapsed', () => {
  assert.match(
    sidebar,
    /size=\{mobileMode \? 16 : RAIL_GLYPH\}/,
    'the expanded tab strip draws the same four tabs as the collapsed rail, so on the desktop it '
    + 'takes the same RAIL_GLYPH; the phone keeps its own tier\'s 16',
  );
  assert.match(
    sidebar,
    /padding: mobileMode \? '10px 2px' : '9px 2px'/,
    'the desktop tab pads 1px less top and bottom, so the 2px the glyph gained does not make the '
    + 'tab strip taller and push the panel\'s content down',
  );
});
