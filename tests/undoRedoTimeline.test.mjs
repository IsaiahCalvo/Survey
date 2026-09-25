// w37 (2026-09-25): the undo/redo regression matrix.
//
// Owner report (one tab, today's main): "I did a bunch of pen strokes and then
// erasure strokes. When I undid the erasure strokes ... not all the pen
// strokes [came back]. Then I drew a pen stroke and undid that. It then undid
// the previous pen strokes as well." Replayed live (agent-cli/undo-redo-probe.mjs):
//   * before w35, a whole-stroke erase's Undo showed nothing (the capture had
//     deleted the stored mark), so presses looked dead and later presses took
//     the pen strokes — the first half of the report; w35 fixed that;
//   * on today's main, a new stroke after undoing erases left the erases on
//     Redo: Redo re-erased marks instead of doing nothing (each lane cleared
//     only its own Redo);
//   * a step that could no longer change anything stayed on top of its stack
//     while presses fell through to OLDER steps of the other lane; an 'excel:'
//     checkpoint Undo cannot take blocked every older step;
//   * a Survey Marker Undo restored every mark as it was (deleting a
//     collaborator's newer stroke through the capture);
//   * with two documents open, Cmd+Z went to the first one opened.
// Standard held here (Drawboard / Acrobat / Figma): every gesture is ONE step;
// Undo reverts exactly this user's newest step and Redo re-applies it; a new
// action clears Redo; other people's work is never touched; remote updates
// and reloads do not break the stacks; no step is empty.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCloud, openFor, until, settle } from './helpers/liveSyncFakeCloud.mjs';
import { createHistoryScreen } from './helpers/historyTimelineHarness.mjs';
import {
  HISTORY_SKIP_LIMIT,
  foldIntoCreateStep,
  historyActionChangedPages,
  legacyRestoreKeepsCurrentMarks,
  runHistoryPress,
  scopeLegacyRestoreToOwnSlices,
} from '../src/utils/historyStacks.js';
import { jsonEqual } from '../src/utils/jsonEqual.js';
import { calloutToAnnotationObject } from '../src/utils/calloutAnnotationBridge.js';

const A = 'user-a';
const B = 'user-b';
const PAGE_SIZE = { width: 612, height: 792 };

