import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeLivePagePresentation,
  remapClipboardPage,
  rotateDisplayedPageSize,
  rotateDisplayedPoint,
  transformPageState,
} from '../pageAnnotationReindex.js';

const make = () => ({
  annotationsByPage: {
    1: { width: 100, objects: [{ type: 'rect', data: { id: 'a1', pageNumber: 1 } }] },
    2: { width: 200, objects: [{ type: 'rect', data: { id: 'a2', pageNumber: 2, regionId: 'r2' } }] },
    3: { width: 300, objects: [{ type: 'rect', data: { id: 'a3', pageNumber: 3 } }] },
    4: { width: 400, objects: [{ type: 'rect', data: { id: 'a4', pageNumber: 4 } }] },
  },
  surveyMarkers: {
    a1: { id: 'a1', annotationId: 'a1', pageNumber: 1, label: 'm1' },
    a2: { id: 'a2', annotationId: 'a2', pageNumber: 2, regionId: 'r2', label: 'm2' },
    a3: { id: 'a3', annotationId: 'a3', pageNumber: 3, label: 'm3' },
  },
  annotations: {
    a2: { id: 'a2', annotationId: 'a2', pageNumber: 2, regionId: 'r2' },
  },
  pageNames: { 1: 'A', 2: 'B', 3: 'C', 4: 'D' },
  pageTransformations: { 2: { rotation: 90 }, 3: { rotation: 180 } },
  bookmarks: [
    { id: 'b1', name: 'Doors', pageIds: [1, 2] },
    { id: 'folder', type: 'folder', children: [{ id: 'b2', name: 'Roof', pageIds: [3] }] },
  ],
  spaces: [{
    id: 'space',
    assignedPages: [
      { pageId: 2, label: 'Door region', regions: [{ regionId: 'r2', pageId: 2, points: [1, 2] }] },
      { pageId: 4, label: 'Roof', regions: [] },
    ],
  }],
  regionOverlayDisabled: new Map([['space-2', true], ['space-4', false]]),
});

const ids = (...values) => {
  let index = 0;
  return () => values[index++] || `generated-${index}`;
};

test('delete removes deleted-page state and shifts every higher page association', () => {
  const input = make();
  const before = structuredClone({ ...input, regionOverlayDisabled: [...input.regionOverlayDisabled] });
  const out = transformPageState(input, { type: 'delete', page: 2 });

  assert.deepEqual(Object.keys(out.annotationsByPage), ['1', '2', '3']);
  assert.equal(out.annotationsByPage[2].objects[0].data.id, 'a3');
  assert.equal(out.annotationsByPage[2].objects[0].data.pageNumber, 2);
  assert.deepEqual(Object.keys(out.surveyMarkers), ['a1', 'a3']);
  assert.equal(out.surveyMarkers.a3.pageNumber, 2);
  assert.deepEqual(out.annotations, {});
  assert.deepEqual(out.pageNames, { 1: 'A', 2: 'C', 3: 'D' });
  assert.deepEqual(out.pageTransformations, { 2: { rotation: 180 } });
  assert.deepEqual(out.bookmarks[0].pageIds, [1]);
  assert.deepEqual(out.bookmarks[1].children[0].pageIds, [2]);
  assert.deepEqual(out.spaces[0].assignedPages, [{ pageId: 3, label: 'Roof', regions: [] }]);
  assert.deepEqual([...out.regionOverlayDisabled], [['space-3', false]]);
  assert.deepEqual({ ...input, regionOverlayDisabled: [...input.regionOverlayDisabled] }, before, 'input immutable');
});

test('insert blank opens an empty physical slot while preserving identity above it', () => {
  const out = transformPageState(make(), { type: 'insert', afterPage: 1 });
  assert.equal(out.annotationsByPage[2], undefined);
  assert.equal(out.annotationsByPage[3].objects[0].data.id, 'a2');
  assert.equal(out.surveyMarkers.a2.pageNumber, 3);
  assert.deepEqual(out.bookmarks[0].pageIds, [1, 3]);
  assert.deepEqual(out.spaces[0].assignedPages.map((page) => page.pageId), [3, 5]);
  assert.deepEqual([...out.regionOverlayDisabled], [['space-3', true], ['space-5', false]]);
});

