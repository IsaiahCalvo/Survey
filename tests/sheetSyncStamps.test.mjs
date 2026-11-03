// Changed By / Changed Date in the live workbook (owner 2026-11-03: "the
// Changed Date didn't show and the Changed By didn't show"), and the folder a
// new workbook is saved in ("I wasn't able to select where I was going to save").
import test from 'node:test';
import assert from 'node:assert/strict';

import { stampChangedSurveyMarkers } from '../src/services/surveyMarkerStamp.js';
import { fillBlankStamps } from '../supabase/functions/_shared/sheetSync/round.js';
import { cleanFolder } from '../supabase/functions/_shared/sheetSync/service.js';

const AT = '2026-11-03T18:00:00.000Z';

test('an edit to an item\'s survey data stamps who and when', () => {
  const prev = { a: { id: 'a', name: 'D-1', checklistResponses: {} }, b: { id: 'b', name: 'D-2' } };
  const next = { ...prev, a: { ...prev.a, checklistResponses: { q1: { selection: 'Y' } } } };
  const out = stampChangedSurveyMarkers(prev, next, { by: 'IC', at: AT });
  assert.deepEqual(out.a, { ...next.a, changedBy: 'IC', changedDate: AT });
  assert.equal(out.b, prev.b, 'untouched items keep their object');
});

test('a new item is stamped; moving one on the page is not', () => {
  const prev = { a: { id: 'a', name: 'D-1', bounds: { x: 1 } } };
  const moved = { a: { ...prev.a, bounds: { x: 9 } } };
  assert.equal(stampChangedSurveyMarkers(prev, moved, { by: 'IC', at: AT }), moved);
  const added = { ...prev, c: { id: 'c', name: 'D-3' } };
  const out = stampChangedSurveyMarkers(prev, added, { by: 'IC', at: AT });
  assert.equal(out.c.changedBy, 'IC');
  assert.equal(out.c.changedDate, AT);
  assert.equal(out.a, prev.a);
});

test('a write that sets the stamps itself (undo, import) is left alone', () => {
  const prev = { a: { id: 'a', name: 'D-1', changedBy: 'JD', changedDate: '2026-10-01T00:00:00.000Z' } };
  const undo = { a: { id: 'a', name: 'D-0', changedBy: 'KM', changedDate: '2026-09-01T00:00:00.000Z' } };
  assert.equal(stampChangedSurveyMarkers(prev, undo, { by: 'IC', at: AT }), undo);
  const imported = { ...prev, n: { id: 'n', name: 'D-9', changedBy: 'JD' } };
  assert.equal(stampChangedSurveyMarkers(prev, imported, { by: 'IC', at: AT }), imported);
});

test('with no initials known nothing is stamped', () => {
  const prev = { a: { id: 'a', name: 'D-1' } };
  const next = { a: { id: 'a', name: 'D-2' } };
  assert.equal(stampChangedSurveyMarkers(prev, next, { by: '' }), next);
});

test('the server fills blank stamps once, only for items in the sheet', () => {
  const layout = { scopes: [{ moduleId: 'm1', categoryId: 'doors' }] };
  const markers = {
    a: { id: 'a', moduleId: 'm1', categoryId: 'doors' },
    b: { id: 'b', moduleId: 'm1', categoryId: 'doors', changedBy: 'JD', changedDate: AT },
    c: { id: 'c', moduleId: 'm1', categoryId: 'doors', changedBy: 'JD' },
    d: { id: 'd', moduleId: 'm1', categoryId: 'walls' },
  };
  const fills = fillBlankStamps(layout, markers, 'IC', AT);
  assert.deepEqual(Object.keys(fills).sort(), ['a', 'c']);
  assert.deepEqual(fills.a, { ...markers.a, changedBy: 'IC', changedDate: AT });
  assert.deepEqual(fills.c, { ...markers.c, changedDate: AT }, 'a set Changed By is kept');
  assert.deepEqual(fillBlankStamps(layout, { ...markers, ...fills }, 'IC', AT), {}, 'nothing twice');
  assert.deepEqual(fillBlankStamps(layout, markers, '', AT), {});
});

test('a picked folder is cleaned before it reaches OneDrive', () => {
  assert.equal(cleanFolder(undefined), null, 'no folder = the Survey default');
  assert.equal(cleanFolder(''), '', 'the top of OneDrive');
  assert.equal(cleanFolder('Jobs/2026 Hospital'), 'Jobs/2026 Hospital');
  assert.equal(cleanFolder('/Jobs//../a:b*c/./'), 'Jobs/a-b-c');
  assert.equal(cleanFolder(Array.from({ length: 20 }, (_, i) => `f${i}`).join('/')).split('/').length, 12);
});
