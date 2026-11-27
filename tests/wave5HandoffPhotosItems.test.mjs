import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { sendWalkToProject } from '../src/suite/walkthruHandoffRun.js';

test('sendWalkToProject skips pageSizes, outlines, and openDoc for floors with no nodes (#1736)', async () => {
  const openedDocs = [];
  const sizedBlobs = [];
  const outlinedCalls = [];
  const progressEvents = [];
  const linkedDocs = [];

  const template = {
    id: 'tpl-1',
    modules: [{ id: 'mod-1', categories: [{ id: 'cat-1', name: 'Camera' }] }],
  };
  const walk = {
    walk: { name: 'Plot Job' },
    nodeTypes: [{ id: 'nt-1', name: 'Camera' }],
    floors: [
      { id: 'f1', name: 'A01 Cover', asset: { storage_path: 'a01.pdf', format: 'pdf' }, nodes: [] },
      { id: 'f2', name: 'A02 Legend', asset: { storage_path: 'a02.pdf', format: 'pdf' }, nodes: [] },
      {
        id: 'f3',
        name: 'B02 Plan',
        asset: { storage_path: 'b02.pdf', format: 'pdf' },
        nodes: [{ id: 'n1', floor_id: 'f3', page_index: 0, x_pct: 0.5, y_pct: 0.5, node_type_id: 'nt-1', title: 'C-1-01' }],
      },
    ],
  };

  let docNum = 0;
  const result = await sendWalkToProject({
    supabase: null,
    walk,
    template,
    moduleId: 'mod-1',
    categoryFor: { 'nt-1': 'cat-1' },
    download: async (path) => ({ data: new Blob([path], { type: 'application/pdf' }), error: null }),
    addPdfToProject: async (_file, name) => ({ id: `doc-${++docNum}`, name }),
    pageSizes: async (blob) => {
      sizedBlobs.push(blob);
      return () => ({ width: 612, height: 792, rotation: 0 });
    },
    outlines: async (_blob, nodes) => {
      outlinedCalls.push(nodes.length);
      return new Map();
    },
    openDoc: async (docId) => {
      openedDocs.push(docId);
      return {
        getSurveyMarkers: () => ({}),
        applySurveyMarkers: () => {},
        drain: async () => {},
        flushSnapshot: async () => {},
        destroy: async () => {},
      };
    },
    linkTemplate: async (docId) => { linkedDocs.push(docId); },
    newId: () => 'marker-1',
    onProgress: (p) => progressEvents.push(p),
  });

  assert.equal(result.documents.length, 3);
  assert.equal(result.added, 1);
  assert.deepEqual(openedDocs, ['doc-3']);
  assert.equal(sizedBlobs.length, 1);
  assert.deepEqual(outlinedCalls, [1]);
  assert.deepEqual(linkedDocs, ['doc-1', 'doc-2', 'doc-3']);
  assert.deepEqual(progressEvents, [
    { done: 1, total: 3 },
    { done: 2, total: 3 },
    { done: 3, total: 3 },
  ]);
});

test('ProjectPhotosPanel shows a loading spinner on photo tiles before image ready (#1749)', () => {
  const src = fs.readFileSync(new URL('../src/projectPhotos/ProjectPhotosPanel.jsx', import.meta.url), 'utf8');
  assert.match(src, /function PhotoThumb\(/);
  assert.match(src, /aria-label="Loading photo"/);
  assert.match(src, /<Spinner size=\{14\}/);
});

test('ProjectItemsPanel closes the item dialog before opening a linked document (#1753)', () => {
  const src = fs.readFileSync(new URL('../src/projectItems/ProjectItemsPanel.jsx', import.meta.url), 'utf8');
  assert.match(src, /if \(d\) \{ onClose\?\.\(\); onOpenDocument\?\.\(d\); \}/);
});
