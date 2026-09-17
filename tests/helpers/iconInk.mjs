import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * Measures a glyph's INK on the house 24-unit grid, straight from src/Icons.jsx:
 * the geometric bounding box of every painted element plus half its stroke on
 * each side - the same thing getBBox + strokeWidth / 2 measures in a browser.
 *
 * Used by tests/dockGlyphParity.test.mjs (Survey vs Spaces must be the same
 * size) and tests/chromeIconInkCentring.test.mjs (a mark that is mirrored by CSS
 * has to be centred on the grid, or the flip drops its ink off the row).
 */

export const ICON_GRID = 24;

const iconsSource = readFileSync(new URL('../../src/Icons.jsx', import.meta.url), 'utf8');

/** The body of one `name: (size, color, style, className) => (...)` renderer. */
export const renderer = (name) => {
  const start = new RegExp(`^ {4}${name}: \\(size, (?:_color|color), style, className\\) =>`, 'm').exec(iconsSource);
  assert.notEqual(start, null, `${name} renderer not found in src/Icons.jsx`);
  const after = iconsSource.slice(start.index + start[0].length);
  const end = /^ {4}[A-Za-z]\w*: \(size/m.exec(after);
  return after.slice(0, end ? end.index : after.length);
};

export const attr = (tagSource, name) => {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|\\{([^}]*)\\})`).exec(tagSource);
  return m ? (m[1] ?? m[2]).trim() : null;
};

const cubic = (p0, p1, p2, p3, t) => {
  const u = 1 - t;
  return (u * u * u * p0) + (3 * u * u * t * p1) + (3 * u * t * t * p2) + (t * t * t * p3);
};

/**
 * Every point on a path, sampling curves finely. Handles absolute and relative
 * M/L/H/V/C/Z - everything this icon set uses, plus the relative forms so a
 * redraw cannot fall outside the measurement without failing loudly.
 */
export const pathPoints = (d) => {
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
    assert.notEqual(cmd, null, `path starts without a command: ${d}`);
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

/** The ink box of one renderer, on the 24 grid, with any <g translate> applied. */
export const inkBox = (name) => {
  const source = renderer(name);
  const svg = /<svg[^>]*>/.exec(source);
  assert.notEqual(svg, null, `${name} has no <svg>`);
  const viewBox = attr(svg[0], 'viewBox');

  const group = /<g[^>]*\btransform\s*=\s*"translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)"/.exec(source);
  const shiftX = group ? Number(group[1]) : 0;
  const shiftY = group ? Number(group[2]) : 0;

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
    viewBox,
    width: +(x1 - x0).toFixed(3),
    height: +(y1 - y0).toFixed(3),
    centre: [+((x0 + x1) / 2 + shiftX).toFixed(3), +((y0 + y1) / 2 + shiftY).toFixed(3)],
    strokes: [...strokes],
    source,
  };
};
