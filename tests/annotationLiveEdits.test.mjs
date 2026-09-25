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
  assert.equal(before.e[0].o.top, 222, 'a first edit of a mark carries the whole mark');
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

// --- w32 review fixes (reviews A and B, 2026-09-25) ---

const pen = (id, extra = {}) => ({
  type: 'path',
  left: 0,
  top: 0,
  width: 100,
  height: 10,
  path: [['M', 0, 0], ['L', 100, 0]],
  stroke: '#000000',
  strokeWidth: 3,
  data: { id, type: 'pen' },
  ...extra,
});

test('review A #1: moving a mark whose geometry another screen is changing is not applied (its in-flight geometry is never saved)', async () => {
  const { alice, bob, a, b } = await twoScreens('live-edit-inflight-geometry', [pen('p1')]);
  const gate = deferred();
  alice.appendGate = gate.promise;
  // Alice's in-flight change of the geometry (as a partial erase leaves it).
  const screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: [{ ...screen[1].objects[0], width: 40, path: [['M', 0, 0], ['L', 40, 0]] }] } });
  assert.ok(await until(() => markOn(screenOf(b), 'p1')?.width === 40));
  // Bob drags the overlay copy.
  const bobScreen = screenOf(b);
  const result = b.applyByPage({ 1: { ...bobScreen[1], objects: bobScreen[1].objects.map((o) => ({ ...o, left: o.left + 10 })) } });
  await b.drain();
  assert.equal(bob.appendCalls, 0, 'nothing is written');
  assert.equal(markOn(b.getByPage(), 'p1').width, 100, 'the saved mark keeps its own geometry');
  const swap = (result.reconcile || []).find((entry) => entry.key === 'p1');
  assert.ok(swap && swap.to?.width === 100, 'the screen goes back to the saved mark');
  // A recolour on the same overlay copy (a field Alice is not changing) is fine.
  const again = screenOf(b);
  b.applyByPage({ 1: { ...again[1], objects: again[1].objects.map((o) => ({ ...o, stroke: '#00aa00' })) } });
  await b.drain();
  assert.equal(bob.appendCalls, 1);
  assert.equal(markOn(b.getByPage(), 'p1').stroke, '#00aa00');
  assert.equal(markOn(b.getByPage(), 'p1').width, 100);
  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  const both = (h) => markOn(h.getByPage(), 'p1')?.width === 40 && markOn(h.getByPage(), 'p1')?.stroke === '#00aa00';
  assert.ok(await until(() => both(a) && both(b)));
  await Promise.all([a.destroy(), b.destroy()]);
});

test('review A #2/#5: an Undo that brings back a mark deleted while an overlay showed it re-creates it; a flagged copy with another id is its own mark', async () => {
  const { alice, bob, a, b } = await twoScreens('live-edit-undo-delete', [rect('m1'), rect('m2', { left: 300 })]);
  const screen = a.getByPage();
  const gate = deferred();
  alice.appendGate = gate.promise;
  a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => (o.data.id === 'm1' ? { ...o, stroke: '#00ff00' } : o)) } });
  assert.ok(await until(() => typeof markOn(screenOf(b), 'm1')?.[LIVE_EDIT_FLAG] === 'string'));
  const flagged = markOn(screenOf(b), 'm1');
  const history = JSON.parse(JSON.stringify(flagged)); // history clones keep the flag
  // Bob's screen is captured as shown (the app captures after every render),
  // then he deletes m1 and undoes.
  b.applyByPage(screenOf(b));
  assert.equal(bob.appendCalls, 0);
  const withoutM1 = screenOf(b)[1].objects.filter((o) => o.data.id !== 'm1');
  b.applyByPage({ 1: { objects: withoutM1 } });
  await b.drain();
  assert.ok(await until(() => !hasMark(b, 'm1')));
  b.applyByPage({ 1: { objects: [...b.getByPage()[1].objects, history] } });
  await b.drain();
  assert.ok(hasMark(b, 'm1'), 'Undo re-creates the mark');
  assert.equal(markOn(b.getByPage(), 'm1')[LIVE_EDIT_FLAG], undefined, 'without the flag');
  // An overlay copy spread into a new mark (any path that forgets to mint a
  // clean identity) is that new mark, not an edit of the original.
  const spread = { ...flagged, data: { ...flagged.data, id: 'copy-1' } };
  b.applyByPage({ 1: { objects: [...b.getByPage()[1].objects, spread] } });
  await b.drain();
  assert.ok(hasMark(b, 'copy-1'));
  assert.equal(markOn(b.getByPage(), 'copy-1')[LIVE_EDIT_FLAG], undefined);
  assert.ok(bob.appendCalls >= 3);
  gate.resolve();
  alice.appendGate = null;
  await a.drain();
  await Promise.all([a.destroy(), b.destroy()]);
});

