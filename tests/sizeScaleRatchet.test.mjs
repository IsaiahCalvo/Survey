// Design review 2026-10-27: the app had about 19 text sizes and 15 corner
// sizes, set by hand in CSS and inline styles, plus colours typed straight
// into JSX. That is the root of most of the look drift. The short scale lives
// in src/styles/tokens.css (--font-size-*, --radius-*). This test is a
// ratchet: the count of off-scale sizes and of typed-in colours may only go
// DOWN. When you clean some up, lower the number here in the same change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

// The scale. Text: 10 (tiny badge), 11 (label), 12 (small), 13 (body and
// menus), 14, 16 (field on a phone, sheet rows), 18 and up for titles.
// Corners: 0, 2, 4, 6, 8, 10 (dialogs), 16 (phone sheets), 999 (pills),
// plus 50% for circles.
const FONT_SCALE = new Set([10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 30, 32, 40]);
const RADIUS_SCALE = new Set([0, 2, 4, 6, 8, 10, 12, 16, 999]);

// Today's counts (2026-10-27). Lower them as you clean up; never raise them.
const MAX = { offScaleFont: 88, offScaleRadius: 91, hexInJsx: 406 };

function files(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { if (!['__tests__', 'prototype'].includes(name)) files(path, out); }
    else if (/\.(jsx|css)$/.test(name)) out.push(path);
  }
  return out;
}

export function measure() {
  let offScaleFont = 0; let offScaleRadius = 0; let hexInJsx = 0;
  for (const path of files(join(root, 'src'))) {
    const text = readFileSync(path, 'utf8');
    const css = path.endsWith('.css');
    const fonts = css
      ? [...text.matchAll(/font-size:\s*([0-9.]+)px/g)]
      : [...text.matchAll(/fontSize:\s*['"]?([0-9.]+)(?:px)?['"]?\s*[,}]/g)];
    offScaleFont += fonts.filter((m) => !FONT_SCALE.has(Number(m[1]))).length;
    const radii = css
      ? [...text.matchAll(/border-radius:\s*([0-9.]+)px\s*[;}]/g)]
      : [...text.matchAll(/borderRadius:\s*['"]?([0-9.]+)(?:px)?['"]?\s*[,}]/g)];
    offScaleRadius += radii.filter((m) => !RADIUS_SCALE.has(Number(m[1]))).length;
    if (!css) hexInJsx += (text.match(/['"`]#[0-9a-fA-F]{3,8}\b/g) || []).length;
  }
  return { offScaleFont, offScaleRadius, hexInJsx };
}

test('the size scale tokens exist', () => {
  const tokens = readFileSync(join(root, 'src/styles/tokens.css'), 'utf8');
  for (const [name, px] of [['xs', 10], ['sm', 11], ['md', 12], ['base', 13], ['lg', 14], ['xl', 16], ['2xl', 18]]) {
    assert.match(tokens, new RegExp(`--font-size-${name}: ${px}px;`), name);
  }
  for (const name of ['xs', 'sm', 'md', 'dialog', 'lg', 'pill']) assert.match(tokens, new RegExp(`--radius-${name}:`), name);
});

test('off-scale text sizes, corners and typed-in colours do not grow', () => {
  const now = measure();
  for (const key of Object.keys(MAX)) {
    assert.ok(now[key] <= MAX[key], `${key}: ${now[key]} is over the ratchet (${MAX[key]}). Use the tokens.css scale instead of a new hand-set value.`);
  }
});