// ---- marks of every tool -----------------------------------------------------
const own = (author) => ({ meta: { authorId: author } });
const TOOLS = {
  pen: (id, y = 40, author = A) => ({
    type: 'path', path: [['M', 20, y], ['Q', 60, y - 10, 100, y], ['L', 140, y + 6]],
    left: 20, top: y - 10, width: 120, height: 16,
    stroke: '#ff0000', strokeWidth: 3, fill: null, opacity: 1,
    ...own(author), data: { id, type: 'pen', authorId: author },
  }),
  highlighter: (id, y = 80, author = A) => ({
    type: 'path', path: [['M', 20, y], ['L', 160, y]],
    left: 20, top: y - 6, width: 140, height: 12,
    stroke: '#ffe066', strokeWidth: 12, fill: null, opacity: 0.4,
    ...own(author), data: { id, type: 'highlighter', authorId: author },
  }),
  rect: (id, author = A) => ({
    type: 'rect', left: 200, top: 40, width: 80, height: 50, scaleX: 1, scaleY: 1,
    stroke: '#1e293b', strokeWidth: 2, fill: 'transparent',
    ...own(author), data: { id, type: 'rect', authorId: author },
  }),
  ellipse: (id, author = A) => ({
    type: 'ellipse', left: 300, top: 40, rx: 40, ry: 25, width: 80, height: 50, scaleX: 1, scaleY: 1,
    stroke: '#1e293b', strokeWidth: 2, fill: 'transparent',
    ...own(author), data: { id, type: 'ellipse', authorId: author },
  }),
  line: (id, author = A) => ({
    type: 'line', x1: 0, y1: 0, x2: 90, y2: 30, left: 20, top: 140, width: 90, height: 30,
    stroke: '#000000', strokeWidth: 2,
    ...own(author), data: { id, type: 'line', authorId: author },
  }),
  arrow: (id, author = A) => ({
    type: 'line', x1: 0, y1: 0, x2: 90, y2: -30, left: 140, top: 140, width: 90, height: 30,
    stroke: '#000000', strokeWidth: 2,
    ...own(author), data: { id, type: 'arrow', arrowHead: 'end', authorId: author },
  }),
  polygon: (id, author = A) => ({
    type: 'polygon', points: [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 30, y: 40 }],
    left: 260, top: 140, width: 60, height: 40, pathOffset: { x: 30, y: 20 },
    stroke: '#2563eb', strokeWidth: 2, fill: 'transparent',
    ...own(author), data: { id, type: 'polygon', authorId: author },
  }),
  polyline: (id, author = A) => ({
    type: 'polyline', points: [{ x: 0, y: 0 }, { x: 40, y: 20 }, { x: 80, y: 0 }],
    left: 340, top: 140, width: 80, height: 20, pathOffset: { x: 40, y: 10 },
    stroke: '#2563eb', strokeWidth: 2, fill: 'transparent',
    ...own(author), data: { id, type: 'polyline', authorId: author },
  }),
  cloud: (id, author = A) => ({
    type: 'polygon', points: [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 60 }, { x: 0, y: 60 }],
    left: 20, top: 220, width: 90, height: 60, pathOffset: { x: 45, y: 30 },
    stroke: '#dc2626', strokeWidth: 2, fill: 'transparent',
    ...own(author), data: { id, type: 'cloud', cloud: { arc: 12 }, authorId: author },
  }),
  textbox: (id, author = A) => ({
    type: 'textbox', left: 140, top: 220, width: 140, height: 20, text: 'Note',
    fontSize: 14, fontFamily: 'Helvetica', fill: '#000000',
    ...own(author), data: { id, type: 'textbox', authorId: author, style: { fontColor: '#000000', fontSize: 14 } },
  }),
  callout: (id, author = A, overrides = {}) => ({
    ...JSON.parse(JSON.stringify(calloutToAnnotationObject({
      id, pageNumber: 1, authorId: author,
      arrowTip: { x: 0.5, y: 0.3 }, knee: { x: 0.55, y: 0.33 }, textBoxPosition: { x: 0.6, y: 0.35 },
      textBoxWidth: 0.2, textBoxHeight: 0.04, text: 'Check', style: { fontColor: '#000000', fontSize: 14, borderColor: '#1e293b' },
      ...overrides,
    }, PAGE_SIZE))),
    ...own(author),
  }),
  counter: (id, author = A) => ({
    type: 'circle', left: 320, top: 240, radius: 12, width: 24, height: 24,
    stroke: '#1e293b', strokeWidth: 2, fill: '#fde68a',
    ...own(author), data: { id, type: 'counter', displayNumber: 1, seriesId: 's1', authorId: author },
  }),
  stamp: (id, author = A) => ({
    type: 'image', left: 400, top: 240, width: 60, height: 30, scaleX: 1, scaleY: 1,
    src: 'data:image/png;base64,iVBORw0KGgo=',
    ...own(author), data: { id, type: 'stamp', label: 'APPROVED', authorId: author },
  }),
};

const byId = (objects, id) => objects.find((o) => String(o?.data?.id) === String(id));
const withMark = (id, change) => (objects) => objects.map((o) => (String(o?.data?.id) === String(id) ? change(o) : o));

async function openScreens(name, { second = false } = {}) {
  const cloud = createCloud(name);
  const handleA = await openFor(cloud.makeClient(A), name);
  const handleB = second ? await openFor(cloud.makeClient(B), name) : null;
  assert.ok(await until(() => handleA.isRealtimeReady() && (!handleB || handleB.isRealtimeReady())));
  const a = createHistoryScreen(handleA, A);
  const b = handleB ? createHistoryScreen(handleB, B) : null;
  return {
    cloud, a, b,
    async sync() {
      await handleA.drain();
      if (handleB) await handleB.drain();
      await settle(60);
      a.refresh();
      b?.refresh();
    },
    async close() { await Promise.all([handleA.destroy(), handleB?.destroy()]); },
  };
}

