import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpaceCSVContent } from '../spaceCSVExporter.js';

const annotation = (overrides = {}) => ({
  id: 'a1', type: 'rect', left: 10, top: 20, width: 30, height: 40, ...overrides,
});

test('Space CSV always has a header and includes full-page annotations', () => {
  const empty = buildSpaceCSVContent({ id: 's1', name: 'S', assignedPages: [] }, {});
  assert.equal(empty.split('\n').length, 1);
  const csv = buildSpaceCSVContent(
    { id: 's1', name: 'Space One', assignedPages: [{ pageId: 3, wholePageIncluded: true, regions: [] }] },
    { 3: { objects: [annotation({ id: 'ann-9', type: 'circle' })] } },
  );
  assert.match(csv, /ann-9/);
  assert.match(csv, /circle/);
  assert.match(csv, /Space One/);
});

test('Space CSV excludes annotations belonging to another space', () => {
  const csv = buildSpaceCSVContent(
    { id: 's1', name: 'S', assignedPages: [{ pageId: 1, wholePageIncluded: true, regions: [] }] },
    { 1: { objects: [annotation({ id: 'keep', spaceId: 's1' }), annotation({ id: 'drop', spaceId: 's2' })] } },
  );
  assert.match(csv, /keep/);
  assert.doesNotMatch(csv, /drop/);
});

test('Space CSV appends category summary rows', () => {
  const csv = buildSpaceCSVContent({
    id: 's1', name: 'S', assignedPages: [], categories: [{ name: 'Doors', checklist: ['a', 'b'] }],
  }, {});
  assert.match(csv, /category/);
  assert.match(csv, /Doors/);
});
