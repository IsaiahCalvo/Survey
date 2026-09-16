import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';

/*
 * Owner ruling 2026-09-16: the app renders ONE icon set on desktop, web mobile
 * and iOS, and the glyphs in it must be consistent with each other — same stroke
 * weight, same node-circle radius.
 *
 * This test parses the shared icon module (src/Icons.jsx) and every asset it can
 * pull in (src/assets/icons), resolves each stroke onto the house 24-unit grid
 * through the element's own grid and its ancestors' scale() groups, and requires
 * one weight. It then requires one radius for every vertex/handle node in the
 * "shape with handles" family.
 *
 * It exists because the set drifted twice: once into four different line weights
 * in a single toolbar row, and once into three different handle sizes across
 * three icons that use the same motif.
 */

const ICONS_URL = new URL('../src/Icons.jsx', import.meta.url);
const ASSET_DIR = new URL('../src/assets/icons/', import.meta.url);

const GRID = 24;
const HOUSE_STROKE = 1.5;
const HOUSE_NODE_RADIUS = 2;
// 2% of the house weight. Below that no eye resolves a difference at icon sizes,
// and it lets a glyph compensate a scaled group with a rounded stroke width.
const STROKE_TOLERANCE = 0.03;

const PAINTED_TAGS = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

/*
 * Glyphs excluded from the one-weight rule, each for a stated reason. Anything
 * not listed here is held to the rule — that is the point of the list being
 * short and explicit.
 */
const EXEMPT_RENDERERS = new Map([
  ['google', 'the Google brand mark, drawn to their spec in their colours'],
  ['oneDrive', 'the OneDrive brand logo, an <img>'],
]);

/*
 * DELIBERATE ASSERTION CHANGE (2026-09-16, desktop sweep): a STROKE WEIGHT is no
 * longer an excusable thing. This list used to hold five assets whose stated
 * reason was the weight itself ("stroke 2.375, sha256-pinned", "stroke 1.75,
 * sha256-pinned", "stroke 7.2 on a 128 grid", "the numeral is drawn at 2.0",
 * "nothing imports it yet"), which meant the one-weight rule could be opted out
 * of by writing a sentence. All five were redrawn at the house 1.5 in this pass
 * and their pins re-taken. What is left is the only excuse that is not a weight:
 * the glyph is not an outline drawing at all.
 *
 * Every entry below is VERIFIED to be fill-drawn by the test further down — a
 * listing here cannot hide a real outline stroke. Two kinds of stroke survive on
 * a fill-drawn glyph and neither is an outline:
 *   - a HAIRLINE that firms a filled edge (0.25 on a 224-unit letterform), and
 *   - the MARK itself, the thing the glyph is about: the rule under a U, the bar
 *     over an A. A mark's weight is the glyph's meaning, exactly as documented on
 *     text-redact.svg's solid bar, and it is measured against its filled siblings
 *     rather than the house stroke.
 */
const FILL_DRAWN_ASSETS = new Map([
  // Filled letterform marks (a highlighted A, a U with an underline, a
  // struck-through S). Their optical sizes still do not match each other — see
  // the 2026-09-16 notDone list.
  ['text-bold.svg', 'a filled letterform: its ink is fill, so it has no outline stroke to match'],
  ['text-italic.svg', 'a filled letterform: its ink is fill, so it has no outline stroke to match'],
  ['text-underline.svg', 'a filled letterform: its ink is fill, so it has no outline stroke to match'],
  ['text-strikethrough.svg', 'a filled letterform: its ink is fill, so it has no outline stroke to match'],
  ['text-squiggle.svg', 'a filled letterform whose squiggle rule is the mark, not an outline drawing'],
  ['text-highlight.svg', 'a filled letterform behind a mask: no stroke anywhere in the file'],
  ['counter.svg', 'an owner-approved filled tracing: its ink is fill, so it has no outline stroke'],
]);

/*
 * The one stroke-drawn MARK in the set, and the band its filled siblings' marks
 * occupy. text-underline.svg draws its rule as fill about 2.4 house units thick;
 * text-squiggle.svg draws the same idea as a stroke, so it is held to the marks'
 * band and not to the house outline weight. This is a list of ONE on purpose: a
 * second entry means someone is using it to dodge the weight rule.
 */
const MARK_STROKE_BAND = [2.0, 3.0];
const MARK_STROKES = new Map([
  ['text-squiggle.svg', 'the squiggly rule under the U — the mark the glyph is about'],
]);

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