test('review A #3: a page renumbered here keeps an overlaid mark with its page', () => {
  const overlay = { ...rect('m1', { left: 5 }), [LIVE_EDIT_FLAG]: 't-1' };
  const delivered = rect('m1');
  // The overlay was shown on page 2; this screen then deleted page 1, so the
  // screen now holds the mark on page 1 (the document still says 2).
  const moved = { ...overlay };
  const out = stripLiveEditObjects({ 1: { objects: [moved, rect('other')] } }, {
    resolveToken: () => ({ key: 'm1', object: overlay, page: 2 }),
    deliveredOf: () => delivered,
    docPageOf: () => 2,
  });
  assert.ok(out.byPage[1].objects.some((o) => o.data.id === 'm1'), 'stays on the page this screen has it');
  assert.equal(out.byPage[2], undefined);
});

test('review A #6: a counter overlay keeps this screen\'s number and still counts as untouched', () => {
  const counter = (id, n) => ({ type: 'group', left: 1, top: 1, data: { id, type: 'counter', seriesId: 's', displayNumber: n, seriesStart: 1 } });
  const overlay = { ...counter('c1', 1), left: 50, [LIVE_EDIT_FLAG]: 't-c' };
  const byPage = { 1: { objects: [counter('c1', 3)] } };
  const edits = new Map([['c1', { page: 1, object: overlay }]]);
  const first = mergeLiveOverlays(byPage, { edits, docPageOf: () => 1 });
  const second = mergeLiveOverlays(byPage, { edits, docPageOf: () => 1 });
  const shown = first[1].objects[0];
  assert.equal(shown.data.displayNumber, 3);
  assert.equal(shown.left, 50);
  assert.equal(second[1].objects[0], shown, 'the same object every render');
  const out = stripLiveEditObjects(first, {
    resolveToken: () => ({ key: 'c1', object: overlay, page: 1 }),
    deliveredOf: () => byPage[1].objects[0],
    docPageOf: () => 1,
  });
  assert.equal(out.byPage[1].objects[0], byPage[1].objects[0], 'untouched: nothing to write');
  assert.deepEqual(out.editedKeys, []);
});

test('review B #6: an edit of a mark this screen does not hold is not shown (no resurrection)', () => {
  const merged = mergeLiveOverlays({ 1: { objects: [] } }, {
    edits: new Map([['gone', { page: 1, object: { ...rect('gone'), [LIVE_EDIT_FLAG]: 't' } }]]),
    docPageOf: () => null,
  });
  assert.deepEqual(merged[1].objects, []);
});

test('a v2 delta patch cannot change identity and is applied onto this screen\'s copy', () => {
  const ok = parseLiveEditPayload({ v: 2, w: 'x', s: 1, e: [{ k: 'm1', p: 1, s: { stroke: '#00ff00' } }] });
  assert.deepEqual(ok.entries.get('m1').patch, { set: { stroke: '#00ff00' }, unset: [] });
  assert.equal(parseLiveEditPayload({ v: 2, w: 'x', s: 1, e: [{ k: 'm1', p: 1, s: { data: { id: 'other' } } }] }), null);
  assert.equal(parseLiveEditPayload({ v: 2, w: 'x', s: 1, e: [{ k: 'm1', p: 1, s: {}, u: ['data'] }] }), null);
  assert.equal(parseLiveEditPayload({ v: 2, w: 'x', s: 1, e: [{ k: 'm1', p: 1, s: { id: 'm2' } }] }), null);
  const huge = 'x'.repeat(80 * 1024);
  assert.equal(parseLiveEditPayload({ v: 2, w: 'x', s: 1, e: [{ k: 'm1', p: 1, s: { note: huge } }] }), null, 'oversized messages are refused');
});

// --- w32 fix-verification pass (2026-09-25) ---

