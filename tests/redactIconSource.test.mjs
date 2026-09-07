import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 2026-09-07 polish pass (A5). New test — the redact glyph had no source guard.
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const icon = async () => (await read('../src/assets/icons/text-redact.svg')).replace(/<!--[\s\S]*?-->/g, '');

test('the text-markup row renders every glyph at one size', async () => {
  const bar = await read('../src/components/TextSelectionActionBar.jsx');
  // Redact used to override to size 21 in a row of 18s, which is what made it
  // the widest thing there. No per-icon size overrides in this row.
  assert.doesNotMatch(bar, /<ToolIcon[^>]*\bsize=\{/);
  assert.match(bar, /function ToolIcon\(\{ name, emphasized = false, size = 18 \}\)/);
});

test('redact glyph is on the 24-unit grid at one stroke weight', async () => {
  const svg = await icon();
  assert.match(svg, /viewBox="0 0 24 24"/);
  const widths = new Set([...svg.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...widths], ['1.75']);
  assert.doesNotMatch(svg, /<script|onload\s*=|<!DOCTYPE|<!ENTITY/i);
});

test('redact keeps a solid bar that outweighs the letter strokes', async () => {
  const svg = await icon();
  const rect = /<rect[^>]*>/.exec(svg);
  assert.ok(rect, 'the redaction bar must stay a solid rect, not a stroke');
  assert.match(rect[0], /fill="#000"/);
  assert.match(rect[0], /stroke="none"/);
  const h = Number(/height="([\d.]+)"/.exec(rect[0])[1]);
  const w = Number(/width="([\d.]+)"/.exec(rect[0])[1]);
  // Slimming the bar to the row's stroke weight was tried and killed the
  // meaning — the glyph just read as the letter A. The bar must stay clearly
  // heavier than the strokes, and wide enough to overhang the letter.
  assert.ok(h >= 1.5 * 1.75, `bar height ${h} must stay well above the 1.75 stroke`);
  assert.ok(w >= 14, `bar width ${w} must overhang the letter`);
});

test('redact ink is centred with the house optical margin', async () => {
  const svg = await icon();
  const half = 1.75 / 2;
  const letter = /<path d="M([\d. ]+)"/.exec(svg)[1].trim().split(/\s+/).map(Number);
  const rect = /<rect[^>]*>/.exec(svg)[0];
  const n = (k) => Number(new RegExp(`${k}="([\\d.]+)"`).exec(rect)[1]);
  const xs = [n('x'), n('x') + n('width')];
  const ys = [n('y'), n('y') + n('height')];
  for (let i = 0; i < letter.length; i += 2) {
    xs.push(letter[i] - half, letter[i] + half);
    ys.push(letter[i + 1] - half, letter[i + 1] + half);
  }
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  // Target from the brief: ~15-16 units of ink height per 18 of box, i.e. about
  // 20 of 24 here, with a real margin rather than an edge-to-edge glyph.
  assert.ok(y1 - y0 >= 19 && y1 - y0 <= 20.5, `ink height ${(y1 - y0).toFixed(2)}`);
  assert.ok(x1 - x0 >= 17.5 && x1 - x0 <= 20.5, `ink width ${(x1 - x0).toFixed(2)}`);
  assert.ok(Math.abs((x0 + x1) / 2 - 12) < 0.2, `ink centre x ${((x0 + x1) / 2).toFixed(2)}`);
  assert.ok(Math.abs((y0 + y1) / 2 - 12) < 0.2, `ink centre y ${((y0 + y1) / 2).toFixed(2)}`);
});
