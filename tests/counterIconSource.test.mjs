import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// 2026-09-07 polish pass (A6). New test — the counter glyph had no source guard.
const read = (p) => readFile(new URL(p, import.meta.url), 'utf8');
const strip = (s) => s.replace(/<!--[\s\S]*?-->/g, '');

test('Counter is a true circle at the Ellipse glyph geometry', async () => {
  const [icon, icons] = await Promise.all([
    read('../src/assets/icons/counter-outline.svg').then(strip),
    read('../src/Icons.jsx'),
  ]);

  assert.match(icons, /counter:.*renderMaskIcon\(counterIconUrl,/);
  assert.match(icon, /viewBox="0 0 24 24"/);
  assert.doesNotMatch(icon, /<script|onload\s*=|<!DOCTYPE|<!ENTITY/i);

  // The supplied artwork was a hand-sketched 976-unit blob. It must be a real
  // <circle> matching the Ellipse tool icon exactly, so the two read as
  // siblings in the Shapes row.
  const circle = /<circle[^>]*>/.exec(icon);
  assert.ok(circle, 'the ring must be a true circle, not a traced path');
  const n = (k) => Number(new RegExp(`${k}="([\\d.]+)"`).exec(circle[0])[1]);
  assert.equal(n('cx'), 12);
  assert.equal(n('cy'), 12);

  const ellipse = /ellipse: \(size, color, style, className\)[\s\S]{0,600}?<circle[^>]*\/>/.exec(icons)[0];
  const eR = Number(/r="([\d.]+)"/.exec(ellipse)[1]);
  const eW = Number(/strokeWidth="([\d.]+)"/.exec(ellipse)[1]);
  assert.equal(n('r'), eR, 'counter ring radius must match the Ellipse glyph');
  assert.equal(n('stroke-width'), eW, 'counter ring weight must match the Ellipse glyph');
});

test('Counter keeps a hollow ring so the selected state is never a solid disc', async () => {
  const icon = strip(await read('../src/assets/icons/counter-outline.svg'));
  // Owner rule: selected Counter is a gold OUTLINE with a gold inner mark. This
  // renders as a mask, so any filled ring would become a solid gold disc.
  assert.match(icon, /fill="none"/);
  assert.doesNotMatch(icon, /fill="(?!none)[^"]*"/);
});

test('the Counter numeral is heavier than the ring and reads centred', async () => {
  const icon = strip(await read('../src/assets/icons/counter-outline.svg'));
  const numeral = /<path[^>]*>/.exec(icon)[0];
  const ringW = Number(/stroke-width="([\d.]+)"/.exec(/<circle[^>]*>/.exec(icon)[0])[1]);
  const numW = Number(/stroke-width="([\d.]+)"/.exec(numeral)[1]);
  // Optical sizing: the numeral is under half the ring's height, so it needs
  // relatively heavier strokes to read at the same weight.
  assert.ok(numW > ringW, `numeral ${numW} must be heavier than the ring ${ringW}`);
  assert.ok(numW <= ringW * 1.6, 'but not so heavy it reads as a different family');

  const pts = /d="M([\d. ]+)V([\d.]+)"/.exec(numeral);
  const [fx, fy, sx, sy] = pts[1].trim().split(/\s+/).map(Number);
  const bottom = Number(pts[2]);
  const half = numW / 2;
  const inkX0 = Math.min(fx, sx) - half;
  const inkX1 = Math.max(fx, sx) + half;
  // Between stem-centred (reads left) and ink-centred (stem reads right).
  assert.ok(Math.abs((inkX0 + inkX1) / 2 - 12) < 0.6, 'numeral ink must sit near the ring centre');
  assert.ok(sx > 12 && sx < 13.2, `stem at ${sx} should sit just right of the ring centre`);
  // Vertically centred on the ring, and comfortably inside it.
  const inkY0 = Math.min(fy, sy) - half;
  const inkY1 = bottom + half;
  assert.ok(Math.abs((inkY0 + inkY1) / 2 - 12) < 0.4, `numeral ink centre y ${((inkY0 + inkY1) / 2).toFixed(2)}`);
  assert.ok(inkY1 - inkY0 < 13, `numeral height ${(inkY1 - inkY0).toFixed(2)} must stay clear of the ring`);
});
