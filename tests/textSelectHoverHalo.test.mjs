// #1796 / KAL-843: Text Select keeps the SVG root pointer-inert so native
// PDF text drags work. Rectangle Select paints hover from live SVG pointer
// events; Text Select cannot. It must share Pan's document-level hover halo
// so an existing highlight, strike, underline or squiggle still glows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { shouldShowHoverHalo } from '../src/utils/selectModes.js';

const PDF_VIEWER = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const SVG_LAYER = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');

test('Text Select is a pick-any tool, so the position halo is allowed to run', () => {
  assert.equal(shouldShowHoverHalo('text-select'), true);
  assert.equal(shouldShowHoverHalo('select'), true);
  assert.equal(shouldShowHoverHalo('pan'), true);
});

test('the document-level hover halo includes Text Select and still excludes Rectangle Select', () => {
  assert.match(
    PDF_VIEWER,
    /const haloByPosition = activeTool === 'eraser' \|\| activeTool === 'pan'\s*\|\| \(shouldShowHoverHalo\(activeTool\) && activeTool !== 'pan' && activeTool !== 'select'\);/,
  );
  assert.doesNotMatch(
    PDF_VIEWER,
    /shouldShowHoverHalo\(activeTool\) && activeTool !== 'pan' && activeTool !== 'select' && activeTool !== 'text-select'/,
  );
});

test('Text Select still leaves the SVG root inert, and still consumes pendingHover for the glow', () => {
  assert.match(
    SVG_LAYER,
    /pointerEvents: isInteractive && \(\s*\n\s*activeTool !== 'text-select' \|\| textSelectManipulationArmed \|\| interactionState !== 'idle'\s*\n\s*\) \? 'auto' : 'none',/,
  );
  assert.match(PDF_VIEWER, /pendingHover=\{pendingSvgHover\}/);
  assert.match(SVG_LAYER, /setHoveredId\(nextAnnotationIndex\)/);
  assert.match(SVG_LAYER, /data-hover-glow=\{`text-markup-\$\{tmType\}`\}/);
});