// Walk the whole history back and forward: every press must land exactly on
// the state recorded before / after the matching step, and one press past
// either end changes nothing.
function assertWalk(screen, states, label, { keep = null } = {}) {
  const expectAt = (index) => {
    const state = { ...states[index] };
    if (keep) Object.assign(state, keep());
    return state;
  };
  for (let index = states.length - 1; index > 0; index -= 1) {
    assert.equal(screen.undo(), 'applied', `${label}: undo of step ${index} did something`);
    assert.deepEqual(screen.signature(), expectAt(index - 1), `${label}: undo of step ${index} lands before it`);
  }
  assert.equal(screen.undo(), 'none', `${label}: nothing left to undo`);
  assert.deepEqual(screen.signature(), expectAt(0), `${label}: extra undo changes nothing`);
  for (let index = 1; index < states.length; index += 1) {
    assert.equal(screen.redo(), 'applied', `${label}: redo of step ${index} did something`);
    assert.deepEqual(screen.signature(), expectAt(index), `${label}: redo of step ${index} lands after it`);
  }
  assert.equal(screen.redo(), 'none', `${label}: nothing left to redo`);
  assert.deepEqual(screen.signature(), expectAt(states.length - 1), `${label}: extra redo changes nothing`);
}

// ---- shared rules (pure) -----------------------------------------------------

test('a press skips dead steps and stops at the first visible one', () => {
  const outcomes = ['skipped', 'skipped', 'applied', 'applied'];
  let calls = 0;
  assert.equal(runHistoryPress(() => outcomes[calls++]), 'applied');
  assert.equal(calls, 3, 'one press = one visible step');
  assert.equal(runHistoryPress(() => 'none'), 'none');
  let loops = 0;
  assert.equal(runHistoryPress(() => { loops += 1; return 'skipped'; }), 'skipped');
  assert.equal(loops, HISTORY_SKIP_LIMIT, 'bounded');
});

test('a step counts as visible only when a page it touches changed', () => {
  const page = (objects) => ({ objects });
  const before = { 1: page([{ data: { id: 'm' }, left: 1 }]), 2: page([]) };
  const same = { ...before, 1: page([{ data: { id: 'm' }, left: 1 }]) };
  const moved = { ...before, 1: page([{ data: { id: 'm' }, left: 2 }]) };
  const action = { type: 'fabric:update', pageNumber: 1 };
  assert.equal(historyActionChangedPages(before, same, action, jsonEqual), false);
  assert.equal(historyActionChangedPages(before, moved, action, jsonEqual), true);
  assert.equal(historyActionChangedPages(before, moved, { type: 'fabric:update', pageNumber: 2 }, jsonEqual), false);
  assert.equal(historyActionChangedPages(before, moved, {
    type: 'fabric:document-batch', actions: [{ type: 'fabric:delete', pageNumber: 2 }, { type: 'fabric:update', pageNumber: 1 }],
  }, jsonEqual), true);
});

test('Survey Marker and space steps restore their own slices, never the marks', () => {
  const current = { annotationsByPage: { 1: { objects: ['now'] } }, callouts: ['c-now'], surveyMarkers: { m: 2 } };
  const target = { annotationsByPage: { 1: { objects: ['then'] } }, callouts: ['c-then'], surveyMarkers: { m: 1 }, spaces: [] };
  for (const reason of ['highlight:create', 'highlight:delete', 'survey-marker:move', 'space:delete']) {
    assert.equal(legacyRestoreKeepsCurrentMarks({ reason }), true, reason);
    const scoped = scopeLegacyRestoreToOwnSlices({ reason }, current, target);
    assert.deepEqual(scoped.annotationsByPage, current.annotationsByPage, reason);
    assert.deepEqual(scoped.callouts, current.callouts, reason);
    assert.deepEqual(scoped.surveyMarkers, target.surveyMarkers, reason);
  }
  for (const reason of ['annotations:save', 'callouts:update', 'delete:batch']) {
    assert.equal(scopeLegacyRestoreToOwnSlices({ reason }, current, target), target, reason);
  }
});

