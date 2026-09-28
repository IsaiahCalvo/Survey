// Field-level Undo/Redo (2026-09-23).
//
// Bug: undoing a change to a mark put the WHOLE mark back as it was before
// that change, so a collaborator's edit to another setting of the same mark
// (e.g. a callout's text size, changed while you dragged its text colour) was
// wiped in both sessions. Undo/Redo now writes back only the fields your own
// action changed, onto the mark as it is now.
import test from 'node:test';
import { deepStrictEqual, equal, ok } from 'node:assert/strict';
import * as Y from 'yjs';

import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  collectAnnotationFieldTouches,
  createGestureTouchRecord,
  diffAnnotationFields,
  filterAnnotationHistoryActionByOwner,
  invertAnnotationHistoryAction,
  mergeAnnotationUpdateOntoCurrent,
  restrictAnnotationHistoryActionFields,
} from '../src/utils/annotationLocalHistory.js';
import {
  calloutToAnnotationObject,
  deriveCalloutsFromByPage,
} from '../src/utils/calloutAnnotationBridge.js';
import { docToByPage, syncByPageToDoc } from '../src/services/annotationDocStore.js';
import { normalizeMergedHistoryObject } from '../src/utils/historyMergeNormalize.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const page = (...objects) => ({ version: '5.3.0', objects });
const objectsOf = (byPage, pageNumber = 1) => (byPage[pageNumber] || byPage[String(pageNumber)]).objects;

const textbox = (overrides = {}) => ({
  type: 'textbox',
  left: 10,
  top: 20,
  width: 120,
  height: 20,
  fill: '#000000',
  fontSize: 14,
  text: 'Hello',
  data: { id: 't1', authorId: 'user-a', style: { fontColor: '#000000', fontSize: 14 } },
  ...overrides,
});

test('field diff walks nested style keys separately and treats arrays as one field', () => {
  const before = {
    left: 1,
    points: [{ x: 0, y: 0 }, { x: 5, y: 5 }],
    data: { id: 'p1', style: { fontColor: '#000', fontSize: 14 } },
  };
  const after = {
    left: 1,
    points: [{ x: 0, y: 0 }, { x: 6, y: 5 }],
    data: { id: 'p1', style: { fontColor: '#f00', fontSize: 14 }, note: 'new' },
  };
  const changes = diffAnnotationFields(before, after);
  deepStrictEqual(
    changes.map((change) => change.path.join('.')).sort(),
    ['data.note', 'data.style.fontColor', 'points'],
  );
  const points = changes.find((change) => change.path[0] === 'points');
  deepStrictEqual(points.after, after.points, 'the whole array travels as one value');
  const note = changes.find((change) => change.path.join('.') === 'data.note');
  equal(note.hadBefore, false);
  equal(note.hasAfter, true);
});

test('undo of my colour change keeps a collaborator\'s later size change on the same mark', () => {
  const original = textbox();
  const recolored = textbox({ fill: '#ff0000', data: { ...original.data, style: { fontColor: '#ff0000', fontSize: 14 } } });
  const action = buildAnnotationHistoryAction({
    pageNumber: 1,
    previousPage: page(original),
    nextPage: page(recolored),
  });
  equal(action.type, 'fabric:update');

  // Collaborator B then sets the size to 24 (the box grows too).
  const afterRemote = {
    1: page({
      ...clone(recolored),
      fontSize: 24,
      height: 34,
      data: { ...clone(recolored.data), style: { fontColor: '#ff0000', fontSize: 24 } },
    }),
  };

  const undone = applyAnnotationHistoryAction(afterRemote, invertAnnotationHistoryAction(action));
  const [mark] = objectsOf(undone);
  equal(mark.fill, '#000000', 'my colour is undone');
  equal(mark.data.style.fontColor, '#000000');
  equal(mark.fontSize, 24, 'B\'s size survives');
  equal(mark.height, 34, 'B\'s box growth survives');
  equal(mark.data.style.fontSize, 24);

  const redone = applyAnnotationHistoryAction(undone, action);
  const [again] = objectsOf(redone);
  equal(again.fill, '#ff0000', 'redo re-applies my colour');
  equal(again.data.style.fontColor, '#ff0000');
  equal(again.fontSize, 24, 'redo still keeps B\'s size');
});

