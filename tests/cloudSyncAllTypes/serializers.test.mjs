// Phase 21 — Round-trip tests for the annotation type serializers.
// Each test takes a representative in-app shape, serializes it to a DB row,
// deserializes it back, and asserts the round-trip is lossless for the
// fields the app cares about (geometry, style, custom data).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  serializeFabricObjectToRow,
  deserializeRowToFabricObject,
  fabricObjectToDbType,
  computeBounds,
  serializeAnnotationsByPage,
  deserializeRowsToAnnotationsByPage,
  serializeCalloutToRow,
  deserializeRowToCallout,
  deserializeRowsToCallouts,
  normalizeFabricAnnotationRows
} from '../../src/services/annotationTypeSerializers.js';

const DOC_ID = '11111111-1111-1111-1111-111111111111';
const USER_ID = '22222222-2222-2222-2222-222222222222';

// ----------------------------------------------------------------------------
// Type mapping
// ----------------------------------------------------------------------------

test('fabricObjectToDbType: pen path → ink', () => {
  assert.equal(fabricObjectToDbType({ type: 'path' }), 'ink');
});

test('fabricObjectToDbType: rect → square', () => {
  assert.equal(fabricObjectToDbType({ type: 'rect' }), 'square');
});

test('fabricObjectToDbType: circle and ellipse both → circle', () => {
  assert.equal(fabricObjectToDbType({ type: 'circle' }), 'circle');
  assert.equal(fabricObjectToDbType({ type: 'ellipse' }), 'circle');
});

test('fabricObjectToDbType: textbox → freetext', () => {
  assert.equal(fabricObjectToDbType({ type: 'textbox' }), 'freetext');
});

test('fabricObjectToDbType: image → stamp', () => {
  assert.equal(fabricObjectToDbType({ type: 'image' }), 'stamp');
});

test('fabricObjectToDbType: counter group disambiguation via data.type', () => {
  const counter = { type: 'group', data: { type: 'counter', seriesId: 'C1' } };
  assert.equal(fabricObjectToDbType(counter), 'counter');
});

test('fabricObjectToDbType: callout group disambiguation via data.type', () => {
  const callout = { type: 'group', data: { type: 'callout' } };
  assert.equal(fabricObjectToDbType(callout), 'callout');
});

test('fabricObjectToDbType: sticky note disambiguation', () => {
  assert.equal(fabricObjectToDbType({ type: 'group', data: { type: 'sticky_note' } }), 'sticky_note');
  assert.equal(fabricObjectToDbType({ type: 'group', data: { type: 'sticky-note' } }), 'sticky_note');
});

// ----------------------------------------------------------------------------
// Bounds extraction
// ----------------------------------------------------------------------------

test('computeBounds: applies scaleX/scaleY to width/height', () => {
  const b = computeBounds({ left: 10, top: 20, width: 100, height: 50, scaleX: 2, scaleY: 3 });
  assert.equal(b.x, 10);
  assert.equal(b.y, 20);
  assert.equal(b.width, 200);
  assert.equal(b.height, 150);
});

test('computeBounds: defaults missing fields to zero/one', () => {
  const b = computeBounds({});
  assert.deepEqual(b, { x: 0, y: 0, width: 0, height: 0, rotation: 0 });
});

test('computeBounds: preserves rotation angle', () => {
  const b = computeBounds({ left: 0, top: 0, width: 10, height: 10, angle: 45 });
  assert.equal(b.rotation, 45);
});

// ----------------------------------------------------------------------------
// Round-trip per type (Fabric → DB row → Fabric)
// ----------------------------------------------------------------------------

function roundTrip(fabricObj, pageNumber = 1) {
  const row = serializeFabricObjectToRow(fabricObj, {
    documentId: DOC_ID,
    userId: USER_ID,
    pageNumber
  });
  const back = deserializeRowToFabricObject(row);
  return { row, back };
}

