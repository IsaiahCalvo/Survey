// Nightly 'tool-style-preview' (Drawboard PDF Pro push 2026-11-12, the pen
// panel's live preview): the desktop colour popover draws what the tool will.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewPaint, toolStylePreview } from '../src/utils/toolStylePreview.js';

test('a shape shows its fill, border, width and line style', () => {
  const p = toolStylePreview({ activeTool: 'rect', strokeColor: '#ff0000', strokeOpacity: 100, fillColor: '#00ff00', fillOpacity: 50, strokeWidthInputValue: 3, lineBorderStyle: 'dashed' });
  assert.deepEqual(p, { kind: 'shape', shape: 'rect', stroke: 'rgba(255, 0, 0, 1)', fill: 'rgba(0, 255, 0, 0.5)', width: 3, lineStyle: 'dashed' });
  // Cloud only where the tool takes it.
  assert.equal(toolStylePreview({ activeTool: 'ellipse', lineBorderStyle: 'cloud', supportsCloudStyle: true }).lineStyle, 'cloud');
  assert.equal(toolStylePreview({ activeTool: 'ellipse', lineBorderStyle: 'cloud', supportsCloudStyle: false }).lineStyle, 'solid');
});

test('strokes, lines, arrows and counters', () => {
  assert.equal(toolStylePreview({ activeTool: 'pen', lineBorderStyle: 'dashed' }).lineStyle, 'solid');
  assert.equal(toolStylePreview({ activeTool: 'pen' }).kind, 'stroke');
  assert.equal(toolStylePreview({ activeTool: 'polyline' }).kind, 'polyline');
  const arrow = toolStylePreview({ activeTool: 'arrow', arrowheadStyle: 'openArrow', lineBorderStyle: 'dotted' });
  assert.equal(arrow.kind, 'line');
  assert.equal(arrow.arrowhead, 'openArrow');
  assert.equal(arrow.lineStyle, 'dotted');
  assert.equal(toolStylePreview({ activeTool: 'line' }).arrowhead, 'none');
  assert.equal(toolStylePreview({ activeTool: 'counter', strokeWidthInputValue: 20 }).kind, 'counter');
  // A picked mark's own tool wins over the armed one.
  assert.equal(toolStylePreview({ activeTool: 'select', contextTool: 'ellipse' }).shape, 'ellipse');
});

test('no preview for text, eraser or nothing', () => {
  for (const tool of ['text', 'callout', 'eraser', 'select', 'pan', 'text-select']) {
    assert.equal(toolStylePreview({ activeTool: tool }), null, tool);
  }
  assert.equal(toolStylePreview(null), null);
});

test('previewPaint reads hex, short hex and rgb', () => {
  assert.equal(previewPaint('#abc', 100, '#000000'), 'rgba(170, 187, 204, 1)');
  assert.equal(previewPaint('rgb(1, 2, 3)', 25, '#000000'), 'rgba(1, 2, 3, 0.25)');
  assert.equal(previewPaint('nope', undefined, '#ff0000'), 'rgba(255, 0, 0, 1)');
});

test('AppShell draws it above the picker behind the flag', () => {
  const src = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  assert.match(src, /const \[toolStylePreviewOn\] = useState\(\(\) => isFeatureOn\('tool-style-preview'\)\);/);
  assert.match(src, /\{toolStylePreviewOn && !isTextMarkupPalette && \(\(\) => \{\n\s+const preview = toolStylePreview\(bottomToolbarApi\);/);
  const mig = readFileSync(new URL('../supabase/migrations/20261112096000_tool_style_preview_flag.sql', import.meta.url), 'utf8');
  assert.match(mig, /'tool-style-preview', 'off'/);
});
