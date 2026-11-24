// r5a #12 (2026-11-24): marks brought in from a PDF listed as "Unknown" with
// no date, though the PDF names the maker (/T) and the time (/CreationDate).
import test from 'node:test';
import assert from 'node:assert/strict';
import { pdfDateToIso } from '../src/utils/pdfAnnotationImporter.js';
import { authorLabel, buildMarkupRows } from '../src/utils/markupList.js';

test('a PDF date reads as an ISO time, with or without its zone', () => {
  assert.equal(pdfDateToIso("D:20251112093000-05'00'"), '2025-11-12T14:30:00.000Z');
  assert.equal(pdfDateToIso('D:20251112093000Z'), '2025-11-12T09:30:00.000Z');
  assert.equal(pdfDateToIso('D:2025'), '2025-01-01T00:00:00.000Z');
  assert.equal(pdfDateToIso(''), null);
  assert.equal(pdfDateToIso('yesterday'), null);
});

test('an imported mark lists under the name the PDF gave it', () => {
  const rows = buildMarkupRows({
    1: { objects: [{ type: 'rect', id: 'r1', stroke: '#ff0000', data: { authorName: 'JOHN DIBLASIO', createdAt: '2025-11-12T14:30:00.000Z' } }] },
  });
  assert.equal(rows.length, 1);
  assert.equal(authorLabel(rows[0].authorId), 'JOHN DIBLASIO');
  assert.equal(rows[0].createdAt, '2025-11-12T14:30:00.000Z');
});
