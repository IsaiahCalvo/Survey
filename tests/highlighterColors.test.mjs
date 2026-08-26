import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { COLOR_PICKER_PRESETS } from '../src/utils/annotationStyleCatalog.js';
import { buildFreehandCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { composeColorForPatch } from '../src/utils/annotationData.js';

const MOBILE_ANNOTATION_COLORS = [
  '#ff0000',
  '#4A90E2',
  '#27C07D',
  '#F4D35E',
  '#ffffff',
  '#1e293b',
  '#C7A7FF',
  '#FF8A3D',
  '#000000',
];

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('highlighter highlightColor is picker-derived, not hardcoded yellow', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.equal(
    (viewer.match(/highlightColor="rgba\(255,\s*193,\s*7,\s*0\.3\)"/g) || []).length,
    0,
    'PDFViewer must not hardcode highlighter yellow',
  );
  assert.match(viewer, /highlightColor=\{composeColorForPatch\(strokeColor, strokeOpacity\)\}/);
  assert.equal(
    (viewer.match(/highlightColor=\{composeColorForPatch\(strokeColor, strokeOpacity\)\}/g) || []).length,
    2,
    'legacy PAL + live SVG both take the Color picker composition',
  );

  const commit = read('src/utils/annotationCreationCommit.js');
  assert.match(commit, /color: tool === 'highlighter'\s*\n\s*\? \(highlightColor \|\| strokeColor\)\s*\n\s*: composeAnnotationColor\(strokeColor, strokeOpacity\)/);
  assert.doesNotMatch(commit, /highlighter used the fixed highlightColor/);
});

test('390 Highlighter sheet is stroke-only and uses the 9-chip catalog', () => {
  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  assert.match(mobile, /const FILL_TOOLS = new Set\(\['rect', 'ellipse', 'text', 'callout', 'counter'\]\)/);
  assert.match(mobile, /highlighter: 'Highlighter'/);
  assert.match(mobile, /Set \$\{shapeSection === 'fill' \? 'Fill' : 'Stroke'\} color \$\{color\}/);
  assert.match(mobile, /aria-label=\{showFill \? \(tool === 'counter' \? 'Counter colors' : 'Fill and border colors'\) : 'Stroke color'\}/);
  for (const color of MOBILE_ANNOTATION_COLORS) {
    assert.match(mobile, new RegExp(color.replace('#', '\\#')));
  }
  const desktopUpper = COLOR_PICKER_PRESETS.map((c) => String(c).toUpperCase());
  const mobileOnly = MOBILE_ANNOTATION_COLORS.filter((c) => !desktopUpper.includes(c.toUpperCase()));
  assert.ok(mobileOnly.length >= 5);
});

test('buildFreehandCommitJSON highlighter stores picker highlightColor as fill', () => {
  const yellow = buildFreehandCommitJSON({
    tool: 'highlighter',
    id: 'hl-yellow',
    points: [{ x: 10, y: 10 }, { x: 80, y: 14 }],
    strokeColor: '#000000',
    highlightColor: composeColorForPatch('#FFFF00', 100),
    strokeWidth: 4,
  });
  assert.equal(yellow.tool, 'highlighter');
  assert.equal(yellow.fill, 'rgba(255, 255, 0, 1)');
  assert.equal(yellow.globalCompositeOperation, 'multiply');

  const chip = buildFreehandCommitJSON({
    tool: 'highlighter',
    id: 'hl-chip',
    points: [{ x: 10, y: 20 }, { x: 80, y: 24 }],
    strokeColor: '#4A90E2',
    highlightColor: composeColorForPatch('#4A90E2', 100),
    strokeWidth: 12,
  });
  assert.equal(chip.fill, 'rgba(74, 144, 226, 1)');

  const fallback = buildFreehandCommitJSON({
    tool: 'highlighter',
    id: 'hl-fallback',
    points: [{ x: 10, y: 30 }, { x: 80, y: 34 }],
    strokeColor: '#FF0000',
    strokeWidth: 8,
  });
  assert.equal(fallback.fill, '#FF0000');

  const transparent = buildFreehandCommitJSON({
    tool: 'highlighter',
    id: 'hl-transparent',
    points: [{ x: 10, y: 40 }, { x: 80, y: 44 }],
    strokeColor: '#FF0000',
    highlightColor: 'transparent',
    strokeWidth: 8,
  });
  assert.equal(transparent.fill, 'transparent');
});