test('round-trip: pen stroke (ink) preserves path commands and stroke style', () => {
  const fabricObj = {
    type: 'path',
    left: 100,
    top: 200,
    width: 80,
    height: 40,
    scaleX: 1,
    scaleY: 1,
    stroke: '#FF0000',
    strokeWidth: 3,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    fill: null,
    opacity: 0.9,
    path: [['M', 0, 0], ['L', 80, 40]],
    id: 'ink-test-1'
  };
  const { row, back } = roundTrip(fabricObj);
  assert.equal(row.annotation_type, 'ink');
  assert.equal(row.bounds.x, 100);
  assert.equal(row.bounds.width, 80);
  assert.deepEqual(back.fabricObject, fabricObj);
  assert.equal(back.annotationType, 'ink');
  assert.equal(back.pageNumber, 1);
});

test('round-trip: rectangle (square) preserves stroke and fill', () => {
  const fabricObj = {
    type: 'rect',
    left: 50, top: 50, width: 100, height: 60,
    scaleX: 1, scaleY: 1,
    stroke: '#0000FF', strokeWidth: 2,
    fill: 'rgba(0,0,255,0.2)',
    id: 'rect-1'
  };
  const { row, back } = roundTrip(fabricObj);
  assert.equal(row.annotation_type, 'square');
  assert.deepEqual(back.fabricObject, fabricObj);
});

test('round-trip: circle preserves radius via Fabric object', () => {
  const fabricObj = {
    type: 'circle',
    left: 100, top: 100, width: 80, height: 80,
    radius: 40, scaleX: 1, scaleY: 1,
    stroke: '#00FF00', strokeWidth: 1, fill: null,
    id: 'circle-1'
  };
  const { row, back } = roundTrip(fabricObj);
  assert.equal(row.annotation_type, 'circle');
  assert.equal(back.fabricObject.radius, 40);
});

test('round-trip: line preserves x1/y1/x2/y2', () => {
  const fabricObj = {
    type: 'line',
    left: 10, top: 10, width: 100, height: 0,
    x1: 0, y1: 0, x2: 100, y2: 0,
    stroke: '#000000', strokeWidth: 1.5, scaleX: 1, scaleY: 1,
    id: 'line-1'
  };
  const { row, back } = roundTrip(fabricObj);
  assert.equal(row.annotation_type, 'line');
  assert.equal(back.fabricObject.x2, 100);
});

test('round-trip: arrow (line type with arrowhead data) maps to line', () => {
  const fabricObj = {
    type: 'line',
    left: 0, top: 0, width: 50, height: 30,
    x1: 0, y1: 0, x2: 50, y2: 30,
    stroke: '#FF00FF', strokeWidth: 2, scaleX: 1, scaleY: 1,
    data: { arrowhead: 'end', curvature: 0 },
    id: 'arrow-1'
  };
  const { row, back } = roundTrip(fabricObj);
  assert.equal(row.annotation_type, 'line');
  assert.deepEqual(back.fabricObject.data, { arrowhead: 'end', curvature: 0 });
});

test('round-trip: polyline preserves points array', () => {
  const fabricObj = {
    type: 'polyline',
    left: 0, top: 0, width: 100, height: 60,
    points: [{ x: 0, y: 0 }, { x: 50, y: 60 }, { x: 100, y: 0 }],
    stroke: '#999', strokeWidth: 2, fill: null, scaleX: 1, scaleY: 1,
    id: 'pl-1'
  };
  const { row, back } = roundTrip(fabricObj);
  assert.equal(row.annotation_type, 'polyline');
  assert.equal(back.fabricObject.points.length, 3);
});

test('round-trip: polygon preserves points and closed fill', () => {
  const fabricObj = {
    type: 'polygon',
    left: 10, top: 10, width: 80, height: 80,
    points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 40, y: 80 }],
    stroke: '#CCC', strokeWidth: 1, fill: 'rgba(255,0,0,0.1)',
    scaleX: 1, scaleY: 1,
    id: 'pg-1'
  };
  const { row, back } = roundTrip(fabricObj);
  assert.equal(row.annotation_type, 'polygon');
  assert.equal(back.fabricObject.fill, 'rgba(255,0,0,0.1)');
});

