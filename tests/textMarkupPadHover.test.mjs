import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildTextMarkupQuadPathD,
  padTextHighlightQuad,
} from '../src/utils/pdfTextMarkup.js';
import {
  buildTextMarkupRenderSpec,
  groupUniformTextMarkupHighlights,
} from '../src/utils/textMarkupRenderSpec.js';

const quad = { x1: 100, y1: 50, x2: 180, y2: 50, x3: 100, y3: 62, x4: 180, y4: 62 };

test('padTextHighlightQuad extends highlight quads horizontally past the first and last letter edges', () => {
  const padded = padTextHighlightQuad(quad);
  assert.ok(padded.x1 < quad.x1 - 1.4, `left edge extends past text start: ${padded.x1} vs ${quad.x1}`);
  assert.ok(padded.x2 > quad.x2 + 1.4, `right edge extends past text end: ${padded.x2} vs ${quad.x2}`);
  assert.equal(padded.y1, quad.y1, 'top edge stays aligned to line');
  assert.equal(padded.y3, quad.y3, 'bottom edge stays aligned to line');
});

test('buildTextMarkupQuadPathD pads native highlights but leaves redactions and imported highlights exact', () => {
  const nativeHighlight = {
    type: 'group',
    data: { type: 'text-markup', markupType: 'highlight', quads: [quad] },
  };
  const redact = {
    type: 'group',
    data: { type: 'text-markup', markupType: 'redact', quads: [quad] },
  };
  const importedHighlight = {
    type: 'group',
    isPdfImported: true,
    data: { type: 'text-markup', markupType: 'highlight', quads: [quad] },
  };

  const nativeD = buildTextMarkupQuadPathD(nativeHighlight);
  assert.ok(!nativeD.startsWith('M 100 50 '), 'native highlight path starts left of x1=100');

  const redactD = buildTextMarkupQuadPathD(redact);
  assert.equal(redactD, 'M 100 50 L 180 50 L 180 62 L 100 62 Z');

  const importedD = buildTextMarkupQuadPathD(importedHighlight);
  assert.equal(importedD, 'M 100 50 L 180 50 L 180 62 L 100 62 Z');
});

test('the canvas painter pads native highlights the same way, and leaves line marks exact', () => {
  const native = { data: { type: 'text-markup', markupType: 'highlight', quads: [quad] } };
  const imported = { isPdfImported: true, data: { type: 'text-markup', markupType: 'highlight', quads: [quad] } };
  const padded = padTextHighlightQuad(quad);
  assert.equal(buildTextMarkupRenderSpec(native).runs[0][0][0], padded.x1);
  assert.equal(buildTextMarkupRenderSpec(imported).runs[0][0][0], quad.x1);
  const uniform = { data: { type: 'text-markup', markupType: 'highlight', overlapMode: 'uniform', quads: [quad] } };
  assert.equal(groupUniformTextMarkupHighlights([uniform])[0].runs[0][0][0], padded.x1);
  const strike = { data: { type: 'text-markup', markupType: 'strikeout', quads: [quad] } };
  assert.deepEqual(buildTextMarkupRenderSpec(strike).runs[0], [[100, 56], [180, 56]]);
});

test('SVGAnnotationLayer draws text-markup hover glow on the actual mark path, never a bounding-box rect', () => {
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(src, /data-hover-glow=\{`text-markup-\$\{tmType\}`\}/);
  assert.match(src, /textMarkupLinePathD\(renderObj\)/);
  assert.match(src, /buildTextMarkupQuadPathD\(renderObj\)/);
});