/**
 * Walks markup as a tag stream and returns every painted element with the stroke
 * width and cumulative scale in force on it. Handles both SVG assets (attributes
 * inherit down the tree) and the module's JSX (same, with braces for values).
 */
const walk = (source) => {
  const out = [];
  const stack = [{ strokeWidth: null, scale: 1, grid: GRID }];
  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    if (source.startsWith('<?', lt) || source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt);
      i = end === -1 ? source.length : end + 1;
      continue;
    }
    // Read to the matching '>' while respecting quotes and JSX braces.
    let j = lt + 1;
    let quote = null;
    let depth = 0;
    while (j < source.length) {
      const ch = source[j];
      if (quote) {
        if (ch === quote) quote = null;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '{') {
        depth += 1;
      } else if (ch === '}') {
        depth -= 1;
      } else if (ch === '>' && depth === 0) {
        break;
      }
      j += 1;
    }
    const raw = source.slice(lt + 1, j);
    i = j + 1;

    if (raw.startsWith('/')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const nameMatch = /^([A-Za-z][\w:-]*)/.exec(raw);
    if (!nameMatch) continue;
    const tag = nameMatch[1];
    const selfClosing = raw.trimEnd().endsWith('/');

    const attr = (names) => {
      for (const name of names) {
        const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{([^}]*)\\})`).exec(raw);
        if (m) return (m[1] ?? m[2] ?? m[3]).trim();
      }
      return null;
    };

    const parent = stack[stack.length - 1];
    const declaredStroke = attr(['stroke-width', 'strokeWidth']);
    const strokeWidth = declaredStroke === null
      ? parent.strokeWidth
      // strokeWidth={ICON_STROKE_WIDTH} is the shared token; resolve it.
      : (/^[\d.]+$/.test(declaredStroke) ? Number(declaredStroke) : (declaredStroke === 'ICON_STROKE_WIDTH' ? HOUSE_STROKE : null));

    const transform = [attr(['transform']), attr(['style'])].filter(Boolean).join(' ');
    const scale = parent.scale * scaleOf(transform);

    let grid = parent.grid;
    const viewBox = attr(['viewBox']);
    if (viewBox) {
      const parts = viewBox.split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0) grid = parts[2];
    }

    const frame = { strokeWidth, scale, grid };
    if (PAINTED_TAGS.has(tag) && strokeWidth) {
      const strokeAttr = attr(['stroke']);
      const painted = strokeAttr === null ? parent.hasStroke : strokeAttr !== 'none';
      if (painted) {
        out.push({ tag, effective: strokeWidth * scale * (GRID / grid), raw });
      }
    }
    frame.hasStroke = attr(['stroke']) === null
      ? parent.hasStroke
      : attr(['stroke']) !== 'none';
    if (!selfClosing) stack.push(frame);
  }
  return out;
};

const iconsSource = await readFile(ICONS_URL, 'utf8');

/** Every `name: (size, color, style, className) => (...)` block in Icons.jsx. */
const renderers = () => {
  const found = new Map();
  const re = /^ {4}([A-Za-z][\w]*): \(size, (?:_color|color), style, className\) =>/gm;
  const starts = [...iconsSource.matchAll(re)].map((m) => ({ name: m[1], at: m.index }));
  starts.forEach((entry, index) => {
    const end = index + 1 < starts.length ? starts[index + 1].at : iconsSource.indexOf('\n};', entry.at);
    found.set(entry.name, iconsSource.slice(entry.at, end));
  });
  return found;
};

test('the shared icon module holds one stroke weight for every glyph', () => {
  const all = renderers();
  assert.ok(all.size > 60, `expected the whole set, parsed ${all.size} renderers`);

  const offenders = [];
  for (const [name, source] of all) {
    if (EXEMPT_RENDERERS.has(name)) continue;
    for (const element of walk(source)) {
      if (Math.abs(element.effective - HOUSE_STROKE) > STROKE_TOLERANCE) {
        offenders.push(`${name} <${element.tag}> resolves to ${element.effective.toFixed(3)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `glyphs off the house ${HOUSE_STROKE} weight:\n  ${offenders.join('\n  ')}`);
});

test('the module declares the shared geometry tokens the glyphs are drawn to', () => {
  assert.match(iconsSource, /export const ICON_GRID = 24;/);
  assert.match(iconsSource, /export const ICON_STROKE_WIDTH = 1\.5;/);
  assert.match(iconsSource, /export const ICON_NODE_RADIUS = 2;/);
  assert.match(iconsSource, /export const ICON_CORNER_RADIUS_RATIO = 1 \/ 9;/);
});

