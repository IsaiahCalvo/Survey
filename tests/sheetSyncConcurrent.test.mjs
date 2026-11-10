// An app edit made without seeing a value a round brought in from the sheet
// (a phone offline while the PM typed in Excel): sheetSync/concurrent.js.
// Yjs settles two writes to one field by client id, so each case runs with
// the phone's id above and below the round's.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { buildSyncLayout } from '../supabase/functions/_shared/sheetSync/layout.js';
import { checkWatched, watchWrites, applyClashes, keepWatched } from '../supabase/functions/_shared/sheetSync/concurrent.js';
import { appRecordOf, fieldPrintsOf } from '../supabase/functions/_shared/sheetSync/engine.js';
import { docToSurveyMarkers, getSurveyMarkersMap, syncSurveyMarkersToDoc } from '../supabase/functions/_shared/surveyMarkerDocSync.js';
import { defaultKit, template, door } from './helpers/sheetSyncHarness.mjs';

const layout = buildSyncLayout({ template: template(), kit: defaultKit });
const scope = layout.scopes.find((s) => s.categoryId === 'doors');
const printsOf = (m) => fieldPrintsOf(appRecordOf(m, scope, layout));

// A survey with one door (per-field Y.Maps, as the app writes them now), a
// round that writes `pulled` into it, and a phone that loaded it before.
function scene({ phoneId, roundId, start }) {
  const origin = new Y.Doc();
  origin.clientID = 50;
  syncSurveyMarkersToDoc(origin, { d1: start }, { fieldMaps: true });
  const base = Y.encodeStateAsUpdate(origin);
  const load = (id) => { const d = new Y.Doc({ gc: false }); d.clientID = id; Y.applyUpdate(d, base); return d; };
  return { base, phone: load(phoneId), round: load(roundId), load };
}

function roundWrites(round, next) {
  const fresh = docToSurveyMarkers(round);
  const sv = Y.encodeStateVector(round);
  syncSurveyMarkersToDoc(round, { d1: next }, { origin: 'excel-import', fieldMaps: true });
  const pulls = watchWrites(round, getSurveyMarkersMap(round), fresh, { d1: next }, layout);
  return { pulls, update: Y.encodeStateAsUpdate(round, sv) };
}

for (const [label, phoneId] of [['phone shown', 900], ['round shown', 10]]) {
  test(`same note, ${label}: the cells compare from before the PM's change`, () => {
    const start = door('d1', 'D-1', { note: { text: 'Start' } });
    const { phone, round, load } = scene({ phoneId, roundId: 500, start });
    const { pulls, update } = roundWrites(round, { ...start, note: { text: 'PM' } });
    assert.ok(pulls.d1?.fields?.note, 'the note write is watched');
    assert.equal(JSON.stringify(pulls).includes('PM'), false, 'fingerprints only, never the text');

    const sv = Y.encodeStateVector(phone);
    syncSurveyMarkersToDoc(phone, { d1: { ...start, note: { text: 'Phone' } } }, { fieldMaps: true });
    const held = Y.encodeStateAsUpdate(phone, sv);

    // The server's view: the round's write, then the phone's held one.
    const server = load(1);
    Y.applyUpdate(server, update);
    Y.applyUpdate(server, held);
    const markers = docToSurveyMarkers(server);
    const { clashes } = checkWatched(getSurveyMarkersMap(server), pulls, markers);
    assert.ok(clashes.d1, 'the phone did not see the PM\'s note');
    assert.equal(clashes.d1.cells.notes, printsOf(start).notes, 'Notes compares against "Start"');
    if (markers.d1.note.text === 'PM') assert.equal(clashes.d1.theirs?.note?.text, 'Phone', 'the dropped edit is read back');
    else assert.equal(clashes.d1.theirs, null);

    const baseline = { d1: { scopeId: scope.scopeId, fields: printsOf({ ...start, note: { text: 'PM' } }) } };
    const view = applyClashes(markers, baseline, clashes);
    assert.equal(view.markers.d1.note.text, 'Phone', 'the app side is the phone\'s edit');
    assert.equal(view.baseline.d1.fields.notes, printsOf(start).notes);
  });

  test(`another answer line, ${label}: only the PM's line compares from before`, () => {
    const start = door('d1', 'D-1', { checklistResponses: { c1: { selection: 'N' }, c2: { value: '7' } } });
    const { phone, round, load } = scene({ phoneId, roundId: 500, start });
    const { pulls, update } = roundWrites(round, { ...start, checklistResponses: { ...start.checklistResponses, c1: { selection: 'Y' } } });
    const sv = Y.encodeStateVector(phone);
    syncSurveyMarkersToDoc(phone, { d1: { ...start, checklistResponses: { ...start.checklistResponses, c2: { value: '9' } } } }, { fieldMaps: true });
    const server = load(1);
    Y.applyUpdate(server, update);
    Y.applyUpdate(server, Y.encodeStateAsUpdate(phone, sv));
    const { clashes } = checkWatched(getSurveyMarkersMap(server), pulls, docToSurveyMarkers(server));
    assert.deepEqual(Object.keys(clashes.d1.cells), ['answers']);
    assert.deepEqual(Object.keys(clashes.d1.cells.answers), ['c1'], 'Height is not rewound');
  });
}

