// w32 (2026-09-25): live EDITS reach other screens before their WAL row.
//
// A move, restyle, partial or whole erase, or delete of an existing mark is
// broadcast (v2, annotationLiveOverlay.js) as what the sender's screen shows
// for each mark it touched. Other screens draw it as an overlay until its
// row is applied. These tests pin:
//   * the overlay shows before the row, the document does not change, and the
//     overlay leaves when the row is applied (or a later row of that screen,
//     or after the expiry);
//   * a mark hidden by an overlay (deleted elsewhere) is never captured as
//     this screen deleting it; an untouched overlay copy writes nothing;
//   * an edit made ON an overlay copy writes only the user's own change;
//   * an erase planned on an overlay copy is cancelled or not applied;
//   * forged, stale and oversized messages are ignored; the sender stays
//     quiet when nothing drawn changed;
//   * a lane-only edit (partial erase) goes out as v2, never as a v1 preview
//     every receiver would drop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import {
  createCloud,
  deferred,
  hasMark,
  openFor,
  settle,
  until,
} from './helpers/liveSyncFakeCloud.mjs';
import {
  LIVE_EDIT_FLAG,
  buildLiveEditEntries,
  mergeLiveOverlays,
  parseLiveEditPayload,
  stripLiveEditObjects,
} from '../src/services/annotationLiveOverlay.js';
import { materializeAnnotationKeys, writeAnnotationMark } from '../src/services/annotationDocStore.js';
import { buildEraseIntent } from '../src/utils/annotationEraseTransaction.js';
import { prepareEraseIntentForCommit } from '../src/utils/annotationEraseCommitPlan.js';
import { mintPastedCloneIdentity } from '../src/utils/pasteCloneIdentity.js';

const rect = (id, extra = {}) => ({
  type: 'rect',
  left: 10,
  top: 20,
  width: 100,
  height: 50,
  fill: 'transparent',
  stroke: '#ff0000',
  strokeWidth: 2,
  opacity: 1,
  meta: { authorId: 'user-a' },
  data: { id, type: 'shape', authorId: 'user-a' },
  ...extra,
});

const screenOf = (handle) => handle.withLiveOverlays(handle.getByPage());
const markOn = (byPage, id, page = 1) => (byPage?.[page]?.objects || []).find((o) => o?.data?.id === id) || null;
const edits = (cloud) => cloud.sent.filter((message) => message.payload?.v === 2);

async function twoScreens(documentId, marks = [rect('m1')], extra = {}) {
  const cloud = createCloud(documentId);
  const alice = cloud.makeClient('user-a');
  const bob = cloud.makeClient('user-b');
  const a = await openFor(alice, documentId, extra);
  const b = await openFor(bob, documentId, extra);
  await until(() => a.isRealtimeReady() && b.isRealtimeReady());
  a.applyByPage({ 1: { objects: marks } });
  await a.drain();
  for (const mark of marks) assert.ok(await until(() => hasMark(b, mark.data.id)));
  cloud.sent.length = 0;
  return { cloud, alice, bob, a, b };
}

test('a move shows on the other screen before its row, and the overlay leaves when the row lands', async () => {
  const { cloud, alice, bob, a, b } = await twoScreens('live-edit-move');
  const gate = deferred();
  alice.appendGate = gate.promise; // the WAL insert is slow
  const screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, left: 300 })) } });
  assert.equal(edits(cloud).length, 1, 'the edit is broadcast at once');
  assert.equal(cloud.sent[0].rowsAtSend, 2 - 1, 'before its WAL row is written');
  assert.ok(await until(() => markOn(screenOf(b), 'm1')?.left === 300), 'the other screen shows the move');
  assert.equal(markOn(b.getByPage(), 'm1').left, 10, 'its document waits for the row');
  const tailReads = bob.tailReads;
  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => markOn(b.getByPage(), 'm1').left === 300));
  assert.equal(typeof markOn(screenOf(b), 'm1')[LIVE_EDIT_FLAG], 'undefined', 'the doc copy shows, not the overlay');
  assert.equal(bob.tailReads, tailReads, 'no log read on the fast path');
  assert.equal(bob.appendCalls, 0, 'the receiver writes nothing');
  await Promise.all([a.destroy(), b.destroy()]);
});