test('duplicate clones all source-page state with fresh annotation and region identities', () => {
  const out = transformPageState(make(), { type: 'duplicate', page: 2 }, {
    createId: ids('region-copy', 'annotation-copy'),
  });
  const copied = out.annotationsByPage[3].objects[0];
  assert.equal(copied.data.id, 'annotation-copy');
  assert.equal(copied.data.pageNumber, 3);
  assert.equal(copied.data.regionId, 'region-copy');
  assert.equal(out.surveyMarkers['annotation-copy'].pageNumber, 3);
  assert.equal(out.surveyMarkers['annotation-copy'].regionId, 'region-copy');
  assert.equal(out.annotations['annotation-copy'].pageNumber, 3);
  assert.equal(out.pageNames[3], 'B');
  assert.deepEqual(out.pageTransformations[3], { rotation: 90 });
  assert.deepEqual(out.bookmarks[0].pageIds, [1, 2, 3]);
  assert.deepEqual(out.spaces[0].assignedPages.map((page) => page.pageId), [2, 3, 5]);
  assert.equal(out.spaces[0].assignedPages[1].regions[0].regionId, 'region-copy');
  assert.equal(out.regionOverlayDisabled.get('space-3'), true);
  assert.equal(out.annotationsByPage[4].objects[0].data.id, 'a3');
});

test('copy-paste after an earlier target clones the source and shifts its original page', () => {
  const out = transformPageState(make(), { type: 'copy', source: 3, afterPage: 1 }, {
    createId: ids('annotation-copy'),
  });
  assert.equal(out.annotationsByPage[2].objects[0].data.id, 'annotation-copy');
  assert.equal(out.annotationsByPage[2].objects[0].data.pageNumber, 2);
  assert.equal(out.annotationsByPage[4].objects[0].data.id, 'a3');
  assert.deepEqual(out.bookmarks[1].children[0].pageIds, [2, 4]);
});

test('move/cut keeps identity while moving the physical page forward and backward', () => {
  const forward = transformPageState(make(), { type: 'move', from: 2, to: 4 });
  assert.equal(forward.annotationsByPage[4].objects[0].data.id, 'a2');
  assert.equal(forward.surveyMarkers.a2.pageNumber, 4);
  assert.deepEqual(forward.bookmarks[0].pageIds, [1, 4]);
  assert.deepEqual(forward.spaces[0].assignedPages.map((page) => page.pageId), [3, 4]);

  const backward = transformPageState(make(), { type: 'move', from: 4, to: 1 });
  assert.equal(backward.annotationsByPage[1].objects[0].data.id, 'a4');
  assert.equal(backward.annotationsByPage[3].objects[0].data.id, 'a2');
  assert.deepEqual(backward.bookmarks[0].pageIds, [2, 3]);
});

test('rotate leaves every page association on the same physical page', () => {
  const input = make();
  const out = transformPageState(input, { type: 'rotate', page: 2 });
  assert.deepEqual(out.annotationsByPage, input.annotationsByPage);
  assert.deepEqual(out.surveyMarkers, input.surveyMarkers);
  assert.deepEqual(out.bookmarks, input.bookmarks);
  assert.deepEqual(out.spaces, input.spaces);
  assert.equal(out.pageTransformations[2], undefined, 'baked rotation clears the old visual rotation');
  assert.deepEqual(out.pageTransformations[3], { rotation: 180 });
});

