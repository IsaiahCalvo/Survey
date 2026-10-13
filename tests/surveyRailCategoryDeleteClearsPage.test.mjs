// KAL-502: deleting a category in the Survey rail removed its markers from the
// saved list but left their boxes drawn on the page until a reload. The page
// draws from newSurveyMarkersByPage; the rail never touched it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { removeSurveyMarkersFromPages } from '../src/utils/surveyMarkerPageRemoval.js';

const RAIL = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');

const box = (x, y) => ({ x, y, width: 40, height: 40 });

test('deleted markers leave the page; the others stay', () => {
  const byPage = {
    1: [{ annotationId: 'cam-1', ...box(10, 10) }, { annotationId: 'door-1', ...box(100, 10) }],
    2: [{ annotationId: 'cam-2', ...box(10, 10) }],
  };
  const next = removeSurveyMarkersFromPages(byPage, [
    { id: 'cam-1', pageNumber: 1, bounds: box(10, 10) },
    { id: 'cam-2', pageNumber: 2, bounds: box(10, 10) },
  ]);
  assert.deepEqual(next[1].map((m) => m.annotationId), ['door-1']);
  assert.equal(next[2], undefined, 'an emptied page key is dropped');
  assert.equal(byPage[1].length, 2, 'input is not changed');
});

test('an entry with its own id is only removed by id, never by a matching box', () => {
  const byPage = { 1: [{ annotationId: 'pasted-copy', ...box(12, 11) }] };
  const next = removeSurveyMarkersFromPages(byPage, [{ id: 'cam-1', pageNumber: 1, bounds: box(10, 10) }]);
  assert.equal(next, byPage);
});

test('an entry without an id goes when its box matches a deleted marker on that page', () => {
  const byPage = { 1: [{ ...box(12, 11) }, { ...box(300, 300) }], 3: [{ ...box(10, 10) }] };
  const next = removeSurveyMarkersFromPages(byPage, [{ id: 'cam-1', pageNumber: 1, bounds: box(10, 10) }]);
  assert.equal(next[1].length, 1);
  assert.equal(next[1][0].x, 300);
  assert.equal(next[3], byPage[3], 'same box on another page stays');
});

test('nothing to delete returns the same object (no re-render)', () => {
  const byPage = { 1: [{ annotationId: 'a', ...box(0, 0) }] };
  assert.equal(removeSurveyMarkersFromPages(byPage, []), byPage);
  assert.equal(removeSurveyMarkersFromPages(byPage, [{ id: 'zzz', pageNumber: 1 }]), byPage);
  assert.equal(removeSurveyMarkersFromPages(undefined, [{ id: 'a' }]), undefined);
});

test('the rail category delete takes the markers off the page, not just the list', () => {
  const start = RAIL.indexOf('const deleteSelectedCategories = async');
  assert.ok(start > 0);
  const body = RAIL.slice(start, RAIL.indexOf('setSelectedCategories({});', start));
  assert.match(body, /setNewSurveyMarkersByPage\(prev => removeSurveyMarkersFromPages\(prev, deletedForPage\)\)/);
  assert.match(body, /setTimeout\(\(\) => \{\s*setSurveyMarkersToRemoveByPage/, 'the removal queue is emptied afterwards');
});