test('verify #3: an Undo of a delete made on an overlay copy re-creates the mark with THIS screen\'s colour, never the other screen\'s in-flight one', async () => {
  const { alice, bob, a, b } = await twoScreens('live-edit-undo-colour', [rect('m1', { stroke: '#ff0000' })]);
  const gate = deferred();
  alice.appendGate = gate.promise;
  alice.appendError = { code: '42501', message: 'annotation write is not permitted' }; // Alice's recolour is refused
  const screen = a.getByPage();
  a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, stroke: '#00ff00' })) } });
  assert.ok(await until(() => markOn(screenOf(b), 'm1')?.stroke === '#00ff00'));
  b.applyByPage(screenOf(b));
  const history = JSON.parse(JSON.stringify(markOn(screenOf(b), 'm1')));
  b.applyByPage({ 1: { objects: screenOf(b)[1].objects.filter((o) => o.data.id !== 'm1') } });
  await b.drain();
  assert.ok(await until(() => !hasMark(b, 'm1')));
  b.applyByPage({ 1: { objects: [...(b.getByPage()[1]?.objects || []), { ...history, left: 77 }] } });
  await b.drain();
  const restored = markOn(b.getByPage(), 'm1');
  assert.ok(restored, 'Undo re-creates it');
  assert.equal(restored.stroke, '#ff0000', 'with the colour this screen had, not Alice\'s unsaved green');
  assert.equal(restored.left, 77, 'and the user\'s own change');
  gate.resolve();
  alice.appendGate = null;
  await Promise.all([a.destroy(), b.destroy()]);
});

test('verify #4: consecutive edits send only changed fields against the previous message; nothing is sent for no change', async () => {
  const { cloud, a, b } = await twoScreens('live-edit-patch-chain', [rect('m1')]);
  const edit = (patch) => {
    const screen = a.getByPage();
    a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => ({ ...o, ...patch })) } });
  };
  edit({ left: 111 });
  edit({ stroke: '#0000ff' });
  const [first, second] = edits(cloud).map((m) => m.payload);
  assert.ok(first.e[0].o, 'first: whole mark');
  assert.deepEqual(second.e[0].s, { stroke: '#0000ff' }, 'second: the changed field only');
  assert.equal(second.s, first.s + 1);
  assert.ok(await until(() => {
    const mark = markOn(screenOf(b), 'm1');
    return mark?.left === 111 && mark?.stroke === '#0000ff';
  }), 'applied onto the previous message\'s object');
  // A patch whose previous message never arrived here is not shown (the row
  // brings the change).
  cloud.inject({ v: 2, w: 'someone', s: 9, e: [{ k: 'm1', p: 1, s: { stroke: '#123123' } }] });
  await settle(30);
  assert.notEqual(markOn(screenOf(b), 'm1').stroke, '#123123');
  const built = buildLiveEditEntries(new Map([['m1', { page: 1, object: rect('m1') }]]), { baseOf: () => rect('m1') });
  assert.equal(built, null, 'an entry with nothing new is not sent');
  await a.drain();
  await Promise.all([a.destroy(), b.destroy()]);
});

test('verify #5: a callout/counter edit on an overlay copy that touches different nested fields is applied; the same field is refused', () => {
  const callout = (extra = {}) => ({
    type: 'group', left: 0, top: 0,
    data: { id: 'c1', type: 'callout', legacyCallout: { text: 'hi', style: { color: '#000' } }, ...extra },
  });
  const arrivalBase = callout();
  const overlay = { ...callout({ legacyCallout: { text: 'hi', style: { color: '#f00' } } }), [LIVE_EDIT_FLAG]: 't' };
  const run = (edited) => stripLiveEditObjects({ 1: { objects: [edited] } }, {
    resolveToken: () => ({ key: 'c1', object: overlay, page: 1, base: arrivalBase }),
    deliveredOf: () => arrivalBase,
    docPageOf: () => 1,
  });
  const textEdit = { ...overlay, data: { ...overlay.data, legacyCallout: { ...overlay.data.legacyCallout, text: 'hello' } } };
  const applied = run(textEdit);
  assert.deepEqual(applied.editedKeys, ['c1'], 'a different nested field is applied');
  assert.equal(applied.byPage[1].objects[0].data.legacyCallout.text, 'hello');
  assert.equal(applied.byPage[1].objects[0].data.legacyCallout.style.color, '#000', 'without the other screen\'s colour');
  const colourEdit = { ...overlay, data: { ...overlay.data, legacyCallout: { ...overlay.data.legacyCallout, style: { color: '#0f0' } } } };
  assert.deepEqual(run(colourEdit).editedKeys, [], 'the field the other screen is changing is refused');

  // Counter: this screen's number shown on the overlay copy is not an edit.
  const counter = (n, extra = {}) => ({ type: 'group', left: 1, top: 1, data: { id: 'k1', type: 'counter', seriesId: 's', displayNumber: n, seriesStart: 1 }, ...extra });
  const counterOverlay = { ...counter(1, { left: 50 }), [LIVE_EDIT_FLAG]: 'tk' };
  const shown = mergeLiveOverlays({ 1: { objects: [counter(3)] } }, {
    edits: new Map([['k1', { page: 1, object: counterOverlay }]]),
    docPageOf: () => 1,
  })[1].objects[0];
  const recoloured = { ...shown, fill: '#00f' };
  const out = stripLiveEditObjects({ 1: { objects: [recoloured] } }, {
    resolveToken: () => ({ key: 'k1', object: counterOverlay, page: 1, base: counter(3) }),
    deliveredOf: () => counter(3),
    docPageOf: () => 1,
  });
  assert.deepEqual(out.editedKeys, ['k1'], 'a counter edit is applied');
  assert.equal(out.byPage[1].objects[0].fill, '#00f');
  assert.equal(out.byPage[1].objects[0].data.displayNumber, 3, 'the shown number is not written as a change');
  assert.equal(out.byPage[1].objects[0].left, 1, 'nor the other screen\'s move');
});