test('a delete hides the mark at once; the receiver\'s capture never writes that delete itself', async () => {
  const { cloud, alice, bob, a, b } = await twoScreens('live-edit-delete', [rect('m1'), rect('m2', { left: 400 })]);
  const gate = deferred();
  alice.appendGate = gate.promise;
  const screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.filter((o) => o.data.id !== 'm1') } });
  assert.deepEqual(edits(cloud)[0].payload.e, [{ k: 'm1', d: 1 }]);
  assert.ok(await until(() => !markOn(screenOf(b), 'm1')), 'hidden on the other screen');
  // Bob's screen (without m1) is captured, and he restyles m2 meanwhile.
  const bobScreen = screenOf(b);
  b.applyByPage({ 1: { ...bobScreen[1], objects: bobScreen[1].objects.map((o) => ({ ...o, stroke: '#00ff00' })) } });
  await b.drain();
  assert.equal(bob.appendCalls, 1, 'only his restyle is written');
  assert.ok(hasMark(b, 'm1'), 'hiding is not deleting: the document still holds m1');
  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => !hasMark(b, 'm1')), 'Alice\'s row deletes it');
  assert.ok(await until(() => markOn(a.getByPage(), 'm2')?.stroke === '#00ff00'));
  await Promise.all([a.destroy(), b.destroy()]);
});

test('an edit made on an overlay copy writes only the user\'s own change; both changes survive', async () => {
  const { alice, bob, a, b } = await twoScreens('live-edit-edit-on-overlay');
  const gate = deferred();
  alice.appendGate = gate.promise;
  const screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, left: 300 })) } });
  assert.ok(await until(() => markOn(screenOf(b), 'm1')?.left === 300));
  // Bob recolours the mark he sees (the overlay copy, spread like the app's
  // editors do).
  const bobScreen = screenOf(b);
  const result = b.applyByPage({
    1: { ...bobScreen[1], objects: bobScreen[1].objects.map((o) => ({ ...o, stroke: '#0000ff' })) },
  });
  await b.drain();
  assert.equal(bob.appendCalls, 1);
  assert.equal(markOn(b.getByPage(), 'm1').left, 10, 'Alice\'s in-flight move is not written by Bob');
  assert.equal(markOn(b.getByPage(), 'm1').stroke, '#0000ff', 'Bob\'s own change is');
  const swap = (result.reconcile || []).find((entry) => entry.key === 'm1');
  assert.ok(swap && swap.to && typeof swap.to[LIVE_EDIT_FLAG] === 'undefined', 'his screen shows what was saved');
  assert.equal(markOn(screenOf(b), 'm1').stroke, '#0000ff', 'the overlay no longer hides his change');
  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  const converged = (handle) => {
    const mark = markOn(handle.getByPage(), 'm1');
    return mark?.left === 300 && mark?.stroke === '#0000ff';
  };
  assert.ok(await until(() => converged(a) && converged(b)), 'both screens end with both changes');
  await Promise.all([a.destroy(), b.destroy()]);
});

test('an untouched overlay copy writes nothing, and a stale or expired overlay leaves', async () => {
  const { cloud, alice, bob, a, b } = await twoScreens('live-edit-untouched', [rect('m1')], {
    livePreviewTimings: { expireMs: 20_000, sweepMs: 20, editExpireMs: 80 },
  });
  alice.appendError = { code: '42501', message: 'annotation write is not permitted' };
  const screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, top: 222 })) } });
  assert.ok(await until(() => markOn(screenOf(b), 'm1')?.top === 222));
  const bobScreen = screenOf(b);
  b.applyByPage(bobScreen);
  await b.drain();
  assert.equal(bob.appendCalls, 0, 'capturing the overlay as shown writes nothing');
  assert.ok(await until(() => markOn(screenOf(b), 'm1')?.top === 20), 'a refused edit leaves the screen after the expiry');
  assert.equal(markOn(b.getByPage(), 'm1').top, 20);
  // A late copy of the same message is ignored once its row (or a later one)
  // is in.
  const before = edits(cloud)[0].payload;
  await Promise.all([a.destroy(), b.destroy()]);
  assert.ok(before.e[0].o.top === 222);
});

test('a later row from the same screen drops its older overlay; a replayed message after its row is ignored', async () => {
  const { cloud, alice, a, b } = await twoScreens('live-edit-order');
  const gate = deferred();
  alice.appendGate = gate.promise;
  let screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, left: 111 })) } });
  screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, left: 222 })) } });
  assert.ok(await until(() => markOn(screenOf(b), 'm1')?.left === 222), 'the newest edit shows');
  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => markOn(b.getByPage(), 'm1').left === 222));
  assert.equal(typeof markOn(screenOf(b), 'm1')[LIVE_EDIT_FLAG], 'undefined');
  // Replays of both messages arrive late: nothing shows.
  for (const message of edits(cloud)) cloud.inject(message.payload);
  await settle(30);
  assert.equal(typeof markOn(screenOf(b), 'm1')[LIVE_EDIT_FLAG], 'undefined', 'stale messages are ignored');
  await Promise.all([a.destroy(), b.destroy()]);
});