test('rotate remaps a transformed rect through displayed-space +90 and restores on -90', () => {
  const input = {
    annotationsByPage: {
      1: {
        width: 612,
        height: 792,
        objects: [{
          type: 'rect',
          left: 120,
          top: 200,
          width: 80,
          height: 40,
          scaleX: 1,
          scaleY: 1,
          angle: 0,
          data: { id: 'xf-rect', type: 'rect', pageNumber: 1, left: 120, top: 200 },
        }],
      },
    },
    surveyMarkers: {},
    annotations: {},
    pageNames: {},
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
  const cw = transformPageState(input, {
    type: 'rotate', page: 1, delta: 90, pageWidth: 612, pageHeight: 792,
  });
  const rect = cw.annotationsByPage[1].objects[0];
  const expected = rotateDisplayedPoint(120 + 40, 200 + 20, 612, 792, 90);
  assert.equal(rect.data.id, 'xf-rect');
  assert.equal(rect.data.pageNumber, 1);
  assert.equal(cw.annotationsByPage[1].width, 792);
  assert.equal(cw.annotationsByPage[1].height, 612);
  assert.ok(Math.abs(rect.left - (expected.x - 40)) < 1e-6);
  assert.ok(Math.abs(rect.top - (expected.y - 20)) < 1e-6);
  assert.equal(rect.angle, 90);
  assert.equal(rect.width, 80);
  assert.equal(rect.height, 40);

  const empty = transformPageState({
    ...input,
    annotationsByPage: { 1: { width: 612, height: 792, objects: [] } },
  }, { type: 'rotate', page: 1, delta: 90, pageWidth: 612, pageHeight: 792 });
  assert.equal(empty.annotationsByPage[1].objects.length, 0);

  const restored = transformPageState(cw, {
    type: 'rotate', page: 1, delta: -90, pageWidth: 792, pageHeight: 612,
  });
  const back = restored.annotationsByPage[1].objects[0];
  assert.ok(Math.abs(back.left - 120) < 1e-6);
  assert.ok(Math.abs(back.top - 200) < 1e-6);
  assert.equal(back.angle, 0);
  assert.equal(restored.annotationsByPage[1].width, 612);
  assert.equal(restored.annotationsByPage[1].height, 792);
  assert.deepEqual(rotateDisplayedPageSize(612, 792, 90), { width: 792, height: 612 });
});

test('serialized hard reopen retains the transformed page identity graph', () => {
  const transformed = transformPageState(make(), { type: 'move', from: 2, to: 4 });
  const stored = JSON.stringify({
    ...transformed,
    regionOverlayDisabled: Object.fromEntries(transformed.regionOverlayDisabled),
  });
  const reopened = JSON.parse(stored);
  assert.equal(reopened.annotationsByPage[4].objects[0].data.id, 'a2');
  assert.equal(reopened.surveyMarkers.a2.pageNumber, 4);
  assert.deepEqual(reopened.bookmarks[0].pageIds, [1, 4]);
  assert.equal(reopened.spaces[0].assignedPages.find((page) => page.pageId === 4).regions[0].regionId, 'r2');
});

test('P1-18: remapClipboardPage clears a deleted clipped page and shifts later pages', () => {
  assert.equal(remapClipboardPage(3, { type: 'delete', page: 3 }), null);
  assert.equal(remapClipboardPage(3, { type: 'delete', page: 1 }), 2);
  assert.equal(remapClipboardPage(2, { type: 'move', from: 1, to: 3 }), 1);
  assert.equal(remapClipboardPage(2, { type: 'rotate', page: 2, delta: 90 }), 2);
});

test('P1-17: mergeLivePagePresentation keeps a rename that landed during persist', () => {
  const queued = transformPageState(make(), { type: 'delete', page: 2 });
  const live = {
    pageNames: { 1: 'A-renamed', 2: 'B', 3: 'C', 4: 'D' },
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
  };
  const merged = mergeLivePagePresentation(queued, live, { type: 'delete', page: 2 });
  assert.equal(merged.pageNames[1], 'A-renamed');
  assert.equal(merged.pageNames[2], 'C');
  assert.equal(merged.annotationsByPage[2].objects[0].data.id, 'a3');
});