test('a multi-field action (size + box growth) undoes and redoes as one step', () => {
  const original = textbox();
  const resized = textbox({ fontSize: 24, height: 34, data: { ...original.data, style: { fontColor: '#000000', fontSize: 24 } } });
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(original), nextPage: page(resized) });
  const state = { 1: page(clone(resized)) };

  const undone = applyAnnotationHistoryAction(state, invertAnnotationHistoryAction(action));
  deepStrictEqual(objectsOf(undone)[0], original, 'one Undo restores every field the action changed');
  const redone = applyAnnotationHistoryAction(undone, action);
  deepStrictEqual(objectsOf(redone)[0], resized, 'one Redo re-applies every field');
});

test('geometry fields of a move are reverted without touching a concurrent restyle', () => {
  const rect = { type: 'rect', left: 10, top: 10, width: 50, height: 40, stroke: '#000', strokeWidth: 2, data: { id: 'r1' } };
  const moved = { ...rect, left: 110, top: 60 };
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(rect), nextPage: page(moved) });
  const current = { 1: page({ ...moved, stroke: '#00f', strokeWidth: 6 }) };
  const [mark] = objectsOf(applyAnnotationHistoryAction(current, invertAnnotationHistoryAction(action)));
  equal(mark.left, 10);
  equal(mark.top, 10);
  equal(mark.stroke, '#00f');
  equal(mark.strokeWidth, 6);
});

test('ink path arrays are restored as one unit', () => {
  const ink = { type: 'path', path: [['M', 0, 0], ['L', 10, 10]], stroke: '#000', data: { id: 'i1' } };
  const reshaped = { ...ink, path: [['M', 0, 0], ['Q', 5, 5, 10, 10], ['L', 20, 20]] };
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(ink), nextPage: page(reshaped) });
  const current = { 1: page({ ...reshaped, stroke: '#0a0' }) };
  const [mark] = objectsOf(applyAnnotationHistoryAction(current, invertAnnotationHistoryAction(action)));
  deepStrictEqual(mark.path, ink.path);
  equal(mark.stroke, '#0a0');
});

test('same field changed by a collaborator after my action: my undo still restores my before value', () => {
  const original = textbox();
  const recolored = textbox({ fill: '#ff0000' });
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(original), nextPage: page(recolored) });
  const current = { 1: page(textbox({ fill: '#00ff00' })) };
  const [mark] = objectsOf(applyAnnotationHistoryAction(current, invertAnnotationHistoryAction(action)));
  equal(mark.fill, '#000000');
});

test('undo of an update on a mark deleted by someone else is a no-op, never a resurrection', () => {
  const original = textbox();
  const recolored = textbox({ fill: '#ff0000' });
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(original), nextPage: page(recolored) });
  const other = { type: 'rect', data: { id: 'r9' }, left: 3 };
  const current = { 1: page(other) };
  const undone = applyAnnotationHistoryAction(current, invertAnnotationHistoryAction(action));
  deepStrictEqual(objectsOf(undone), [other]);
  const redone = applyAnnotationHistoryAction(undone, action);
  deepStrictEqual(objectsOf(redone), [other]);
});

test('creates and deletes still undo and redo whole marks', () => {
  const mark = textbox();
  const createAction = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(), nextPage: page(mark) });
  equal(createAction.type, 'fabric:create');
  const afterUndoCreate = applyAnnotationHistoryAction({ 1: page(mark) }, invertAnnotationHistoryAction(createAction));
  deepStrictEqual(objectsOf(afterUndoCreate), []);

  const deleteAction = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(mark), nextPage: page() });
  equal(deleteAction.type, 'fabric:delete');
  const afterUndoDelete = applyAnnotationHistoryAction({ 1: page() }, invertAnnotationHistoryAction(deleteAction));
  deepStrictEqual(objectsOf(afterUndoDelete), [mark]);
});

