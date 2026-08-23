import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';

import { mutatePdfPages, peekDisplayedPageSize } from '../src/utils/pdfPageMutation.js';
import {
  remapFormWidgetRect,
  resolveTextLayerRotation,
  resolveTextLayerScale,
} from '../src/utils/pdfjsTextLayerViewport.js';

// Source contracts: Form widgets AFTER page CW (viewBox 0 0 792 612).
// Unrotated X-05 is kal441-form-fields / e2e-select-text form INPUT
// (portrait). Widgets must sit on the visible fields, not leftover
// portrait fractions (0.363 / 0.338).
// Live proof: debug/scenarios/e2e-page-rotate-form-widgets.spec.mjs
// Distinct from leftover-18 / X-01 / remapper / create-after-rotate /
// History-restore / eraser-on-remap / mtr / page-ops / after-CW
// Select-text / Search / thumbnails. Do not invent a Forms editor.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('CW rewrite peeks swapped 792×612; widget remap leaves leftover fractions', async () => {
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

  const leftoverVp = {
    width: 612,
    height: 792,
    convertToViewportPoint(x, y) { return [x, 792 - y]; },
  };
  const swappedVp = {
    width: 792,
    height: 612,
    // CW 90 displayed-space: PDF (x, y) → (y, x) on the swapped 792×612 box.
    convertToViewportPoint(x, y) { return [y, x]; },
  };
  const nameRect = [72, 510, 372, 538];
  const leftover = remapFormWidgetRect(nameRect, leftoverVp);
  const remapped = remapFormWidgetRect(nameRect, swappedVp);
  assert.ok(leftover);
  assert.ok(remapped);
  const leftoverCx = leftover.left + leftover.width / 2;
  const remappedCx = remapped.left + remapped.width / 2;
  assert.ok(Math.abs(leftoverCx / 100 - 0.363) < 0.02, 'leftover name center stays ~0.363');
  assert.ok(Math.abs(remappedCx / 100 - leftoverCx / 100) > 0.15, 'must not keep leftover fractions');
  assert.ok(remappedCx / 100 > 0.55, 'remapped name sits on the swapped field');
  assert.equal(remapFormWidgetRect(null, swappedVp), null);
  assert.equal(remapFormWidgetRect(nameRect, { width: 792, height: 612 }), null);
});

test('form layer pins to the live host and remaps widget rects; SVG falls through; no JS zoom', () => {
  const layer = read('src/components/PdfjsFormLayer.jsx');
  assert.match(layer, /survey-pdfjs-page-div\[data-page-number=/);
  assert.match(layer, /resolveTextLayerRotation/);
  assert.match(layer, /resolveTextLayerScale/);
  assert.match(layer, /remapFormWidgetRect/);
  assert.match(layer, /inset = 'auto'/);
  assert.match(layer, /never pageSize \* scale/);
  assert.match(layer, /Do not invent a Forms editor/);
  assert.match(layer, /div\.style\.width = `\$\{Math\.floor\(hostWidth \|\| viewport\.width\)\}px`/);
  assert.match(layer, /div\.style\.height = `\$\{Math\.floor\(hostHeight \|\| viewport\.height\)\}px`/);
  assert.match(layer, /data-interactive=\{interactive \? 'true' : 'false'\}/);
  assert.doesNotMatch(layer, /createTextField|createCheckBox|formDesigner/);

  const viewportUtil = read('src/utils/pdfjsTextLayerViewport.js');
  assert.match(viewportUtil, /export function remapFormWidgetRect/);
  assert.match(viewportUtil, /convertToViewportPoint/);

  const svg = read('src/components/SVGAnnotationLayer.jsx');
  assert.match(svg, /viewBox=\{`0 0 \$\{width\} \$\{height\}`\}/);
  assert.match(svg, /zoomGeneration/);
  assert.doesNotMatch(svg, /beginSyncfusionScaleConfirmPending|onScaleApplied/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /<PdfjsFormLayer/);
  assert.match(viewer, /setZoomGeneration\(prev => prev \+ 1\)/);
  assert.match(viewer, /const showTextMarkupHighlightMenu = false/);
});

test('live spec covers form widgets after CW + leftover fractions + empty rotate + 390; skip leftover-18', () => {
  const spec = read('debug/scenarios/e2e-page-rotate-form-widgets.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /desktop form widgets after page CW intended \+ break \+ edge/);
  assert.match(spec, /390 form widgets after page CW edge/);
  assert.match(spec, /before-rotate checkpoint keeps portrait viewBox/);
  assert.match(spec, /page rotate must keep swapped viewBox/);
  assert.match(spec, /form layer must be landscape, not leftover portrait/);
  assert.match(spec, /name widget must leave leftover portrait fractions/);
  assert.match(spec, /name widget must sit on the visible field, not the leftover portrait box/);
  assert.match(spec, /empty CW invents 0 annotations/);
  assert.match(spec, /widgets are not selectable as Survey marks/);
  assert.match(spec, /viewBox held after form widgets/);
  assert.match(spec, /390 Pages rotate is not cheap \(sheet backdrop\)/);
  assert.match(spec, /0 0 792 612/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /rotatePageSpaceInk|rotateCalloutFractions|rotateSurveyMarkerBounds/);
  assert.doesNotMatch(spec, /createRevision\(|restoreRevision\(/);
  assert.doesNotMatch(spec, /createTextField|formDesigner|setActiveTool\('form-/);

  const unrotated = read('debug/scenarios/e2e-select-text.spec.mjs');
  assert.match(unrotated, /testPdf=kal441-form-fields\.pdf/);
  assert.doesNotMatch(unrotated, /page rotate must keep swapped viewBox/);

  const thumbs = read('debug/scenarios/e2e-page-rotate-thumbnails.spec.mjs');
  assert.match(thumbs, /thumbnail preview must be landscape, not leftover portrait/);
  assert.doesNotMatch(thumbs, /name widget must leave leftover portrait fractions/);

  const dev = read('src/DevTestRoute.jsx');
  assert.match(dev, /Do NOT set file\.id/);
  assert.doesNotMatch(dev, /file\.id\s*=/);
});
