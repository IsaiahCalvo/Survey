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

const EXEMPT_ASSETS = new Map([
  // Filled letterform marks. These are typographic glyphs (a highlighted A, a U
  // with an underline, a struck-through S), not outline drawings, so they have no
  // stroke to match. Their optical sizes still do not match each other — see the
  // 2026-09-16 notDone list; all of them are sha256-pinned by existing tests.
  ['text-bold.svg', 'filled letterform, sha256-pinned by tests/textSelectionActionBarMounted'],
  ['text-italic.svg', 'filled letterform, sha256-pinned by tests/textSelectionActionBarMounted'],
  ['text-underline.svg', 'filled letterform, sha256-pinned by tests/textSelectionActionBarMounted'],
  ['text-strikethrough.svg', 'filled letterform, sha256-pinned by tests/textSelectionActionBarMounted'],
  ['text-squiggle.svg', 'filled letterform, sha256-pinned by tests/textSelectionActionBarMounted'],
  ['text-highlight.svg', 'filled letterform, sha256-pinned by tests/highlightIconSeparation'],
  // Stroked, but off the house weight and frozen by an existing hash assertion.
  // Unlocking any of these needs an owner ruling, not a quiet edit here.
  ['text-hyperlink.svg', 'stroke 2.375, sha256-pinned by tests/textSelectionActionBarMounted'],
  ['text-redact.svg', 'stroke 1.75, sha256-pinned by tests/textSelectionActionBarMounted and tests/redactIconSource'],
  ['highlighter-tool.svg', 'stroke 7.2 on a 128 grid (1.35 house units), sha256- and count-pinned by tests/highlightIconSeparation'],
  ['counter.svg', 'owner-approved filled tracing, sha256- and viewBox-pinned by tests/counterIconSource and tests/counterControlFollowup'],
  ['counter-outline.svg', 'a prepared alternative to counter.svg that nothing imports yet'],
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
    if (EXEMPT_ASSETS.has(file)) continue;
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

test('every exemption from the one-weight rule carries a reason', () => {
  for (const [name, reason] of [...EXEMPT_RENDERERS, ...EXEMPT_ASSETS]) {
    assert.ok(reason && reason.length > 20, `${name} needs a real reason, not "${reason}"`);
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
