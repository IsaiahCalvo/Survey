import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const icons = readFileSync(new URL('../src/Icons.jsx', import.meta.url), 'utf8');
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
 *
 * The ink extent here is the geometric bounding box plus half the stroke on
 * each side - the same thing getBBox + strokeWidth/2 measures in the browser.
 */

const GRID = 24;
const HOUSE_STROKE = 1.5;
// The set's own spread, measured 2026-09-17: Draw 20.5, Shapes 20.41,
// layers 21.5, Text 21.5, against ICON_INK_ENVELOPE = 20.
const SET_INK_BAND = [20, 22];

const renderer = (name) => {
  const start = new RegExp(`^ {4}${name}: \\(size, (?:_color|color), style, className\\) =>`, 'm').exec(icons);
  assert.notEqual(start, null, `${name} renderer not found in src/Icons.jsx`);
  const after = icons.slice(start.index + start[0].length);
  const end = /^ {4}[A-Za-z]\w*: \(size/m.exec(after);
  return after.slice(0, end ? end.index : after.length);
};

const attr = (tagSource, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|\\{([^}]*)\\})`).exec(tagSource);
  return m ? (m[1] ?? m[2]).trim() : null;
};

// --- ink extent -------------------------------------------------------------

const cubic = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return (u * u * u * p0) + (3 * u * u * t * p1) + (3 * u * t * t * p2) + (t * t * t * p3);
};

// Absolute and relative M/L/H/V/C/Z - everything the two glyphs use, plus the
// relative forms so a redraw cannot silently fall outside this measurement.
const pathPoints = (d) => {
  const tokens = d.match(/[MmLlHhVvCcZz]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  const points = [];
  let i = 0;
  let cmd = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    if (/^[MmLlHhVvCcZz]$/.test(tokens[i])) { cmd = tokens[i]; i += 1; }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case 'M': {
        const nx = num(); const ny = num();
        x = rel ? x + nx : nx; y = rel ? y + ny : ny;
        startX = x; startY = y;
        points.push([x, y]);
        cmd = rel ? 'l' : 'L';
        break;
      }
      case 'L': {
        const nx = num(); const ny = num();
        x = rel ? x + nx : nx; y = rel ? y + ny : ny;
        points.push([x, y]);
        break;
      }
      case 'H': { const nx = num(); x = rel ? x + nx : nx; points.push([x, y]); break; }
      case 'V': { const ny = num(); y = rel ? y + ny : ny; points.push([x, y]); break; }
      case 'C': {
        const c1x = num(); const c1y = num(); const c2x = num(); const c2y = num();
        const ex = num(); const ey = num();
        const p1x = rel ? x + c1x : c1x; const p1y = rel ? y + c1y : c1y;
        const p2x = rel ? x + c2x : c2x; const p2y = rel ? y + c2y : c2y;
        const p3x = rel ? x + ex : ex; const p3y = rel ? y + ey : ey;
        for (let s = 1; s <= 400; s += 1) {
          const t = s / 400;
          points.push([cubic(x, p1x, p2x, p3x, t), cubic(y, p1y, p2y, p3y, t)]);
        }
        x = p3x; y = p3y;
        break;
      }
      case 'Z': { x = startX; y = startY; points.push([x, y]); break; }
      default: throw new Error(`unsupported path command ${cmd} in ${d}`);
    }
  }
  return points;
};

// Every painted element in a renderer, as an ink box on the 24 grid.
const inkBox = (name) => {
  const source = renderer(name);
  const svg = /<svg[^>]*>/.exec(source);
  assert.notEqual(svg, null, `${name} has no <svg>`);
  assert.equal(attr(svg[0], 'viewBox'), `0 0 ${GRID} ${GRID}`, `${name} must be drawn on the house grid`);

  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  const strokes = new Set();
  const add = (px, py, half) => {
    x0 = Math.min(x0, px - half); y0 = Math.min(y0, py - half);
    x1 = Math.max(x1, px + half); y1 = Math.max(y1, py + half);
  };

  for (const [, tag, body] of source.matchAll(/<(path|circle|rect|line)\b([^>]*)>/g)) {
    const stroke = attr(body, 'strokeWidth') ?? attr(body, 'stroke-width');
    const half = stroke === null ? 0 : Number(stroke) / 2;
    if (stroke !== null) strokes.add(Number(stroke));
    if (tag === 'path') {
      for (const [px, py] of pathPoints(attr(body, 'd'))) add(px, py, half);
    } else if (tag === 'circle') {
      const cx = Number(attr(body, 'cx'));
      const cy = Number(attr(body, 'cy'));
      const r = Number(attr(body, 'r'));
      add(cx - r, cy - r, half); add(cx + r, cy + r, half);
    } else if (tag === 'line') {
      add(Number(attr(body, 'x1')), Number(attr(body, 'y1')), half);
      add(Number(attr(body, 'x2')), Number(attr(body, 'y2')), half);
    } else {
      const rx = Number(attr(body, 'x'));
      const ry = Number(attr(body, 'y'));
      add(rx, ry, half);
      add(rx + Number(attr(body, 'width')), ry + Number(attr(body, 'height')), half);
    }
  }
  assert.notEqual(x1, -Infinity, `${name} drew nothing`);
  return {
    width: +(x1 - x0).toFixed(3),
    height: +(y1 - y0).toFixed(3),
    centre: [+((x0 + x1) / 2).toFixed(3), +((y0 + y1) / 2).toFixed(3)],
    strokes: [...strokes],
  };
};

const DOCK_GLYPH = Number(/const DOCK_GLYPH = (\d+);/.exec(chrome)?.[1]);

test('the dock glyph size is the one this parity is measured at', () => {
  assert.equal(Number.isFinite(DOCK_GLYPH), true, 'DOCK_GLYPH not found in MobilePdfViewerChrome.jsx');
});

test('Survey and Spaces have the same ink extent, within 1px at the dock size', () => {
  const spaces = inkBox('layers');
  const survey = inkBox('survey');
  const perUnit = DOCK_GLYPH / GRID;

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
    for (const value of box.strokes) {
      assert.equal(value, HOUSE_STROKE, `${name} draws a ${value} stroke, not the house ${HOUSE_STROKE}`);
    }
    for (const [axis, centre] of [['x', box.centre[0]], ['y', box.centre[1]]]) {
      assert.ok(
        Math.abs(centre - GRID / 2) <= 0.05,
        `${name}'s ink centre is ${centre} on ${axis}, not the grid's ${GRID / 2}: the glyph `
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
