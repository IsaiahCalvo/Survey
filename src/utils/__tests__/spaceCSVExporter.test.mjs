import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSpaceCSVContent } from '../spaceCSVExporter.js';

const annObj = (over = {}) => ({ id: 'a1', type: 'rect', left: 10, top: 20, width: 30, height: 40, ...over });

test('buildSpaceCSVContent: emits a header row first, always', () => {
  const csv = buildSpaceCSVContent({ id: 's1', name: 'S', assignedPages: [] }, {});
  const lines = csv.split('\n');
  assert.ok(lines[0].startsWith('Space Name,'), 'first line is the header');
  assert.equal(lines.length, 1, 'no data rows for an empty space');
});

test('buildSpaceCSVContent: full-mode page includes its annotations', () => {
  const space = { id: 's1', name: 'Space One', assignedPages: [{ pageId: 3, wholePageIncluded: true, regions: [] }] };
  const csv = buildSpaceCSVContent(space, { 3: { objects: [annObj({ id: 'ann-9', type: 'circle' })] } });
  const lines = csv.split('\n');
  assert.equal(lines.length, 2, 'header + 1 annotation row');
  assert.ok(lines[1].includes('ann-9'));
  assert.ok(lines[1].includes('circle'));
  assert.ok(lines[1].includes('Space One'));
  assert.ok(lines[1].includes(',3,'), 'page number present');
  assert.ok(lines[1].includes('full'), 'mode is full');
});

test('buildSpaceCSVContent: an annotation belonging to a different space is filtered out', () => {
  const space = { id: 's1', name: 'S', assignedPages: [{ pageId: 1, wholePageIncluded: true, regions: [] }] };
  const csv = buildSpaceCSVContent(space, { 1: { objects: [annObj({ id: 'keep', spaceId: 's1' }), annObj({ id: 'drop', spaceId: 's2' })] } });
  assert.ok(csv.includes('keep'));
  assert.ok(!csv.includes('drop'), 'other-space annotation excluded');
});

test('buildSpaceCSVContent: region mode with NO regions does not filter (all included)', () => {
  const space = { id: 's1', name: 'S', assignedPages: [{ pageId: 1, wholePageIncluded: false, regions: [] }] };
  const csv = buildSpaceCSVContent(space, { 1: { objects: [annObj({ id: 'x' })] } });
  const lines = csv.split('\n');
  assert.equal(lines.length, 2, 'annotation included when region mode has no regions');
  assert.ok(lines[1].includes('region'), 'mode is region');
});

test('buildSpaceCSVContent: category rows appended after annotations', () => {
  const space = {
    id: 's1', name: 'S',
    assignedPages: [{ pageId: 1, wholePageIncluded: true, regions: [] }],
    categories: [{ name: 'Doors', checklist: ['a', 'b'] }],
  };
  const csv = buildSpaceCSVContent(space, { 1: { objects: [annObj()] } });
  const lines = csv.split('\n');
  const catLine = lines.find(l => l.includes('category'));
  assert.ok(catLine, 'a category row exists');
  assert.ok(catLine.includes('Doors'));
  assert.ok(catLine.includes('2'), 'checklist count');
});

test('buildSpaceCSVContent: pages without a pageId are skipped', () => {
  const space = { id: 's1', name: 'S', assignedPages: [{ pageId: null, wholePageIncluded: true }] };
  const csv = buildSpaceCSVContent(space, {});
  assert.equal(csv.split('\n').length, 1, 'only header');
});
