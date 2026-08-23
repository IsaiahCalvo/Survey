import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';
import {
  buildPagesPanelThumbKey,
  resolvePagesPanelThumbRotation,
} from '../src/sidebar/pagesPanelUtils.js';

// Source contracts: page thumbnails AFTER page CW (viewBox 0 0 792 612).
// Unrotated V-06 is e2e-thumbnail-click (portrait 0 0 612 792).
// Preview must follow the live landscape host, not leftover 612×792.
// Live proof: debug/scenarios/e2e-page-rotate-thumbnails.spec.mjs
// Distinct from leftover-18 / X-01 / remapper / create-after-rotate /
// History-restore / eraser-on-remap / mtr / page-ops / after-CW
// Select-text / Search / unrotated V-06.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('CW rewrite peeks swapped 792×612; thumb rotation follows the live host', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const sourceBytes = await source.save();
  const before = await peekDisplayedPageSize(sourceBytes, 1);
  assert.deepEqual(before, { width: 612, height: 792 });

  const rotatedBytes = await mutatePdfPages(sourceBytes, { type: 'rotate', page: 1, delta: 90 });
  const displayed = await peekDisplayedPageSize(rotatedBytes, 1);
  assert.deepEqual(displayed, { width: 792, height: 612 });

  assert.equal(resolvePagesPanelThumbRotation({
    pageRotate: 0,
    hostWidth: 1012,
    hostHeight: 782,
    intrinsicWidth: 612,
    intrinsicHeight: 792,
  }), 90);
  assert.equal(resolvePagesPanelThumbRotation({
    pageRotate: 90,
    hostWidth: 1012,
    hostHeight: 782,
    intrinsicWidth: 792,
    intrinsicHeight: 612,
  }), 90);

  assert.notEqual(
    buildPagesPanelThumbKey({ stamp: 'abc', pageNumber: 1, rotate: 0 }),
    buildPagesPanelThumbKey({ stamp: 'abc', pageNumber: 1, rotate: 90 }),
  );
  assert.match(
    buildPagesPanelThumbKey({ stamp: 'abc', pageNumber: 1, rotate: 90, revision: 0 }),
    /::rot90::r0$/,
  );
});

test('PagesPanel raster + cache follow host aspect; SVG falls through; no JS zoom', () => {
  const panel = read('src/sidebar/PagesPanel.jsx');
  assert.match(panel, /resolvePagesPanelThumbRotation/);
  assert.match(panel, /survey-pdfjs-page-div\[data-page-number=/);
  assert.match(panel, /page\.getViewport\(\{ scale, rotation \}\)/);
  assert.match(panel, /rotate: displayRotation/);
  assert.match(panel, /leftoverPortraitCache/);
  assert.match(panel, /generateThumbnail\(pageNumber, \{ force: true \}\)/);
  assert.match(panel, /never pageSize \* scale/);

  const utils = read('src/sidebar/pagesPanelUtils.js');
  assert.match(utils, /export function resolvePagesPanelThumbRotation/);
  assert.match(utils, /resolveTextLayerRotation/);
  assert.match(utils, /::rot\$\{rot\}::r\$\{rev\}/);

  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(svg, /zoomGeneration/);
  assert.doesNotMatch(svg, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /const showTextMarkupHighlightMenu = false/);
});

test('live spec covers thumbnails after CW + leftover preview + empty rotate + 390; skip leftover-18', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-thumbnails.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop thumbnails after page CW intended \+ break \+ edge/);
  assert.match(spec, /390 thumbnails after page CW edge/);
  assert.match(spec, /before-rotate checkpoint keeps portrait viewBox/);
  assert.match(spec, /page rotate must keep swapped viewBox/);
  assert.match(spec, /thumbnail preview must be landscape, not leftover portrait/);
  assert.match(spec, /thumbnail image must be landscape, not leftover 612×792/);
  assert.match(spec, /empty CW invents 0 annotations/);
  assert.match(spec, /viewBox held after thumbnails/);
  assert.match(spec, /390 Pages rotate is not cheap \(sheet backdrop\)/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
  assert.doesNotMatch(spec, /createRevision\(|restoreRevision\(/);
  assert.doesNotMatch(spec, /ABCDEFGHIJKLMNOPQRSTUV/);

  const unrotated = read('debug/scenarios/e2e-thumbnail-click.spec.mjs');
  assert.match(unrotated, /desktop thumbnail click navigates/);
  assert.doesNotMatch(unrotated, /0 0 792 612/);
  assert.doesNotMatch(unrotated, /page rotate must keep swapped viewBox/);

  const searchAfterCw = read('debug/scenarios/e2e-page-rotate-search.spec.mjs');
  assert.match(searchAfterCw, /Search hit highlights AFTER page CW/);
  assert.doesNotMatch(searchAfterCw, /thumbnail preview must be landscape, not leftover portrait/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
