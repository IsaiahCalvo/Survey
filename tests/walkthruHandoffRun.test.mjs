import test from 'node:test';
import assert from 'node:assert/strict';
import { sendWalkToProject } from '../src/suite/walkthruHandoffRun.js';

const template = {
  entities: [{ id: 'e1', name: 'Existing', color: '#22c55e' }],
  modules: [{ id: 'm1', categories: [{ id: 'c-cam', name: 'Camera', libraryEntryId: 'lib-cam' }] }],
};
const walk = {
  walk: { id: 'w1', name: 'Collier NYC' },
  nodeTypes: [{ id: 'nt-cam', name: 'Camera' }, { id: 'nt-wap', name: 'WAP' }],
  floors: [
    {
      id: 'f1', name: 'Collier NYC', asset: { format: 'pdf', storage_path: 'u/w1/plan.pdf' },
      nodes: [
        { id: 'n1', page_index: 0, x_pct: 0.5, y_pct: 0.5, node_type_id: 'nt-cam', title: 'C-1', suite_device_id: 's1' },
        { id: 'n2', page_index: 0, x_pct: 0.2, y_pct: 0.2, node_type_id: 'nt-wap', title: 'W-1', suite_device_id: 's2' },
        { id: 'n3', page_index: 0, x_pct: 0.3, y_pct: 0.3, node_type_id: null, title: 'note' },
      ],
    },
    { id: 'f2', name: 'Roof photo', asset: { format: 'png', storage_path: 'u/w1/roof.png' }, nodes: [{ id: 'n4', node_type_id: 'nt-cam' }] },
  ],
};

function fakeDocs() {
  const docs = new Map();
  const added = [];
  return {
    added,
    docs,
    addPdfToProject: async (file, name) => {
      added.push(name);
      return { id: 'doc-1' }; // same bytes -> same document, like Survey's dedupe
    },
    openDoc: async (id) => {
      const state = docs.get(id) || { markers: { other: { id: 'other', name: 'Field mark' } }, flushed: 0, destroyed: 0 };
      docs.set(id, state);
      return {
        getSurveyMarkers: () => ({ ...state.markers }),
        applySurveyMarkers: (m) => { state.markers = { ...m }; },
        drain: async () => {},
        flushSnapshot: async () => { state.flushed += 1; },
        destroy: async () => { state.destroyed += 1; },
      };
    },
  };
}

function ids() { let n = 0; return () => `new-${++n}`; }

test('a walk lands in the Project, keeps what the document had, and adds up', async () => {
  const fake = fakeDocs();
  const linked = [];
  const out = await sendWalkToProject({
    supabase: {}, walk, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' },
    addPdfToProject: fake.addPdfToProject, openDoc: fake.openDoc,
    pageSizes: async () => () => ({ width: 1000, height: 500, rotation: 0 }),
    linkTemplate: async (id) => linked.push(id),
    download: async () => ({ data: new Blob(['%PDF-1.4']), error: null }),
    newId: ids(),
  });
  assert.deepEqual(fake.added, ['Collier NYC.pdf']);
  assert.deepEqual(linked, ['doc-1']);
  assert.equal(out.added, 1);
  assert.equal(out.defaultNodes, 1);
  assert.deepEqual(out.notInModule, [{ nodeTypeId: 'nt-wap', name: 'WAP', count: 1 }]);
  assert.deepEqual(out.skippedFloors, [{ floorId: 'f2', name: 'Roof photo', reason: 'not a PDF' }]);
  assert.equal(out.unplaced, 1); // the camera on the photo floor is counted, not lost
  const state = fake.docs.get('doc-1');
  assert.ok(state.markers.other, 'a mark already in the document is kept');
  assert.equal(state.markers['new-1'].suiteId, 's1');
  assert.equal(state.flushed, 1);
  assert.equal(state.destroyed, 1);
});

test('sending the same walk again updates in place, no copies', async () => {
  const fake = fakeDocs();
  const args = {
    supabase: {}, walk, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' },
    addPdfToProject: fake.addPdfToProject, openDoc: fake.openDoc,
    pageSizes: async () => () => ({ width: 1000, height: 500 }),
    download: async () => ({ data: new Blob(['%PDF-1.4']), error: null }),
  };
  await sendWalkToProject({ ...args, newId: ids() });
  const again = await sendWalkToProject({ ...args, newId: ids() });
  assert.equal(again.added, 0);
  assert.equal(again.updated, 1);
  const markers = fake.docs.get('doc-1').markers;
  assert.equal(Object.values(markers).filter((m) => m.suiteId === 's1').length, 1);
});

test('a failed download stops with a plain message', async () => {
  const fake = fakeDocs();
  await assert.rejects(sendWalkToProject({
    supabase: {}, walk, template, moduleId: 'm1', categoryFor: {},
    addPdfToProject: fake.addPdfToProject, openDoc: fake.openDoc, pageSizes: async () => () => null,
    download: async () => ({ data: null, error: { message: 'not allowed' } }), newId: ids(),
  }), /Could not download "Collier NYC": not allowed/);
});

test('a failed PDF download on one floor skips that floor and still sends remaining PDF floors (#1595)', async () => {
  const fake = fakeDocs();
  let docSeq = 0;
  const twoFloorWalk = {
    walk: { id: 'w2', name: 'Annex' },
    nodeTypes: [{ id: 'nt-cam', name: 'Camera' }],
    floors: [
      {
        id: 'f1', name: 'Floor 1', asset: { format: 'pdf', storage_path: 'u/w2/f1.pdf' },
        nodes: [
          { id: 'n1', page_index: 0, x_pct: 0.5, y_pct: 0.5, node_type_id: 'nt-cam', title: 'C-1', suite_device_id: 's1' },
          { id: 'n2', page_index: 0, x_pct: 0.2, y_pct: 0.2, node_type_id: null, title: 'note' },
        ],
      },
      {
        id: 'f2', name: 'Floor 2', asset: { format: 'pdf', storage_path: 'u/w2/f2.pdf' },
        nodes: [
          { id: 'n3', page_index: 0, x_pct: 0.4, y_pct: 0.6, node_type_id: 'nt-cam', title: 'C-2', suite_device_id: 's2' },
        ],
      },
    ],
  };

  const out = await sendWalkToProject({
    supabase: {}, walk: twoFloorWalk, template, moduleId: 'm1', categoryFor: { 'nt-cam': 'c-cam' },
    addPdfToProject: async (file, name) => {
      fake.added.push(name);
      return { id: `doc-${++docSeq}` };
    },
    openDoc: fake.openDoc,
    pageSizes: async () => () => ({ width: 1000, height: 500, rotation: 0 }),
    download: async (path) => (path.endsWith('f1.pdf')
      ? { data: null, error: { message: 'Object not found' } }
      : { data: new Blob(['%PDF-1.4']), error: null }),
    newId: ids(),
  });

  assert.deepEqual(fake.added, ['Annex - Floor 2.pdf']);
  assert.equal(out.documents.length, 1);
  assert.equal(out.documents[0].floorId, 'f2');
  assert.equal(out.added, 1);
  assert.equal(out.defaultNodes, 1);
  assert.equal(out.unplaced, 1);
  assert.deepEqual(out.skippedFloors, [
    { floorId: 'f1', name: 'Floor 1', reason: 'could not download: Object not found' },
  ]);
  const state = fake.docs.get('doc-1');
  assert.equal(state.markers['new-1'].suiteId, 's2');
});

