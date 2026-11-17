// KAL-758: a Project that came from a Plot job, sent back as a .kvjob so
// Plot shows what the field changed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { jobToWalk } from '../src/suite/jobPackage.js';
import { buildWalkMarkers, pageToPoint } from '../src/suite/walkthruHandoff.js';
import { buildReturnManifest, pointToPage, returnFileName, writeReturnJob } from '../src/suite/jobReturn.js';

const manifest = {
  format: 'kalvoe.job',
  version: 1,
  sourceApp: 'plot',
  exportedAt: '2026-11-17T12:00:00Z',
  job: { suiteJobId: 'job-1', name: 'Hoboken', source: { app: 'plot', nativeId: 'job-1' } },
  pages: [{ pageId: 'B01', file: 'pages/B01.pdf', pageIndex: 0, widthPt: 1000, heightPt: 500, title: 'B01 First Floor', source: { app: 'plot', nativeId: 'sheet-1' } }],
  items: [
    { suiteId: 'cam-1', tag: 'C-1-01', library: { categoryEntryId: 'e-cam', categoryName: 'Camera' }, pageId: 'B01', position: { x: 0.1, y: 0.2 }, location: 'Lobby', mediaIds: [], source: { app: 'plot', nativeId: 'd1', version: 1 } },
    { suiteId: 'cam-2', tag: 'C-1-02', library: { categoryEntryId: 'e-cam', categoryName: 'Camera' }, pageId: 'B01', position: { x: 0.5, y: 0.5 }, mediaIds: [], source: { app: 'plot', nativeId: 'd2', version: 1 } },
    { suiteId: 'cam-3', tag: 'C-1-03', library: { categoryEntryId: 'e-cam', categoryName: 'Camera' }, pageId: 'B01', position: { x: 0.7, y: 0.7 }, mediaIds: [], source: { app: 'plot', nativeId: 'd3', version: 1 } },
    { suiteId: 'ap-1', tag: 'W-1-01', library: { categoryName: 'Access point' }, pageId: 'B01', position: { x: 0.9, y: 0.9 }, mediaIds: [], source: { app: 'plot', nativeId: 'd4', version: 1 } },
  ],
  annotations: [{ tag: 'Desk', typeName: 'Desk', pageId: 'B01', position: { x: 0.3, y: 0.3 }, source: { app: 'plot', nativeId: 'd5' } }],
  media: [],
};
const template = { id: 't1', modules: [{ id: 'm1', categories: [{ id: 'c-cam', name: 'Camera', libraryEntryId: 'e-cam' }] }] };
const PAGE = { width: 1000, height: 500, rotation: 0 };

function arrive() {
  const walk = jobToWalk(manifest, []);
  let n = 0;
  const outline = { type: 'Polygon', coordinates: [[[90, 90], [130, 90], [130, 110], [90, 110]]] };
  const out = buildWalkMarkers({
    nodes: walk.floors[0].nodes, nodeTypes: walk.nodeTypes, template, moduleId: 'm1',
    categoryFor: { 'entry:e-cam': 'c-cam' }, pageSize: () => PAGE, newId: () => `mk-${++n}`,
    outlineFor: (node) => (node.title === 'C-1-01' ? outline : null),
  });
  return out.markers;
}
const byId = (markers, suiteId) => Object.values(markers).find((m) => m.suiteId === suiteId);
const shift = (bounds, dx, dy) => ({ ...bounds, x: bounds.x + dx, y: bounds.y + dy });

test('pointToPage undoes pageToPoint on every page turn', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const page = { width: rotation % 180 ? 500 : 1000, height: rotation % 180 ? 1000 : 500, rotation };
    const [px, py] = pageToPoint(0.25, 0.8, page);
    const back = pointToPage(px, py, page);
    assert.ok(Math.abs(back.x - 0.25) < 1e-9 && Math.abs(back.y - 0.8) < 1e-9, `rotation ${rotation}`);
  }
});

test('a marker from a job remembers where it arrived', () => {
  const cam = byId(arrive(), 'cam-1');
  assert.equal(cam.suiteOrigin.pageId, 'B01');
  assert.deepEqual([cam.suiteOrigin.x, cam.suiteOrigin.y], [0.1, 0.2]);
  assert.equal(cam.suiteOrigin.tag, 'C-1-01');
  assert.deepEqual(cam.suiteOrigin.center, { x: 110, y: 100 }, 'the middle of the tag outline it landed on');
  assert.deepEqual(cam.suiteOrigin.page, PAGE);
});