test('round-trip: free text (textbox) preserves content and font', () => {
  const fabricObj = {
    type: 'textbox',
    left: 100, top: 100, width: 200, height: 30,
    text: 'Hello world',
    fontFamily: 'Helvetica',
    fontSize: 14,
    fill: '#000000',
    scaleX: 1, scaleY: 1,
    id: 'text-1'
  };
  const { row, back } = roundTrip(fabricObj);
  assert.equal(row.annotation_type, 'freetext');
  assert.equal(row.font_size, 14);
  assert.equal(back.fabricObject.text, 'Hello world');
  assert.equal(back.fabricObject.fontFamily, 'Helvetica');
});

test('round-trip: stamp (image) preserves src and size', () => {
  const fabricObj = {
    type: 'image',
    left: 200, top: 200, width: 64, height: 64,
    src: 'data:image/png;base64,iVBORw0KGgo=',
    scaleX: 1, scaleY: 1,
    id: 'stamp-1'
  };
  const { row, back } = roundTrip(fabricObj);
  assert.equal(row.annotation_type, 'stamp');
  assert.equal(back.fabricObject.src, fabricObj.src);
});

test('round-trip: counter chain pin preserves seriesId and number', () => {
  const fabricObj = {
    type: 'group',
    left: 300, top: 300, width: 24, height: 24,
    scaleX: 1, scaleY: 1,
    data: { type: 'counter', seriesId: 'series-A', number: 5, color: '#FF0000' },
    id: 'counter-A-5'
  };
  const { row, back } = roundTrip(fabricObj);
  assert.equal(row.annotation_type, 'counter');
  assert.equal(back.fabricObject.data.seriesId, 'series-A');
  assert.equal(back.fabricObject.data.number, 5);
});

test('round-trip: sticky note preserves text and color', () => {
  const fabricObj = {
    type: 'group',
    left: 50, top: 50, width: 120, height: 80,
    scaleX: 1, scaleY: 1,
    data: { type: 'sticky_note', text: 'Remember this', color: '#FFEB3B' },
    id: 'sticky-1'
  };
  const { row, back } = roundTrip(fabricObj);
  assert.equal(row.annotation_type, 'sticky_note');
  assert.equal(back.fabricObject.data.text, 'Remember this');
});

// ----------------------------------------------------------------------------
// Validation paths
// ----------------------------------------------------------------------------

test('serializeFabricObjectToRow: rejects unsupported types', () => {
  assert.throws(
    () => serializeFabricObjectToRow(
      { type: 'unknown-shape' },
      { documentId: DOC_ID, userId: USER_ID, pageNumber: 1 }
    ),
    /Unsupported Fabric type/
  );
});

test('serializeFabricObjectToRow: requires documentId, userId, pageNumber', () => {
  const obj = { type: 'rect' };
  assert.throws(() => serializeFabricObjectToRow(obj, { userId: USER_ID, pageNumber: 1 }), /documentId/);
  assert.throws(() => serializeFabricObjectToRow(obj, { documentId: DOC_ID, pageNumber: 1 }), /userId/);
  assert.throws(() => serializeFabricObjectToRow(obj, { documentId: DOC_ID, userId: USER_ID }), /pageNumber/);
});

test('deserializeRowToFabricObject: rejects highlight rows', () => {
  const row = {
    annotation_type: 'highlight',
    annotation_data: {}
  };
  assert.throws(() => deserializeRowToFabricObject(row), /highlight rows are not Fabric objects/);
});

test('deserializeRowToFabricObject: recovers legacy highlight rows with Fabric payloads', () => {
  const row = {
    annotation_type: 'highlight',
    page_number: 6,
    annotation_id: 'ink-legacy',
    annotation_data: {
      pageNumber: 6,
      fabricObject: {
        type: 'path',
        path: [['M', 0, 0], ['L', 1, 1]],
        isPdfImported: true,
        pdfAnnotationId: '3409R'
      }
    }
  };
  const restored = deserializeRowToFabricObject(row);
  assert.equal(restored.pageNumber, 6);
  assert.equal(restored.fabricObject.pdfAnnotationId, '3409R');
  assert.equal(restored.fabricObject.data.id, 'ink-legacy');
});

