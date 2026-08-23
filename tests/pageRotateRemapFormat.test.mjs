import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for remapped color / font / callout style after page CW.
// Live proof: debug/scenarios/e2e-page-rotate-remap-format.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('font catalogs stay single-name; no leftover-portrait pageWidth in style apply', () => {
  const catalog = read('src/utils/annotationStyleCatalog.js');
  const families = catalog.match(/export const FONT_FAMILIES = Object\.freeze\(\[([\s\S]*?)\]\)/)?.[1] || '';
  assert.match(families, /Times New Roman/);
  assert.match(families, /Helvetica/);
  assert.doesNotMatch(families, /-apple-system|BlinkMacSystemFont|sans-serif/);
  assert.match(catalog, /Never put a CSS fallback stack in FONT_FAMILIES/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /pageWidth:\s*612/);
});

test('remapped-format spec applies chip + hex + font + arrowhead without a mouse remapper', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-format.spec.mjs');
  assert.match(spec, /#FF0000/);
  assert.match(spec, /Times New Roman/);
  assert.match(spec, /Arrowhead|Font color|Style/);
  assert.match(spec, /isSingleNameFontFamily/);
  assert.match(spec, /Escape skip-commit/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /must not stamp file\.id/);
  assert.doesNotMatch(spec, /mouse-coord remapper|clientX \* \(792 \/ 612\)/);
});