test('every icon asset resolves to the same stroke weight on the 24 grid', async () => {
  const files = (await readdir(ASSET_DIR)).filter((f) => f.endsWith('.svg')).sort();
  assert.ok(files.length >= 15, `expected the asset folder, found ${files.length} files`);

  const offenders = [];
  let checked = 0;
  for (const file of files) {
    if (FILL_DRAWN_ASSETS.has(file)) continue;
    const source = await readFile(new URL(file, ASSET_DIR), 'utf8');
    let sawStroke = false;
    for (const element of walk(source)) {
      sawStroke = true;
      if (Math.abs(element.effective - HOUSE_STROKE) > STROKE_TOLERANCE) {
        offenders.push(`${file} <${element.tag}> resolves to ${element.effective.toFixed(3)}`);
      }
    }
    if (sawStroke) checked += 1;
  }
  assert.ok(checked >= 6, `expected to check several stroked assets, checked ${checked}`);
  assert.deepEqual(offenders, [], `assets off the house ${HOUSE_STROKE} weight:\n  ${offenders.join('\n  ')}`);
});

test('every glyph held back from the one-weight rule carries a reason', () => {
  for (const [name, reason] of [...EXEMPT_RENDERERS, ...FILL_DRAWN_ASSETS, ...MARK_STROKES]) {
    assert.ok(reason && reason.length > 20, `${name} needs a real reason, not "${reason}"`);
  }
});

test('no glyph is excused from the house stroke weight', () => {
  // The rule this guards: a stroke weight is not a thing a glyph can be let off.
  // Before this pass five assets sat on the exemption list with the WEIGHT as
  // their stated reason ("stroke 2.375, sha256-pinned", "stroke 7.2 on a 128
  // grid", "the numeral is drawn at 2.0", "nothing imports it yet"), so the
  // one-weight rule could be opted out of by writing a sentence. All five were
  // redrawn at the house 1.5. The only excuse left is not being an outline
  // drawing at all — which the next test verifies rather than believes.
  for (const [name, reason] of [...EXEMPT_RENDERERS, ...FILL_DRAWN_ASSETS]) {
    assert.doesNotMatch(
      reason,
      /stroke[- ]?width|\bstroke \d|\bpinned\b|\bimports? it\b/i,
      `${name} may not be held back because of its stroke weight or a hash pin — `
      + 'redraw it at the house weight and re-take the pin as a ruled decision. '
      + `Reason given: "${reason}"`,
    );
  }
  assert.equal(
    MARK_STROKES.size,
    1,
    'MARK_STROKES is the squiggle rule and nothing else. A second entry means '
    + 'someone is calling an outline drawing a "mark" to dodge the weight rule.',
  );
});

