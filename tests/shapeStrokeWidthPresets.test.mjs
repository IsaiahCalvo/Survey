import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAnnotationSize, sanitizeAnnotationSizeDraft } from '../src/utils/annotationSize.js';
import {
  buildLineCommitJSON,
  buildBoundaryShapeCommitJSON,
} from '../src/utils/annotationCreationCommit.js';

// Source contracts for Line / Arrow / shape Width (same 12-preset chrome as
// Pen, different apply path: strokeWidth / callout lineThickness, not Pen
// sourceWidth + baked outline 0). Live proof:
// debug/scenarios/e2e-shape-stroke-width-presets.spec.mjs

const WIDTH_PRESETS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Line/Arrow/shape Width reuses the 12-preset catalog and selected-patch apply path', () => {
  const size = read('src/components/AnnotationSizeControl.jsx');
  assert.match(size, /width: \[1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50\]/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /contextTool === 'arrow'/);
  assert.match(shell, /contextTool === 'line'/);
  assert.match(shell, /contextTool === 'rect'/);
  assert.match(shell, /contextTool === 'callout'/);
  assert.match(shell, /ANNOTATION_SIZE_PRESETS\.width/);
  assert.match(shell, /handleStrokeWidthInputChange/);
  assert.match(shell, /handleStrokeWidthInputBlur/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /handlePatchSelectedAnnotation\(\{ strokeWidth: width \}\)/);
  assert.match(viewer, /handlePatchSelectedCallout\(\{ lineThickness: Math\.max\(1, Number\(width\) \|\| 2\) \}\)/);
  assert.match(viewer, /const maxWidth = isCounterSize \? COUNTER_SIZE_MAX : 50/);

  const defaults = read('src/hooks/useDatabase.js');
  assert.match(defaults, /line: \{ strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100 \}/);
  assert.match(defaults, /arrow: \{ strokeColor: '#ff0000', strokeWidth: 2, strokeOpacity: 100 \}/);
  assert.match(defaults, /rect: \{ strokeColor: '#ff0000', strokeWidth: 2,/);

  for (const n of WIDTH_PRESETS) {
    assert.equal(normalizeAnnotationSize(n, 1, 50), n);
  }
  assert.equal(normalizeAnnotationSize(0, 1, 50), 1);
  assert.equal(normalizeAnnotationSize(999, 1, 50), 50);
  assert.equal(normalizeAnnotationSize('abc', 1, 50), 1);
  assert.equal(normalizeAnnotationSize(7, 1, 50), 7);
  assert.equal(sanitizeAnnotationSizeDraft('7'), '7');
  assert.equal(sanitizeAnnotationSizeDraft('abc'), null);
  assert.equal(sanitizeAnnotationSizeDraft('12.5'), null);
});

test('Line/Arrow/Rect create stamps strokeWidth as-is; callout create uses lineThickness', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /lineThickness: Math\.max\(1, Number\(strokeWidth\) \|\| 2\)/);

  const line = buildLineCommitJSON({
    tool: 'line',
    id: 'line-width-1',
    start: { x: 20, y: 40 },
    end: { x: 180, y: 48 },
    strokeColor: '#ff0000',
    strokeOpacity: 100,
    strokeWidth: 1,
  });
  assert.equal(line.tool, 'line');
  assert.equal(line.strokeWidth, 1);
  assert.equal(line.sourceWidth, undefined);

  const thick = buildLineCommitJSON({
    tool: 'line',
    id: 'line-width-50',
    start: { x: 20, y: 80 },
    end: { x: 180, y: 88 },
    strokeColor: '#ff0000',
    strokeOpacity: 100,
    strokeWidth: 50,
  });
  assert.equal(thick.strokeWidth, 50);

  const custom = buildLineCommitJSON({
    tool: 'arrow',
    id: 'arrow-width-7',
    start: { x: 20, y: 120 },
    end: { x: 180, y: 128 },
    strokeColor: '#0000ff',
    strokeOpacity: 100,
    strokeWidth: 7,
    arrowheadStyle: 'solid-triangle',
  });
  assert.equal(custom.tool, 'arrow');
  assert.equal(custom.strokeWidth, 7);
  assert.equal(custom.data.arrowheadStyle, 'solid-triangle');

  const rect = buildBoundaryShapeCommitJSON({
    tool: 'rect',
    id: 'rect-width-12',
    start: { x: 40, y: 200 },
    end: { x: 160, y: 280 },
    strokeColor: '#00ff00',
    strokeOpacity: 100,
    fillColor: '#ffffff',
    fillOpacity: 0,
    strokeWidth: 12,
  });
  assert.equal(rect.type, 'Rect');
  assert.equal(rect.strokeWidth, 12);
  assert.equal(rect.sourceWidth, undefined);
});
