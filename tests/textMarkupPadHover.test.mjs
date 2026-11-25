import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  buildTextMarkupLinePathD,
  buildTextMarkupQuadPathD,
  padTextHighlightQuad,
} from '../src/utils/pdfTextMarkup.js';

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

test('buildTextMarkupLinePathD produces exact line and squiggle paths for strikeout, underline, and squiggly', () => {
  const strike = {
    type: 'group',
    data: { type: 'text-markup', markupType: 'strikeout', quads: [quad] },
  };
  assert.equal(buildTextMarkupLinePathD(strike), 'M 100 56 L 180 56');

  const squiggle = {
    type: 'group',
    data: { type: 'text-markup', markupType: 'squiggly', quads: [quad] },
  };
  const sqD = buildTextMarkupLinePathD(squiggle);
  assert.ok(sqD.startsWith('M 100 62 L '), 'squiggle traces wave along the bottom baseline');
  assert.ok((sqD.match(/ L /g) || []).length >= 6, 'squiggle has multiple wave segments');
});

test('SVGAnnotationLayer draws text-markup hover glow on the actual mark path, never a bounding-box rect', () => {
  const src = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  assert.match(src, /data-hover-glow=\{`text-markup-\$\{tmType\}`\}/);
  assert.match(src, /buildTextMarkupLinePathD\(renderObj\)/);
  assert.match(src, /buildTextMarkupQuadPathD\(renderObj\)/);
});
