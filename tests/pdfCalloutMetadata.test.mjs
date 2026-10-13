import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PDF_CALLOUT_SUBJECT,
  buildPdfCalloutMetadata,
  serializePdfCalloutMetadata,
  parsePdfCalloutMetadata,
} from '../src/utils/pdfCalloutMetadata.js';

const valid = {
  id: 'c1',
  arrowTip: { x: 1, y: 2 },
  knee: { x: 3, y: 4 },
  textBoxPosition: { x: 5, y: 6 },
  textBoxWidth: 40,
  textBoxHeight: 20,
  text: 'hello',
  style: { color: '#f00' },
  moduleId: 'm1',
  regionId: 'r1',
};

test('build/serializePdfCalloutMetadata require complete geometry', () => {
  assert.equal(buildPdfCalloutMetadata(null), null);
  assert.equal(buildPdfCalloutMetadata({ id: 'x' }), null);
  const meta = buildPdfCalloutMetadata(valid, 2, 'body');
  assert.equal(meta.kind, PDF_CALLOUT_SUBJECT);
  assert.equal(meta.pageNumber, 2);
  assert.equal(meta.part, 'body');
  assert.equal(meta.text, 'hello');
  assert.equal(serializePdfCalloutMetadata(valid, 1), JSON.stringify(buildPdfCalloutMetadata(valid, 1)));
});

test('parsePdfCalloutMetadata accepts only SurveyApp callout payloads', () => {
  assert.equal(parsePdfCalloutMetadata(null), null);
  assert.equal(parsePdfCalloutMetadata('{'), null);
  assert.equal(parsePdfCalloutMetadata(JSON.stringify({ app: 'SurveyApp', kind: 'nope' })), null);
  const raw = serializePdfCalloutMetadata(valid, 3);
  const parsed = parsePdfCalloutMetadata(raw);
  assert.equal(parsed.id, 'c1');
  assert.equal(parsed.pageNumber, 3);
});
