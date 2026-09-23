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
  const touches = new Map();
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

test('owner filtering keeps the field list, and foreign updates stay filtered out', () => {
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
  equal(filterAnnotationHistoryActionByOwner(action, 'user-b'), null);

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
  const touches = new Map();
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
