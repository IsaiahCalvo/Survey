import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAnnotationSize, sanitizeAnnotationSizeDraft } from '../src/utils/annotationSize.js';
import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { buildFreehandCommitJSON } from '../src/utils/annotationCreationCommit.js';

// Source contracts for Pen Width catalog (1–50, 12 presets + custom field).
// Distinct from Eraser Size ([1,4,8,…,100], 1–100) and Counter Size
// ([5,8,12,16,24,32,48,64], 4–76). Live proof:
// debug/scenarios/e2e-pen-width-presets.spec.mjs

const WIDTH_PRESETS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Pen Width catalog is 12 discrete presets, 1–50, labeled Width not Size', () => {
  const size = read('src/components/AnnotationSizeControl.jsx');
  assert.match(size, /width: \[1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50\]/);
  assert.match(size, /eraser: \[1, 4, 8, 12, 16, 24, 32, 48, 64, 80, 100\]/);
  assert.match(size, /counter: \[5, 8, 12, 16, 24, 32, 48, 64\]/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /contextTool === 'pen'/);
  assert.match(shell, /contextTool === 'counter' \|\| bottomToolbarApi\.activeTool === 'eraser' \? 'Size' : 'Width'/);
  assert.match(shell, /activeTool === 'eraser'\s*\n\s*\? 100/);
  assert.match(shell, /: 50\}/);
  assert.match(shell, /ANNOTATION_SIZE_PRESETS\.width/);
  assert.match(shell, /handleStrokeWidthInputChange/);
  assert.doesNotMatch(shell, /type="range"[^>]*Width/i);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /isEraser \|\| tool === 'counter' \? 'Size' : 'Width'/);
  assert.match(mobile, /isEraser \? 100 : tool === 'counter' \? COUNTER_SIZE_MAX : 50/);
  assert.match(mobile, /ANNOTATION_SIZE_PRESETS\.width/);

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

test('Pen create stamps sourceWidth as-is; highlighter stamps as-is; outline strokeWidth is 0', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const maxWidth = isCounterSize \? COUNTER_SIZE_MAX : 50/);
  assert.match(viewer, /const \[strokeWidth, setStrokeWidth\] = useState\(3\)/);

  const defaults = read('src/hooks/useDatabase.js');
  assert.match(defaults, /pen: \{ strokeColor: '#ff0000', strokeWidth: 3, strokeOpacity: 100 \}/);
  assert.match(defaults, /highlighter: \{ strokeColor: '#ffff00', strokeWidth: 20, strokeOpacity: 50 \}/);

  const commit = read('src/utils/annotationCreationCommit.js');
  assert.match(commit, /width: strokeWidth,/);
  assert.doesNotMatch(commit, /width: tool === 'highlighter' \? Math\.max\(strokeWidth, 8\)/);

  const pen = createProductionPaperInk({
    id: 'pen-width-1',
    tool: 'pen',
    points: [{ x: 10, y: 20 }, { x: 80, y: 20 }],
    color: '#ff0000',
    width: 1,
  });
  assert.equal(pen.tool, 'pen');
  assert.equal(pen.sourceWidth, 1);
  assert.equal(pen.strokeWidth, 0);
  assert.equal(pen.paperInkGeometry, 'v1');

  const custom = createProductionPaperInk({
    id: 'pen-width-7',
    tool: 'pen',
    points: [{ x: 10, y: 20 }, { x: 80, y: 20 }],
    color: '#ff0000',
    width: 7,
  });
  assert.equal(custom.sourceWidth, 7);

  const thick = createProductionPaperInk({
    id: 'pen-width-50',
    tool: 'pen',
    points: [{ x: 10, y: 20 }, { x: 80, y: 20 }],
    color: '#ff0000',
    width: 50,
  });
  assert.equal(thick.sourceWidth, 50);

  const highlight = buildFreehandCommitJSON({
    id: 'hl-width-1',
    tool: 'highlighter',
    points: [{ x: 10, y: 20 }, { x: 80, y: 20 }],
    strokeColor: '#ffff00',
    strokeWidth: 1,
  });
  assert.equal(highlight.tool, 'highlighter');
  assert.equal(highlight.sourceWidth, 1);

  const highlightWide = buildFreehandCommitJSON({
    id: 'hl-width-20',
    tool: 'highlighter',
    points: [{ x: 10, y: 20 }, { x: 80, y: 20 }],
    strokeColor: '#ffff00',
    strokeWidth: 20,
  });
  assert.equal(highlightWide.sourceWidth, 20);

  const penCommit = buildFreehandCommitJSON({
    id: 'pen-commit-1',
    tool: 'pen',
    points: [{ x: 10, y: 20 }, { x: 80, y: 20 }],
    strokeColor: '#ff0000',
    strokeWidth: 1,
  });
  assert.equal(penCommit.tool, 'pen');
  assert.equal(penCommit.sourceWidth, 1);
});