test('a new callout\'s first commit folds into its create step (typed, left blank, or Esc)', () => {
  const create = { type: 'fabric:create', pageNumber: 1, storageKey: 'c1', annotationId: 'c1', annotation: { text: '' }, __historyMeta: { checkpointId: 7 } };
  const older = { type: 'fabric:create', pageNumber: 1, storageKey: 'p1', __historyMeta: { checkpointId: 6 } };
  const stack = [older, create];
  const typed = { type: 'fabric:update', pageNumber: 1, storageKey: 'c1', annotationId: 'c1', before: { text: '' }, after: { text: 'Hi' } };
  const updated = foldIntoCreateStep(stack, typed, 'c1', 7);
  assert.equal(updated.folded, 'updated');
  assert.equal(updated.stack.length, 2, 'still one step for the callout');
  assert.deepEqual(updated.stack[1].annotation, { text: 'Hi' }, 'the step creates the callout as committed');
  assert.equal(updated.stack[1].__historyMeta.checkpointId, 7);
  assert.deepEqual(stack[1].annotation, { text: '' }, 'input untouched');
  const removed = foldIntoCreateStep(stack, { type: 'fabric:delete', pageNumber: 1, storageKey: 'c1' }, 'c1', 7);
  assert.equal(removed.folded, 'removed');
  assert.deepEqual(removed.stack, [older], 'a blank / cancelled new callout leaves no step');
  // Not folded: something else happened since, another mark, or no create on top.
  assert.equal(foldIntoCreateStep(stack, typed, 'c1', 8).folded, null);
  assert.equal(foldIntoCreateStep(stack, { ...typed, storageKey: 'c2', annotationId: 'c2' }, 'c1', 7).folded, null);
  assert.equal(foldIntoCreateStep([older], typed, 'c1', 6).folded, null);
});

// ---- the owner's report ------------------------------------------------------

test('owner report: pens, partial + whole + multi-stroke erases, undo each erase exactly, new stroke undoes alone, redo never re-erases', async () => {
  const { a, close } = await openScreens('w37-owner-report');
  try {
    const states = [a.signature()];
    for (let i = 0; i < 4; i += 1) {
      a.save(1, (objects) => [...objects, TOOLS.pen(`p${i + 1}`, 40 + i * 40)]);
      states.push(a.signature());
    }
    const shorter = (id) => (objects) => {
      const mark = byId(objects, id);
      return { ...mark, path: mark.path.slice(0, 2), width: 80 };
    };
    // E1 partial on p1; E2 one drag partly erasing p2 and p3; E3 whole p4;
    // E4 one drag wholly erasing p1 and p2.
    assert.equal((await a.erase(1, (o) => [{ id: 'p1', after: shorter('p1')(o) }])).status, 'committed');
    states.push(a.signature());
    assert.equal((await a.erase(1, (o) => [{ id: 'p2', after: shorter('p2')(o) }, { id: 'p3', after: shorter('p3')(o) }])).status, 'committed');
    states.push(a.signature());
    assert.equal((await a.erase(1, () => [{ id: 'p4', after: null }], { mode: 'full' })).status, 'committed');
    states.push(a.signature());
    assert.equal((await a.erase(1, () => [{ id: 'p1', after: null }, { id: 'p2', after: null }], { mode: 'full' })).status, 'committed');
    states.push(a.signature());
    assert.deepEqual(Object.keys(a.signature()), ['p3'], 'three strokes erased, one partly');

    for (let step = 8; step > 4; step -= 1) {
      assert.equal(a.undo(), 'applied');
      assert.deepEqual(a.signature(), states[step - 1], `undo of erase ${step - 4} restores exactly what it erased`);
    }
    assert.deepEqual(a.signature(), states[4], 'all four pens back, whole and unerased');
    a.save(1, (objects) => [...objects, TOOLS.pen('p5', 220)]);
    const withNew = a.signature();
    assert.equal(a.undo(), 'applied');
    assert.deepEqual(a.signature(), states[4], 'undoing the new stroke removes only it');
    assert.equal(a.redo(), 'applied');
    assert.deepEqual(a.signature(), withNew, 'redo brings the new stroke back');
    assert.equal(a.redo(), 'none', 'the undone erases were cleared by the new stroke');
    assert.deepEqual(a.signature(), withNew, 'redo never re-erases');
    // And the store agrees with the screen.
    assert.deepEqual(Object.keys(createHistoryScreen(a.handle, A).signature()).sort(), ['p1', 'p2', 'p3', 'p4', 'p5']);
  } finally {
    await close();
  }
});

