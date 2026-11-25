import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWalkMarkers, matchCategories, pageToPoint } from '../src/suite/walkthruHandoff.js';

// Walkthru's toCanonical (packages/shared/src/coords.ts), copied so the test
// proves pageToPoint is its exact inverse for every page rotation.
function toCanonical(px, py, w, h, rotation) {
  const f = {
    0: () => ({ x: px, y: py, w, h }),
    90: () => ({ x: py, y: w - px, w: h, h: w }),
    180: () => ({ x: w - px, y: h - py, w, h }),
    270: () => ({ x: h - py, y: px, w: h, h: w }),
  }[rotation]();
  return [f.x / f.w, f.y / f.h];
}

test('a spot lands where Walkthru put it, on every page rotation', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const sideways = rotation % 180 !== 0;
    const page = { width: sideways ? 792 : 1224, height: sideways ? 1224 : 792, rotation };
    for (const [px, py] of [[100, 50], [600, 400], [0, 0], [page.width, page.height]]) {
      const [xPct, yPct] = toCanonical(px, py, page.width, page.height, rotation);
      const [x, y] = pageToPoint(xPct, yPct, page);
      assert.ok(Math.abs(x - px) < 1e-6 && Math.abs(y - py) < 1e-6, `rotation ${rotation}: ${px},${py} -> ${x},${y}`);
    }
  }
});

test('a spot with no page size is left unplaced, not guessed', () => {
  assert.equal(pageToPoint(0.5, 0.5, null), null);
  assert.equal(pageToPoint(0.5, 0.5, { width: 0, height: 10 }), null);
});

const template = {
  id: 't1',
  entities: [{ id: 'e1', name: 'Existing', color: '#22c55e' }, { id: 'e2', name: 'New', color: '#ef4444' }],
  modules: [{
    id: 'm1', name: 'Security',
    categories: [
      { id: 'c-cam', name: 'Camera', libraryEntryId: 'lib-cam', checklist: [] },
      { id: 'c-door', name: 'Door', checklist: [] },
    ],
  }],
};
const nodeTypes = [
  { id: 'nt-cam', name: 'CCTV', library_entry_id: 'lib-cam' },
  { id: 'nt-door', name: 'Door' },
  { id: 'nt-wap', name: 'WAP' },
];

test('Categories match by library id first, else by exact name to confirm, else are missing', () => {
  const m = matchCategories(nodeTypes, template, 'm1');
  assert.deepEqual(m.linked, { 'nt-cam': 'c-cam' });
  assert.deepEqual(m.nameMatches, [{ nodeTypeId: 'nt-door', categoryId: 'c-door', name: 'Door' }]);
  assert.deepEqual(m.missing, [{ nodeTypeId: 'nt-wap', name: 'WAP' }]);
});

test('a near name is never matched', () => {
  const m = matchCategories([{ id: 'x', name: 'door' }, { id: 'y', name: 'Doors' }], template, 'm1');
  assert.deepEqual(m.nameMatches, []);
  assert.equal(m.missing.length, 2);
});

const page = () => ({ width: 1224, height: 792, rotation: 0 });
const nodes = [
  { id: 'n1', page_index: 0, x_pct: 0.5, y_pct: 0.25, node_type_id: 'nt-cam', title: 'C-1-01', suite_device_id: 's1', building: 'A', wing: 'East', floor_label: '1', location: 'Lobby' },
  { id: 'n2', page_index: 0, x_pct: 0.1, y_pct: 0.1, node_type_id: 'nt-door', title: 'D-1', suite_device_id: 's2' },
  { id: 'n3', page_index: 0, x_pct: 0.2, y_pct: 0.2, node_type_id: 'nt-wap', title: 'W-1', suite_device_id: 's3' },
  { id: 'n4', page_index: 0, x_pct: 0.3, y_pct: 0.3, node_type_id: 'nt-wap', title: 'W-2', suite_device_id: 's4' },
  { id: 'n5', page_index: 0, x_pct: 0.4, y_pct: 0.4, node_type_id: null, title: 'note' },
];

function ids() { let n = 0; return () => `new-${++n}`; }

