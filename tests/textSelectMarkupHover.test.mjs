import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  findTextMarkupAtPoint,
  isPointOnTextMarkup,
  padTextHighlightQuad,
} from '../src/utils/pdfTextMarkup.js';

const multiLineQuads = [
  { x1: 100, y1: 50, x2: 300, y2: 50, x3: 100, y3: 62, x4: 300, y4: 62 },
  { x1: 100, y1: 68, x2: 180, y2: 68, x3: 100, y3: 80, x4: 180, y4: 80 },
];

const makeMarkup = (markupType, quads, extra = {}) => ({
  type: 'group',
  ...extra,
  data: {
    type: 'text-markup',
    markupType,
    quads,
    ...(extra.data || {}),
  },
});

test('multi-line highlight hits its word quads and misses empty margin and inter-line gap', () => {
  const highlight = makeMarkup('highlight', multiLineQuads);
  assert.equal(isPointOnTextMarkup(highlight, { x: 150, y: 56 }), true, 'hits line 1 text');
  assert.equal(isPointOnTextMarkup(highlight, { x: 140, y: 74 }), true, 'hits line 2 text');

  // Native highlights pad slightly past the first and last letters.
  const padded = padTextHighlightQuad(multiLineQuads[0]);
  assert.equal(isPointOnTextMarkup(highlight, { x: padded.x1 + 0.2, y: 56 }), true, 'hits padded left edge');

  // Inside the combined bounding box [100..300, 50..80], but outside every quad.
  assert.equal(isPointOnTextMarkup(highlight, { x: 250, y: 74 }), false, 'misses empty margin right of line 2');
  assert.equal(isPointOnTextMarkup(highlight, { x: 150, y: 65 }), false, 'misses whitespace between lines');
  assert.equal(isPointOnTextMarkup(highlight, { x: 80, y: 56 }), false, 'misses left of quad');

  // Redactions and imported highlights stay unpadded.
  const redact = makeMarkup('redact', [multiLineQuads[0]]);
  assert.equal(isPointOnTextMarkup(redact, { x: 150, y: 56 }), true, 'hits redaction interior');
  assert.equal(isPointOnTextMarkup(redact, { x: 96, y: 56 }), false, 'misses outside unpadded redaction');
});

test('underline, strikeout, and squiggly hit both text quads and comfortable line bands while rejecting whitespace', () => {
  for (const kind of ['underline', 'strikeout', 'squiggly']) {
    const mark = makeMarkup(kind, multiLineQuads);
    assert.equal(isPointOnTextMarkup(mark, { x: 150, y: 56 }), true, `${kind} hits line 1 text`);
    assert.equal(isPointOnTextMarkup(mark, { x: 140, y: 74 }), true, `${kind} hits line 2 text`);
    assert.equal(isPointOnTextMarkup(mark, { x: 250, y: 74 }), false, `${kind} misses empty margin right of line 2`);
    assert.equal(isPointOnTextMarkup(mark, { x: 150, y: 65 }), false, `${kind} misses gap between lines`);
  }

  // Thin imported underline / strikeout quads still have a comfortable line hit band.
  const thinUnderline = makeMarkup('underline', [
    { x1: 100, y1: 61, x2: 200, y2: 61, x3: 100, y3: 62, x4: 200, y4: 62 },
  ], { isPdfImported: true });
  assert.equal(isPointOnTextMarkup(thinUnderline, { x: 150, y: 60 }), true, 'thin underline hits just above stroke');
  assert.equal(isPointOnTextMarkup(thinUnderline, { x: 150, y: 63 }), true, 'thin underline hits just below stroke');
  assert.equal(isPointOnTextMarkup(thinUnderline, { x: 150, y: 68 }), false, 'thin underline misses well below stroke');

  const thinStrikeout = makeMarkup('strikeout', [
    { x1: 100, y1: 55.5, x2: 200, y2: 55.5, x3: 100, y3: 56.5, x4: 200, y4: 56.5 },
  ], { isPdfImported: true });
  assert.equal(isPointOnTextMarkup(thinStrikeout, { x: 150, y: 54 }), true, 'thin strikeout hits within line band');
  assert.equal(isPointOnTextMarkup(thinStrikeout, { x: 150, y: 62 }), false, 'thin strikeout misses outside line band');

  // Squiggly wave dips slightly below the quad bottom edge (y3=62) and should still hit on the crest.
  const squiggly = makeMarkup('squiggly', [multiLineQuads[0]]);
  assert.equal(isPointOnTextMarkup(squiggly, { x: 150, y: 63.5 }), true, 'squiggly hits wave crest below quad');
  assert.equal(isPointOnTextMarkup(squiggly, { x: 150, y: 66.5 }), false, 'squiggly misses below wave');
});

