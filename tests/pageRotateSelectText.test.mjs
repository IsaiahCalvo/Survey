import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';
import {
  resolveTextLayerRotation,
  resolveTextLayerScale,
} from '../src/utils/pdfjsTextLayerViewport.js';

// Source contracts: Select text AFTER page CW (viewBox 0 0 792 612).
// Unrotated V-03 is e2e-select-text (portrait 0 0 612 792).
// Text layer viewport must inherit baked /Rotate, not leftover portrait.
// Live proof: debug/scenarios/e2e-page-rotate-select-text.spec.mjs
// Distinct from leftover-18 / X-01 / remapper / create-after-rotate /
// History-restore / eraser-on-remap / mtr / page-ops / unrotated V-03.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('CW rewrite peeks swapped 792×612; text layer viewport uses page.rotate', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const sourceBytes = await source.save();
  const before = await peekDisplayedPageSize(sourceBytes, 1);
  assert.deepEqual(before, { width: 612, height: 792 });

  const rotatedBytes = await mutatePdfPages(sourceBytes, { type: 'rotate', page: 1, delta: 90 });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });

  assert.equal(resolveTextLayerRotation(0, 0, 1012, 782, 612, 792), 90);
  assert.equal(resolveTextLayerRotation(90, 0, 1012, 782, 792, 612), 90);
  assert.equal(resolveTextLayerRotation(0, 0, 782, 1012, 612, 792), 0);
  assert.ok(Math.abs(resolveTextLayerScale(1012, 792, 1) - (1012 / 792)) < 1e-9);
  assert.equal(resolveTextLayerScale(0, 792, 1.25), 1.25);

  const layer = read('src/components/PdfjsTextLayer.jsx');
  assert.match(layer, /survey-pdfjs-page-div\[data-page-number=/);
  assert.match(layer, /inset = 'auto'/);
  assert.match(layer, /resolveTextLayerRotation/);
  assert.match(layer, /resolveTextLayerScale/);
  assert.match(layer, /el\.style\.setProperty\('--scale-factor', String\(viewport\.scale\)\)/);
  assert.match(layer, /el\.style\.width = `\$\{Math\.floor\(hostWidth \|\| viewport\.width\)\}px`/);
  assert.match(layer, /el\.style\.height = `\$\{Math\.floor\(hostHeight \|\| viewport\.height\)\}px`/);
  assert.match(layer, /never pageSize \* scale/);
  assert.match(layer, /\[pdf, pageNumber, scale, rotation\]/);
  assert.match(layer, /user-select: text/);
  assert.match(layer, /pdfjsTextLayer\$\{interactive \? ' is-interactive' : ''\}/);
});

test('text-select mounts only after CW; SVG falls through; no JS zoom; no text-markup invent', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /<PdfjsTextLayer/);
  assert.match(viewer, /activeTool === 'text-select'/);
  assert.match(viewer, /setActiveTool\('text-select'\)/);
  assert.match(viewer, /const showTextMarkupHighlightMenu = false/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /setPageSizes\(\{ 1: \{ width: firstViewport\.width, height: firstViewport\.height \} \}\)/);

  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /pointerEvents: \(isInteractive && activeTool !== 'text-select'\) \? 'auto' : 'none'/);
  assert.match(svg, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(svg, /zoomGeneration/);
  assert.doesNotMatch(svg, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const viewerContainer = read('src/components/PdfjsViewerContainer.jsx');
  assert.match(viewerContainer, /survey-pdfjs-mobile-surface \.pdfjsTextLayer\.is-interactive/);
  assert.match(viewerContainer, /user-select: text !important/);
  assert.match(viewerContainer, /data-text-select=\{interactionMode === 'TextSelection' \? 'true' : 'false'\}/);

  const ops = read('src/hooks/usePageOperations.js');
  assert.match(ops, /peekDisplayedPageSize/);
  assert.match(ops, /pageWidth: displayed\.width/);
  assert.match(ops, /pageHeight: displayed\.height/);

  const mutation = read('src/utils/pdfPageMutation.js');
  assert.match(mutation, /page\.setRotation/);
  assert.match(mutation, /rot === 90 \|\| rot === 270/);
});

test('live spec covers Select text after CW + offset + empty click + 390 lift; skip leftover-18', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-select-text.spec.mjs');
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Select text after page CW intended \+ break \+ edge/);
  assert.match(spec, /390 Select text after page CW edge/);
  assert.match(spec, /before-rotate checkpoint keeps portrait viewBox/);
  assert.match(spec, /page rotate must keep swapped viewBox/);
  assert.match(spec, /text-layer viewport must be landscape, not leftover portrait/);
  assert.match(spec, /text-layer viewport width must match swapped host/);
  assert.match(spec, /layerOffsetW/);
  assert.match(spec, /visible glyphs must sit on the swapped page, not the pre-rotate portrait/);
  assert.match(spec, /elementFromPoint at the visible glyph must hit the text layer, not a pre-rotate offset/);
  assert.match(spec, /drag must select PDF glyphs on the swapped page/);
  assert.match(spec, /Select-text tool does not invent annotations/);
  assert.match(spec, /click on empty space selects 0/);
  assert.match(spec, /empty CW invents 0 annotations/);
  assert.match(spec, /viewBox held after Select text/);
  assert.match(spec, /390 user-select lift if still live/);
  assert.match(spec, /390 Pages rotate is not cheap \(sheet backdrop\)/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /showTextMarkupHighlightMenu = true/);
  assert.doesNotMatch(spec, /setActiveTool\('text-highlight'\)/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
  assert.doesNotMatch(spec, /createRevision\(|restoreRevision\(/);

  const unrotated = read('debug/scenarios/e2e-select-text.spec.mjs');
  assert.match(unrotated, /0 0 612 792/);
  assert.doesNotMatch(unrotated, /0 0 792 612/);
  assert.doesNotMatch(unrotated, /page rotate must keep swapped viewBox/);
  assert.match(unrotated, /V-03 Select text/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