test('a walk becomes markers with Tag, shared id, places and Entity; nothing is dropped', () => {
  const out = buildWalkMarkers({
    nodes, nodeTypes, template, moduleId: 'm1',
    categoryFor: { 'nt-cam': 'c-cam', 'nt-door': 'c-door' },
    pageSize: page, newId: ids(), now: '2026-11-16T00:00:00Z',
  });
  assert.equal(out.added, 2);
  assert.equal(out.defaultNodes, 1);
  assert.deepEqual(out.notInModule, [{ nodeTypeId: 'nt-wap', name: 'WAP', count: 2 }]);
  assert.equal(out.added + out.defaultNodes + out.notInModule.reduce((s, m) => s + m.count, 0), nodes.length);
  const cam = out.markers['new-1'];
  assert.equal(cam.name, 'C-1-01');
  assert.equal(cam.suiteId, 's1');
  assert.equal(cam.categoryId, 'c-cam');
  assert.equal(cam.moduleId, 'm1');
  assert.equal(cam.libraryEntryId, 'lib-cam');
  assert.deepEqual([cam.building, cam.wing, cam.floor, cam.location], ['A', 'East', '1', 'Lobby']);
  assert.equal(cam.entityId, 'e1');
  assert.equal(cam.pageNumber, 1);
  assert.equal(cam.bounds.shape.type, 'stroke');
  const [a, b] = cam.bounds.shape.points;
  assert.ok(Math.abs((a[0] + b[0]) / 2 - 612) < 0.01 && Math.abs(a[1] - 198) < 0.01);
});

test('sending again updates by shared id and keeps the field\'s answers, Entity and spot', () => {
  const first = buildWalkMarkers({
    nodes, nodeTypes, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' },
    pageSize: page, newId: ids(),
  });
  const existing = { ...first.markers };
  existing['new-1'] = {
    ...existing['new-1'], checklistResponses: { q1: true }, entityId: 'e2', entityName: 'New',
    bounds: { ...existing['new-1'].bounds, x: 1 },
  };
  const moved = nodes.map((n) => (n.id === 'n1' ? { ...n, title: 'C-1-02', location: 'Hall' } : n));
  const again = buildWalkMarkers({
    nodes: moved, nodeTypes, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' },
    pageSize: page, existingMarkers: existing, newId: ids(),
  });
  assert.equal(again.added, 0);
  assert.equal(again.updated, 1);
  const m = again.markers['new-1'];
  assert.equal(m.name, 'C-1-02');
  assert.equal(m.location, 'Hall');
  assert.deepEqual(m.checklistResponses, { q1: true });
  assert.equal(m.entityId, 'e2');
  assert.equal(m.bounds.x, 1);
});