test('deserializeRowToFabricObject: rejects rows missing annotation_data.fabricObject', () => {
  const row = {
    annotation_type: 'ink',
    annotation_data: {}
  };
  assert.throws(() => deserializeRowToFabricObject(row), /no annotation_data\.fabricObject/);
});

// ----------------------------------------------------------------------------
// Bulk page → rows / rows → page
// ----------------------------------------------------------------------------

test('serializeAnnotationsByPage: walks every page and emits one row per object', () => {
  const annotationsByPage = {
    '1': {
      objects: [
        { type: 'rect', left: 0, top: 0, width: 10, height: 10, id: 'r1' },
        { type: 'circle', left: 20, top: 20, width: 10, height: 10, radius: 5, id: 'c1' }
      ]
    },
    '2': {
      objects: [
        { type: 'path', left: 0, top: 0, width: 10, height: 10, path: [['M', 0, 0]], id: 'p1' }
      ]
    }
  };
  const rows = serializeAnnotationsByPage(annotationsByPage, {
    documentId: DOC_ID,
    userId: USER_ID
  });
  assert.equal(rows.length, 3);
  assert.equal(rows[0].page_number, 1);
  assert.equal(rows[2].page_number, 2);
  assert.equal(rows[0].annotation_type, 'square');
  assert.equal(rows[1].annotation_type, 'circle');
  assert.equal(rows[2].annotation_type, 'ink');
});

test('serializeAnnotationsByPage: silently skips unsupported objects', () => {
  const annotationsByPage = {
    '1': {
      objects: [
        { type: 'rect', left: 0, top: 0, width: 10, height: 10, id: 'r1' },
        { type: 'unknown-shape', id: 'bad' }
      ]
    }
  };
  // Suppress console.warn for this test
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    const rows = serializeAnnotationsByPage(annotationsByPage, {
      documentId: DOC_ID,
      userId: USER_ID
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].annotation_id, 'r1');
  } finally {
    console.warn = originalWarn;
  }
});

test('deserializeRowsToAnnotationsByPage: round-trip through page store', () => {
  const annotationsByPage = {
    '3': {
      objects: [
        {
          type: 'rect', left: 1, top: 2, width: 10, height: 10,
          stroke: '#000', strokeWidth: 1, fill: null, scaleX: 1, scaleY: 1, id: 'r-3-1'
        },
        {
          type: 'textbox', left: 5, top: 5, width: 100, height: 20,
          text: 'A', fontFamily: 'Arial', fontSize: 12, fill: '#000',
          scaleX: 1, scaleY: 1, id: 't-3-1'
        }
      ]
    }
  };
  const rows = serializeAnnotationsByPage(annotationsByPage, {
    documentId: DOC_ID, userId: USER_ID
  });
  const restored = deserializeRowsToAnnotationsByPage(rows);
  assert.deepEqual(Object.keys(restored), ['3']);
  assert.equal(restored['3'].objects.length, 2);
  assert.equal(restored['3'].objects[1].text, 'A');
});

test('deserializeRowsToAnnotationsByPage: skips plain highlight and callout rows', () => {
  const rows = [
    { annotation_type: 'highlight', annotation_data: {}, page_number: 1, annotation_id: 'h1' },
    { annotation_type: 'callout', annotation_data: { callout: { id: 'cb', anchor: { x: 0, y: 0 } } }, page_number: 1, annotation_id: 'cb' },
    {
      annotation_type: 'square',
      annotation_data: { fabricObject: { type: 'rect', left: 0, top: 0, width: 10, height: 10 }, pageNumber: 1 },
      page_number: 1,
      annotation_id: 'r1'
    }
  ];
  const restored = deserializeRowsToAnnotationsByPage(rows);
  assert.equal(restored['1'].objects.length, 1);
  assert.equal(restored['1'].objects[0].type, 'rect');
});

