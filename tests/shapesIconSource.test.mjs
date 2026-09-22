import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

// 2026-09-07 polish pass: the Shapes group glyph was redrawn from the supplied
// filled artwork to stroke artwork on the 24-unit grid, so the old path-literal
// assertions no longer describe it. They are replaced by the properties that
// actually had to hold: same composition (circle + square + triangle), ONE
// stroke weight, and a real optical margin instead of an edge-to-edge box.
test('Shapes category keeps the circle, square and triangle composition', async () => {
  const [icon, icons, shell, mobile] = await Promise.all([
    read('../src/assets/icons/shapes.svg'),
    read('../src/Icons.jsx'),
    read('../src/AppShell.jsx'),
    read('../src/mobile/MobilePdfViewerChrome.jsx'),
  ]);

  assert.match(icon, /<circle\b/);
  assert.match(icon, /<rect\b/);
  assert.match(icon, /<path d="M[\d.]+ [\d.]+ [\d.]+ [\d.]+ [\d.]+ [\d.]+Z"/);
  assert.doesNotMatch(icon, /<!DOCTYPE|<metadata|<!ENTITY|<script|onload\s*=/i);
  assert.match(icons, /import shapesIconUrl from '\.\/assets\/icons\/shapes\.svg';/);
  assert.match(icons, /shapes:.*renderMaskIcon\(shapesIconUrl,/);
  // DELIBERATE ASSERTION CHANGE (2026-09-21, pass 7 — owner-approved artboards
  // 8-14): a tool glyph in the document chrome is 16 inside a 28px button, not
  // 18 inside 34. The assertion now pins the shared CHROME_GLYPH constant
  // rather than a literal, so the bar and the sub-row can never disagree again.
  assert.match(shell, /aria-label="Shapes"[\s\S]{0,500}<Icon name="shapes" size=\{CHROME_GLYPH\}/);
  assert.match(mobile, /shape:\s*\{[\s\S]{0,100}icon: 'shapes'/);
  assert.match(mobile, /\{ id: 'rect', label: 'Rectangle', icon: 'rect' \}/);
});

test('Shapes glyph is one stroke weight on the 24-unit grid', async () => {
  const icon = await read('../src/assets/icons/shapes.svg');
  assert.match(icon, /viewBox="0 0 24 24"/);
  // Exactly one stroke-width declaration, set on the root, shared by all three
  // sub-forms. The old filled artwork mixed 2.0-unit and ~1.6-unit line weights.
  const widths = new Set([...icon.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => m[1]));
  // DELIBERATE ASSERTION CHANGE (2026-09-16, icon-set consistency pass): 1.7 ->
  // 1.5. The 1.7 was an optical compensation for a row where Shapes rendered at
  // 18px and Pan at 20px; the whole row renders at one size now, so 1.7 stopped
  // matching Pan and started reading 13% heavier than it. Owner ruling of this
  // pass: one stroke weight across the set. What this test guards — ONE weight,
  // never the old artwork's mixed 2.0 and ~1.6 — is unchanged.
  assert.deepEqual([...widths], ['1.5'], 'one weight only across all three forms');
  assert.doesNotMatch(icon.replace(/<!--[\s\S]*?-->/g, ''), /\bfill="(?!none)/);
});

test('Shapes glyph keeps an optical margin instead of touching its box', async () => {
  const icon = (await read('../src/assets/icons/shapes.svg')).replace(/<!--[\s\S]*?-->/g, '');
  const half = 1.7 / 2;
  const num = (s, k) => Number(new RegExp(`${k}="([-\\d.]+)"`).exec(s)[1]);

  const circle = /<circle[^>]*>/.exec(icon)[0];
  const rect = /<rect[^>]*>/.exec(icon)[0];
  const tri = [...(/<path d="M([\d. ]+)Z"/.exec(icon)[1]).trim().split(/\s+/).map(Number)];

  const xs = [];
  const ys = [];
  xs.push(num(circle, 'cx') - num(circle, 'r') - half, num(circle, 'cx') + num(circle, 'r') + half);
  ys.push(num(circle, 'cy') - num(circle, 'r') - half, num(circle, 'cy') + num(circle, 'r') + half);
  xs.push(num(rect, 'x') - half, num(rect, 'x') + num(rect, 'width') + half);
  ys.push(num(rect, 'y') - half, num(rect, 'y') + num(rect, 'height') + half);
  for (let i = 0; i < tri.length; i += 2) {
    xs.push(tri[i] - half, tri[i] + half);
    ys.push(tri[i + 1] - half, tri[i + 1] + half);
  }

  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  const y0 = Math.min(...ys); const y1 = Math.max(...ys);

  // Optical margin: the old artwork filled 100% of the box, so it read bigger
  // and heavier than every neighbour. A composite glyph is allowed to run a
  // little larger than a single form, but never edge to edge.
  assert.ok(x1 - x0 <= 21 && y1 - y0 <= 21, `ink envelope ${(x1 - x0).toFixed(2)}x${(y1 - y0).toFixed(2)} must leave a margin`);
  assert.ok(x1 - x0 >= 19.5 && y1 - y0 >= 19.5, 'and must not shrink below the row size');
  // Centred on its own ink, so the row needs no translateY nudges.
  assert.ok(Math.abs((x0 + x1) / 2 - 12) < 0.15, `ink centre x ${((x0 + x1) / 2).toFixed(2)}`);
  assert.ok(Math.abs((y0 + y1) / 2 - 12) < 0.15, `ink centre y ${((y0 + y1) / 2).toFixed(2)}`);

  // Round-vs-square overshoot: the circle must read the same size as the square,
  // which means measuring 2-4% larger.
  const circleD = 2 * (num(circle, 'r') + half);
  const squareD = num(rect, 'width') + 2 * half;
  const overshoot = (circleD / squareD - 1) * 100;
  assert.ok(overshoot > 1 && overshoot < 6, `circle overshoot ${overshoot.toFixed(1)}% should be ~2-4%`);
});
