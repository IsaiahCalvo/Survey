// Independent hunt after selected-callout Fill swatch independence (c22e7910).
// No unique LIVE leftover proved. Selected-shape and selected-textbox Fill
// vs Border already stamp independent rgba and Select chrome does not
// multiply leftover Border into Fill. Do not invent a leftover. Do not
// invent Line /AP, callout Rotation, user-settable callout verticalAlign,
// or a richTextEditor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { composeColorForPatch } from '../src/utils/annotationData.js';
import { composeAnnotationColor } from '../src/utils/annotationCreationCommit.js';
import { boxFillFromToolbar } from '../src/utils/textEditCommit.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function hexFromColor(color) {
  const text = String(color || '');
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text;
  const rgb = text.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return null;
  return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

function effectivePreviewColor(color, opacity = 1) {
  if (!color || color === 'transparent' || color === 'none') return 'transparent';
  const hex = hexFromColor(color);
  if (!hex) return color;
  const alphaMatch = String(color).match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\s*\)$/i);
  const colorAlpha = alphaMatch ? Number(alphaMatch[1]) : 1;
  const effectiveAlpha = Math.max(0, Math.min(1, colorAlpha * Math.max(0, Math.min(1, Number(opacity) || 0))));
  return composeColorForPatch(hex, effectiveAlpha * 100);
}

function selectedShapePreview(annot, objectOpacity = 1) {
  return {
    fill: effectivePreviewColor(annot.fill || 'transparent', objectOpacity),
    stroke: effectivePreviewColor(annot.stroke || 'transparent', objectOpacity),
  };
}

test('selected-shape / textbox preview does not multiply leftover Border into Fill', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /fill: effectivePreviewColor\(currentSelectedAnnot\.fill \|\| 'transparent', objectOpacity\)/);
  assert.match(viewer, /stroke: effectivePreviewColor\(currentSelectedAnnot\.stroke \|\| 'transparent', objectOpacity\)/);
  assert.match(viewer, /fill: effectivePreviewColor\(fillSource, objectOpacity\)/);
  assert.match(viewer, /stroke: effectivePreviewColor\(strokeSource, objectOpacity\)/);
  assert.match(viewer, /fill: effectivePreviewColor\(fill, fillOpacityValue\)/);
  assert.doesNotMatch(viewer, /borderOpacity \* fillOpacityValue/);
});

test('selected-shape Fill 90 + Border 10 paints 0.90 / 0.10, not leftover 0.09', () => {
  const paint = selectedShapePreview({
    fill: composeAnnotationColor('#ffffff', 90),
    stroke: composeAnnotationColor('#ff0000', 10),
  }, 1);
  assert.equal(paint.fill, 'rgba(255, 255, 255, 0.9)');
  assert.equal(paint.stroke, 'rgba(255, 0, 0, 0.1)');
  assert.notEqual(paint.fill, 'rgba(255, 255, 255, 0.09)');
});

test('selected-textbox Fill 90 + Border 10 stamps independent rgba; empty default stays empty', () => {
  assert.equal(boxFillFromToolbar('#ffffff', 90), 'rgba(255, 255, 255, 0.9)');
  assert.equal(composeAnnotationColor('#000000', 10), 'rgba(0, 0, 0, 0.1)');
  assert.equal(boxFillFromToolbar('#ffffff', 0), '');
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