test('normalizeFabricAnnotationRows: dedupes repeated PDF imports and prefers corrected non-highlight rows', () => {
  const legacy = {
    annotation_type: 'highlight',
    page_number: 6,
    updated_at: '2026-04-28T10:00:00.000Z',
    annotation_data: {
      pageNumber: 6,
      fabricObject: {
        type: 'path',
        data: { id: 'legacy' },
        path: [['M', 0, 0]],
        isPdfImported: true,
        pdfAnnotationId: '3409R',
        stroke: 'red'
      }
    },
    annotation_id: 'legacy'
  };
  const corrected = {
    annotation_type: 'ink',
    page_number: 6,
    updated_at: '2026-04-28T09:00:00.000Z',
    annotation_data: {
      pageNumber: 6,
      fabricObject: {
        type: 'path',
        data: { id: 'corrected' },
        path: [['M', 1, 1]],
        isPdfImported: true,
        pdfAnnotationId: '3409R',
        stroke: 'blue'
      }
    },
    annotation_id: 'corrected'
  };

  const normalized = normalizeFabricAnnotationRows([legacy, corrected]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].annotation_type, 'ink');

  const restored = deserializeRowsToAnnotationsByPage([legacy, corrected]);
  assert.equal(restored['6'].objects.length, 1);
  assert.equal(restored['6'].objects[0].stroke, 'blue');
});

// ----------------------------------------------------------------------------
// Callout serialization (separate state slice)
// ----------------------------------------------------------------------------

test('round-trip: callout preserves anchor and knee', () => {
  const callout = {
    id: 'co-1',
    pageNumber: 4,
    anchor: { x: 100, y: 200 },
    knee: { x: 150, y: 200 },
    label: { left: 200, top: 180, width: 80, height: 40, text: 'See note' },
    color: '#FF0000'
  };
  const row = serializeCalloutToRow(callout, { documentId: DOC_ID, userId: USER_ID });
  assert.equal(row.annotation_type, 'callout');
  assert.equal(row.page_number, 4);
  const back = deserializeRowToCallout(row);
  assert.deepEqual(back, callout);
});

test('callout bounds enclose anchor, knee, and label', () => {
  const callout = {
    id: 'co-2',
    pageNumber: 1,
    anchor: { x: 10, y: 10 },
    knee: { x: 50, y: 10 },
    label: { left: 60, top: 0, width: 100, height: 20 }
  };
  const row = serializeCalloutToRow(callout, { documentId: DOC_ID, userId: USER_ID });
  assert.equal(row.bounds.x, 10);
  assert.equal(row.bounds.y, 0);
  assert.equal(row.bounds.width, 150); // 60+100=160 - 10 = 150
});

test('callout bounds enclose current SVG callout schema', () => {
  const callout = {
    id: 'co-svg-1',
    pageNumber: 1,
    arrowTip: { x: 0.2, y: 0.3 },
    knee: { x: 0.25, y: 0.35 },
    textBoxPosition: { x: 0.3, y: 0.3 },
    textBoxWidth: 0.1,
    textBoxHeight: 0.05,
    text: 'See note'
  };
  const row = serializeCalloutToRow(callout, { documentId: DOC_ID, userId: USER_ID });

  assert.equal(row.bounds.x, 0.2);
  assert.equal(row.bounds.y, 0.3);
  assert.equal(row.bounds.width, 0.2);
  assert.ok(Math.abs(row.bounds.height - 0.05) < 1e-12);
});

test('deserializeRowsToCallouts: pulls only callout rows', () => {
  const rows = [
    {
      annotation_type: 'callout',
      annotation_data: { callout: { id: 'co-A', anchor: { x: 0, y: 0 }, pageNumber: 1 }, pageNumber: 1 },
      page_number: 1,
      annotation_id: 'co-A'
    },
    {
      annotation_type: 'square',
      annotation_data: { fabricObject: { type: 'rect' }, pageNumber: 1 },
      page_number: 1,
      annotation_id: 'r1'
    }
  ];
  const callouts = deserializeRowsToCallouts(rows);
  assert.equal(callouts.length, 1);
  assert.equal(callouts[0].id, 'co-A');
});