test('forged or malformed edit messages are ignored', async () => {
  const { cloud, a, b } = await twoScreens('live-edit-forged');
  const inject = (payload) => cloud.inject(payload);
  inject({ v: 2, w: 'x', s: 1, e: [{ k: 'm1', p: 1, o: rect('other-id', { left: 999 }) }] }); // id != key
  inject({ v: 2, w: 'x', s: 2, e: [{ k: 'm1', p: 0, o: rect('m1', { left: 999 }) }] });      // bad page
  inject({ v: 2, w: 'x', s: 3, e: [] });                                                    // empty
  inject({ v: 2, w: 'x', s: 4, e: [{ k: 'm1', p: 1, o: [1, 2] }] });                        // not an object
  inject({ v: 2, w: 'x', s: -1, e: [{ k: 'm1', d: 1 }] });                                  // bad seq
  inject({ v: 2, w: b.writerId || 'self', s: 5, e: 'nope' });
  await settle(30);
  assert.equal(markOn(screenOf(b), 'm1').left, 10);
  assert.ok(markOn(screenOf(b), 'm1'));
  // A flagged copy smuggled in from outside is still recognised by capture.
  assert.equal(parseLiveEditPayload({ v: 2, w: 'x', s: 1, e: [{ k: 'k', p: 1, o: { data: { id: 'k' }, [LIVE_EDIT_FLAG]: 'forged' } }] })
    .entries.get('k').object[LIVE_EDIT_FLAG], undefined, 'incoming flags are stripped');
  await Promise.all([a.destroy(), b.destroy()]);
});

test('a lane-only edit (partial erase) is sent as a v2 overlay of the erased mark, never as a v1 preview', async () => {
  const { cloud, alice, a, b } = await twoScreens('live-edit-lane');
  const gate = deferred();
  alice.appendGate = gate.promise;
  // An eraser lane written by Alice (as the eraser does): only the lanes map
  // changes, a pure addition in Yjs terms. (A delete lane: rect survivors
  // keep their geometry; ink survivors are pinned by the probe.)
  a.doc.transact(() => {
    a.doc.getMap('annotationEraserOps').set(`alice-writer\u0000m1`, {
      storageKey: 'm1', pageNumber: 1, operationId: 'op-1', deleted: true,
    });
  }, 'local');
  assert.equal(cloud.sent.filter((m) => m.payload?.v === 1).length, 0, 'no v1 preview every receiver drops');
  const [message] = edits(cloud);
  assert.ok(message, 'a v2 overlay is sent');
  assert.deepEqual(message.payload.e, [{ k: 'm1', d: 1 }]);
  assert.ok(await until(() => !markOn(screenOf(b), 'm1')), 'the other screen shows the erase at once');
  assert.ok(hasMark(b, 'm1'), 'its document waits for the row');
  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => !markOn(b.getByPage(), 'm1')));
  await Promise.all([a.destroy(), b.destroy()]);
});

test('an erase planned on an overlay copy is cancelled, and an eraser page mutation never writes it', async () => {
  const { alice, bob, a, b } = await twoScreens('live-edit-erase', [rect('m1', { stroke: '#abcdef' })]);
  const gate = deferred();
  alice.appendGate = gate.promise;
  const screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, left: 333 })) } });
  assert.ok(await until(() => markOn(screenOf(b), 'm1')?.left === 333));
  const bobScreen = screenOf(b);
  const before = markOn(bobScreen, 'm1');
  const intent = prepareEraseIntentForCommit({
    intent: buildEraseIntent({
      mutationId: 'erase-1',
      pageNumber: 1,
      renderer: 'svg',
      gesture: { points: [{ x: 1, y: 1 }], radius: 4, mode: 'full' },
      targets: [{
        domain: 'page-object', storageKey: 'm1', kind: 'rect', operation: 'delete',
        pageNumber: 1, index: 0, before, after: null,
      }],
    }),
    annotationsByPage: bobScreen,
    userId: 'user-b',
    includeDeleteHistory: true,
  });
  const result = await b.commitEraseIntent(intent, { permissionContext: { mode: 'local-only' } });
  assert.equal(result.status, 'cancelled');
  // The page-mutation eraser path: the survivor built on the overlay copy.
  const survivor = { ...before, width: 40 };
  b.applyEraserMutation(1, { ...bobScreen[1], objects: [survivor] }, {
    id: 'erase-op-1',
    pageNumber: 1,
    points: [{ x: 1, y: 1 }],
    radius: 4,
    mode: 'partial',
    touchedIds: ['m1'],
    changedIds: ['m1'],
    deletedIds: [],
    objectMutations: [{ index: 0, storageKey: 'm1', annotationId: 'm1', base: before, deleted: false, survivor }],
  });
  await b.drain();
  assert.equal(bob.appendCalls, 0, 'nothing built on the overlay copy is written');
  assert.ok(hasMark(b, 'm1'));
  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  assert.ok(await until(() => markOn(b.getByPage(), 'm1')?.left === 333), 'Alice\'s move lands intact');
  await Promise.all([a.destroy(), b.destroy()]);
});

