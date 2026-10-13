import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createProductionPaperInk } from '../src/utils/productionPaperInk.js';
import { buildFreehandCommitJSON } from '../src/utils/annotationCreationCommit.js';
import { createInkPathAffine } from '../src/utils/inkGeometryTransform.js';
import { polygonSetToCommands } from '../src/utils/paperAnnotationGeometry.js';
import { canModify, getAnnotationAuthorId } from '../src/lib/collab/permissionScope.js';
import {
  applyPdfAppAnnotationMetadata,
  buildPdfAppAnnotationMetadata,
} from '../src/utils/pdfAppAnnotationMetadata.js';

test('a production pen stroke is persisted as the demo native filled geometry', () => {
  const object = createProductionPaperInk({
    id: 'pen-1',
    tool: 'pen',
    points: [{ x: 10, y: 20 }, { x: 110, y: 20 }],
    color: 'rgba(209, 27, 45, 0.8)',
    width: 3,
    data: { custom: 'preserved' },
    moduleId: 'module-1',
    pathOffset: { x: 60, y: 20 },
  });

  assert.equal(object.type, 'path');
  assert.equal(object.id, 'pen-1');
  assert.equal(object.annotationId, undefined);
  assert.equal(object.tool, 'pen');
  assert.equal(object.paperInkGeometry, 'v1');
  assert.equal(object.fillRule, 'evenodd');
  assert.equal(object.fill, 'rgba(209, 27, 45, 0.8)');
  assert.equal(object.stroke, 'transparent');
  assert.equal(object.strokeWidth, 0);
  assert.equal(object.sourceWidth, 3);
  assert.equal(object.left, 0);
  assert.equal(object.top, 0);
  assert.equal(object.pathOffset, undefined);
  assert.equal(object.moduleId, 'module-1');
  assert.deepEqual(object.data, { custom: 'preserved', id: 'pen-1', tool: 'pen' });
  assert.deepEqual(object.path, polygonSetToCommands(object.polygons));
  assert.equal(object.polygons.length, 1);
  assert.equal(object.polygons[0].length, 1);
});

test('fresh page-space ink is not repositioned by stale Fabric origin residue', () => {
  const object = createProductionPaperInk({
    id: 'page-space-pen',
    tool: 'pen',
    points: [{ x: 110, y: 620 }, { x: 210, y: 640 }],
    color: '#d11b2d',
    width: 8,
    originX: 'left',
    originY: 'top',
  });

  assert.equal(object.originX, undefined);
  assert.equal(object.originY, undefined);
  assert.deepEqual(
    createInkPathAffine(object, object.path, {
      polygons: object.polygons,
      centerline: object.paperCenterline,
    }).matrix,
    [1, 0, 0, 1, 0, 0],
  );
});

test('a production highlighter uses the same geometry with multiply compositing', () => {
  const object = createProductionPaperInk({
    id: 'highlight-1',
    tool: 'highlighter',
    points: [{ x: 0, y: 0 }, { x: 50, y: 10 }],
    color: 'rgba(255, 235, 59, 0.45)',
    width: 12,
  });

  assert.equal(object.tool, 'highlighter');
  assert.equal(object.globalCompositeOperation, 'multiply');
  assert.equal(object.fill, 'rgba(255, 235, 59, 0.45)');
  assert.equal(object.sourceWidth, 12);
  assert.ok(object.paperCenterline.length >= 2);
});

test('editor-created highlighter stamps its creator for partial-erase admission', () => {
  const creatorId = '53f84051-1022-4915-bdcf-63e63ddcd2fc';
  const ownerId = '170d915c-5741-4e0b-b03f-deaeedae27bd';
  const object = buildFreehandCommitJSON({
    tool: 'highlighter',
    id: 'editor-highlight-1',
    authorId: creatorId,
    points: [{ x: 10, y: 30 }, { x: 110, y: 30 }],
    strokeColor: '#d11b2d',
    highlightColor: 'rgba(255, 235, 59, 0.45)',
    strokeWidth: 20,
  });

  assert.equal(object.id, 'editor-highlight-1');
  assert.equal(object.data.id, 'editor-highlight-1');
  assert.equal(object.tool, 'highlighter');
  assert.equal(object.paperInkGeometry, 'v1');
  assert.equal(getAnnotationAuthorId(object), creatorId);
  assert.equal(canModify({ annotation: object, viewerId: creatorId, documentOwnerId: ownerId }), true);
  // RULED 2026-09-28 owner: open editing + lock — any editor may erase it once the owner is known.
  assert.equal(canModify({
    annotation: object,
    viewerId: '00000000-0000-0000-0000-000000000002',
    documentOwnerId: ownerId,
  }), true);
  // RULED 2026-09-28 owner: open editing + lock — the creator stamp still decides admission while the owner is unknown.
  assert.equal(canModify({ annotation: object, viewerId: creatorId, documentOwnerId: null }), true);
  assert.equal(canModify({
    annotation: object,
    viewerId: '00000000-0000-0000-0000-000000000002',
    documentOwnerId: null,
  }), false);
});

