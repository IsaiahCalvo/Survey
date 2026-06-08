// Stage 0 — attribute-only import boundary.
//
// Excel may write answers/name/note/entity and may propose a new unplaced row,
// but it can never place a marker, move one, or write geometry. These pin the
// helpers the import paths in PDFViewer use at every marker-write point.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IMPORTABLE_MARKER_FIELDS,
  GEOMETRY_FIELDS,
  forceUnplacedImportedMarker,
  freezeGeometryFromOriginal,
  pickImportableFields,
} from '../src/services/importFieldWhitelist.js';

test('geometry fields are never in the importable set', () => {
  for (const g of GEOMETRY_FIELDS) {
    assert.equal(IMPORTABLE_MARKER_FIELDS.includes(g), false, `${g} must not be importable`);
  }
});

test('forceUnplacedImportedMarker strips any geometry off a new row', () => {
  const hostile = {
    name: 'Injected',
    checklistResponses: { c1: { selection: 'Y' } },
    pageNumber: 5, // a malformed workbook trying to pre-place
    bounds: { x: 1, y: 2, width: 3, height: 4 },
  };
  const safe = forceUnplacedImportedMarker(hostile);
  assert.equal(safe.pageNumber, null);
  assert.equal(safe.bounds, null);
  assert.equal(safe.name, 'Injected'); // attributes preserved
  assert.deepEqual(safe.checklistResponses, { c1: { selection: 'Y' } });
});

test('freezeGeometryFromOriginal keeps a placed marker on its page through an import', () => {
  const original = {
    name: 'Exit',
    pageNumber: 3,
    bounds: { x: 10, y: 20, width: 40, height: 40 },
  };
  const importCandidate = {
    name: 'Exit Renamed', // Excel renamed it
    pageNumber: 99, // and (wrongly) tried to move it
    bounds: { x: 0, y: 0, width: 1, height: 1 },
  };
  const safe = freezeGeometryFromOriginal(importCandidate, original);
  assert.equal(safe.name, 'Exit Renamed'); // attribute change applied
  assert.equal(safe.pageNumber, 3); // geometry preserved from original
  assert.deepEqual(safe.bounds, { x: 10, y: 20, width: 40, height: 40 });
});

test('freezeGeometryFromOriginal yields null geometry when original had none', () => {
  const safe = freezeGeometryFromOriginal({ name: 'X', pageNumber: 7, bounds: { x: 1 } }, { name: 'X' });
  assert.equal(safe.pageNumber, null);
  assert.equal(safe.bounds, null);
});

test('pickImportableFields drops geometry and unknown keys', () => {
  const patch = pickImportableFields({
    name: 'A',
    note: { text: 'hi' },
    pageNumber: 2,
    bounds: { x: 0 },
    bogusField: true,
  });
  assert.deepEqual(patch, { name: 'A', note: { text: 'hi' } });
});
