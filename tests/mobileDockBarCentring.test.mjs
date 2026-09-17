import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/mobile/mobilePdfViewer.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

/*
 * UX contract (owner ruling 2026-09-17): "the bottom-dock icons sit too high
 * against the painted bar on web mobile and iOS. Make each button's glyph the
 * vertical centre of the painted bar region a user perceives as the bar - the
 * bar above the home-indicator reserve on iOS, the whole bar on web where the
 * reserve is 10px - and make the painted bar's own padding symmetric so the
 * chips are centred in it. Keep the 44px hit pads."
 *
 * Measured in the pane before the fix (fixture open, dock visible):
 *   375x812, inset 10: bar painted y 766..812 (46px, centre 789); chips
 *     y 769..799, centre 784 -> 5px HIGH; 3px of bar above them, 13px below.
 *   402x874 with --native-safe-area-bottom: 34px: bar painted y 742..812
 *     (70px, centre 777); chips y 745..775, centre 760 -> 17px HIGH; 3px of bar
 *     above them, 37px below - over half the bar empty under the icons.
 * After: centre offset 0.00 at inset 10 (8px of bar above and below each chip)
 * and 0.00 against the perceived bar at inset 34 (9.5px above, 9.5px below,
 * then the indicator's own 21px). The hit pads did not move: 767..811 (44px)
 * and 743..811 (68px) respectively, the same pixels as before.
 *
 * This test does the same arithmetic from the tokens, so the geometry cannot
 * drift without someone seeing this contract.
 */

// --- a small px-expression evaluator, enough for the dock's own tokens -------

// Find the index of the ")" that closes the "(" at `open`.
const matchParen = (text, open) => {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') { depth -= 1; if (depth === 0) return i; }
  }
  throw new Error(`unbalanced parentheses in: ${text}`);
};

// Split on commas that are not inside parentheses.
const topLevelSplit = (text) => {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') depth -= 1;
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim());
};

