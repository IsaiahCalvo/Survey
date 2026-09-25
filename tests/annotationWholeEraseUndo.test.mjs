// w35 (2026-09-25, combined w32/w33/w34 verify): a whole-stroke erase is a
// delete LANE over a kept stored mark, so Undo and Revisions can bring the
// mark back. The capture treated "the document stopped showing this mark" as
// the user deleting it: the erasing screen (on its next capture) and every
// other open screen (on the capture after the erase row) deleted the stored
// mark — one extra WAL row each — and Undo then reported "applied" with no
// mark to show. Found by the w35 adversarial review; measured live as the
// watching screen writing a row on someone else's erase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloud, openFor, until, settle, hasMark } from './helpers/liveSyncFakeCloud.mjs';
import { buildEraseIntent } from '../src/utils/annotationEraseTransaction.js';
import { prepareEraseIntentForCommit } from '../src/utils/annotationEraseCommitPlan.js';

const pen = (id) => ({
  type: 'path',
  path: [['M', 10, 10], ['L', 50, 60]],
  left: 10, top: 10, width: 40, height: 50,
  stroke: '#ff0000', strokeWidth: 3, fill: null, opacity: 1,
  meta: { authorId: 'user-a' },
  data: { id, type: 'pen', authorId: 'user-a' },
});

async function eraseScenario(documentId, { withViewer }) {
  const cloud = createCloud(documentId);
  const a = await openFor(cloud.makeClient('user-a'), documentId);
  const b = withViewer ? await openFor(cloud.makeClient('user-b'), documentId) : null;
  assert.ok(await until(() => a.isRealtimeReady() && (!b || b.isRealtimeReady())));
  // The viewer hook captures what it shows after every change it is handed.
  let open = true;
  if (b) {
    b.onChange(() => setTimeout(() => {
      if (open) b.applyByPage(b.withLiveOverlays(b.getByPage()));
    }, 0));
  }
  a.applyByPage({ 1: { objects: [pen('m1')] } });
  await a.drain();
  if (b) {
    assert.ok(await until(() => hasMark(b, 'm1')));
    b.applyByPage(b.withLiveOverlays(b.getByPage()));
  }
  const screen = a.getByPage();
  a.applyByPage(screen);
  const before = screen[1].objects[0];
  const rowsBefore = cloud.rows.length;
  const intent = prepareEraseIntentForCommit({
    intent: buildEraseIntent({
      mutationId: `whole-erase-${documentId}`,
      pageNumber: 1,
      renderer: 'svg',
      gesture: { points: [{ x: 20, y: 20 }], radius: 4, mode: 'full' },
      targets: [{
        domain: 'page-object', storageKey: 'm1', kind: 'path', operation: 'delete',
        pageNumber: 1, index: 0, before, after: null,
      }],
    }),
    annotationsByPage: screen,
    userId: 'user-a',
    includeDeleteHistory: false,
  });
  const result = await a.commitEraseIntent(intent, { permissionContext: { mode: 'local-only' } });
  assert.equal(result.status, 'committed');
  a.applyByPage(result.byPage); // the erasing screen's capture after the commit render
  await a.drain();
  if (b) {
    assert.ok(await until(() => !hasMark(b, 'm1')), 'the erase reached the other screen');
    await settle(100);
    await b.drain();
  }
  await settle(100);
  const close = async () => { open = false; await Promise.all([a.destroy(), b?.destroy()]); };
  return { cloud, a, b, result, rowsBefore, close };
}

for (const withViewer of [false, true]) {
  const label = withViewer ? 'with another screen open' : 'alone';
  test(`a whole-stroke erase keeps the stored mark and Undo brings it back (${label})`, async () => {
    const { cloud, a, b, result, rowsBefore, close } = await eraseScenario(`whole-erase-undo-${withViewer ? 'viewer' : 'alone'}`, { withViewer });
    try {
      const erased = cloud.rows.slice(rowsBefore);
      assert.equal(erased.length, 1, `one row for the erase, got ${erased.length} (${erased.map((r) => r.actor_user_id).join(',')})`);
      assert.ok(erased.every((row) => row.actor_user_id === 'user-a'), 'only the erasing screen writes');
      assert.equal(a.doc.getMap('marks').has('m1'), true, 'the stored mark stays under its delete lane');
      const undo = a.applyEraseHistoryTransition(result.historyTransition, 'undo');
      assert.equal(undo.status, 'applied');
      assert.ok((undo.byPage?.[1]?.objects || []).some((o) => o?.data?.id === 'm1'), 'Undo shows the mark again');
      await a.drain();
      if (b) assert.ok(await until(() => hasMark(b, 'm1')), 'the other screen shows it again');
    } finally {
      await close();
    }
  });
}