test('a drag step keeps only the fields its own frames wrote, not a mid-drag collaborator edit', () => {
  // Pre-drag baseline.
  const baseline = page(textbox());
  const touches = createGestureTouchRecord();
  // Frame 1 (ours): colour moves.
  const frame1 = page(textbox({ fill: '#aa0000' }));
  collectAnnotationFieldTouches(baseline, frame1, touches);
  // Collaborator's size change lands between frames (not one of our saves).
  const withRemote = page(textbox({ fill: '#aa0000', fontSize: 24, height: 34 }));
  // Frame 2 (ours) reads the current page, so only the colour differs.
  const frame2 = page(textbox({ fill: '#ff0000', fontSize: 24, height: 34 }));
  collectAnnotationFieldTouches(withRemote, frame2, touches);

  const rawStep = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: baseline, nextPage: frame2 });
  deepStrictEqual(
    diffAnnotationFields(rawStep.before, rawStep.after).map((change) => change.path.join('.')).sort(),
    ['fill', 'fontSize', 'height'],
    'the raw baseline-vs-release diff wrongly contains the collaborator\'s size',
  );
  const step = restrictAnnotationHistoryActionFields(rawStep, touches);
  deepStrictEqual(step.fields, [['fill']]);

  const undone = applyAnnotationHistoryAction({ 1: frame2 }, invertAnnotationHistoryAction(step));
  const [mark] = objectsOf(undone);
  equal(mark.fill, '#000000', 'the whole drag undoes in one step');
  equal(mark.fontSize, 24, 'the collaborator\'s size survives');
  equal(mark.height, 34);
  const [redone] = objectsOf(applyAnnotationHistoryAction(undone, step));
  equal(redone.fill, '#ff0000');
  equal(redone.fontSize, 24);
});

test('restricting drops an update that holds only a collaborator\'s change', () => {
  const baseline = page(textbox(), { type: 'rect', data: { id: 'r1' }, left: 0 });
  const release = page(textbox({ fill: '#ff0000' }), { type: 'rect', data: { id: 'r1' }, left: 0 });
  const touches = collectAnnotationFieldTouches(baseline, release);
  // The text box changed only through someone else's size edit in a second
  // batch entry; our touches say "fill" — but fill ended where it began.
  const noOpForUs = buildAnnotationHistoryAction({
    pageNumber: 1,
    previousPage: page(textbox({ fill: '#ff0000' })),
    nextPage: page(textbox({ fill: '#ff0000', fontSize: 24 })),
  });
  equal(restrictAnnotationHistoryActionFields(noOpForUs, touches), null);
});

test('owner filtering keeps the field list, for the author and for other editors alike', () => {
  const action = {
    type: 'fabric:update',
    pageNumber: 1,
    annotationId: 't1',
    storageKey: 't1',
    before: textbox(),
    after: textbox({ fill: '#ff0000' }),
    fields: [['fill']],
  };
  const scoped = filterAnnotationHistoryActionByOwner(action, 'user-a');
  deepStrictEqual(scoped.fields, [['fill']]);
  deepStrictEqual(invertAnnotationHistoryAction(scoped).fields, [['fill']]);
  // RULED 2026-09-28 owner: open editing + lock — another editor's restyle of this mark is their own undo step; field list kept.
  deepStrictEqual(filterAnnotationHistoryActionByOwner(action, 'user-b').fields, [['fill']]);

  const batch = {
    type: 'fabric:batch',
    pageNumber: 1,
    created: [],
    deleted: [],
    updated: [{ id: 't1', annotationId: 't1', storageKey: 't1', before: action.before, after: action.after, fields: [['fill']] }],
  };
  deepStrictEqual(invertAnnotationHistoryAction(filterAnnotationHistoryActionByOwner(batch, 'user-a')).updated[0].fields, [['fill']]);
});

