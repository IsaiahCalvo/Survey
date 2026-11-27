// KAL-617: a job file (.kvjob) from Plot into a Survey Project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { jobFileDownload, jobLeftOut, jobToWalk, openJobFile } from '../src/suite/jobPackage.js';
import { pickTagOutline, textCenters } from '../src/suite/jobOutlines.js';
import { matchCategories } from '../src/suite/walkthruHandoff.js';
import { sendWalkToProject } from '../src/suite/walkthruHandoffRun.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const manifest = {
  format: 'kalvoe.job',
  version: 1,
  sourceApp: 'plot',
  exportedAt: '2026-11-17T12:00:00Z',
  job: { suiteJobId: 'job-1', name: 'Collier NYC', source: 'plot' },
  pages: [
    { pageId: 'p1', file: 'pages/p1.pdf', pageIndex: 0, widthPt: 1000, heightPt: 500, building: 'HP 20', wing: 'East', floor: 'Level 2', title: 'E-201' },
    { pageId: 'p2', file: 'pages/p2.pdf', pageIndex: 1, widthPt: 1000, heightPt: 500, building: 'HP 20', floor: 'Level 3', title: 'E-301' },
  ],
  items: [
    {
      suiteId: 'dev-cam-1', tag: 'C-2-01',
      library: { categoryEntryId: 'e-cam', typeEntryId: 'e-ptz', categoryName: 'Camera', typeName: 'PTZ' },
      pageId: 'p1', position: { x: 0.1, y: 0.2 }, location: 'Lobby',
      source: { app: 'plot', nativeId: 'blk-1', version: 1 },
    },
    {
      suiteId: 'dev-door-1', tag: 'D-2-01',
      library: { categoryName: 'Door', typeName: 'Maglock' },
      pageId: 'p1', position: { x: 0.5, y: 0.5 }, floor: 'Mezzanine',
      source: { app: 'plot', nativeId: 'blk-2', version: 1 },
    },
    {
      suiteId: 'dev-ap-1', tag: 'W-3-01',
      library: { categoryName: 'Access point' },
      pageId: 'p2', position: { x: 0.9, y: 0.9 },
    },
    { suiteId: 'dev-lost', tag: 'X-1', library: { categoryName: 'Camera' }, pageId: 'nope', position: { x: 0, y: 0 } },
  ],
  annotations: [{ pageId: 'p1', position: { x: 0.3, y: 0.3 }, library: { categoryName: 'Desk' } }],
  media: [{ mediaId: 'm1', kind: 'photo', file: 'media/m1.jpg' }],
  plot: { schedules: [{ name: 'Camera schedule' }], riser: { idfs: [] } },
};
const library = [{ entryId: 'e-cam', kind: 'category', name: 'Camera', scope: 'company' }];

async function jobZip(m = manifest) {
  const zip = new JSZip();
  zip.file('package.json', JSON.stringify(m));
  zip.file('library.json', JSON.stringify(library));
  zip.file('pages/p1.pdf', '%PDF-1.4 page one');
  zip.file('pages/p2.pdf', '%PDF-1.4 page two');
  return zip.generateAsync({ type: 'uint8array' });
}

const template = {
  id: 't1',
  entities: [{ id: 'ent-1', name: 'To check', color: '#f00' }],
  modules: [{
    id: 'm1',
    categories: [
      { id: 'c-cam', name: 'Camera', libraryEntryId: 'e-cam' },
      { id: 'c-door', name: 'Door', types: [{ id: 'ty-mag', name: 'Maglock', libraryEntryId: 'e-mag' }] },
    ],
  }],
};

test('a job file opens; anything else is turned away in plain words', async () => {
  const job = await openJobFile(await jobZip());
  assert.equal(job.manifest.job.name, 'Collier NYC');
  assert.equal(job.library.length, 1);
  await assert.rejects(openJobFile(new TextEncoder().encode('not a zip')), /not a job file/);
  const wrong = new JSZip();
  wrong.file('package.json', JSON.stringify({ format: 'something.else' }));
  await assert.rejects(openJobFile(await wrong.generateAsync({ type: 'uint8array' })), /not a Kal Voe job file/);
  await assert.rejects(openJobFile(await jobZip({ ...manifest, version: 2 })), /newer app/);
});