test('rotated text-markup quads and rotated annotations match exact polygon geometry', () => {
  // 45-degree tilted quad centered around (150, 150).
  const tiltedQuad = {
    x1: 100, y1: 150,
    x2: 150, y2: 100,
    x3: 110, y3: 160,
    x4: 160, y4: 110,
  };
  const tiltedHighlight = makeMarkup('highlight', [tiltedQuad], { isPdfImported: true });
  assert.equal(isPointOnTextMarkup(tiltedHighlight, { x: 130, y: 130 }), true, 'hits center of tilted quad');
  assert.equal(isPointOnTextMarkup(tiltedHighlight, { x: 105, y: 105 }), false, 'misses empty corner of tilted AABB');

  // Annotation-level 90-degree rotation around its bbox center (150, 56).
  const rotatedMarkup = makeMarkup('highlight', [
    { x1: 100, y1: 50, x2: 200, y2: 50, x3: 100, y3: 62, x4: 200, y4: 62 },
  ], {
    isPdfImported: true,
    left: 100,
    top: 50,
    width: 100,
    height: 12,
    angle: 90,
  });
  assert.equal(isPointOnTextMarkup(rotatedMarkup, { x: 150, y: 90 }), true, 'hits rotated vertical span');
  assert.equal(isPointOnTextMarkup(rotatedMarkup, { x: 190, y: 56 }), false, 'misses pre-rotation horizontal end');
});

test('findTextMarkupAtPoint picks the top-most interactive text markup and skips hidden, non-interactive, and non-markup items', () => {
  const quad = { x1: 100, y1: 50, x2: 200, y2: 50, x3: 100, y3: 62, x4: 200, y4: 62 };
  const entries = [
    { index: 0, obj: makeMarkup('highlight', [quad]), isObjectInteractive: true },
    { index: 1, obj: { type: 'rect', left: 90, top: 40, width: 120, height: 40 }, isObjectInteractive: true },
    { index: 2, obj: makeMarkup('underline', [quad]), isObjectInteractive: true },
    { index: 3, obj: makeMarkup('strikeout', [quad], { visible: false }), isObjectInteractive: true },
    { index: 4, obj: makeMarkup('squiggly', [quad]), isObjectInteractive: false },
    { index: 5, obj: makeMarkup('link', [quad]), isObjectInteractive: true },
  ];

  assert.equal(findTextMarkupAtPoint(entries, { x: 150, y: 56 }), 2, 'top-most visible interactive text markup wins');
  assert.equal(findTextMarkupAtPoint(entries, { x: 150, y: 20 }), null, 'returns null on blank page space');
});

test('SVGAnnotationLayer passively hovers text markups in Text Select without blocking native PDF text selection', () => {
  const layerSource = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');
  const containerSource = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');

  assert.match(layerSource, /const passiveTextSelectHoverRef = useRef\(null\)/);
  assert.match(
    layerSource,
    /activeTool !== 'text-select'[\s\S]{0,160}interactionState !== 'idle'[\s\S]{0,160}textSelectManipulationArmed[\s\S]{0,160}textDragModeActive/,
  );
  assert.match(layerSource, /event\.pointerType === 'touch' \|\| event\.buttons !== 0/);
  assert.match(layerSource, /const svgPoint = screenToSVG\(root, event\.clientX, event\.clientY\);\s*const hitIndex = findTextMarkupAtPoint\(entries, svgPoint\);\s*setPassiveHover\(hitIndex\);/);
  assert.match(layerSource, /window\.addEventListener\('pointermove', handlePointerMove, true\)/);
  assert.match(layerSource, /window\.addEventListener\('pointerdown', clearPassiveHover, true\)/);
  assert.match(layerSource, /window\.addEventListener\('blur', clearPassiveHover\)/);
  assert.match(layerSource, /document\.addEventListener\('pointerleave', clearPassiveHover\)/);

  // Passive hover must never disable .pdfjsTextLayer pointerEvents, and the
  // SVG overlay host must stack above .pdfjsTextLayer (z-index 40) so the glow
  // remains visible while text selection stays interactive.
  const passiveEffectStart = layerSource.indexOf('const passiveTextSelectHoverRef = useRef(null)');
  const passiveEffectEnd = layerSource.indexOf('const textSelectOwnsPointer =', passiveEffectStart);
  assert.ok(passiveEffectStart > 0 && passiveEffectEnd > passiveEffectStart);
  const passiveBlock = layerSource.slice(passiveEffectStart, passiveEffectEnd);
  assert.doesNotMatch(passiveBlock, /pointerEvents\s*=/, 'passive hover must not mutate text layer pointerEvents');
  assert.match(containerSource, /zIndex:\s*textSelectionLayerActive \? 41 : 30/);
});