test('two nodes sharing one shared id each keep their own marker on resend', () => {
  const twins = [
    { id: 'a', page_index: 0, x_pct: 0.1, y_pct: 0.1, node_type_id: 'nt-cam', title: 'C-1', suite_device_id: 'same' },
    { id: 'b', page_index: 0, x_pct: 0.9, y_pct: 0.9, node_type_id: 'nt-cam', title: 'C-1', suite_device_id: 'same' },
  ];
  const args = { nodeTypes, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' }, pageSize: page };
  const first = buildWalkMarkers({ ...args, nodes: twins, newId: ids() });
  assert.equal(first.added, 2);
  const again = buildWalkMarkers({ ...args, nodes: twins, existingMarkers: first.markers, newId: ids() });
  assert.equal(again.added, 0);
  assert.equal(again.updated, 2);
  assert.deepEqual(Object.keys(again.markers).sort(), ['new-1', 'new-2']);
});

test('a node on a page Survey cannot size arrives unplaced, still counted', () => {
  const out = buildWalkMarkers({
    nodes: [nodes[0]], nodeTypes, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' },
    pageSize: () => null, newId: ids(),
  });
  assert.equal(out.added, 1);
  assert.equal(out.unplaced, 1);
  assert.equal(out.markers['new-1'].bounds, null);
});

test('resending a walk keeps field-edited Tag and place fields while still updating untouched fields (#1593)', () => {
  const first = buildWalkMarkers({
    nodes: [nodes[0]], nodeTypes, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' },
    pageSize: page, newId: ids(),
  });
  // Field retags C-1-01 -> C-1-01X and updates building + location, leaving wing & floor untouched.
  const existing = {
    'new-1': {
      ...first.markers['new-1'],
      name: 'C-1-01X',
      building: 'B',
      location: 'Server Room',
    },
  };
  // Walk is resent with original title/building/location and an updated wing/floor.
  const resentNodes = [{ ...nodes[0], wing: 'West', floor_label: '2' }];
  const again = buildWalkMarkers({
    nodes: resentNodes, nodeTypes, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' },
    pageSize: page, existingMarkers: existing, newId: ids(),
  });
  const m = again.markers['new-1'];
  assert.equal(m.name, 'C-1-01X', 'field-edited Tag must not be overwritten on resend');
  assert.equal(m.building, 'B', 'field-edited building must not be overwritten on resend');
  assert.equal(m.location, 'Server Room', 'field-edited location must not be overwritten on resend');
  assert.equal(m.wing, 'West', 'untouched wing still picks up walk update');
  assert.equal(m.floor, '2', 'untouched floor still picks up walk update');

  // A third resend still keeps the field's edits.
  const third = buildWalkMarkers({
    nodes: resentNodes, nodeTypes, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' },
    pageSize: page, existingMarkers: again.markers, newId: ids(),
  });
  assert.equal(third.markers['new-1'].name, 'C-1-01X');
  assert.equal(third.markers['new-1'].building, 'B');
  assert.equal(third.markers['new-1'].location, 'Server Room');
});

test('resending keeps field Tag and place edits even on legacy markers without suiteWalkBaseline (#1593)', () => {
  const legacyMarker = {
    id: 'm-legacy',
    name: 'C-2-01X',
    categoryId: 'c-cam',
    moduleId: 'm1',
    suiteId: 's1',
    building: 'Annex',
    wing: 'North',
    floor: '3',
    location: 'Closet',
    pageNumber: 1,
    bounds: { x: 10, y: 10, width: 12, height: 12 },
    suiteOrigin: {
      pageId: 'B01', x: 0.5, y: 0.25, tag: 'C-1-01', location: 'Lobby',
      page: { width: 1224, height: 792, rotation: 0 }, center: { x: 612, y: 198 },
    },
  };
  const again = buildWalkMarkers({
    nodes: [nodes[0]], nodeTypes, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' },
    pageSize: page, existingMarkers: { 'm-legacy': legacyMarker }, newId: ids(),
  });
  const m = again.markers['m-legacy'];
  assert.equal(m.name, 'C-2-01X');
  assert.equal(m.building, 'Annex');
  assert.equal(m.wing, 'North');
  assert.equal(m.floor, '3');
  assert.equal(m.location, 'Closet');
});

test('suiteWalkBaseline survives Yjs live editing and Supabase row mirror round-trips (#1593)', async () => {
  const Y = await import('yjs');
  const { docToSurveyMarkers, syncSurveyMarkersToDoc } = await import('../src/services/annotationDocStore.js');
  const { buildSurveyMarkerRow, mapSurveyMarkerRowToLocalAnnotation } = await import('../src/services/documentSurveyMarkerMapper.js');
  const first = buildWalkMarkers({
    nodes: [nodes[0]], nodeTypes, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' },
    pageSize: page, newId: ids(),
  });
  const cam = first.markers['new-1'];
  assert.ok(cam.suiteWalkBaseline, 'new walk marker stores suiteWalkBaseline');
  for (const fieldMaps of [false, true]) {
    const a = new Y.Doc();
    syncSurveyMarkersToDoc(a, { [cam.id]: cam }, { fieldMaps });
    const reloaded = new Y.Doc();
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(a));
    assert.deepEqual(docToSurveyMarkers(reloaded)[cam.id].suiteWalkBaseline, cam.suiteWalkBaseline, `fieldMaps=${fieldMaps}`);
  }
  const row = buildSurveyMarkerRow({ documentId: 'd', userId: 'u', annotationId: cam.id, annotation: cam });
  assert.deepEqual(mapSurveyMarkerRowToLocalAnnotation({ ...row, id: 'r1' }).suiteWalkBaseline, cam.suiteWalkBaseline);
});

