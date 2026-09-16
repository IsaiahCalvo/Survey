import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const iconUrl = new URL('../src/assets/icons/callout-arrow-outline.svg', import.meta.url);
const iconsUrl = new URL('../src/Icons.jsx', import.meta.url);

// 2026-09-07 polish pass: the callout glyph was redrawn from the supplied
// 1095-unit filled outline into stroke artwork on the 24-unit grid, so the
// locked sha256 of the old asset and its "exactly two move-to subpaths" shape
// check no longer describe the file. Both are replaced below.
const readIcon = async () => (await readFile(iconUrl, 'utf8')).replace(/<!--[\s\S]*?-->/g, '');

// DELIBERATE ASSERTION CHANGE (2026-09-16, icon-set consistency pass): this test
// used to be called "callout icon keeps an empty bubble — no inner T or
// underscore" and required exactly one rect and two paths so that nothing could
// be drawn inside the bubble. The owner has reversed that rule: the callout glyph
// must show a T inside its box plus its leader, matching the text-box glyph's T,
// because an empty rounded box with a leader did not read as a TEXT callout and
// was indistinguishable in kind from the Rectangle tool glyph. The assertions
// below enforce the new rule with the same structural strictness — the bubble,
// the T, the leader and the arrowhead, and nothing else.
test('callout icon shows a T inside the bubble, drawn like the text-box T', async () => {
  const [icon, iconsSource, textBox] = await Promise.all([
    readIcon(),
    readFile(iconsUrl, 'utf8'),
    readFile(new URL('../src/assets/icons/text-box-selection.svg', import.meta.url), 'utf8'),
  ]);

  assert.match(iconsSource, /import calloutIconUrl from '\.\/assets\/icons\/callout-arrow-outline\.svg';/);
  assert.match(iconsSource, /callout:.*renderMaskIcon\(calloutIconUrl,/);
  assert.doesNotMatch(icon, /<script|onload\s*=|<!DOCTYPE|<!ENTITY/i);

  // The bubble, the T's bar and stem, the leader and the arrowhead. Nothing else.
  assert.equal((icon.match(/<rect\b/g) || []).length, 1);
  assert.equal((icon.match(/<path\b/g) || []).length, 4);
  assert.doesNotMatch(icon, /<text\b|<tspan\b|<circle\b|<line\b|<polyline\b|<polygon\b|<image\b/);

  // The T is a horizontal bar with a stem hung from its middle, which is exactly
  // how text-box-selection.svg draws its T (M9 9H15 plus M12 15L12 9).
  const bar = /<path d="M([\d.]+) ([\d.]+)H([\d.]+)"\/>/.exec(icon);
  const stem = /<path d="M([\d.]+) ([\d.]+)V([\d.]+)"\/>/.exec(icon);
  assert.ok(bar, 'callout needs a horizontal T bar');
  assert.ok(stem, 'callout needs a vertical T stem');
  assert.match(textBox, /d="M9 9H15"/);
  assert.match(textBox, /d="M12 15L12 9"/);

  const barY = Number(bar[2]);
  const barX0 = Number(bar[1]);
  const barX1 = Number(bar[3]);
  const stemX = Number(stem[1]);
  const stemY0 = Number(stem[2]);
  const stemY1 = Number(stem[3]);
  assert.equal(stemY0, barY, 'the stem hangs from the bar');
  assert.ok(Math.abs(stemX - (barX0 + barX1) / 2) < 0.05, 'the stem is centred on the bar');

  // Square like the text-box T (6 x 6 in a 16-unit box), and inside the bubble
  // with an even margin top and bottom.
  const rect = /<rect[^>]*>/.exec(icon)[0];
  const num = (k) => Number(new RegExp(`${k}="([-\\d.]+)"`).exec(rect)[1]);
  const barW = barX1 - barX0;
  const stemH = stemY1 - stemY0;
  assert.ok(Math.abs(barW - stemH) < 0.05, `T is ${barW} x ${stemH}, must be square`);
  const inner = [num('y') + 0.75, num('y') + num('height') - 0.75];
  assert.ok(Math.abs((barY - inner[0]) - (inner[1] - stemY1)) < 0.1, 'T sits centred in the bubble');
  assert.ok(barW / num('height') > 0.3 && barW / num('height') < 0.5, `T is ${(barW / num('height') * 100).toFixed(0)}% of the bubble, want ~37%`);
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
