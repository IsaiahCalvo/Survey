import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for remapped in-place text edit + opacity/width after page CW.
// Live proof: debug/scenarios/e2e-page-rotate-remap-text-opacity-width.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('remapped text/opacity/width spec covers edit + skip-commit without a mouse remapper', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-remap-text-opacity-width.spec.mjs');
  assert.match(spec, /enterRemappedEdit/);
  assert.match(spec, /BETA/);
  assert.match(spec, /isSingleNameFontFamily/);
  assert.match(spec, /Opacity percentage/);
  assert.match(spec, /Width presets/);
  assert.match(spec, /Escape skip-commit does not apply text/);
  assert.match(spec, /Escape skip-commit does not apply width/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /must not stamp file\.id/);
  assert.doesNotMatch(spec, /mouse-coord remapper|clientX \* \(792 \/ 612\)/);
});

test('text overlay uses container-aware scale; fontFamily stays a single name', () => {
  const overlay = read('src/components/TextEditOverlay.jsx');
  assert.match(overlay, /host\.offsetWidth/);
  assert.match(overlay, /w \/ pageWidth/);
  assert.match(overlay, /DEFAULT_FONT_FAMILY = 'Helvetica'/);
  assert.doesNotMatch(overlay, /-apple-system|BlinkMacSystemFont/);

  const layer = read('src/components/SVGAnnotationLayer.jsx');
  assert.ok(layer.includes('viewBox={`0 0 ${width} ${height}`}'));
  assert.doesNotMatch(layer, /pageWidth:\s*612/);
});