test('items become nodes with their shared id, Tag and places; one floor per PDF', () => {
  const walk = jobToWalk(manifest, library);
  assert.equal(walk.walk.name, 'Collier NYC');
  assert.equal(walk.source, 'Plot');
  assert.deepEqual(walk.floors.map((f) => [f.id, f.name]), [['pages/p1.pdf', 'E-201'], ['pages/p2.pdf', 'E-301']]);
  const cam = walk.floors[0].nodes.find((n) => n.suite_device_id === 'dev-cam-1');
  assert.deepEqual(
    { ...cam },
    {
      id: 'blk-1', page_index: 0, x_pct: 0.1, y_pct: 0.2, node_type_id: 'entry:e-cam',
      library_type_entry_id: 'e-ptz', library_type_name: 'PTZ', title: 'C-2-01', suite_device_id: 'dev-cam-1',
      building: 'HP 20', wing: 'East', floor_label: 'Level 2', location: 'Lobby', origin_page_id: 'p1',
    },
  );
  // The item's own Floor wins over the page's.
  assert.equal(walk.floors[0].nodes.find((n) => n.title === 'D-2-01').floor_label, 'Mezzanine');
  // Categories: by library id, else by exact name.
  assert.deepEqual(walk.nodeTypes, [
    { id: 'entry:e-cam', name: 'Camera', library_entry_id: 'e-cam' },
    { id: 'name:Door', name: 'Door', library_entry_id: null },
    { id: 'name:Access point', name: 'Access point', library_entry_id: null },
  ]);
  // A Block with no Category rides along with no Category, never tracked.
  const desk = walk.floors[0].nodes.find((n) => n.node_type_id == null);
  assert.equal(desk.suite_device_id, null);
  assert.deepEqual(walk.extras, { media: 1, schedules: 1, riser: true, noPage: 1 });
  assert.equal(jobLeftOut(walk.extras), '1 media file, the Schedule, the Riser, 1 item with no page');
});

test('a page is placed by its order in its own PDF, whatever pageIndex counts', () => {
  // Plot: one PDF per page, pageIndex counted across the job.
  const walk = jobToWalk(manifest, library);
  assert.equal(walk.floors[1].nodes[0].page_index, 0, 'p2 (pageIndex 1) is page 1 of pages/p2.pdf');
  // One PDF with two pages.
  const shared = jobToWalk({
    ...manifest,
    pages: [
      { pageId: 'b', file: 'pages/set.pdf', pageIndex: 1 },
      { pageId: 'a', file: 'pages/set.pdf', pageIndex: 0 },
    ],
    items: [
      { suiteId: 's-a', tag: 'A', library: { categoryName: 'Door' }, pageId: 'a', position: { x: 0, y: 0 } },
      { suiteId: 's-b', tag: 'B', library: { categoryName: 'Door' }, pageId: 'b', position: { x: 0, y: 0 } },
    ],
    annotations: [],
  });
  assert.equal(shared.floors.length, 1);
  assert.deepEqual(shared.floors[0].nodes.map((n) => [n.title, n.page_index]), [['A', 0], ['B', 1]]);
});

test('the arrival rule is the walk rule: library id, then exact name, the rest counted', () => {
  const walk = jobToWalk(manifest, library);
  const match = matchCategories(walk.nodeTypes, template, 'm1');
  assert.deepEqual(match.linked, { 'entry:e-cam': 'c-cam' });
  assert.deepEqual(match.nameMatches.map((m) => m.nodeTypeId), ['name:Door']);
  assert.deepEqual(match.missing.map((m) => m.nodeTypeId), ['name:Access point']);
});

test('sending a job: tag outlines where found, dots elsewhere, shared ids kept, resend updates', async () => {
  const bytes = await jobZip();
  const { manifest: m, library: lib, zip } = await openJobFile(bytes);
  const walk = jobToWalk(m, lib);
  const docs = new Map();
  const added = [];
  const outline = { type: 'Polygon', coordinates: [[[90, 90], [110, 90], [110, 110], [90, 110]]] };
  let id = 0;
  const run = () => sendWalkToProject({
    walk,
    template,
    moduleId: 'm1',
    categoryFor: { 'entry:e-cam': 'c-cam', 'name:Door': 'c-door' },
    download: jobFileDownload(zip),
    newId: () => `mk-${++id}`,
    pageSizes: async () => () => ({ width: 1000, height: 500, rotation: 0 }),
    outlines: async (_blob, nodes) => new Map(nodes.filter((n) => n.title === 'C-2-01').map((n) => [n, outline])),
    addPdfToProject: async (file, name) => { added.push(name); return { id: `doc-${name}` }; },
    openDoc: async (docId) => {
      const markers = docs.get(docId) || {};
      return {
        getSurveyMarkers: () => markers,
        applySurveyMarkers: (next) => { docs.set(docId, next); },
      };
    },
  });
  const first = await run();
  assert.deepEqual(added, ['Collier NYC - E-201.pdf', 'Collier NYC - E-301.pdf']);
  assert.equal(first.added, 2);
  assert.equal(first.defaultNodes, 1);
  assert.deepEqual(first.notInModule.map((x) => [x.name, x.count]), [['Access point', 1]]);
  const markers = Object.values(docs.get('doc-Collier NYC - E-201.pdf'));
  const cam = markers.find((mk) => mk.suiteId === 'dev-cam-1');
  assert.equal(cam.name, 'C-2-01');
  assert.equal(cam.libraryEntryId, 'e-cam');
  assert.equal(cam.libraryTypeEntryId, 'e-ptz');
  assert.equal(cam.bounds.shape.type, 'polygon', 'the camera lands on its tag outline');
  assert.deepEqual([cam.bounds.x, cam.bounds.y, cam.bounds.width, cam.bounds.height], [90, 90, 20, 20]);
  const door = markers.find((mk) => mk.suiteId === 'dev-door-1');
  assert.notEqual(door.bounds.shape?.type, 'polygon', 'no outline: a dot where Plot put it');
  assert.equal(door.floor, 'Mezzanine');
  // A Type with no library id in the file links by its exact name in the Module.
  assert.equal(door.libraryTypeEntryId, 'e-mag');
  assert.equal(door.entityId, 'ent-1');

  const again = await run();
  assert.equal(again.added, 0);
  assert.equal(again.updated, 2);
  assert.equal(Object.keys(docs.get('doc-Collier NYC - E-201.pdf')).length, 2, 'nothing is copied twice');
});

