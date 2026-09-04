import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { convertPdfAnnotationToFabric, importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import {
  isAnnotationTransformHandleLocked,
  isMovementLockedAnnotation,
} from '../src/utils/annotationSelectionEligibility.js';
import { getTextMarkupSelectionChrome } from '../src/utils/pdfTextMarkup.js';

const makeViewport = () => ({
  height: 100,
  convertToViewportPoint(x, y) {
    return [x, 100 - y];
  },
  convertToViewportRectangle(rect) {
    const [x1, y1] = this.convertToViewportPoint(rect[0], rect[1]);
    const [x2, y2] = this.convertToViewportPoint(rect[2], rect[3]);
    return [x1, y1, x2, y2];
  },
});

const importedTextMarkupFixtures = [
  { id: 'underline-1', subtype: 'Underline', rect: [10, 76, 70, 90], color: [1, 0, 0] },
  { id: 'strikeout-1', subtype: 'StrikeOut', rect: [10, 76, 70, 90], color: [0, 0, 1] },
  { id: 'squiggly-1', subtype: 'Squiggly', rect: [10, 76, 70, 90], color: [0, 1, 0] },
];

test('imported underline, strike-through, and squiggle use native text-range handles', () => {
  const textContent = { items: [{
    str: 'marked text',
    transform: [10, 0, 0, 10, 10, 80],
    width: 60,
    height: 10,
    dir: 'ltr',
  }] };
  for (const fixture of importedTextMarkupFixtures) {
    const annotation = convertPdfAnnotationToFabric(
      fixture,
      makeViewport(),
      1,
      null,
      { pageNumber: 1, textContent },
    );
    assert.ok(annotation, `${fixture.subtype} must import`);
    assert.equal(annotation.data.type, 'text-markup');
    assert.equal(annotation.isPdfImported, true);
    assert.equal(annotation.selectable, true);
    assert.equal(annotation.evented, true);
    assert.equal(annotation.hasControls, false);
    assert.equal(annotation.lockMovementX, true, `${fixture.subtype} must not move`);
    assert.equal(annotation.lockMovementY, true, `${fixture.subtype} must not move`);
    assert.equal(annotation.lockScalingX, true, `${fixture.subtype} must not box-resize`);
    assert.equal(annotation.lockScalingY, true, `${fixture.subtype} must not resize vertically`);
    assert.equal(annotation.lockRotation, true, `${fixture.subtype} must not rotate`);
    assert.equal(isMovementLockedAnnotation(annotation), true);
    assert.equal(isAnnotationTransformHandleLocked(annotation, 'ml'), false);
    assert.equal(isAnnotationTransformHandleLocked(annotation, 'mr'), false);
    assert.equal(isAnnotationTransformHandleLocked(annotation, 'mt'), true);
    assert.equal(isAnnotationTransformHandleLocked(annotation, 'mtr'), true);
    assert.deepEqual(getTextMarkupSelectionChrome(annotation), {
      hideBoundingBox: true,
      hideResizeHandles: false,
    });
  }
});

test('an imported pending redaction stays an outlined warning, not a black fill', () => {
  const annotation = convertPdfAnnotationToFabric(
    { id: 'redact-1', subtype: 'Redact', rect: [10, 76, 70, 90], color: [1, 0, 0] },
    makeViewport(),
    1,
    null,
    { pageNumber: 1 },
  );

  assert.equal(annotation.isPdfImported, true);
  assert.equal(annotation.fill, 'transparent');
  assert.equal(annotation.stroke, '#ff0000');
  assert.equal(annotation.data.applied, false);
});

test('import reports converted redactions so the not-applied warning stays visible', async () => {
  const viewport = makeViewport();
  const result = await importAnnotationsFromPdf({
    numPages: 1,
    async getPage() {
      return {
        rotate: 0,
        getViewport: () => viewport,
        getTextContent: async () => ({ items: [] }),
        getAnnotations: async () => [
          { id: 'redact-1', subtype: 'Redact', rect: [10, 76, 70, 90], color: [1, 0, 0] },
        ],
      };
    },
  });

  assert.equal(result.unsupportedCounts.Redact, 1);
  assert.deepEqual(result.nativeLayerPolicyByPage[1].importedTextMarkupIdsByType.Redact, ['redact-1']);
});

test('both annotation render paths route imported marks through native text-markup controls', () => {
  const svgSource = readFileSync(
    new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url),
    'utf8',
  );
  const canvasSource = readFileSync(
    new URL('../src/PageAnnotationLayer.jsx', import.meta.url),
    'utf8',
  );
  const interactionSource = readFileSync(
    new URL('../src/hooks/useSVGInteraction.js', import.meta.url),
    'utf8',
  );
  const rendererSource = readFileSync(
    new URL('../src/utils/svgAnnotationRenderers.jsx', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(svgSource, /isImportedScaleOnlyTextMarkup/);
  assert.match(svgSource, /horizontalResizeOnly=\{selectionObj\?\.data\?\.type === 'text-markup'\}/);
  assert.match(canvasSource, /objData\?\.data\?\.type === 'text-markup'/);
  assert.match(canvasSource, /lockScalingX: true/);
  assert.match(interactionSource, /obj\?\.data\?\.type === 'text-markup' \|\| isMovementLockedAnnotation\(obj\)/);
  assert.match(interactionSource, /isAnnotationTransformHandleLocked\(obj, handleId\)/);
  assert.match(rendererSource, /getTextMarkupUnderlineInset\(obj, height, lineWidth\)/);
  assert.match(rendererSource, /isUnappliedImportedRedaction/);
  assert.match(rendererSource, /obj\.fill !== 'transparent'/);
  assert.match(rendererSource, /if \(type === 'link' && obj\?\.isPdfImported\) return null/);
});

test('Text Select routes imported hyperlinks through the selectable link layer', () => {
  const viewerSource = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewerSource, /activeTool === 'select' \|\| activeTool === 'text-select' \? 'select'/);
});