test('the production drawing surface commits captured pointer points through paper geometry', () => {
  // Unified renderer (FabricDrawingCanvas retired): creation lives in
  // SVGAnnotationLayer, which captures raw coalesced pointer samples and
  // commits them through annotationCreationCommit.buildFreehandCommitJSON →
  // createProductionPaperInk. This tripwire must fail if pen ink ever stops
  // flowing through the paper-geometry pipeline on the LIVE path.
  const commitSource = readFileSync(
    new URL('../src/utils/annotationCreationCommit.js', import.meta.url),
    'utf8',
  );
  const layerSource = readFileSync(
    new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url),
    'utf8',
  );

  assert.match(commitSource, /createProductionPaperInk\s*\(/);
  // The layer feeds the commit builder its captured raw points (coalesced,
  // page-space) — the successor of rawInkGestureRef.current.points.
  assert.match(layerSource, /getCoalescedEvents/);
  assert.match(layerSource, /const points = freehandPointsRef\.current;/);
  assert.match(layerSource, /buildFreehandCommitJSON\s*\(/);
  // Never a return to raw fabric brush-path serialization on the live surface.
  assert.doesNotMatch(layerSource, /\.path\.toObject\(/);
});

test('app PDF metadata round-trips editable paper geometry without flattening topology', () => {
  const object = createProductionPaperInk({
    id: 'round-trip-ink',
    tool: 'pen',
    points: [{ x: 10, y: 20 }, { x: 110, y: 25 }],
    color: '#d11b2d',
    width: 14,
  });
  object.paperEraserGeometry = 'v1';
  const metadata = buildPdfAppAnnotationMetadata(object, {
    id: object.id,
    type: 'path',
    pageNumber: 1,
  });
  const restored = applyPdfAppAnnotationMetadata(
    { type: 'path', path: [['M', 0, 0], ['L', 1, 1]], stroke: '#000', data: {} },
    metadata,
  );

  assert.deepEqual(restored.path, object.path);
  assert.deepEqual(restored.polygons, object.polygons);
  assert.deepEqual(restored.paperCenterline, object.paperCenterline);
  assert.equal(restored.paperInkGeometry, 'v1');
  assert.equal(restored.paperEraserGeometry, 'v1');
  assert.equal(restored.sourceWidth, 14);
});

test('collaboration serialization includes paper geometry fields', () => {
  const collabSource = readFileSync(
    new URL('../src/lib/collab/crdtAnnotationBridge.js', import.meta.url),
    'utf8',
  );
  for (const property of [
    'tool',
    'paperInkGeometry',
    'paperEraserGeometry',
    'polygons',
    'paperCenterline',
    'sourceWidth',
    'fillRule',
  ]) {
    assert.match(collabSource, new RegExp(`['\"]${property}['\"]`));
  }
});

test('app PDF metadata does not truncate a long erased polygon ring', () => {
  const ring = Array.from({ length: 700 }, (_, index) => {
    const angle = (index / 699) * Math.PI * 2;
    return [100 + Math.cos(angle) * 50, 100 + Math.sin(angle) * 50];
  });
  ring.push([...ring[0]]);
  const object = {
    id: 'long-erased-ring',
    type: 'path',
    tool: 'pen',
    path: polygonSetToCommands([[ring]]),
    polygons: [[ring]],
    fill: '#d11b2d',
    stroke: 'transparent',
    strokeWidth: 0,
    sourceWidth: 20,
    paperInkGeometry: 'v1',
    paperEraserGeometry: 'v1',
  };

  const metadata = buildPdfAppAnnotationMetadata(object, {
    id: object.id,
    type: 'path',
    pageNumber: 1,
  });

  assert.equal(metadata.geometry.polygons[0][0].length, ring.length);
  assert.equal(metadata.geometry.path.length, object.path.length);
});
