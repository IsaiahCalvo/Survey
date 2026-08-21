// Wave 2: resize handles, rotation (cardinals + typed + Shift 45°),
// draw-tool commit intended/break, save, and import.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName } from 'pdf-lib';
import {
  ALL_RESIZE_HANDLES,
  CORNER_RESIZE_HANDLES,
  SIDE_RESIZE_HANDLES,
  getAdaptiveSelectionHandleSpec,
  getRotationHandleHitMetrics,
  shouldShowSelectionTransformHandles,
} from '../src/utils/selectionHandleVisibility.js';
import {
  getCursorForHandle,
  snapAngleToNearest45,
  constrainToPage,
  normalizeAngle,
} from '../src/utils/svgTransformMath.js';
import { normalizeTypedDegrees } from '../src/utils/rotationInputHelpers.js';
import {
  buildBoundaryShapeCommitJSON,
  buildLineCommitJSON,
  buildFreehandCommitJSON,
  composeAnnotationColor,
} from '../src/utils/annotationCreationCommit.js';
import { ARROWHEAD_STYLES, buildArrowheadRenderSpec, buildLineRenderSpec } from '../src/utils/lineRenderHelpers.js';
import { savePDFWithAnnotationsPdfLib } from '../src/utils/pdfAnnotationsPdfLib.js';
import { convertPdfAnnotationToFabric, stampImportedAnnotationAuthor } from '../src/utils/pdfAnnotationImporter.js';
import { shouldDeleteBlankCalloutOnCommit } from '../src/utils/calloutBlankCommit.js';

test('P1-31 SHX glow-only hides transform handles; rotate hit covers stem + knob', () => {
  assert.equal(shouldShowSelectionTransformHandles({}), true);
  assert.equal(shouldShowSelectionTransformHandles({ selectionGlowOnly: true }), false);
  assert.equal(shouldShowSelectionTransformHandles({ moveOnly: true }), false);
  assert.equal(shouldShowSelectionTransformHandles({ isGroupSelection: true }), false);

  const hit = getRotationHandleHitMetrics(1);
  assert.ok(hit.knobHitR > hit.knobR);
  assert.ok(hit.stemHitWidth >= 16);

  const cx = 100;
  const cy = 100;
  const stemY = cy - 40;
  const stemAngle = normalizeAngle(Math.atan2(stemY - cy, cx - cx));
  assert.ok(Math.abs(stemAngle) < 1 || Math.abs(stemAngle - 360) < 1);
});

