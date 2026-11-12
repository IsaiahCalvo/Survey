// Phone tool sheet: with Line style Cloud, the preview draws a cloud outline
// (Drawboard PDF Pro push 2026-11-12, apps-side-by-side.md, style sheet row).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/mobile/MobileToolSheetControls.jsx', import.meta.url), 'utf8');
const fnSrc = src.slice(src.indexOf('export function cloudPreviewPath'), src.indexOf('const PREVIEW_RINGS')).replace('export ', '');
// eslint-disable-next-line no-new-func
const cloudPreviewPath = new Function(`${fnSrc}; return cloudPreviewPath;`)();

test('cloud preview path: one arc per bump, closed, nothing for fewer than 3 points', () => {
  const d = cloudPreviewPath([[0, 0], [100, 0], [100, 20], [0, 20]], 10);
  assert.match(d, /^M0\.00 0\.00 /);
  assert.match(d, / Z$/);
  assert.equal((d.match(/ A/g) || []).length, 10 + 2 + 10 + 2);
  assert.equal(cloudPreviewPath([[0, 0], [1, 1]]), '');
});

test('the shape preview switches to the cloud path for Line style Cloud', () => {
  assert.match(src, /lineStyle === 'cloud'\s*\?\s*<path d=\{cloudPreviewPath\(PREVIEW_RINGS\[shape\]/);
});
