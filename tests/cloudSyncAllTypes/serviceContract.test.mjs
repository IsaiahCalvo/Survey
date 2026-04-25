// Phase 21 — Contract tests for the all-types annotation cloud sync service.
//
// These tests verify the serializer-driven row shape that the service would
// send to Supabase, without actually invoking the supabase client. The
// supabase client itself depends on Vite's import.meta.env which is not
// available under Node's --test runner; the supabase-touching paths are
// verified end-to-end via manual multi-device testing (see Task 21.8 in
// the phase plan).
//
// What this file validates:
//   - The bulk serializer produces one row per Fabric object across pages
//   - Type dispatch covers every supported annotation kind
//   - Round-trip: rows ↔ app state is lossless

import test from 'node:test';
import assert from 'node:assert/strict';

test('serializeAnnotationsByPage produces one row per object across multiple types', async () => {
  const { serializeAnnotationsByPage } = await import('../../src/services/annotationTypeSerializers.js');
  const annotationsByPage = {
    '1': {
      objects: [
        { type: 'path', left: 0, top: 0, width: 10, height: 10, path: [['M', 0, 0]], id: 'p1' },
        { type: 'rect', left: 5, top: 5, width: 20, height: 20, id: 'r1' },
        { type: 'textbox', left: 0, top: 0, width: 50, height: 20, text: 'A', fontSize: 12, id: 't1' },
        { type: 'image', left: 0, top: 0, width: 32, height: 32, src: 'data:img', id: 'st1' }
      ]
    },
    '2': {
      objects: [
        { type: 'group', left: 0, top: 0, width: 24, height: 24, data: { type: 'counter', seriesId: 'A', number: 1 }, id: 'cn1' }
      ]
    }
  };
  const rows = serializeAnnotationsByPage(annotationsByPage, {
    documentId: 'd1', userId: 'u1'
  });
  assert.equal(rows.length, 5);
  const types = rows.map(r => r.annotation_type).sort();
  assert.deepEqual(types, ['counter', 'freetext', 'ink', 'square', 'stamp'].sort());

  const counterRow = rows.find(r => r.annotation_type === 'counter');
  assert.equal(counterRow.annotation_data.fabricObject.data.seriesId, 'A');
});

test('round-trip: rows from upsert format → app state format → rows again', async () => {
  const {
    serializeAnnotationsByPage,
    deserializeRowsToAnnotationsByPage
  } = await import('../../src/services/annotationTypeSerializers.js');

  const original = {
    '7': {
      objects: [
        {
          type: 'rect',
          left: 1, top: 2, width: 10, height: 10,
          stroke: '#000', strokeWidth: 1, fill: null,
          scaleX: 1, scaleY: 1,
          id: 'r-7-1'
        }
      ]
    }
  };
  const rows = serializeAnnotationsByPage(original, { documentId: 'd', userId: 'u' });
  const restored = deserializeRowsToAnnotationsByPage(rows);
  assert.equal(restored['7'].objects.length, 1);
  assert.equal(restored['7'].objects[0].id, 'r-7-1');

  const rows2 = serializeAnnotationsByPage(restored, { documentId: 'd', userId: 'u' });
  assert.equal(rows2.length, rows.length);
  assert.equal(rows2[0].annotation_type, rows[0].annotation_type);
});

test('every supported annotation type round-trips through the page store', async () => {
  const {
    serializeAnnotationsByPage,
    deserializeRowsToAnnotationsByPage
  } = await import('../../src/services/annotationTypeSerializers.js');

  const annotationsByPage = {
    '1': {
      objects: [
        { type: 'path', left: 0, top: 0, width: 10, height: 10, path: [['M', 0, 0]], id: 'ink' },
        { type: 'rect', left: 0, top: 0, width: 10, height: 10, id: 'rect' },
        { type: 'circle', left: 0, top: 0, width: 10, height: 10, radius: 5, id: 'circle' },
        { type: 'line', left: 0, top: 0, width: 10, height: 0, x1: 0, y1: 0, x2: 10, y2: 0, id: 'line' },
        { type: 'polyline', left: 0, top: 0, width: 10, height: 10, points: [{x:0,y:0},{x:10,y:10}], id: 'pl' },
        { type: 'polygon', left: 0, top: 0, width: 10, height: 10, points: [{x:0,y:0},{x:10,y:0},{x:5,y:10}], id: 'pg' },
        { type: 'textbox', left: 0, top: 0, width: 100, height: 20, text: 'Hi', fontSize: 14, id: 'text' },
        { type: 'image', left: 0, top: 0, width: 32, height: 32, src: 'data:img', id: 'stamp' },
        { type: 'group', left: 0, top: 0, width: 24, height: 24, data: { type: 'counter', seriesId: 'A', number: 1 }, id: 'counter' },
        { type: 'group', left: 0, top: 0, width: 100, height: 60, data: { type: 'sticky_note', text: 'note' }, id: 'sticky' }
      ]
    }
  };
  const rows = serializeAnnotationsByPage(annotationsByPage, { documentId: 'd', userId: 'u' });
  assert.equal(rows.length, 10);
  const restored = deserializeRowsToAnnotationsByPage(rows);
  assert.equal(restored['1'].objects.length, 10);
  // ID preservation across the round-trip
  const ids = restored['1'].objects.map(o => o.id).sort();
  assert.deepEqual(
    ids,
    ['circle', 'counter', 'ink', 'line', 'pg', 'pl', 'rect', 'stamp', 'sticky', 'text']
  );
});