// A tag-sized circle (as a ring) for pickShapeAtPoint.
function square(x, y, size) {
  const ring = [[x, y], [x + size, y], [x + size, y + size], [x, y + size]];
  return { ring, minX: x, minY: y, maxX: x + size, maxY: y + size, width: size, height: size, area: size * size };
}

test('Smart Fill on arrival: the shape around the printed Tag, else a dot', () => {
  const tagA = square(100, 100, 20);
  const tagB = square(300, 100, 20);
  const room = square(0, 0, 100); // 100 pt: too big to trust from the spot alone
  const shapes = [tagA, tagB, room];
  const texts = [{ text: 'C-2-01', x: 110, y: 110 }, { text: 'C-2-02', x: 310, y: 110 }];

  // The Tag text wins, even when the device's spot is off the tag.
  const byTag = pickTagOutline({ shapes, texts, tag: 'C-2-01', point: [400, 400] });
  assert.equal(byTag.by, 'tag');
  assert.deepEqual(byTag.polygon.coordinates[0], tagA.ring);

  // No printed Tag: a dot, even with a shape under the spot (in Plot that is
  // the device symbol, not its tag).
  assert.equal(pickTagOutline({ shapes, texts, tag: 'C-9-99', point: [305, 105] }), null);
  // A grouped label is not the Tag.
  assert.equal(pickTagOutline({ shapes, texts: [{ text: 'ACP-1-01 to ACP-1-04', x: 110, y: 110 }], tag: 'ACP-1-01', point: null }), null);
  // Exact text only: no near match.
  assert.equal(pickTagOutline({ shapes, texts, tag: 'C-2-0', point: null }), null);
  // The same Tag twice: the one nearest the spot.
  const twice = pickTagOutline({ shapes, texts: [...texts, { text: 'C-2-01', x: 310, y: 115 }], tag: 'C-2-01', point: [305, 105] });
  assert.deepEqual(twice.polygon.coordinates[0], tagB.ring);
});

test('text middles are in page units, top-left origin', () => {
  // A 500 pt tall page: pdf.js flips y.
  const viewport = { convertToViewportPoint: (x, y) => [x, 500 - y] };
  const [mid] = textCenters([{ str: ' C-2-01 ', transform: [10, 0, 0, 10, 100, 380], width: 30, height: 10 }], viewport);
  assert.deepEqual(mid, { text: 'C-2-01', x: 115, y: 115 });
});

test('wiring: Nightly-only entry, job dialog mode, outlines passed', () => {
  const dashboard = read('src/Dashboard.jsx');
  assert.match(dashboard, /onAddFromJobFile=\{suiteOn && user \?/);
  assert.match(dashboard, /source="job"/);
  assert.match(dashboard, /outlines: \(blob, nodes\) => readJobOutlines\(blob, nodes, loadPdfjs\)/);
  assert.match(read('src/home/ProjectsFolderTree.jsx'), /data-project-add-job/);
  const dialog = read('src/home/WalkthruHandoffDialog.jsx');
  assert.match(dialog, /accept="\.kvjob,\.zip,application\/zip"/);
  assert.match(dialog, /loadSavedJobCategoryLinks/);
  assert.match(dashboard, /saveJobCategoryLinks/);
});