test('merge with no concurrent change reproduces the old whole-snapshot result exactly', () => {
  const before = textbox();
  const after = textbox({ fill: '#123456', left: 99, data: { ...before.data, extra: [1, 2] } });
  deepStrictEqual(mergeAnnotationUpdateOntoCurrent(clone(before), before, after), after);
  deepStrictEqual(mergeAnnotationUpdateOntoCurrent(clone(after), after, before), before);
});

// ---- Callouts: the reported case --------------------------------------------

const PAGE_SIZE = { width: 612, height: 792 };
const baseCallout = () => ({
  id: 'c1',
  pageNumber: 1,
  authorId: 'user-a',
  arrowTip: { x: 0.2, y: 0.2 },
  knee: { x: 0.3, y: 0.25 },
  textBoxPosition: { x: 0.4, y: 0.3 },
  textBoxWidth: 0.2,
  textBoxHeight: 0.04,
  text: 'Check this',
  style: { fontColor: '#000000', fontSize: 14, borderColor: '#1e293b' },
});
const project = (callout) => clone(calloutToAnnotationObject(callout, PAGE_SIZE));
const reproject = (object) => {
  const callout = deriveCalloutsFromByPage({ 1: { objects: [object] } })[0];
  return calloutToAnnotationObject(callout, PAGE_SIZE);
};

test('callout: undo of a text-colour drag keeps a collaborator\'s mid-drag 24pt size (one step, redo works)', () => {
  const start = baseCallout();
  const baseline = page(project(start));
  const touches = createGestureTouchRecord();
  // A's first colour frame.
  const f1 = page(project({ ...start, style: { ...start.style, fontColor: '#884400' } }));
  collectAnnotationFieldTouches(baseline, f1, touches);
  // B's size change arrives: 24pt and the box grows.
  const bCallout = { ...start, textBoxHeight: 0.07, style: { ...start.style, fontColor: '#884400', fontSize: 24 } };
  const withRemote = page(project(bCallout));
  // A's release frame reads the current callout, so only the colour moves.
  const releaseCallout = { ...bCallout, style: { ...bCallout.style, fontColor: '#ff0000' } };
  const release = page(project(releaseCallout));
  collectAnnotationFieldTouches(withRemote, release, touches);

  const step = restrictAnnotationHistoryActionFields(
    buildAnnotationHistoryAction({ pageNumber: 1, previousPage: baseline, nextPage: release }),
    touches,
  );
  equal(step.type, 'fabric:update');
  ok(!step.fields.some((path) => path.join('.') === 'data.legacyCallout.style.fontSize'), 'size is not ours');

  const options = { normalizeUpdatedObject: (object) => reproject(object) };
  const undone = applyAnnotationHistoryAction({ 1: release }, invertAnnotationHistoryAction(step), options);
  const [callout] = deriveCalloutsFromByPage(undone);
  equal(callout.style.fontColor, '#000000', 'my colour drag is undone in one press');
  equal(callout.style.fontSize, 24, 'B\'s 24pt survives');
  equal(callout.textBoxHeight, 0.07, 'B\'s box growth survives');
  deepStrictEqual(
    clone(objectsOf(undone)[0]),
    project({ ...bCallout, style: { ...bCallout.style, fontColor: '#000000' } }),
    'the drawn callout is rebuilt to match its merged settings',
  );

  const redone = applyAnnotationHistoryAction(undone, step, options);
  const [again] = deriveCalloutsFromByPage(redone);
  equal(again.style.fontColor, '#ff0000');
  equal(again.style.fontSize, 24);
});

// ---- Two sessions through the real shared-document store --------------------

function linkDocs(docA, docB) {
  docA.on('update', (update, origin) => { if (origin !== 'remote') Y.applyUpdate(docB, update, 'remote'); });
  docB.on('update', (update, origin) => { if (origin !== 'remote') Y.applyUpdate(docA, update, 'remote'); });
}