test('sent back: moves, retags and Locations change; nothing else does', () => {
  const markers = arrive();
  const cam1 = byId(markers, 'cam-1');
  const cam2 = byId(markers, 'cam-2');
  cam1.bounds = shift(cam1.bounds, 100, 50); // moved 0.1 across, 0.1 down
  cam2.name = 'C-1-02A';
  cam2.location = 'Stair 2';
  markers['mk-new'] = {
    id: 'mk-new', name: 'C-1-09', categoryId: 'c-cam', libraryEntryId: 'e-cam', suiteId: 'mk-new',
    pageNumber: 1, bounds: { x: 395, y: 245, width: 10, height: 10 }, location: 'Hall',
  };
  const { manifest: back, counts } = buildReturnManifest({
    manifest,
    documents: [{ documentId: 'doc-1', markers }],
    libraryOf: (m) => (m.categoryId === 'c-cam' ? { categoryName: 'Camera' } : null),
    now: '2026-11-18T09:00:00Z',
  });
  assert.equal(back.sourceApp, 'survey');
  assert.equal(back.exportedAt, '2026-11-18T09:00:00Z');
  assert.deepEqual(back.pages, manifest.pages, 'pages go back as Plot sent them');
  const item = (id) => back.items.find((i) => i.suiteId === id);
  assert.deepEqual(item('cam-1').position, { x: 0.2, y: 0.3 }, 'Plot\'s own spot, moved by what the marker moved');
  assert.equal(item('cam-1').tag, 'C-1-01');
  assert.equal(item('cam-1').location, 'Lobby');
  assert.deepEqual(item('cam-2').position, { x: 0.5, y: 0.5 }, 'not moved: Plot\'s spot to the digit');
  assert.equal(item('cam-2').tag, 'C-1-02A');
  assert.equal(item('cam-2').location, 'Stair 2');
  assert.deepEqual(item('cam-3'), manifest.items[2], 'untouched: exactly as sent');
  assert.deepEqual(item('ap-1'), manifest.items[3], 'not in Survey (no Category in the Module): as sent, never removed');
  const added = item('mk-new');
  assert.equal(added.pageId, 'B01');
  assert.deepEqual(added.position, { x: 0.4, y: 0.5 });
  assert.deepEqual(added.library, { categoryEntryId: 'e-cam', categoryName: 'Camera' });
  assert.equal(added.source.app, 'survey');
  assert.deepEqual(counts, { moved: 1, retagged: 1, relocated: 1, added: 1, unchanged: 1, notInSurvey: 1, markups: 0, notPlaced: 0 });
  assert.deepEqual(back.annotations, manifest.annotations);
});

test('red lines go in annotations as markup, only on the job\'s pages', () => {
  const line = { kind: 'markup', shape: 'line', pageId: 'B01', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], color: '#ff0000' };
  const { manifest: back, counts } = buildReturnManifest({ manifest, documents: [{ documentId: 'd', markers: arrive() }], markups: [line, { ...line, pageId: 'ZZ' }] });
  assert.deepEqual(back.annotations.at(-1), line);
  assert.equal(counts.markups, 1);
});

test('the file is Plot\'s job with the new package.json', async () => {
  const zip = new JSZip();
  zip.file('package.json', JSON.stringify(manifest));
  zip.file('pages/B01.pdf', '%PDF-1.4 one');
  const { manifest: back } = buildReturnManifest({ manifest, documents: [] });
  const out = await JSZip.loadAsync(await writeReturnJob(zip, back));
  assert.equal(JSON.parse(await out.file('package.json').async('string')).sourceApp, 'survey');
  assert.equal(await out.file('pages/B01.pdf').async('string'), '%PDF-1.4 one');
  assert.equal(returnFileName(manifest, new Date('2026-11-18T09:00:00Z')), 'Hoboken field changes 2026-11-18.kvjob');
  assert.throws(() => buildReturnManifest({ manifest: { format: 'x' } }), /not a Kal Voe job file/);
});