test('a new step in either lane clears Redo in both', async () => {
  const { a, close } = await openScreens('w37-redo-cleared');
  try {
    a.save(1, (o) => [...o, TOOLS.pen('p1', 40)]);
    a.save(1, (o) => [...o, TOOLS.pen('p2', 80)]);
    await a.erase(1, () => [{ id: 'p1', after: null }], { mode: 'full' });
    // Undo the erase (legacy) and p2 (local), then a new LOCAL step.
    a.undo();
    a.undo();
    assert.deepEqual(a.depths(), { localUndo: 1, localRedo: 1, legacyUndo: 0, legacyRedo: 1 });
    a.save(1, withMark('p1', (m) => ({ ...m, stroke: '#0000ff' })));
    assert.deepEqual(a.depths(), { localUndo: 2, localRedo: 0, legacyUndo: 0, legacyRedo: 0 });
    const afterRecolour = a.signature();
    assert.equal(a.redo(), 'none');
    assert.deepEqual(a.signature(), afterRecolour);

    // Undo the recolour (local), then a new LEGACY step (an erase).
    a.undo();
    assert.equal(a.depths().localRedo, 1);
    await a.erase(1, () => [{ id: 'p1', after: null }], { mode: 'full' });
    assert.deepEqual(a.depths(), { localUndo: 1, localRedo: 0, legacyUndo: 1, legacyRedo: 0 });
    const afterErase = a.signature();
    assert.equal(a.redo(), 'none', 'the undone recolour was cleared by the erase');
    assert.deepEqual(a.signature(), afterErase);
  } finally {
    await close();
  }
});

// ---- every tool × every action ----------------------------------------------

const MOVE = (id, dx = 12, dy = 8) => [1, 2, 3].map((f) => withMark(id, (m) => ({
  ...m, left: m.left + dx / 3, top: m.top + dy / 3,
})));
const RESIZE = (id) => [1, 2].map(() => withMark(id, (m) => ({
  ...m, scaleX: (m.scaleX ?? 1) * 1.25, scaleY: (m.scaleY ?? 1) * 1.1,
})));
const RECOLOUR = (id) => withMark(id, (m) => (m.data?.type === 'callout'
  ? TOOLS.callout(id, A, { text: m.data.legacyCallout.text, style: { ...m.data.legacyCallout.style, borderColor: '#dc2626' } })
  : { ...m, stroke: '#16a34a', ...(m.type === 'textbox' ? { fill: '#16a34a' } : {}) }));
const TEXT_EDIT = (id) => withMark(id, (m) => (m.data?.type === 'callout'
  ? TOOLS.callout(id, A, { text: 'Checked twice', style: m.data.legacyCallout.style })
  : { ...m, text: `${m.text} edited` }));

for (const [tool, make] of Object.entries(TOOLS)) {
  test(`${tool}: create, move, resize, recolour${tool === 'textbox' || tool === 'callout' ? ', text edit' : ''}, paste, delete — one step each, undo/redo walks exactly`, async () => {
    const { a, close } = await openScreens(`w37-matrix-${tool}`);
    try {
      const id = `${tool}-1`;
      const states = [a.signature()];
      const step = (fn) => { fn(); states.push(a.signature()); };
      step(() => a.save(1, (o) => [...o, make(id)]));
      step(() => a.gesture(1, MOVE(id)));
      if (tool !== 'callout') step(() => a.gesture(1, RESIZE(id)));
      step(() => a.save(1, RECOLOUR(id)));
      if (tool === 'textbox' || tool === 'callout') step(() => a.save(1, TEXT_EDIT(id)));
      // Paste: a copy with its own id, offset.
      step(() => a.save(1, (o) => {
        const copy = JSON.parse(JSON.stringify(byId(o, id)));
        copy.data = { ...copy.data, id: `${id}-copy` };
        if (copy.data.legacyCallout) copy.data.legacyCallout = { ...copy.data.legacyCallout, id: `${id}-copy` };
        copy.left += 30;
        return [...o, copy];
      }));
      step(() => a.save(1, (o) => o.filter((m) => String(m.data?.id) !== id)));
      for (let i = 1; i < states.length; i += 1) {
        assert.notDeepEqual(states[i], states[i - 1], `${tool}: step ${i} changed the page`);
      }
      assert.equal(a.depths().localUndo, states.length - 1, `${tool}: one undo step per gesture`);
      assertWalk(a, states, tool);
    } finally {
      await close();
    }
  });
}