test('two sessions: A recolours, B resizes, A undoes -> B\'s size survives in both; redo restores A\'s colour', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  linkDocs(docA, docB);

  const start = { 1: page(textbox()) };
  syncByPageToDoc(docA, start);
  deepStrictEqual(objectsOf(docToByPage(docB))[0].fontSize, 14);

  // Session A: text colour.
  const aBefore = docToByPage(docA);
  const aAfter = clone(aBefore);
  objectsOf(aAfter)[0].fill = '#ff0000';
  objectsOf(aAfter)[0].data.style.fontColor = '#ff0000';
  const aAction = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: aBefore[1], nextPage: aAfter[1] });
  syncByPageToDoc(docA, aAfter);

  // Session B: font size 24 (box grows).
  const bNow = docToByPage(docB);
  const bNext = clone(bNow);
  Object.assign(objectsOf(bNext)[0], { fontSize: 24, height: 34 });
  objectsOf(bNext)[0].data.style.fontSize = 24;
  syncByPageToDoc(docB, bNext);

  // Session A: Undo once.
  const aUndone = applyAnnotationHistoryAction(docToByPage(docA), invertAnnotationHistoryAction(aAction));
  syncByPageToDoc(docA, aUndone);
  for (const [name, doc] of [['A', docA], ['B', docB]]) {
    const [mark] = objectsOf(docToByPage(doc));
    equal(mark.fontSize, 24, `${name}: B's 24pt survives A's undo`);
    equal(mark.data.style.fontSize, 24, `${name}: B's style size survives`);
    equal(mark.fill, '#000000', `${name}: A's colour is undone`);
  }

  // Session A: Redo.
  syncByPageToDoc(docA, applyAnnotationHistoryAction(docToByPage(docA), aAction));
  for (const [name, doc] of [['A', docA], ['B', docB]]) {
    const [mark] = objectsOf(docToByPage(doc));
    equal(mark.fill, '#ff0000', `${name}: redo restores A's colour`);
    equal(mark.fontSize, 24, `${name}: and keeps B's size`);
  }
});

// ---- Review fixes (2026-09-23, second pass) ----------------------------------

const rect = (id, overrides = {}) => ({ type: 'rect', left: 10, top: 10, width: 40, height: 30, stroke: '#000000', data: { id, authorId: 'user-a' }, ...overrides });

test('a drag step never includes a collaborator\'s mid-drag edit to ANOTHER mark', () => {
  // Reviewer repro: baseline {A,B}; preview moves A; collaborator sets B red;
  // release -> the step must hold A only, and its undo must not reset B.
  const baseline = page(rect('A'), rect('B', { left: 200 }));
  const record = createGestureTouchRecord();
  const frame1 = page(rect('A', { left: 30 }), rect('B', { left: 200 }));
  collectAnnotationFieldTouches(baseline, frame1, record);
  const withRemote = page(rect('A', { left: 30 }), rect('B', { left: 200, stroke: '#ff0000' }));
  const release = page(rect('A', { left: 60 }), rect('B', { left: 200, stroke: '#ff0000' }));
  collectAnnotationFieldTouches(withRemote, release, record);

  const raw = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: baseline, nextPage: release });
  equal(raw.type, 'fabric:batch', 'the raw baseline-vs-release diff holds both marks');
  const step = restrictAnnotationHistoryActionFields(raw, record);
  equal(step.type, 'fabric:update');
  equal(step.storageKey, 'A');
  const undone = applyAnnotationHistoryAction({ 1: release }, invertAnnotationHistoryAction(step));
  equal(objectsOf(undone)[0].left, 10, 'A goes back');
  equal(objectsOf(undone)[1].stroke, '#ff0000', 'B keeps the collaborator\'s red');
});

test('a drag step never deletes a mark a collaborator added, nor restores one they removed, mid-drag', () => {
  const baseline = page(rect('A'), rect('GONE', { left: 300 }));
  const record = createGestureTouchRecord();
  collectAnnotationFieldTouches(baseline, page(rect('A', { left: 30 }), rect('GONE', { left: 300 })), record);
  // Collaborator removes GONE and adds NEW; our release moves A once more.
  const withRemote = page(rect('A', { left: 30 }), rect('NEW', { left: 400 }));
  const release = page(rect('A', { left: 60 }), rect('NEW', { left: 400 }));
  collectAnnotationFieldTouches(withRemote, release, record);
  const step = restrictAnnotationHistoryActionFields(
    buildAnnotationHistoryAction({ pageNumber: 1, previousPage: baseline, nextPage: release }),
    record,
  );
  equal(step.type, 'fabric:update');
  const undone = applyAnnotationHistoryAction({ 1: release }, invertAnnotationHistoryAction(step));
  deepStrictEqual(objectsOf(undone).map((o) => [o.data.id, o.left]), [['A', 10], ['NEW', 400]]);
});