// Replace every var()/env() with its value from `env`, or with its fallback.
const substitute = (expr, env) => {
  let out = expr;
  for (;;) {
    const at = out.search(/\b(?:var|env)\(/);
    if (at < 0) return out;
    const open = out.indexOf('(', at);
    const close = matchParen(out, open);
    const [name, ...fallback] = topLevelSplit(out.slice(open + 1, close));
    const value = Object.prototype.hasOwnProperty.call(env, name)
      ? String(env[name])
      : (fallback.length ? fallback.join(',') : null);
    assert.notEqual(value, null, `no value and no fallback for ${name}`);
    out = `${out.slice(0, at)}(${substitute(value, env)})${out.slice(close + 1)}`;
  }
};

const evalPx = (expr, env) => {
  const js = substitute(expr, env)
    .replace(/\bcalc\(/g, '(')
    .replace(/\bmin\(/g, 'Math.min(')
    .replace(/\bmax\(/g, 'Math.max(')
    .replace(/(\d)px\b/g, '$1')
    .replace(/\bpx\b/g, '');
  assert.match(js, /^[-+*/(),.\d\sMathmin ax]*$/, `not a plain px expression: ${expr} -> ${js}`);
  // eslint-disable-next-line no-new-func
  const value = Function(`"use strict"; return (${js});`)();
  assert.equal(Number.isFinite(value), true, `${expr} did not evaluate to a number`);
  return value;
};

// --- the declarations this contract is made of ------------------------------

const rootBlock = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
assert.notEqual(rootBlock, null, ':root token block not found');
const tokens = {};
for (const [, name, value] of rootBlock[1].matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) tokens[name] = value.trim();

// Every rule whose selector list names this exact selector, in source order.
const rulesFor = (selector) => {
  const bodies = [];
  for (const [, selectors, block] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (selectors.split(',').some((one) => one.trim() === selector)) bodies.push(block);
  }
  assert.ok(bodies.length, `${selector} rule not found`);
  return bodies;
};

const ruleBody = (selector) => rulesFor(selector).join('\n');

// The last declaration of a property across every rule naming the selector -
// which is the one the cascade lands on, these all having equal specificity.
const declaration = (selector, property) => {
  let raw = null;
  for (const body of rulesFor(selector)) {
    const match = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`).exec(body);
    if (match) raw = match[1].trim();
  }
  assert.notEqual(raw, null, `${selector} must declare ${property}`);
  return raw;
};

// Geometry for one device, straight from the stylesheet.
const geometry = (rawSafeAreaBottom) => {
  const env = { ...tokens, '--native-safe-area-bottom': `${rawSafeAreaBottom}px` };
  const inset = evalPx(tokens['--mobile-bottom-inset'], env);
  const reserve = evalPx(tokens['--mobile-dock-reserve'], env);
  const chip = evalPx(tokens['--mobile-dock-control-h'], env);

  const boxHeight = evalPx(declaration('.mobile-pdf-dock', 'height'), env);
  const [padTop, , padBottom] = declaration('.mobile-pdf-dock', 'padding').split(/\s+/);
  const paintedHeight = evalPx(
    declaration('.mobile-pdf-dock__surface', 'height'),
    env,
  );

  // Both boxes are pinned to the bottom of the screen, so measure everything
  // from the painted bar's top edge.
  const gutter = evalPx(padTop, env);
  const reserved = evalPx(padBottom, env);
  // Both boxes are bottom-anchored, so the dock box starts (box - painted)
  // above the painted bar and its content band starts one top gutter below it.
  const bandTop = gutter - (boxHeight - paintedHeight);
  assert.equal(
    +(boxHeight - paintedHeight).toFixed(4),
    gutter,
    'the dock box\'s top gutter must be exactly the part of the box above the painted bar, '
    + 'otherwise `align-items: center` is not centring in the bar at all',
  );
  const band = boxHeight - gutter - reserved;
  const chipTop = bandTop + (band - chip) / 2;

  return {
    inset,
    reserve,
    reserved,
    chip,
    painted: paintedHeight,
    // The bar the user perceives: everything painted except the home
    // indicator's own footprint. NOT "everything except whatever the dock
    // happens to pad out" - that is the bug this contract is about.
    perceived: paintedHeight - reserve,
    chipTop,
    chipCentre: chipTop + chip / 2,
  };
};

const DEVICES = [
  { what: 'web mobile / the pane at 375x812 (no safe area, the 10px floor shows)', raw: 0, reserve: [0, 0] },
  { what: 'an iPhone 17 Pro at 402x874 (34px safe area)', raw: 34, reserve: [15, 21] },
];

test('the dock reserves the home indicator\'s own footprint, not the whole inset', () => {
  for (const { what, raw, reserve: [low, high] } of DEVICES) {
    const g = geometry(raw);
    assert.ok(
      g.reserve >= low && g.reserve <= high,
      `on ${what} the dock reserves ${g.reserve}px for the home indicator, outside the `
      + `${low}..${high}px this contract allows. In a browser there is no indicator at all `
      + '(the 10px --mobile-bottom-inset floor is padding, not clearance) and on iOS the '
      + "indicator lives in the bottom ~21pt of a 34pt inset, not all of it.",
    );
    assert.equal(
      g.reserved,
      g.reserve,
      `on ${what} .mobile-pdf-dock pads out ${g.reserved}px at the bottom while the home `
      + `indicator only needs ${g.reserve}px. Every pixel of that difference pushes the chips `
      + 'above the centre of the bar the user sees - which is exactly what the owner ruled '
      + 'out on 2026-09-17.',
    );
  }
});

test('every dock chip is centred in the bar the user perceives, at both insets', () => {
  for (const { what, raw } of DEVICES) {
    const g = geometry(raw);
    const offset = +(g.chipCentre - g.perceived / 2).toFixed(4);
    assert.equal(
      offset,
      0,
      `on ${what} a dock chip's centre sits ${offset}px from the centre of the ${g.perceived}px `
      + `bar the user sees (painted ${g.painted}px, of which ${g.reserve}px is the home `
      + 'indicator\'s own reserve). The owner ruled on 2026-09-17 that the glyph is the '
      + 'vertical centre of that region.',
    );
  }
});

test('the painted bar\'s padding is symmetric around the chips', () => {
  for (const { what, raw } of DEVICES) {
    const g = geometry(raw);
    const above = +g.chipTop.toFixed(4);
    const below = +(g.perceived - g.chipTop - g.chip).toFixed(4);
    assert.equal(
      above,
      below,
      `on ${what} the bar leaves ${above}px above each chip and ${below}px below it`,
    );
  }
});

test('the 44px hit pads stay pinned to the painted bar, not to the chip', () => {
  // Split the two values on whitespace that is not inside a calc().
  const splitValues = (raw) => {
    const parts = [];
    let depth = 0;
    let current = '';
    for (const ch of raw.trim()) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (/\s/.test(ch) && depth === 0) { if (current) parts.push(current); current = ''; continue; }
      current += ch;
    }
    if (current) parts.push(current);
    return parts;
  };
  const [top, bottom] = splitValues(declaration('.mobile-pdf-dock__side::after', 'inset-block'));
  assert.ok(bottom, '.mobile-pdf-dock__side::after must declare both inset-block values');

  for (const { what, raw } of DEVICES) {
    const g = geometry(raw);
    const env = { ...tokens, '--native-safe-area-bottom': `${raw}px` };
    const border = Number(/border:\s*(\d+(?:\.\d+)?)px/.exec(ruleBody('.mobile-pdf-dock__side'))?.[1] ?? 1);

    // An absolutely positioned ::after is laid out against the PADDING box.
    const paddingBoxTop = g.chipTop + border;
    const paddingBoxBottom = g.chipTop + g.chip - border;
    const padTop = paddingBoxTop + evalPx(top, env);
    const padBottom = paddingBoxBottom - evalPx(bottom, env);
    const height = +(padBottom - padTop).toFixed(4);

    assert.ok(height >= 44, `on ${what} the dock pad is only ${height}px tall`);
    assert.ok(
      padTop >= 0 && padTop <= 1.01,
      `on ${what} the dock pad starts ${padTop}px below the painted bar's top edge; it is `
      + 'supposed to fill the bar, so it must not drift when the chips move',
    );
    assert.ok(
      g.painted - padBottom >= 0 && g.painted - padBottom <= 1.01,
      `on ${what} the dock pad stops ${(g.painted - padBottom).toFixed(2)}px short of the `
      + 'painted bar\'s bottom edge (or runs past it)',
    );
  }
});

test('nothing about the dock grew: the box and the painted bar keep their heights', () => {
  for (const { raw } of DEVICES) {
    const g = geometry(raw);
    const env = { ...tokens, '--native-safe-area-bottom': `${raw}px` };
    assert.equal(evalPx(declaration('.mobile-pdf-dock', 'height'), env), 52 + g.inset);
    assert.equal(g.painted, 36 + g.inset);
    assert.equal(g.chip, 30);
  }
});

test('the glyph is the chip\'s own centre, so centring the chip centres the glyph', () => {
  assert.match(ruleBody('.mobile-pdf-dock__side'), /place-items: center/);
  const centre = ruleBody('.mobile-pdf-dock__center');
  assert.match(centre, /align-items: center/);
  assert.match(centre, /justify-content: center/);
});
