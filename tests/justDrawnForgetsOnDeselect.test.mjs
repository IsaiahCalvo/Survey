// Review round 9 (2026-10-04): the SVG layer remembered "the mark just drawn"
// until the tool changed. Draw a rectangle, press Escape (pick gone), set the
// Rectangle tool to 8 pt, click the rectangle again and pick 4 pt in the bar:
// the re-pick still counted as "just drawn", so the bar worked for the TOOL -
// the Rectangle's saved width became 4 pt (every later rectangle drew at 4),
// although the bar had shown the mark's own 2 pt. Reproduced in Chromium
// (scratchpad review9/pickedit.mjs): after Escape the bar read 4 pt and the next
// rectangle was 4 pt; with the fix it reads 8 pt and the next one is 8 pt.
// Once the pick is dropped the mark is no longer "just drawn".
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const layerSource = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');

test('an empty pick forgets the just-drawn mark', () => {
  const start = layerSource.indexOf('if (selectedAnnotationIndex == null) {');
  assert.ok(start > 0);
  const branch = layerSource.slice(start, layerSource.indexOf('onSelectionChange({', start));
  assert.match(branch, /if \(annotationIndices\.length === 0\) justDrawnRef\.current = null;/);
});

test('the auto-pick right after drawing is still "just drawn" (owner Test 15)', () => {
  assert.match(layerSource, /justDrawnRef\.current = \{ id: getAnnotationRenderIdentity\(json\)\.annotationId, tool: activeTool \};\s*selectAnnotation\(/);
  assert.match(layerSource, /justDrawn: Boolean\(drawn && drawn\.id && drawn\.id === annotationIds\[0\] && drawn\.tool === activeTool\)/);
});