test('a selection delete of a partly erased mark still deletes it', async () => {
  // The guard above must not swallow a real delete: a mark the document is
  // still showing (here a lane-owned survivor) that the user removes is gone.
  const cloud = createCloud('whole-erase-selection-delete');
  const a = await openFor(cloud.makeClient('user-a'), 'whole-erase-selection-delete');
  try {
    assert.ok(await until(() => a.isRealtimeReady()));
    a.applyByPage({ 1: { objects: [pen('m2')] } });
    await a.drain();
    const screen = a.getByPage();
    a.applyByPage(screen);
    const before = screen[1].objects[0];
    const intent = prepareEraseIntentForCommit({
      intent: buildEraseIntent({
        mutationId: 'partial-then-delete',
        pageNumber: 1,
        renderer: 'svg',
        gesture: { points: [{ x: 20, y: 20 }], radius: 4, mode: 'partial' },
        targets: [{
          domain: 'page-object', storageKey: 'm2', kind: 'pen', operation: 'replace',
          pageNumber: 1, index: 0, before, after: { ...before, path: [['M', 10, 10], ['L', 30, 35]] },
        }],
      }),
      annotationsByPage: screen,
      userId: 'user-a',
      includeDeleteHistory: false,
    });
    const result = await a.commitEraseIntent(intent, { permissionContext: { mode: 'local-only' } });
    assert.equal(result.status, 'committed');
    a.applyByPage(result.byPage);
    await a.drain();
    assert.ok(hasMark(a, 'm2'), 'the survivor shows');
    const shown = a.getByPage();
    a.applyByPage({ ...shown, 1: { ...shown[1], objects: shown[1].objects.filter((o) => o?.data?.id !== 'm2') } });
    await a.drain();
    assert.equal(a.doc.getMap('marks').has('m2'), false, 'the selection delete removed the stored mark');
    assert.equal(hasMark(a, 'm2'), false);
  } finally {
    await a.destroy();
  }
});

test('deleting a partly erased mark again after Undo still deletes it (another screen writing meanwhile)', async () => {
  // w35 pass C: the delete-lane guard must not rest on what the document last
  // handed the screen (a remote row refreshes that, local captures do not).
  const pen2 = (id, x = 10) => ({ ...pen(id), path: [['M', x, 10], ['L', x + 40, 60]], left: x });
  const cloud = createCloud('whole-erase-undo-delete-again');
  const a = await openFor(cloud.makeClient('user-a'), 'whole-erase-undo-delete-again');
  const b = await openFor(cloud.makeClient('user-a'), 'whole-erase-undo-delete-again');
  try {
    assert.ok(await until(() => a.isRealtimeReady() && b.isRealtimeReady()));
    a.applyByPage({ 1: { objects: [pen2('m2')] } });
    await a.drain();
    const screen = a.getByPage();
    a.applyByPage(screen);
    const before = screen[1].objects[0];
    const intent = prepareEraseIntentForCommit({
      intent: buildEraseIntent({
        mutationId: 'undo-delete-again', pageNumber: 1, renderer: 'svg',
        gesture: { points: [{ x: 20, y: 20 }], radius: 4, mode: 'partial' },
        targets: [{
          domain: 'page-object', storageKey: 'm2', kind: 'pen', operation: 'replace', pageNumber: 1, index: 0,
          before, after: { ...before, path: [['M', 10, 10], ['L', 30, 35]] },
        }],
      }),
      annotationsByPage: screen, userId: 'user-a', includeDeleteHistory: false,
    });
    const res = await a.commitEraseIntent(intent, { permissionContext: { mode: 'local-only' } });
    assert.equal(res.status, 'committed');
    a.applyByPage(res.byPage);
    await a.drain();
    const survivorPage = res.byPage[1];
    const survivor = survivorPage.objects.find((o) => o?.data?.id === 'm2');
    a.applyByPage({ ...res.byPage, 1: { ...survivorPage, objects: survivorPage.objects.filter((o) => o?.data?.id !== 'm2') } });
    await a.drain();
    assert.equal(a.doc.getMap('marks').has('m2'), false, 'first delete');
    const bp = b.getByPage();
    b.applyByPage({ ...bp, 1: { objects: [...(bp[1]?.objects || []), pen2('other', 200)] } });
    await b.drain();
    assert.ok(await until(() => a.doc.getMap('marks').has('other')));
    await settle(50);
    const current = a.getByPage();
    const undone = { 1: { ...current[1], objects: [...(current[1]?.objects || []), survivor] } };
    a.applyByPage(undone);
    await a.drain();
    assert.equal(a.doc.getMap('marks').has('m2'), true, 'Undo put it back');
    a.applyByPage({ 1: { ...undone[1], objects: undone[1].objects.filter((o) => o?.data?.id !== 'm2') } });
    await a.drain();
    assert.equal(a.doc.getMap('marks').has('m2'), false, 'the second delete removed the stored mark');
    assert.equal((a.getByPage()[1]?.objects || []).some((o) => o?.data?.id === 'm2'), false);
  } finally {
    await Promise.all([a.destroy(), b.destroy()]);
  }
});

test('a whole erase on the page-mutation path still names the imported mark as deleted', async () => {
  const cloud = createCloud('whole-erase-legacy-tombstone');
  const a = await openFor(cloud.makeClient('user-a'), 'whole-erase-legacy-tombstone');
  try {
    assert.ok(await until(() => a.isRealtimeReady()));
    const imported = {
      ...pen('m1'), isPdfImported: true, pdfAnnotationId: 'pdf-m1', pdfAnnotationType: 'Ink',
    };
    a.applyByPage({ 1: { objects: [imported] } });
    await a.drain();
    const screen = a.getByPage();
    a.applyByPage(screen);
    const page = a.applyEraserMutation(1, { objects: [] }, {
      id: 'legacy-erase-1', pageNumber: 1, points: [{ x: 20, y: 20 }], radius: 4, mode: 'full',
      touchedIds: ['m1'], changedIds: [], deletedIds: ['m1'],
      objectMutations: [{ storageKey: 'm1', annotationId: 'm1', deleted: true, base: screen[1].objects[0] }],
    });
    a.applyByPage({ 1: page });
    await a.drain();
    assert.deepEqual(a.getDeletedPdfAnnotations().map((entry) => entry.pdfAnnotationId), ['pdf-m1']);
    assert.equal((a.getByPage()[1]?.objects || []).length, 0);
  } finally {
    await a.destroy();
  }
});
