import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const iconUrl = new URL('../src/assets/icons/callout-arrow-outline.svg', import.meta.url);
const iconsUrl = new URL('../src/Icons.jsx', import.meta.url);

// 2026-09-07 polish pass: the callout glyph was redrawn from the supplied
// 1095-unit filled outline into stroke artwork on the 24-unit grid, so the
// locked sha256 of the old asset and its "exactly two move-to subpaths" shape
// check no longer describe the file. Both are replaced below. The owner's rule
// that nothing may sit inside the bubble is still enforced, now structurally.
const readIcon = async () => (await readFile(iconUrl, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');

test('callout icon keeps an empty bubble — no inner T or underscore', async () => {
  const [icon, iconsSource] = await Promise.all([readIcon(), readFile(iconsUrl, 'utf8')]);

  assert.match(iconsSource, /import calloutIconUrl from '\.\/assets\/icons\/callout-arrow-outline\.svg';/);
  assert.match(iconsSource, /callout:.*renderMaskIcon\(calloutIconUrl,/);
  assert.doesNotMatch(icon, /<script|onload\s*=|<!DOCTYPE|<!ENTITY/i);

  // The bubble, the leader and the arrowhead. Nothing else may be drawn, which
  // is what keeps a "T" or an underscore out of the bubble.
  assert.equal((icon.match(/<rect\b/g) || []).length, 1);
  assert.equal((icon.match(/<path\b/g) || []).length, 2);
  assert.doesNotMatch(icon, /<text\b|<tspan\b|<circle\b|<line\b|<polyline\b|<polygon\b|<image\b/);
});

test('callout is stroke artwork at the text-box icon weight', async () => {
  const icon = await readIcon();
  assert.match(icon, /viewBox="0 0 24 24"/);
  const widths = new Set([...icon.matchAll(/stroke-width="([\d.]+)"/g)].map((m) => m[1]));
  // Same weight as text-box-selection.svg, the icon it sits beside.
  assert.deepEqual([...widths], ['1.5']);
  assert.match(icon, /stroke-linecap="round"/);
  assert.doesNotMatch(icon, /\bfill="(?!none)/);
});

test('callout arrowhead is big enough to survive 1x', async () => {
  const icon = await readIcon();
  const head = /<path d="M([\d. ]+)"\/>\s*<\/svg>/.exec(icon)[1].trim().split(/\s+/).map(Number);
  const [b1x, b1y, tx, ty, b2x, b2y] = head;
  const len = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  const l1 = len(b1x, b1y, tx, ty);
  const l2 = len(b2x, b2y, tx, ty);
  // The old filled wedge collapsed into an unreadable nub at deviceScaleFactor
  // 1. At the 20px sub-toolbar size one viewBox unit is 0.83px, so barbs must
  // stay well over 4 units to keep more than 3px of readable arrowhead.
  assert.ok(l1 > 4.2 && l2 > 4.2, `arrowhead barbs ${l1.toFixed(2)} / ${l2.toFixed(2)} units are too short`);
  // ...and the head must stay wide open. A narrow head puts two diagonals on
  // top of each other and rasterises back into a nub; ~90 degrees lands one
  // barb near-horizontal and one near-vertical, on the pixel grid.
  const a1 = Math.atan2(b1y - ty, b1x - tx);
  const a2 = Math.atan2(b2y - ty, b2x - tx);
  const open = Math.abs(((a1 - a2 + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * (180 / Math.PI);
  assert.ok(open > 70 && open < 110, `arrowhead opens ${open.toFixed(1)} degrees, want ~90`);
});

test('callout ink is centred with the house optical margin', async () => {
  const icon = await readIcon();
  const half = 1.5 / 2;
  const rect = /<rect[^>]*>/.exec(icon)[0];
  const num = (s, k) => Number(new RegExp(`${k}="([-\\d.]+)"`).exec(s)[1]);
  const xs = [num(rect, 'x') - half, num(rect, 'x') + num(rect, 'width') + half];
  const ys = [num(rect, 'y') - half, num(rect, 'y') + num(rect, 'height') + half];
  for (const m of icon.matchAll(/<path d="M([\d. ]+)"/g)) {
    const p = m[1].trim().split(/\s+/).map(Number);
    for (let i = 0; i < p.length; i += 2) {
      xs.push(p[i] - half, p[i] + half);
      ys.push(p[i + 1] - half, p[i + 1] + half);
    }
  }
  const x0 = Math.min(...xs); const x1 = Math.max(...xs);
  const y0 = Math.min(...ys); const y1 = Math.max(...ys);
  // 83% fill matches text-box-selection.svg, the house single-form reference.
  assert.ok(x1 - x0 >= 19.5 && x1 - x0 <= 20.5, `ink width ${(x1 - x0).toFixed(2)}`);
  assert.ok(y1 - y0 >= 19.0 && y1 - y0 <= 20.5, `ink height ${(y1 - y0).toFixed(2)}`);
  assert.ok(Math.abs((x0 + x1) / 2 - 12) < 0.2, `ink centre x ${((x0 + x1) / 2).toFixed(2)}`);
  assert.ok(Math.abs((y0 + y1) / 2 - 12) < 0.2, `ink centre y ${((y0 + y1) / 2).toFixed(2)}`);
});