test('an edit made after seeing the round\'s value is not a clash', () => {
  const start = door('d1', 'D-1', { note: { text: 'Start' } });
  const { round, load } = scene({ phoneId: 900, roundId: 500, start });
  const { pulls, update } = roundWrites(round, { ...start, note: { text: 'PM' } });
  for (const id of [2, 4000]) {
    const phone = load(id);
    Y.applyUpdate(phone, update);
    const sv = Y.encodeStateVector(phone);
    syncSurveyMarkersToDoc(phone, { d1: { ...docToSurveyMarkers(phone).d1, note: { text: `After ${id}` } } }, { fieldMaps: true });
    const server = load(1);
    Y.applyUpdate(server, update);
    Y.applyUpdate(server, Y.encodeStateAsUpdate(phone, sv));
    const out = checkWatched(getSurveyMarkersMap(server), pulls, docToSurveyMarkers(server));
    assert.deepEqual(out.clashes, {});
    assert.ok(out.pulls.d1, 'still watched for a later offline device');
  }
});

test('a whole marker written over by an old device counts as not seen', () => {
  const start = door('d1', 'D-1', { note: { text: 'Start' } });
  const { phone, round, load } = scene({ phoneId: 900, roundId: 500, start });
  const { pulls, update } = roundWrites(round, { ...start, note: { text: 'PM' } });
  const sv = Y.encodeStateVector(phone);
  syncSurveyMarkersToDoc(phone, { d1: { ...start, note: { text: 'Old app' } } }); // plain object
  const server = load(1);
  Y.applyUpdate(server, update);
  Y.applyUpdate(server, Y.encodeStateAsUpdate(phone, sv));
  const { clashes, pulls: left } = checkWatched(getSurveyMarkersMap(server), pulls, docToSurveyMarkers(server));
  assert.ok(clashes.d1);
  assert.equal(left.d1, undefined, 'nothing left to watch inside a replaced marker');
});

test('a clash found once is not found again', () => {
  const start = door('d1', 'D-1', { note: { text: 'Start' } });
  const { phone, round, load } = scene({ phoneId: 900, roundId: 500, start });
  const { pulls, update } = roundWrites(round, { ...start, note: { text: 'PM' } });
  const sv = Y.encodeStateVector(phone);
  syncSurveyMarkersToDoc(phone, { d1: { ...start, note: { text: 'Phone' } } }, { fieldMaps: true });
  const server = load(1);
  Y.applyUpdate(server, update);
  Y.applyUpdate(server, Y.encodeStateAsUpdate(phone, sv));
  const first = checkWatched(getSurveyMarkersMap(server), pulls, docToSurveyMarkers(server));
  assert.ok(first.clashes.d1);
  const second = checkWatched(getSurveyMarkersMap(server), first.pulls, docToSurveyMarkers(server));
  assert.deepEqual(second.clashes, {});
});

test('watched writes expire and are capped', () => {
  const now = Date.parse('2026-11-10T00:00:00Z');
  const old = { a: { t: now - 31 * 86400000 }, b: { t: now - 1000 } };
  assert.deepEqual(Object.keys(keepWatched(old, { c: { t: now } }, now)).sort(), ['b', 'c']);
  const many = Object.fromEntries(Array.from({ length: 1200 }, (_, i) => [`m${i}`, { t: now - i }]));
  const kept = keepWatched(many, {}, now);
  assert.equal(Object.keys(kept).length, 1000);
  assert.ok(kept.m0 && !kept.m1100, 'the newest are kept');
});