// --- w32 verification pass 2 (2026-09-25) ---

test('verify2 #3/#4: Undo of a delete re-creates the mark from this screen\'s own copy — untouched, or edited on the other screen\'s in-flight field', () => {
  const base = rect('m1', { stroke: '#ff0000', left: 10 });
  const overlay = { ...rect('m1', { stroke: '#00ff00', left: 10 }), [LIVE_EDIT_FLAG]: 't1' };
  const run = (object, record = { key: 'm1', object: overlay, page: 1, base }) => stripLiveEditObjects(
    { 1: { objects: [object] } },
    { resolveToken: () => record, deliveredOf: () => null, docPageOf: () => null },
  ).byPage[1].objects;
  const untouched = run(overlay);
  assert.equal(untouched.length, 1, 'an untouched copy comes back');
  assert.equal(untouched[0].stroke, '#ff0000', 'as this screen\'s own copy');
  const onInFlight = run({ ...overlay, stroke: '#0000ff' });
  assert.equal(onInFlight[0].stroke, '#ff0000', 'an edit of the field the other screen was changing falls back to the base');
  const ownField = run({ ...overlay, left: 99 });
  assert.equal(ownField[0].left, 99, 'an edit of another field is kept');
  assert.equal(ownField[0].stroke, '#ff0000');
  // The overlay object itself long gone (only the base kept): rebuilt as the base.
  const baseOnly = run({ ...overlay, left: 99 }, { key: 'm1', object: base, page: null, base, rebuildOnly: true });
  assert.equal(baseOnly[0].stroke, '#ff0000');
  assert.equal(baseOnly[0].left, 10, 'nothing of the flagged copy is taken when it cannot be told apart');
  assert.equal(baseOnly[0][LIVE_EDIT_FLAG], undefined);
});

test('verify2 #5/#6: only marks a message carried become the next patch base, and a whole copy goes out at least every 8 messages', async () => {
  const { cloud, a, b } = await twoScreens('live-edit-full-every', [rect('m1'), rect('m2', { left: 400 })]);
  const edit = (id, patch) => {
    const screen = a.getByPage();
    a.applyByPage({ 1: { ...screen[1], objects: screen[1].objects.map((o) => (o.data.id === id ? { ...o, ...patch } : o)) } });
  };
  for (let i = 1; i <= 10; i += 1) edit('m1', { left: 10 + i });
  const m1 = edits(cloud).map((m) => m.payload.e.find((e) => e.k === 'm1')).filter(Boolean);
  const fullAt = m1.map((e, i) => (e.o ? i : -1)).filter((i) => i >= 0);
  assert.ok(fullAt.includes(0) && fullAt.some((i) => i >= 1 && i <= 8), `a whole copy at least every 8th message (${fullAt})`);
  assert.ok(await until(() => markOn(screenOf(b), 'm1')?.left === 20));
  // An edit of m2 in between breaks m1's chain: the next m1 edit is whole.
  edit('m2', { left: 401 });
  edit('m1', { left: 55 });
  const last = edits(cloud).at(-1).payload.e.find((e) => e.k === 'm1');
  assert.ok(last.o, 'not a patch against a message that did not carry it');
  await a.drain();
  await Promise.all([a.destroy(), b.destroy()]);
});
