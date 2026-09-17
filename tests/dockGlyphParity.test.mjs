import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ICON_GRID, inkBox } from './helpers/iconInk.mjs';

const chrome = readFileSync(new URL('../src/mobile/MobilePdfViewerChrome.jsx', import.meta.url), 'utf8');

/*
 * UX contract (owner ruling 2026-09-17): "Survey vs Spaces - make their glyph
 * ink extents and optical weight match (same box, same ink extent within 1px,
 * house stroke), from the shared icon set."
 *
 * The two sit at opposite ends of the phone's bottom dock as two identical 30px
 * circles, so a size difference between the marks is unmissable. Survey was
 * drawn to a smaller box than the set: r 9 gave it 19.5 of the 24 grid where
 * layers (Spaces) is 21.5, Text 21.5 and Draw 20.5. Measured in the pane at the
 * 17px dock glyph: Spaces ink 15.23 x 15.22px, Survey 13.81 x 13.81px - 1.42px
 * short in both axes, -9.3%. Rasterised at 170px, Survey covered 20.58% of its
 * box against Spaces' 23.83%, 13.6% less ink. After r 9 -> r 10 and the two
 * inner bars widening with it: Survey 15.23 x 15.23px and 23.79% coverage,
 * against Spaces' 15.23 x 15.22px and 23.83%.
 */

const HOUSE_STROKE = 1.5;
// The set's own spread, measured 2026-09-17: Draw 20.5, Shapes 20.41,
// layers 21.5, Text 21.5, against ICON_INK_ENVELOPE = 20.
const SET_INK_BAND = [20, 22];

const DOCK_GLYPH = Number(/const DOCK_GLYPH = (\d+);/.exec(chrome)?.[1]);

test('the dock glyph size is the one this parity is measured at', () => {
  assert.equal(Number.isFinite(DOCK_GLYPH), true, 'DOCK_GLYPH not found in MobilePdfViewerChrome.jsx');
});

test('Survey and Spaces have the same ink extent, within 1px at the dock size', () => {
  const spaces = inkBox('layers');
  const survey = inkBox('survey');
  const perUnit = DOCK_GLYPH / ICON_GRID;

  for (const axis of ['width', 'height']) {
    const deltaPx = Math.abs(survey[axis] - spaces[axis]) * perUnit;
    assert.ok(
      deltaPx <= 1,
      `Survey's ink is ${survey[axis]} of the 24 grid and Spaces' is ${spaces[axis]} (${axis}), `
      + `which is ${deltaPx.toFixed(2)}px apart at the ${DOCK_GLYPH}px dock glyph. They sit at `
      + 'opposite ends of the same bar as two identical circles; the owner ruled on 2026-09-17 '
      + 'that they match within 1px.',
    );
  }
});

test('both marks are centred on the grid and drawn at the house stroke', () => {
  for (const name of ['layers', 'survey']) {
    const box = inkBox(name);
    assert.equal(box.viewBox, `0 0 ${ICON_GRID} ${ICON_GRID}`, `${name} must be drawn on the house grid`);
    for (const value of box.strokes) {
      assert.equal(value, HOUSE_STROKE, `${name} draws a ${value} stroke, not the house ${HOUSE_STROKE}`);
    }
    for (const [axis, centre] of [['x', box.centre[0]], ['y', box.centre[1]]]) {
      assert.ok(
        Math.abs(centre - ICON_GRID / 2) <= 0.05,
        `${name}'s ink centre is ${centre} on ${axis}, not the grid's ${ICON_GRID / 2}: the glyph `
        + 'would sit off-centre in its button',
      );
    }
  }
});

test('neither mark drifts outside the set\'s own ink band', () => {
  const [low, high] = SET_INK_BAND;
  for (const name of ['layers', 'survey']) {
    const box = inkBox(name);
    for (const axis of ['width', 'height']) {
      assert.ok(
        box[axis] >= low && box[axis] <= high,
        `${name}'s ink spans ${box[axis]} of the 24 grid on ${axis}, outside the ${low}..${high} `
        + 'the rest of the set occupies (ICON_INK_ENVELOPE is 20)',
      );
    }
  }
});