test('nothing is broadcast for a local write that changes no drawn mark, and oversized edits ride the log only', async () => {
  const { cloud, a, b } = await twoScreens('live-edit-quiet');
  a.setMeta('spaces', [{ id: 's1' }]);
  await a.drain();
  assert.equal(cloud.sent.length, 0, 'a meta write sends nothing live');
  const big = { ...rect('m1'), path: Array.from({ length: 20_000 }, (_, i) => ['L', i, i]) };
  const screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: [big] } });
  assert.equal(edits(cloud).length, 0, 'an edit bigger than the budget is not broadcast');
  await a.drain();
  assert.ok(await until(() => (markOn(b.getByPage(), 'm1')?.path?.length || 0) === 20_000), 'it still arrives with its row');
  await Promise.all([a.destroy(), b.destroy()]);
});

test('pure helpers: entries, merge, strip', () => {
  const doc = new Y.Doc();
  writeAnnotationMark(doc, 'a', 1, rect('a'));
  writeAnnotationMark(doc, 'b', 2, rect('b'));
  const materialized = materializeAnnotationKeys(doc, ['a', 'gone']);
  assert.equal(materialized.get('a').page, 1);
  assert.equal(materialized.get('gone'), null);
  const built = buildLiveEditEntries(materialized);
  assert.deepEqual(built.entries.map((e) => e.k), ['a', 'gone']);
  assert.equal(built.entries[1].d, 1);
  assert.equal(buildLiveEditEntries(materialized, { maxJsonBytes: 10 }), null);

  const byPage = { 1: { objects: [rect('a'), rect('x')] }, 2: { objects: [rect('b')] } };
  const overlayA = { ...rect('a', { left: 5 }), [LIVE_EDIT_FLAG]: 't-a' };
  const merged = mergeLiveOverlays(byPage, {
    edits: new Map([['a', { page: 1, object: overlayA }], ['b', null]]),
    docPageOf: (key) => ({ a: 1, b: 2, x: 1 }[key] ?? null),
  });
  assert.equal(merged[1].objects[0], overlayA, 'replaced in place (z-order kept)');
  assert.deepEqual(merged[2].objects, [], 'hidden');
  assert.equal(byPage[1].objects[0].left, 10, 'input untouched');

  const delivered = { a: byPage[1].objects[0], b: byPage[2].objects[0] };
  const edited = { ...overlayA, stroke: '#00ff00' };
  const swaps = [];
  const stripped = stripLiveEditObjects({ 1: { objects: [edited, rect('x')] }, 2: { objects: [] } }, {
    resolveToken: (token) => (token === 't-a' ? { key: 'a', object: overlayA } : null),
    deliveredOf: (key) => delivered[key] || null,
    docPageOf: (key) => ({ a: 1, b: 2, x: 1 }[key] ?? null),
    hiddenKeys: new Set(['b']),
    swaps,
  });
  const savedA = stripped.byPage[1].objects[0];
  assert.equal(savedA.left, 10, 'the other screen\'s in-flight left is not taken');
  assert.equal(savedA.stroke, '#00ff00', 'the user\'s change is');
  assert.equal(savedA[LIVE_EDIT_FLAG], undefined);
  assert.equal(stripped.byPage[2].objects[0], delivered.b, 'a hidden mark is put back for the capture');
  assert.deepEqual(stripped.editedKeys, ['a']);
  assert.equal(swaps.length, 1);
  const untouched = stripLiveEditObjects({ 1: { objects: [overlayA] } }, {
    resolveToken: () => ({ key: 'a', object: overlayA }),
    deliveredOf: (key) => delivered[key] || null,
    docPageOf: () => 1,
  });
  assert.equal(untouched.byPage[1].objects[0], delivered.a, 'untouched overlay = the delivered copy');
  assert.deepEqual(untouched.editedKeys, []);
  assert.equal(mintPastedCloneIdentity({ ...rect('src'), [LIVE_EDIT_FLAG]: 't' })[LIVE_EDIT_FLAG], undefined);
});