test('multi-select: moving and deleting several marks are one step each', async () => {
  const { a, close } = await openScreens('w37-multi-select');
  try {
    const states = [a.signature()];
    const step = (fn) => { fn(); states.push(a.signature()); };
    step(() => a.save(1, (o) => [...o, TOOLS.rect('r1'), TOOLS.pen('p1', 60), TOOLS.textbox('t1')]));
    step(() => a.gesture(1, [1, 2, 3].map(() => (objects) => objects.map((m) => (
      ['r1', 'p1'].includes(m.data.id) ? { ...m, left: m.left + 5, top: m.top + 3 } : m
    )))));
    step(() => a.save(1, (o) => o.filter((m) => !['r1', 't1'].includes(m.data.id))));
    assert.equal(a.depths().localUndo, 3);
    assertWalk(a, states, 'multi-select');
  } finally {
    await close();
  }
});

test('lanes interleave in order: pen, erase, move, partial erase, recolour, Survey Marker', async () => {
  const { a, close } = await openScreens('w37-interleave');
  try {
    const states = [a.signature()];
    const markers = [a.surveyMarkers];
    const step = async (fn) => { await fn(); states.push(a.signature()); markers.push(a.surveyMarkers); };
    await step(() => a.save(1, (o) => [...o, TOOLS.pen('p1', 40), TOOLS.highlighter('h1', 90)]));
    await step(() => a.erase(1, () => [{ id: 'h1', after: null }], { mode: 'full' }));
    await step(() => a.gesture(1, MOVE('p1')));
    await step(() => a.erase(1, (o) => [{ id: 'p1', after: { ...byId(o, 'p1'), path: byId(o, 'p1').path.slice(0, 2) } }]));
    await step(() => a.save(1, withMark('p1', (m) => ({ ...m, stroke: '#000000' }))));
    await step(() => a.surveyMarker('highlight:create', (m) => ({ ...m, sm1: { id: 'sm1', pageNumber: 1, bounds: { x: 1, y: 2, width: 3, height: 4 } } })));
    for (let index = states.length - 1; index > 0; index -= 1) {
      assert.equal(a.undo(), 'applied', `undo ${index}`);
      assert.deepEqual(a.signature(), states[index - 1], `undo ${index} marks`);
      assert.deepEqual(Object.keys(a.surveyMarkers), Object.keys(markers[index - 1]), `undo ${index} survey markers`);
    }
    assert.equal(a.undo(), 'none');
    for (let index = 1; index < states.length; index += 1) {
      assert.equal(a.redo(), 'applied', `redo ${index}`);
      assert.deepEqual(a.signature(), states[index], `redo ${index} marks`);
      assert.deepEqual(Object.keys(a.surveyMarkers), Object.keys(markers[index]), `redo ${index} survey markers`);
    }
  } finally {
    await close();
  }
});

// ---- other people's work ----------------------------------------------------

test('a collaborator drawing and editing mid-sequence: my undo/redo never touches their work', async () => {
  const s = await openScreens('w37-remote-mid-sequence', { second: true });
  const { a, b } = s;
  try {
    const states = [a.signature()];
    a.save(1, (o) => [...o, TOOLS.pen('a1', 40)]);
    states.push(a.signature());
    await s.sync();
    // B draws its own stroke and a rect, then recolours its stroke.
    b.save(1, (o) => [...o, TOOLS.pen('b1', 300, B), TOOLS.rect('b2', B)]);
    await s.sync();
    a.gesture(1, MOVE('a1'));
    await a.erase(1, (o) => [{ id: 'a1', after: { ...byId(o, 'a1'), path: byId(o, 'a1').path.slice(0, 2) } }]);
    b.save(1, withMark('b1', (m) => ({ ...m, stroke: '#00ff00' })));
    await s.sync();
    a.save(1, (o) => [...o, TOOLS.textbox('a2')]);
    await s.sync();
    const theirs = () => {
      const sig = a.signature();
      return { b1: sig.b1, b2: sig.b2 };
    };
    const bBefore = theirs();
    assert.ok(bBefore.b1 && bBefore.b2);
    for (let i = 0; i < 4; i += 1) {
      assert.equal(a.undo(), 'applied', `undo ${i + 1}`);
      assert.deepEqual(theirs(), bBefore, `undo ${i + 1} left B's marks alone`);
    }
    assert.equal(a.undo(), 'none', 'B\'s steps are not mine to undo');
    assert.deepEqual(Object.keys(a.signature()).sort(), ['b1', 'b2']);
    await s.sync();
    assert.deepEqual(Object.keys(b.signature()).sort(), ['b1', 'b2'], 'B sees my marks gone, theirs kept');
    for (let i = 0; i < 4; i += 1) assert.equal(a.redo(), 'applied', `redo ${i + 1}`);
    assert.deepEqual(theirs(), bBefore);
    await s.sync();
    assert.deepEqual(b.signature(), a.signature(), 'both screens converge');
  } finally {
    await s.close();
  }
});