test('nothing on the fill-drawn list hides an outline stroke', async () => {
  const hairline = HOUSE_STROKE / 4;
  for (const [file] of FILL_DRAWN_ASSETS) {
    const source = await readFile(new URL(file, ASSET_DIR), 'utf8');
    for (const element of walk(source)) {
      const paintsFill = /fill\s*=\s*["'](?!none)/.test(element.raw);
      if (paintsFill) {
        // Ink made of fill may carry a hairline to firm its edge. Anything
        // thicker is an outline drawing and belongs on the house weight.
        assert.ok(
          element.effective <= hairline,
          `${file} <${element.tag}> is fill-drawn but strokes at `
          + `${element.effective.toFixed(3)} house units, well over the ${hairline} `
          + 'hairline that firms a filled edge. That is an outline drawing, so it '
          + `is held to the house ${HOUSE_STROKE} like everything else.`,
        );
        continue;
      }
      // A stroke with no fill behind it is either the glyph's MARK or an outline
      // drawing hiding on this list.
      assert.ok(
        MARK_STROKES.has(file),
        `${file} <${element.tag}> strokes ${element.effective.toFixed(3)} house `
        + 'units with no fill behind it, which makes it an outline drawing, not a '
        + `fill-drawn glyph. Draw it at the house ${HOUSE_STROKE}.`,
      );
      const [lo, hi] = MARK_STROKE_BAND;
      assert.ok(
        element.effective >= lo && element.effective <= hi,
        `${file} <${element.tag}> is the glyph's mark, so it is measured against `
        + `its filled siblings' marks (${lo}-${hi} house units) rather than the `
        + `house outline weight — and ${element.effective.toFixed(3)} is outside that band.`,
      );
    }
  }
});

test('every vertex node circle in the set is the same radius', () => {
  // One helper draws them all, so they cannot drift apart again.
  assert.match(iconsSource, /const nodeCircle = \(key, cx, cy, color\) => \(/);
  assert.match(iconsSource, /r=\{ICON_NODE_RADIUS\}/);
  assert.equal((iconsSource.match(/r=\{ICON_NODE_RADIUS\}/g) || []).length, 1, 'only nodeCircle may set the node radius');

  const all = renderers();
  for (const name of ['polygon', 'polyline']) {
    const source = all.get(name);
    assert.ok(source, `${name} renderer not found`);
    assert.match(source, /nodeCircle\(/, `${name} must draw its vertices through nodeCircle`);
    assert.doesNotMatch(
      source,
      /\br=["{]/,
      `${name} must not set its own node radius — that is how polygon, polyline and the text box ended up with three different handle sizes`,
    );
  }

  // The vertex tables and the drawn node counts have to agree, or a glyph would
  // silently lose a handle.
  const nodeTable = (token) => {
    const at = iconsSource.indexOf(`const ${token} = [`);
    assert.notEqual(at, -1, `${token} not found`);
    const end = iconsSource.indexOf('];', at);
    return [...iconsSource.slice(at, end).matchAll(/\[\s*[\d.]+\s*,\s*[\d.]+\s*\]/g)].length;
  };
  assert.equal(nodeTable('POLYGON_ICON_NODES'), 5);
  assert.equal(nodeTable('POLYLINE_ICON_NODES'), 4);
});

test('every rounded box in the set is rounded by the same ratio', async () => {
  // 2026-09-16 (desktop sweep): new. shapes.svg carried a flat rx="1" on a
  // 7.9-unit square (1/7.9), which made it rounder than every other box in the
  // set; it is 0.88 (7.9/9) now. Nothing guarded the ratio, so it could drift
  // again the same way the stroke weights and the handle radii both did.
  const boxes = [];
  const collect = (source, where) => {
    for (const match of source.matchAll(/<rect\b[^>]*>/g)) {
      const tag = match[0];
      const n = (key) => {
        const m = new RegExp(`${key}\\s*=\\s*["'{]([\\d.]+)`).exec(tag);
        return m ? Number(m[1]) : null;
      };
      const [w, h, rx] = [n('width'), n('height'), n('rx')];
      if (!w || !h || rx === null) continue;
      boxes.push({ where, w, h, rx, expected: Math.round(Math.min(w, h) * (1 / 9) * 100) / 100 });
    }
  };
  collect(iconsSource, 'src/Icons.jsx');
  for (const file of (await readdir(ASSET_DIR)).filter((f) => f.endsWith('.svg'))) {
    collect((await readFile(new URL(file, ASSET_DIR), 'utf8')).replace(/<!--[\s\S]*?-->/g, ''), file);
  }

  assert.ok(boxes.length >= 14, `expected the set's rounded boxes, found ${boxes.length}`);
  const offenders = boxes
    .filter((box) => Math.abs(box.rx - box.expected) > 0.01)
    .map((box) => `${box.where}: ${box.w}x${box.h} box has rx ${box.rx}, want ${box.expected}`);
  assert.deepEqual(
    offenders,
    [],
    'a rounded box is rounded by a ninth of its shorter side '
    + `(ICON_CORNER_RADIUS_RATIO), so a big box and a small box look equally rounded:\n  ${offenders.join('\n  ')}`,
  );
});

test('the node radius is the one on the text-box glyph the owner supplied', async () => {
  const asset = await readFile(new URL('text-box-selection.svg', ASSET_DIR), 'utf8');
  // Its four corner handles are circles written as closed bezier paths.
  const handles = [...asset.matchAll(/<path d="(M[^"]*Z)"/g)].map((m) => m[1]);
  assert.equal(handles.length, 4, 'the text-box glyph has four corner handles');

  const radii = handles.map((d) => {
    const numbers = [...d.matchAll(/-?[\d.]+/g)].map((m) => Number(m[0]));
    const xs = numbers.filter((_, index) => index % 2 === 0);
    return (Math.max(...xs) - Math.min(...xs)) / 2;
  });
  for (const radius of radii) {
    assert.ok(
      Math.abs(radius - HOUSE_NODE_RADIUS) < 0.01,
      `text-box handle radius ${radius} must be the shared ${HOUSE_NODE_RADIUS}`,
    );
  }
  assert.match(iconsSource, new RegExp(`export const ICON_NODE_RADIUS = ${HOUSE_NODE_RADIUS};`));
});