test('a gesture\'s own create and delete stay in its step', () => {
  const baseline = page(rect('A'));
  const record = createGestureTouchRecord();
  const release = page(rect('B', { left: 90 }));
  collectAnnotationFieldTouches(baseline, release, record);
  const step = restrictAnnotationHistoryActionFields(
    buildAnnotationHistoryAction({ pageNumber: 1, previousPage: baseline, nextPage: release }),
    record,
  );
  equal(step.type, 'fabric:batch');
  equal(step.created.length, 1);
  equal(step.deleted.length, 1);
  const undone = applyAnnotationHistoryAction({ 1: release }, invertAnnotationHistoryAction(step));
  deepStrictEqual(objectsOf(undone).map((o) => o.data.id), ['A']);
});

test('a drag dropped back where it started records no step, even if someone else edited the mark', () => {
  const baseline = page(rect('A'));
  const record = createGestureTouchRecord();
  collectAnnotationFieldTouches(baseline, page(rect('A', { left: 40 })), record);
  const withRemote = page(rect('A', { left: 40, stroke: '#00f' }));
  const release = page(rect('A', { left: 10, stroke: '#00f' }));
  collectAnnotationFieldTouches(withRemote, release, record);
  const raw = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: baseline, nextPage: release });
  equal(raw.type, 'fabric:update', 'the raw diff holds only the collaborator\'s stroke');
  equal(restrictAnnotationHistoryActionFields(raw, record), null);
});

// Fake measurer: one line per "\n"-separated line, fontSize * lineHeight each.
const measure = ({ text, fontSize, lineHeight }) => String(text).split('\n').length * fontSize * lineHeight;

test('text box: undoing a size change after someone added lines grows the box instead of clipping', () => {
  // Reviewer repro: font 12 -> 24 grows height 30 -> 44; collaborator types 4
  // more lines -> height 160; undo would leave {fontSize 12, height 30, 5 lines}.
  const small = textbox({ fontSize: 12, height: 30, text: 'one' });
  const big = textbox({ fontSize: 24, height: 44, text: 'one' });
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(small), nextPage: page(big) });
  const fiveLines = 'one\ntwo\nthree\nfour\nfive';
  const current = { 1: page(textbox({ fontSize: 24, height: 160, text: fiveLines })) };
  const options = { normalizeUpdatedObject: (object, { entry }) => normalizeMergedHistoryObject(object, entry.after, { measure }) };

  const [raw] = objectsOf(applyAnnotationHistoryAction(current, invertAnnotationHistoryAction(action)));
  equal(raw.height, 30, 'without the refit the merge clips the text');
  const [mark] = objectsOf(applyAnnotationHistoryAction(current, invertAnnotationHistoryAction(action), options));
  equal(mark.fontSize, 12);
  equal(mark.text, fiveLines);
  const needed = 5 * 12 * 1.16 * 1.13 + 12;
  ok(Math.abs(mark.height - needed) < 0.01, `box grew to fit: ${mark.height} vs ${needed}`);
});

test('text box: a merge that already matches its snapshot is never re-measured', () => {
  const merged = textbox({ height: 30 });
  equal(normalizeMergedHistoryObject(merged, clone(merged), { measure: () => 999 }), merged);
});