test('a page\'s drawn marks become markup; markers and highlights stay out', async () => {
  const { markupsFromPage, jobPagesOf } = await import('../src/suite/jobReturn.js');
  const marks = markupsFromPage([
    { type: 'line', left: 0, top: 0, x1: 100, y1: 50, x2: 200, y2: 100, stroke: '#ff0000' },
    { type: 'arrow', left: 0, top: 0, x1: 0, y1: 0, x2: 500, y2: 250 },
    { type: 'rect', left: 100, top: 100, width: 100, height: 50 },
    { type: 'cloud', points: [[0, 0], [1000, 0], [1000, 500]] },
    { type: 'callout', left: 500, top: 250, width: 100, height: 20, text: 'No power here', author: 'Sam' },
    { type: 'path', left: 0, top: 0, path: [['M', 100, 100], ['Q', 150, 150, 200, 100]] },
    { type: 'ellipse', left: 100, top: 50, width: 200, height: 100 },
    { type: 'surveyMarker', left: 1, top: 1, width: 5, height: 5 },
    { type: 'highlight', left: 1, top: 1, width: 5, height: 5 },
  ], { pageId: 'B01', page: PAGE });
  assert.deepEqual(marks.map((m) => m.shape), ['line', 'arrow', 'rectangle', 'cloud', 'text', 'pen', 'ellipse']);
  assert.deepEqual(marks[0], { kind: 'markup', shape: 'line', pageId: 'B01', points: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }], color: '#ff0000' });
  assert.equal(marks[4].text, 'No power here');
  assert.equal(marks[4].author, 'Sam');
  assert.deepEqual(marks[5].points.map((p) => [p.x, p.y]), [[0.1, 0.2], [0.125, 0.2375], [0.15, 0.25], [0.175, 0.2375], [0.2, 0.2]], 'every point of the stroke, the curve walked');
  assert.deepEqual(marks[6].points, [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.3 }], 'an ellipse: its two box corners');
  const pages = jobPagesOf([{ documentId: 'doc-1', markers: arrive() }]);
  assert.deepEqual([...pages.values()].map((p) => [p.pageId, p.pageNumber]), [['B01', 1]]);
});

test('where a marker arrived survives live editing, the row copy and a reload', async () => {
  const Y = await import('yjs');
  const { docToSurveyMarkers, syncSurveyMarkersToDoc } = await import('../src/services/annotationDocStore.js');
  const { buildSurveyMarkerRow, mapSurveyMarkerRowToLocalAnnotation } = await import('../src/services/documentSurveyMarkerMapper.js');
  const cam = byId(arrive(), 'cam-1');
  for (const fieldMaps of [false, true]) {
    const a = new Y.Doc();
    syncSurveyMarkersToDoc(a, { [cam.id]: cam }, { fieldMaps });
    const reloaded = new Y.Doc();
    Y.applyUpdate(reloaded, Y.encodeStateAsUpdate(a));
    assert.deepEqual(docToSurveyMarkers(reloaded)[cam.id].suiteOrigin, cam.suiteOrigin, `fieldMaps=${fieldMaps}`);
  }
  const row = buildSurveyMarkerRow({ documentId: 'd', userId: 'u', annotationId: cam.id, annotation: cam });
  assert.deepEqual(mapSurveyMarkerRowToLocalAnnotation({ ...row, id: 'r1' }).suiteOrigin, cam.suiteOrigin);
  const dash = readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  assert.match(dash, /onSendBackToPlot=\{suiteOn && user \? sendBackToPlot : null\}/);
  const tree = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');
  assert.match(tree, /data-project-send-plot/);
});

test('KAL-779: the header offers Send back to Plot only on a Project a job came into', async () => {
  const { rememberJobProject, isJobProject } = await import('../src/suite/jobProjects.js');
  const data = new Map();
  const storage = { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  assert.equal(isJobProject('p1', storage), false);
  rememberJobProject('p1', storage);
  rememberJobProject('p2', storage);
  rememberJobProject('p1', storage);
  assert.equal(isJobProject('p1', storage), true);
  assert.equal(isJobProject('p3', storage), false);
  assert.deepEqual(JSON.parse(data.get('survey.suite.jobProjects')), ['p1', 'p2']);
  const tree = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');
  assert.match(tree, /onSendBackToPlot && isJobProject\(open\?\.id\)/);
});