test('a collaborator restyles my mark after I moved it: my undo puts back only my position', async () => {
  const s = await openScreens('w37-remote-same-mark', { second: true });
  const { a, b } = s;
  try {
    a.save(1, (o) => [...o, TOOLS.rect('r1')]);
    a.gesture(1, MOVE('r1', 40, 20));
    await s.sync();
    b.save(1, withMark('r1', (m) => ({ ...m, stroke: '#dc2626' })));
    await s.sync();
    assert.equal(a.undo(), 'applied');
    const mark = a.mark('r1');
    assert.equal(mark.left, 200);
    assert.equal(mark.top, 40);
    assert.equal(mark.stroke, '#dc2626', 'their colour survives my undo');
    await s.sync();
    assert.equal(b.mark('r1').left, 200);
    assert.equal(b.mark('r1').stroke, '#dc2626');
  } finally {
    await s.close();
  }
});

test('a step whose mark someone else deleted is skipped: the same press undoes my previous step', async () => {
  const s = await openScreens('w37-remote-delete', { second: true });
  const { a, b } = s;
  try {
    a.save(1, (o) => [...o, TOOLS.pen('a1', 40)]);
    a.save(1, (o) => [...o, TOOLS.rect('a2')]);
    a.save(1, withMark('a2', (m) => ({ ...m, stroke: '#16a34a' })));
    await s.sync();
    b.save(1, (o) => o.filter((m) => m.data.id !== 'a2'));
    await s.sync();
    assert.equal(a.mark('a2'), null);
    // Top two steps (recolour a2, create a2) can no longer change anything.
    assert.equal(a.undo(), 'applied', 'one press still does something visible');
    assert.equal(a.mark('a1'), null, 'it undid my stroke');
    assert.equal(a.mark('a2'), null, 'and never brought back what B deleted');
    assert.equal(a.undo(), 'none');
  } finally {
    await s.close();
  }
});

test('Survey Marker undo keeps a collaborator\'s newer stroke (was deleted through the capture)', async () => {
  const s = await openScreens('w37-survey-marker-remote', { second: true });
  const { a, b } = s;
  try {
    a.save(1, (o) => [...o, TOOLS.pen('a1', 40)]);
    a.surveyMarker('highlight:create', (m) => ({ ...m, sm1: { id: 'sm1', pageNumber: 1, bounds: { x: 1, y: 2, width: 3, height: 4 } } }));
    await s.sync();
    b.save(1, (o) => [...o, TOOLS.pen('b1', 300, B)]);
    await s.sync();
    assert.ok(a.mark('b1'));
    assert.equal(a.undo(), 'applied');
    assert.equal(a.surveyMarkers.sm1, undefined, 'my Survey Marker is gone');
    assert.ok(a.mark('b1'), 'B\'s stroke stays on my screen');
    assert.ok(a.mark('a1'), 'my earlier stroke stays');
    await s.sync();
    assert.ok(b.mark('b1'), 'and in the shared document');
  } finally {
    await s.close();
  }
});