test('callout: an undone size change after someone added lines grows the box to fit', () => {
  const start = baseCallout();
  const small = project({ ...start, style: { ...start.style, fontSize: 12 }, textBoxHeight: 0.04 });
  const big = project({ ...start, style: { ...start.style, fontSize: 24 }, textBoxHeight: 0.06 });
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(small), nextPage: page(big) });
  const text = 'a\nb\nc\nd\ne';
  const current = { 1: page(project({ ...start, text, style: { ...start.style, fontSize: 24 }, textBoxHeight: 0.2 })) };
  const options = {
    normalizeUpdatedObject: (object, { pageNumber, entry }) => normalizeMergedHistoryObject(object, entry.after, { pageNumber, pageSize: PAGE_SIZE, measure }),
  };
  const [callout] = deriveCalloutsFromByPage(applyAnnotationHistoryAction(current, invertAnnotationHistoryAction(action), options));
  equal(callout.style.fontSize, 12);
  equal(callout.text, text);
  const needed = (5 * 12 * 1.13) / PAGE_SIZE.height;
  ok(Math.abs(callout.textBoxHeight - needed) < 1e-9, `grew to ${callout.textBoxHeight} (needed ${needed})`);
  deepStrictEqual(callout.knee, start.knee, 'the knee never moves');
});

test('text markup: range, quads, text and drawn box restore together; textRange is one field', () => {
  const markup = (start, end, left, width, text) => ({
    type: 'rect', left, top: 100, width, height: 12,
    fill: '#ffff00',
    data: { id: 'm1', type: 'text-markup', quads: [{ x1: left, x2: left + width }], selectedText: text, textRange: { start, end } },
  });
  const before = markup(10, 20, 50, 60, 'ten chars.');
  const after = markup(10, 30, 50, 120, 'twenty chars here..');
  const paths = diffAnnotationFields(before, after).map((c) => c.path.join('.')).sort();
  ok(paths.includes('data.textRange'), 'textRange travels whole');
  ok(!paths.includes('data.textRange.end'));
  ok(paths.includes('left') && paths.includes('top'), 'the linked drawn box is written with the range');

  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(before), nextPage: page(after) });
  // A collaborator recolours it and nudges its top in the meantime.
  const current = { 1: page({ ...after, fill: '#00ff00', top: 104 }) };
  const [mark] = objectsOf(applyAnnotationHistoryAction(current, invertAnnotationHistoryAction(action)));
  deepStrictEqual(mark.data.textRange, { start: 10, end: 20 });
  equal(mark.width, 60);
  equal(mark.top, 100, 'the drawn box follows the restored range');
  equal(mark.fill, '#00ff00', 'the colour is not part of the range');
});

test('polygon: points and position restore as one group; stroke stays independent', () => {
  const poly = { type: 'polygon', left: 10, top: 10, width: 20, height: 20, pathOffset: { x: 10, y: 10 }, points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 20 }], stroke: '#000', data: { id: 'p1' } };
  const moved = { ...poly, left: 60, top: 40 };
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(poly), nextPage: page(moved) });
  // A collaborator then drags a vertex (points + box + offset change together).
  const edited = { ...moved, left: 55, width: 25, pathOffset: { x: 12.5, y: 10 }, points: [{ x: -5, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 20 }], stroke: '#f00' };
  const [mark] = objectsOf(applyAnnotationHistoryAction({ 1: page(edited) }, invertAnnotationHistoryAction(action)));
  deepStrictEqual(
    { left: mark.left, top: mark.top, width: mark.width, pathOffset: mark.pathOffset, points: mark.points },
    { left: poly.left, top: poly.top, width: poly.width, pathOffset: poly.pathOffset, points: poly.points },
    'the geometry is restored whole, never half-shifted',
  );
  equal(mark.stroke, '#f00');
});

test('a key the undo adds back lands where the snapshot has it (key order kept)', () => {
  const before = { type: 'rect', left: 1, shadow: 'x', top: 2, data: { id: 'k1' } };
  const after = { type: 'rect', left: 1, top: 2, data: { id: 'k1' } };
  const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: page(before), nextPage: page(after) });
  const [mark] = objectsOf(applyAnnotationHistoryAction({ 1: page(clone(after)) }, invertAnnotationHistoryAction(action)));
  equal(JSON.stringify(mark), JSON.stringify(before));
});
