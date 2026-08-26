import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAnnotationSize, sanitizeAnnotationSizeDraft } from '../src/utils/annotationSize.js';
import { buildFreehandCommitJSON } from '../src/utils/annotationCreationCommit.js';

// Source contracts for Highlighter Width catalog (same 12-preset chrome as
// Pen, as-is sourceWidth including sub-8). Distinct from Line/Arrow
// strokeWidth, Eraser Size, Counter Size.
// Live proof: debug/scenarios/e2e-highlighter-width-presets.spec.mjs

const WIDTH_PRESETS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Highlighter Width reuses the 12-preset Width catalog and 1–50 field clamp', () => {
  const size = read('src/components/AnnotationSizeControl.jsx');
  assert.match(size, /width: \[1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 32, 50\]/);
  assert.match(size, /eraser: \[1, 4, 8, 12, 16, 24, 32, 48, 64, 80, 100\]/);
  assert.match(size, /counter: \[5, 8, 12, 16, 24, 32, 48, 64\]/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /contextTool === 'highlighter'/);
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
  assert.match(mobile, /highlighter: 'Highlighter'/);

  for (const n of WIDTH_PRESETS) {
    assert.equal(normalizeAnnotationSize(n, 1, 50), n);
  }
  assert.equal(normalizeAnnotationSize(0, 1, 50), 1);
  assert.equal(normalizeAnnotationSize(999, 1, 50), 50);
  assert.equal(normalizeAnnotationSize('abc', 1, 50), 1);
  assert.equal(normalizeAnnotationSize(7, 1, 50), 7);
  assert.equal(sanitizeAnnotationSizeDraft('7'), '7');
  assert.equal(sanitizeAnnotationSizeDraft('9'), '9');
  assert.equal(sanitizeAnnotationSizeDraft('abc'), null);
  assert.equal(sanitizeAnnotationSizeDraft('12.5'), null);
});

test('Highlighter create stamps every Width preset as-is, including sub-8', () => {
  const commit = read('src/utils/annotationCreationCommit.js');
  assert.match(commit, /width: strokeWidth,/);
  assert.doesNotMatch(commit, /Math\.max\(strokeWidth, 8\)/);

  const preview = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(preview, /strokeWidth=\{Number\(strokeWidth\) \|\| 3\}/);
  assert.doesNotMatch(preview, /Math\.max\(Number\(strokeWidth\) \|\| 3, 8\)/);

  const pal = read('src/PageAnnotationLayer.jsx');
  assert.match(pal, /const w = strokeWidth;/);
  assert.doesNotMatch(pal, /Math\.max\(strokeWidth, 8\)/);

  const defaults = read('src/hooks/useDatabase.js');
  assert.match(defaults, /highlighter: \{ strokeColor: '#ffff00', strokeWidth: 20, strokeOpacity: 50 \}/);

  const points = [{ x: 10, y: 20 }, { x: 80, y: 20 }];
  for (const preset of WIDTH_PRESETS) {
    const json = buildFreehandCommitJSON({
      id: `hl-width-${preset}`,
      tool: 'highlighter',
      points,
      strokeColor: '#ffff00',
      strokeWidth: preset,
    });
    assert.equal(json.tool, 'highlighter');
    assert.equal(json.sourceWidth, preset, `preset ${preset}`);
    assert.equal(json.strokeWidth, 0);
    assert.equal(json.paperInkGeometry, 'v1');
    assert.equal(json.globalCompositeOperation, 'multiply');
  }

  const custom7 = buildFreehandCommitJSON({
    id: 'hl-width-7',
    tool: 'highlighter',
    points,
    strokeColor: '#ffff00',
    strokeWidth: 7,
  });
  assert.equal(custom7.sourceWidth, 7);

  const custom9 = buildFreehandCommitJSON({
    id: 'hl-width-9',
    tool: 'highlighter',
    points,
    strokeColor: '#ffff00',
    strokeWidth: 9,
  });
  assert.equal(custom9.sourceWidth, 9);

  const pen = buildFreehandCommitJSON({
    id: 'pen-width-1',
    tool: 'pen',
    points,
    strokeColor: '#ff0000',
    strokeWidth: 1,
  });
  assert.equal(pen.tool, 'pen');
  assert.equal(pen.sourceWidth, 1);
  assert.notEqual(pen.globalCompositeOperation, 'multiply');
});
