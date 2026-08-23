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

// Source contracts: Search AFTER page CW (viewBox 0 0 792 612).
// Unrotated V-08 is e2e-search-previous / e2e-search-result-click
// (portrait 0 0 612 792). Search overlay must follow the swapped host,
// not the leftover portrait box that also offset Select-text.
// Live proof: debug/scenarios/e2e-page-rotate-search.spec.mjs
// Distinct from leftover-18 / X-01 / remapper / create-after-rotate /
// History-restore / eraser-on-remap / mtr / page-ops / unrotated V-08.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('CW rewrite peeks swapped 792×612; search overlay fills the live host', async () => {
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
  assert.ok(Math.abs(resolveTextLayerScale(1012, 792, 1) - (1012 / 792)) < 1e-9);

  const layer = read('src/components/SearchHighlightLayer.jsx');
  assert.match(layer, /data-search-highlight-layer=\{pageNumber\}/);
  assert.match(layer, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(layer, /width: fillContainer \? '100%' : `\$\{layerWidth\}px`/);
  assert.match(layer, /height: fillContainer \? '100%' : `\$\{layerHeight\}px`/);
  assert.match(layer, /closest\?\('\.survey-pdfjs-page-div'\)/);
  assert.match(layer, /pointerEvents: 'none'/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /<SearchHighlightLayer/);
  assert.match(viewer, /width=\{resolvedPageSize\.width\}/);
  assert.match(viewer, /height=\{resolvedPageSize\.height\}/);
  assert.match(viewer, /fillContainer/);
  assert.match(viewer, /searchResultsByPage\[pageNumber\]/);
});

test('Search after CW remounts against the new pdfDoc; SVG falls through; no JS zoom', () => {
  const panel = read('src/sidebar/SearchTextPanel.jsx');
  assert.match(panel, /page\.getViewport\(\{ scale: 1 \}\)/);
  assert.match(panel, /document_key_changed_clear_search/);
  assert.match(panel, /setSearchResults\(\[\], 'empty-query'\)/);
  assert.match(panel, /onClearTextSearch\?\.\(\)/);
  assert.match(panel, /createSearchTextMeasureLayer/);
  assert.doesNotMatch(panel, /caseSensitive|matchCase|Match case/);

  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(svg, /zoomGeneration/);
  assert.doesNotMatch(svg, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /const showTextMarkupHighlightMenu = false/);
  assert.match(viewer, /setPageSizes\(\{ 1: \{ width: firstViewport\.width, height: firstViewport\.height \} \}\)/);
});

test('live spec covers Search after CW + leftover box + empty/no-match + 390; skip leftover-18', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-search.spec.mjs');
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop Search after page CW intended \+ break \+ edge/);
  assert.match(spec, /390 Search after page CW edge/);
  assert.match(spec, /before-rotate checkpoint keeps portrait viewBox/);
  assert.match(spec, /page rotate must keep swapped viewBox/);
  assert.match(spec, /search overlay must be landscape, not leftover portrait/);
  assert.match(spec, /search overlay width must match swapped host/);
  assert.match(spec, /search hits must sit on the swapped page, not the pre-rotate portrait/);
  assert.match(spec, /search hit must land on the visible glyph, not the leftover portrait box/);
  assert.match(spec, /empty query invents 0 marks/);
  assert.match(spec, /no-match invents 0 marks/);
  assert.match(spec, /dismiss does not invent annotations/);
  assert.match(spec, /viewBox held after Search/);
  assert.match(spec, /390 Pages rotate is not cheap \(sheet backdrop\)/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /showTextMarkupHighlightMenu = true/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
  assert.doesNotMatch(spec, /createRevision\(|restoreRevision\(/);
  assert.doesNotMatch(spec, /Next match \(Enter\)|Previous match \(Shift\+Enter\)/);

  const unrotatedPrev = read('debug/scenarios/e2e-search-previous.spec.mjs');
  assert.match(unrotatedPrev, /Search Previous remainder/);
  assert.doesNotMatch(unrotatedPrev, /0 0 792 612/);
  assert.doesNotMatch(unrotatedPrev, /page rotate must keep swapped viewBox/);

  const unrotatedClick = read('debug/scenarios/e2e-search-result-click.spec.mjs');
  assert.match(unrotatedClick, /Search result-row click/);
  assert.doesNotMatch(unrotatedClick, /0 0 792 612/);

  const selectAfterCw = read('debug/scenarios/e2e-page-rotate-select-text.spec.mjs');
  assert.match(selectAfterCw, /Select text AFTER page CW/);
  assert.doesNotMatch(selectAfterCw, /search overlay must be landscape, not leftover portrait/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