test('a checkpoint Undo cannot take never blocks older steps', async () => {
  const { a, close } = await openScreens('w37-unknown-legacy');
  try {
    a.save(1, (o) => [...o, TOOLS.pen('p1', 40)]);
    a.pushUnknownLegacyStep('excel:auto-sync');
    assert.equal(a.undo(), 'applied');
    assert.equal(a.mark('p1'), null, 'the same press undid the stroke');
  } finally {
    await close();
  }
});

test('reload: marks stay, history starts empty (not persisted, like Figma / Acrobat), undo changes nothing', async () => {
  const name = 'w37-reload';
  const cloud = createCloud(name);
  const first = await openFor(cloud.makeClient(A), name);
  assert.ok(await until(() => first.isRealtimeReady()));
  const a = createHistoryScreen(first, A);
  a.save(1, (o) => [...o, TOOLS.pen('p1', 40), TOOLS.rect('r1')]);
  await a.erase(1, () => [{ id: 'p1', after: null }], { mode: 'full' });
  const shown = a.signature();
  await first.drain();
  await first.destroy();
  const second = await openFor(cloud.makeClient(A), name);
  try {
    assert.ok(await until(() => second.isRealtimeReady() && Object.keys(createHistoryScreen(second, A).signature()).length > 0));
    const reopened = createHistoryScreen(second, A);
    assert.deepEqual(reopened.signature(), shown, 'the page reopens as it was left');
    assert.equal(reopened.undo(), 'none');
    assert.equal(reopened.redo(), 'none');
    assert.deepEqual(reopened.signature(), shown);
  } finally {
    await second.destroy();
  }
});

// ---- PDFViewer wiring (source contract; the live probe drives the real app) ----

test('PDFViewer follows the timeline rules', () => {
  const source = fs.readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const between = (from, to) => {
    const start = source.indexOf(from);
    assert.ok(start >= 0, `missing ${from}`);
    const end = source.indexOf(to, start + from.length);
    return source.slice(start, end < 0 ? undefined : end);
  };
  const pushLocal = between('const pushLocalAnnotationHistoryAction = useCallback(', '\n  }, [');
  assert.match(pushLocal, /clearLegacyRedoForNewStep\(/, 'a local step clears the legacy Redo');
  const checkpoint = between('const addHistoryCheckpoint = useCallback(', '\n  }, [');
  assert.equal((checkpoint.match(/clearLocalRedoForNewStep\(/g) || []).length, 3, 'every legacy step clears the local Redo');
  const undo = between('const handleUndo = useCallback(', '\n\t  }, [');
  const redo = between('const handleRedo = useCallback(', '\n\t  }, [');
  for (const [name, body] of [['undo', undo], ['redo', redo]]) {
    assert.match(body, /runHistoryPress\(/, `${name}: one press = one visible step`);
    assert.match(body, /return 'skipped';/, `${name}: dead steps are dropped`);
    assert.match(body, /scopeLegacyRestoreToOwnSlices\(/, `${name}: Survey Marker steps keep the marks`);
  }
  const key = between('const handleUndoRedoKey = (e) => {', '\n    };');
  assert.match(key, /if \(!undoRedoKeyActiveRef\.current\) return;/, 'only the visible document answers Cmd+Z');
  assert.ok(key.indexOf('undoRedoKeyActiveRef') < key.indexOf('stopImmediatePropagation'), 'checked before the event is stopped');
  assert.doesNotMatch(source, /addHistoryCheckpoint\('excel:auto-sync'/, 'the file watcher is not an undo step');
  assert.match(pushLocal, /foldIntoCreateStep\(/, 'a new callout\'s first commit folds into its create');
  assert.match(source, /historyFoldIntoCreateRef\.current = normalizedSaveContext\?\.foldIntoCreateOf \|\| null;/, 'the save hands the fold to its push');
  for (const source of ['callout:edit-commit', 'callout:delete-blank', 'callout:cancel-new']) {
    const block = between(`source: '${source}'`, '});');
    assert.match(block, /foldIntoCreateOf: editingAnnotation\.reactCalloutId/, `${source} folds`);
  }
  const created = between('const handleSurveyMarkerCreated = useCallback(', 'addHistoryCheckpoint(\'highlight:create\'');
  assert.match(created, /if \(!showSurveyPanel \|\| !selectedTemplate\) \{\n\s+return;/, 'no empty Survey Marker step');
});