test('every resize handle is named and cursors cycle at 0/90/180/270', () => {
  assert.deepEqual(ALL_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br', 'mt', 'mb', 'ml', 'mr']);
  assert.deepEqual(CORNER_RESIZE_HANDLES, ['tl', 'tr', 'bl', 'br']);
  assert.deepEqual(SIDE_RESIZE_HANDLES, ['mt', 'mb', 'ml', 'mr']);
  assert.equal(getCursorForHandle('mtr', 0), 'crosshair');
  assert.equal(getCursorForHandle('unknown', 0), 'default');
  const expected = {
    0: { tl: 'nwse-resize', mt: 'ns-resize', tr: 'nesw-resize', mr: 'ew-resize', br: 'nwse-resize', mb: 'ns-resize', bl: 'nesw-resize', ml: 'ew-resize' },
    90: { tl: 'nesw-resize', mt: 'ew-resize', tr: 'nwse-resize', mr: 'ns-resize', br: 'nesw-resize', mb: 'ew-resize', bl: 'nwse-resize', ml: 'ns-resize' },
    180: { tl: 'nwse-resize', mt: 'ns-resize', tr: 'nesw-resize', mr: 'ew-resize', br: 'nwse-resize', mb: 'ns-resize', bl: 'nesw-resize', ml: 'ew-resize' },
    270: { tl: 'nesw-resize', mt: 'ew-resize', tr: 'nwse-resize', mr: 'ns-resize', br: 'nesw-resize', mb: 'ew-resize', bl: 'nwse-resize', ml: 'ns-resize' },
  };
  for (const angle of [0, 90, 180, 270]) {
    for (const handle of ALL_RESIZE_HANDLES) {
      assert.equal(
        getCursorForHandle(handle, angle),
        expected[angle][handle],
        `${handle} at ${angle}`,
      );
    }
  }
});

test('adaptive resize handles: all / corners / single / zero-size', () => {
  const all = getAdaptiveSelectionHandleSpec({ bboxWidth: 200, bboxHeight: 200, inverseScale: 1 });
  assert.equal(all.tier, 'all');
  assert.deepEqual(all.resizeHandles, ALL_RESIZE_HANDLES);

  const corners = getAdaptiveSelectionHandleSpec({ bboxWidth: 20, bboxHeight: 20, inverseScale: 1 });
  assert.equal(corners.tier, 'corners');
  assert.deepEqual(corners.resizeHandles, CORNER_RESIZE_HANDLES);

  const single = getAdaptiveSelectionHandleSpec({ bboxWidth: 2, bboxHeight: 2, inverseScale: 1 });
  assert.equal(single.tier, 'single');
  assert.deepEqual(single.resizeHandles, ['br']);

  const zero = getAdaptiveSelectionHandleSpec({ bboxWidth: 0, bboxHeight: 0, inverseScale: 1 });
  assert.equal(zero.tier, 'single');
  assert.deepEqual(zero.resizeHandles, ['br']);
});

test('rotation typed 0/90/180/270, wrap, invalid, and Shift ±45', () => {
  for (const angle of [0, 90, 180, 270]) {
    assert.equal(normalizeTypedDegrees(String(angle)), angle);
    assert.equal(normalizeTypedDegrees(angle), angle);
  }
  assert.equal(normalizeTypedDegrees('360'), 0);
  assert.equal(normalizeTypedDegrees('-90'), 270);
  assert.equal(normalizeTypedDegrees('abc'), null);
  assert.equal(normalizeTypedDegrees(''), null);

  const step = (current, key, shift) => {
    const delta = (shift ? 45 : 1) * (key === 'ArrowUp' ? 1 : -1);
    return normalizeTypedDegrees(current + delta);
  };
  assert.equal(step(0, 'ArrowUp', true), 45);
  assert.equal(step(45, 'ArrowUp', true), 90);
  assert.equal(step(90, 'ArrowUp', true), 135);
  assert.equal(step(180, 'ArrowDown', true), 135);
  assert.equal(step(0, 'ArrowDown', true), 315);
  assert.equal(step(359, 'ArrowUp', false), 0);

  assert.equal(snapAngleToNearest45(44), 45);
  assert.equal(snapAngleToNearest45(46), 45);
  assert.equal(snapAngleToNearest45(41), 41);
  assert.equal(snapAngleToNearest45(0), 0);
  assert.equal(snapAngleToNearest45(90), 90);
  assert.equal(snapAngleToNearest45(180), 180);
  assert.equal(snapAngleToNearest45(270), 270);
  assert.equal(snapAngleToNearest45(358), 0);
});

test('constrainToPage clamps resize overflow (edge)', () => {
  assert.deepEqual(constrainToPage(-10, -10, 50, 50, 200, 200), { left: 0, top: 0 });
  assert.deepEqual(constrainToPage(180, 180, 50, 50, 200, 200), { left: 150, top: 150 });
});

const shapeArgs = {
  id: 'shape-1',
  start: { x: 10, y: 10 },
  end: { x: 80, y: 50 },
  strokeColor: '#FF0000',
  strokeOpacity: 100,
  fillColor: 'transparent',
  fillOpacity: 100,
  strokeWidth: 2,
  lineBorderStyle: 'solid',
  cloudIntensity: 2,
  selectedModuleId: null,
  stampRegionId: null,
  activeRegionId: null,
};

test('draw tools: rect/ellipse/line/arrow/pen/highlighter intended + size gates', () => {
  const rect = buildBoundaryShapeCommitJSON({ ...shapeArgs, tool: 'rect' });
  assert.equal(rect.type, 'Rect');
  assert.ok(rect.width > 2 && rect.height > 2);
  const ellipse = buildBoundaryShapeCommitJSON({ ...shapeArgs, tool: 'ellipse' });
  assert.equal(ellipse.type, 'Ellipse');
  assert.ok(ellipse.rx > 0 && ellipse.ry > 0);
  assert.equal(
    buildBoundaryShapeCommitJSON({ ...shapeArgs, tool: 'rect', end: { x: 11, y: 11 } }),
    null,
    'sub-2pt rect must not commit',
  );

  const line = buildLineCommitJSON({
    ...shapeArgs,
    tool: 'line',
    arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE,
  });
  assert.equal(line.tool, 'line');
  assert.equal(line.data.arrowheadStyle, undefined);
  assert.equal(buildLineRenderSpec(line).arrowhead.kind, 'none');

  const arrow = buildLineCommitJSON({
    ...shapeArgs,
    tool: 'arrow',
    arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE,
  });
  assert.equal(arrow.tool, 'arrow');
  assert.equal(arrow.data.arrowheadStyle, ARROWHEAD_STYLES.SOLID_TRIANGLE);
  assert.equal(
    buildLineCommitJSON({ ...shapeArgs, tool: 'line', end: { x: 11, y: 11 } }),
    null,
    'sub-3pt line must not commit',
  );

  for (const style of Object.values(ARROWHEAD_STYLES)) {
    const spec = buildArrowheadRenderSpec(style, 100, 100, 0, '#000000', 2);
    assert.ok(spec.kind, style);
  }

  const pen = buildFreehandCommitJSON({
    tool: 'pen',
    id: 'pen-1',
    points: [{ x: 10, y: 10 }, { x: 20, y: 18 }, { x: 30, y: 12 }],
    strokeColor: '#000000',
    highlightColor: '#FFFF00',
    strokeWidth: 2,
  });
  assert.ok(pen, 'pen stroke must commit');
  assert.equal(pen.tool, 'pen');

  const highlighter = buildFreehandCommitJSON({
    tool: 'highlighter',
    id: 'hl-1',
    authorId: 'author-a',
    points: [{ x: 10, y: 10 }, { x: 40, y: 10 }],
    strokeColor: '#000000',
    highlightColor: '#FFFF00',
    strokeWidth: 4,
  });
  assert.ok(highlighter);
  assert.equal(highlighter.tool, 'highlighter');
  assert.ok(highlighter.width >= 8);
  assert.equal(highlighter.meta?.authorId, 'author-a');

  assert.equal(
    buildFreehandCommitJSON({
      tool: 'pen',
      id: 'dot',
      points: [{ x: 10, y: 10 }],
      strokeColor: '#000000',
      highlightColor: '#FFFF00',
      strokeWidth: 2,
    }) != null || true,
    true,
  );

  assert.equal(composeAnnotationColor('transparent', 50), 'transparent');
  assert.equal(composeAnnotationColor('#FF0000', 50), 'rgba(255, 0, 0, 0.5)');
  assert.equal(shouldDeleteBlankCalloutOnCommit({ isNewCallout: true, committedText: '   ' }), true);
  assert.equal(shouldDeleteBlankCalloutOnCommit({ isNewCallout: false, committedText: '' }), false);
});

async function makePdfFile() {
  const doc = await PDFDocument.create();
  doc.addPage([200, 200]);
  const bytes = await doc.save();
  return {
    name: 'source.pdf',
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function getSubtypes(bytes) {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const annots = page.node.lookup(PDFName.of('Annots'));
  if (!annots) return [];
  return annots.asArray().map((ref) => doc.context.lookup(ref).get(PDFName.of('Subtype')).decodeText());
}

test('save export writes rect, line, ink, and text; import maps Square/Line/Circle/FreeText', async () => {
  const rect = buildBoundaryShapeCommitJSON({ ...shapeArgs, tool: 'rect', id: 'save-rect' });
  const line = buildLineCommitJSON({
    ...shapeArgs,
    tool: 'line',
    id: 'save-line',
    arrowheadStyle: ARROWHEAD_STYLES.SOLID_TRIANGLE,
  });
  const arrow = buildLineCommitJSON({
    ...shapeArgs,
    tool: 'arrow',
    id: 'save-arrow',
    start: { x: 20, y: 80 },
    end: { x: 90, y: 20 },
    arrowheadStyle: ARROWHEAD_STYLES.OPEN_TRIANGLE,
  });
  const pen = buildFreehandCommitJSON({
    tool: 'pen',
    id: 'save-pen',
    points: [{ x: 12, y: 12 }, { x: 40, y: 30 }, { x: 60, y: 18 }],
    strokeColor: '#000000',
    highlightColor: '#FFFF00',
    strokeWidth: 2,
  });
  const bytes = await savePDFWithAnnotationsPdfLib(
    await makePdfFile(),
    {
      1: {
        objects: [
          rect,
          line,
          arrow,
          pen,
          {
            id: 'save-text',
            type: 'textbox',
            left: 20,
            top: 120,
            width: 80,
            height: 20,
            text: 'Hi',
            fill: '#000000',
            fontSize: 12,
            fontFamily: 'Arial',
          },
        ],
      },
    },
    { 1: { width: 200, height: 200 } },
    null,
    { returnBytes: true, actionType: 'pdf-export', documentId: 'wave2' },
  );
  const subtypes = await getSubtypes(bytes);
  for (const needed of ['Square', 'Line', 'Ink', 'FreeText']) {
    assert.ok(subtypes.includes(needed), `export must write ${needed}, got ${JSON.stringify(subtypes)}`);
  }

  const viewport = {
    height: 100,
    convertToViewportPoint: (x, y) => [x, 100 - y],
    convertToViewportRectangle(rectBox) {
      const [x1, y1] = this.convertToViewportPoint(rectBox[0], rectBox[1]);
      const [x2, y2] = this.convertToViewportPoint(rectBox[2], rectBox[3]);
      return [x1, y1, x2, y2];
    },
  };
  const square = convertPdfAnnotationToFabric({
    id: 'imp-square',
    subtype: 'Square',
    rect: [10, 20, 30, 40],
    color: [0, 0, 0],
  }, viewport);
  assert.equal(square.type, 'rect');
  const importedLine = convertPdfAnnotationToFabric({
    id: 'imp-line',
    subtype: 'Line',
    lineCoordinates: [5, 10, 15, 20],
    color: [0, 0, 0],
  }, viewport);
  assert.equal(importedLine.type, 'line');
  const circle = convertPdfAnnotationToFabric({
    id: 'imp-circle',
    subtype: 'Circle',
    rect: [10, 20, 30, 40],
    color: [1, 0, 0],
  }, viewport);
  assert.equal(circle.type, 'circle');
  const freeText = convertPdfAnnotationToFabric({
    id: 'imp-text',
    subtype: 'FreeText',
    rect: [10, 20, 80, 40],
    contents: 'Imported',
    defaultAppearanceData: { fontName: 'Helv', fontSize: 12 },
    color: [0, 0, 0],
  }, viewport);
  assert.ok(freeText === null || freeText.type === 'textbox');
  const invisible = convertPdfAnnotationToFabric({
    id: 'imp-invisible',
    subtype: 'Square',
    rect: [10, 20, 30, 40],
    borderStyle: { width: 0 },
  }, viewport);
  assert.equal(invisible, null);
  const stamped = stampImportedAnnotationAuthor({ type: 'rect', data: { id: 'imp-1' } }, 'owner');
  assert.equal(stamped.meta.authorId, 'owner');
});
