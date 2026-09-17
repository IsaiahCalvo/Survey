/*
 * The one parser that reads the stroke weight off a hand-written inline <svg>
 * in the app chrome, wherever that weight is declared.
 *
 * HISTORY / why this is a module and not a copy in each test.
 *
 * tests/chromeInlineIconConsistency.test.mjs shipped first and read strokeWidth
 * ONLY off the <svg> opening tag, which is the minority spelling — most inline
 * glyphs put the weight on the <path>. tests/chromeInlineIconChildStroke.test.mjs
 * (adversarial verification, verify-r3-desktop) proved that hole real: the text
 * editor's tick and cross, and the Survey spaces rail's group-expand chevron,
 * all declared their weight on a child and so were invisible to the first test.
 *
 * Rather than keep two parsers that disagree about what counts as an icon, the
 * child-stroke parser was folded into here (2026-09-16, r4-desktop) and BOTH
 * tests now read the chrome through this one function. One guard, one answer.
 *
 * What it resolves, which a naive regex does not:
 *   - the weight declared on the <svg>, on an enclosing <g>, or on the painted
 *     element itself (nearest declaration wins, as SVG inheritance does);
 *   - the svg's own viewBox, so a glyph drawn on a 12 or 192 grid is normalised
 *     onto the house 24 grid before it is compared;
 *   - uniform scale() transforms on the <svg> and on enclosing <g> groups, so a
 *     glyph inside a scaled group is measured at the weight it actually paints;
 *   - stroke="none" shapes, which carry no weight to match;
 *   - comments, which are blanked before parsing — several of these files TALK
 *     about inline <svg> in prose, and a parser that read those would measure
 *     the prose. Blanked, not removed, so every character keeps its offset and
 *     the line number in a failure message points at the real file.
 */

/** The house icon geometry, mirrored from src/Icons.jsx. */
export const HOUSE_STROKE = 1.5;
export const HOUSE_GRID = 24;
/** Rounding slack: a declared weight may be written to 2dp. */
export const STROKE_TOLERANCE = 0.03;

/** Product of the uniform scale factors in an SVG/CSS transform string. */
const scaleOf = (transform) => {
  if (!transform) return 1;
  let scale = 1;
  for (const match of transform.matchAll(/(?<![A-Za-z])scale\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+))?\s*\)/g)) {
    const sx = Math.abs(Number(match[1]));
    const sy = match[2] === undefined ? sx : Math.abs(Number(match[2]));
    scale *= Math.sqrt(sx * sy);
  }
  return scale;
};

const PAINTED = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

const attr = (tag, name) => {
  const match = new RegExp(`${name}\\s*=\\s*["'{]?\\s*([^"'}\\s>]+)`).exec(tag);
  return match ? match[1] : null;
};

const transformOf = (tag) => {
  const match = /transform\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/.exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
};

const blank = (text) => text.replace(/[^\n]/g, ' ');
export const stripComments = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, blank)
  .split('\n')
  .map((line) => (/^\s*(\/\/|\*)/.test(line) ? blank(line) : line))
  .join('\n');

/**
 * Every painted element inside every inline <svg> of `rawSource`, with the
 * stroke width in force on it resolved onto the house 24 grid.
 *
 * @returns {Array<{file: string, line: number, tag: string, grid: number,
 *                  declared: number, units: number}>}
 */
export const inlineIconStrokes = (rawSource, file = '(source)') => {
  const source = stripComments(rawSource);
  const out = [];
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('<svg', cursor);
    if (open === -1) break;
    const openEnd = source.indexOf('>', open);
    if (openEnd === -1) break;
    const openTag = source.slice(open, openEnd + 1);
    const close = source.indexOf('</svg>', openEnd);
    const body = source.slice(openEnd + 1, close === -1 ? source.length : close);
    cursor = close === -1 ? source.length : close + 6;

    const viewBox = /viewBox\s*=\s*["']([^"']+)["']/.exec(openTag)?.[1] ?? null;
    if (!viewBox) continue;
    const grid = Number(viewBox.trim().split(/[\s,]+/)[2]);
    if (!Number.isFinite(grid) || grid <= 0) continue;

    const rootStroke = attr(openTag, 'strokeWidth') ?? attr(openTag, 'stroke-width');
    const stack = [{
      strokeWidth: rootStroke === null ? null : Number(rootStroke),
      scale: scaleOf(transformOf(openTag)),
    }];

    for (const match of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b([^>]*?)(\/?)>/g)) {
      const [, closing, rawTag, attrs, selfClosing] = match;
      const tag = rawTag.toLowerCase();
      if (closing) {
        if (tag === 'g' && stack.length > 1) stack.pop();
        continue;
      }
      const top = stack[stack.length - 1];
      const declared = attr(attrs, 'strokeWidth') ?? attr(attrs, 'stroke-width');
      const strokeWidth = declared === null ? top.strokeWidth : Number(declared);
      const scale = top.scale * scaleOf(transformOf(attrs));

      if (tag === 'g') {
        if (!selfClosing) stack.push({ strokeWidth, scale });
        continue;
      }
      if (!PAINTED.has(tag)) continue;
      if (strokeWidth === null || !Number.isFinite(strokeWidth) || strokeWidth === 0) continue;
      // A shape that paints no stroke carries no weight to match.
      const stroke = attr(attrs, 'stroke') ?? attr(openTag, 'stroke');
      if (stroke === 'none') continue;

      out.push({
        file,
        line: source.slice(0, open + match.index).split('\n').length,
        tag,
        grid,
        declared: strokeWidth,
        units: Number(((strokeWidth * scale * HOUSE_GRID) / grid).toFixed(3)),
      });
    }
  }
  return out;
};

/** The offenders in `source`: painted inline ink off the house weight. */
export const offHouseWeight = (source, file) => inlineIconStrokes(source, file)
  .filter((icon) => Math.abs(icon.units - HOUSE_STROKE) > STROKE_TOLERANCE)
  .map((icon) => (
    `${icon.file}:${icon.line} <${icon.tag}> strokes ${icon.declared} on a `
    + `${icon.grid} grid = ${icon.units} house units (want ${HOUSE_STROKE})`
  ));
