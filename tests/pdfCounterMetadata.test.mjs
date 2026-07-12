import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PDF_COUNTER_SUBJECT,
  buildPdfCounterMetadata,
  serializePdfCounterMetadata,
  parsePdfCounterMetadata,
} from '../src/utils/pdfCounterMetadata.js';

test('buildPdfCounterMetadata requires a counter fabric object', () => {
  assert.equal(buildPdfCounterMetadata(null), null);
  assert.equal(buildPdfCounterMetadata({ data: { type: 'rect' } }), null);
  const meta = buildPdfCounterMetadata({
    id: 'ctr-1',
    left: 10,
    top: 20,
    radius: 8,
    scaleX: 1,
    fill: '#ef4444',
    data: {
      type: 'counter',
      displayNumber: 3,
      pointerAngle: 90,
      seriesId: 's1',
      seriesName: 'Series',
      groupId: 'g1',
    },
  }, 4);
  assert.equal(meta.kind, PDF_COUNTER_SUBJECT);
  assert.equal(meta.pageNumber, 4);
  assert.equal(meta.number, 3);
  assert.equal(meta.pointer.angle, 90);
  assert.ok(Number.isFinite(meta.pointer.tipX));
});

test('serialize/parsePdfCounterMetadata round-trip', () => {
  const fabricObj = {
    id: 'ctr-2',
    left: 0,
    top: 0,
    radius: 5,
    data: { type: 'counter', displayNumber: 1 },
  };
  const raw = serializePdfCounterMetadata(fabricObj, 1);
  const parsed = parsePdfCounterMetadata(raw);
  assert.equal(parsed.id, 'ctr-2');
  assert.equal(parsePdfCounterMetadata(null), null);
  assert.equal(parsePdfCounterMetadata('{'), null);
  assert.equal(parsePdfCounterMetadata(JSON.stringify({ app: 'SurveyApp', kind: 'x', type: 'counter' })), null);
});
