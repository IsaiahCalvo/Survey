// One-shot 'skip' saves must end their page's preview gesture (2026-09-23).
//
// Bug: the one-time embedded-PDF import saves as a live-preview frame
// (checkpointPolicy 'skip'), which leaves a pre-import page snapshot behind.
// The user's first ordinary edit on that page then diffed from BEFORE the
// import, so every imported mark was recorded as that edit's own create — and
// for the document owner, undoing the edit deleted every imported annotation
// on the page.
import test from 'node:test';
import { deepStrictEqual, equal, ok } from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyAnnotationHistoryAction,
  buildAnnotationHistoryAction,
  collectAnnotationFieldTouches,
  createGestureTouchRecord,
  endPagePreviewGesture,
  filterAnnotationHistoryActionByOwner,
  invertAnnotationHistoryAction,
  restrictAnnotationHistoryActionFields,
} from '../src/utils/annotationLocalHistory.js';

const OWNER = 'owner-1';
const rect = (id, overrides = {}) => ({ type: 'rect', left: 10, top: 10, width: 20, height: 20, stroke: '#000', data: { id, authorId: OWNER }, ...overrides });
const imported = (id) => ({ type: 'rect', left: 100, top: 100, width: 30, height: 30, pdfAnnotationId: id, data: { id } });

// The baseline rules of PDFViewer.handleSaveAnnotations, reduced to a model:
// a 'skip' save snapshots the page once (if none is held) and records no step;
// a normal save diffs from that snapshot (else the current page), records the
// step and drops the snapshot.
function makeViewer(initialPage) {
  const state = { page: initialPage, baselines: new Map(), touches: new Map(), undo: [] };
  state.save = (next, { checkpointPolicy = 'normal' } = {}) => {
    const key = '1';
    if (checkpointPolicy === 'skip' && !state.baselines.has(key)) {
      state.baselines.set(key, structuredClone(state.page));
    }
    const baseline = checkpointPolicy === 'skip' ? null : state.baselines.get(key) || null;
    const action = buildAnnotationHistoryAction({ pageNumber: 1, previousPage: baseline || state.page, nextPage: next });
    state.page = next;
    if (checkpointPolicy !== 'skip') {
      if (action) state.undo.push(action);
      state.baselines.delete(key);
    }
  };
  state.pressUndo = () => {
    const action = filterAnnotationHistoryActionByOwner(state.undo.pop(), OWNER, OWNER);
    state.page = applyAnnotationHistoryAction({ 1: state.page }, invertAnnotationHistoryAction(action))[1];
  };
  return state;
}

function importThenEditThenUndo({ endGestureAfterImport }) {
  const viewer = makeViewer({ objects: [rect('mine')] });
  // One-time embedded import, saved as a preview frame.
  viewer.save({ objects: [rect('mine'), imported('59R'), imported('63R')] }, { checkpointPolicy: 'skip' });
  if (endGestureAfterImport) endPagePreviewGesture(viewer.baselines, viewer.touches, 1);
  // The user's first ordinary edit on that page: move their own mark.
  viewer.save({ objects: [rect('mine', { left: 50 }), imported('59R'), imported('63R')] });
  const step = viewer.undo[viewer.undo.length - 1];
  viewer.pressUndo();
  return { step, page: viewer.page };
}

test('without ending the import\'s gesture, the owner\'s first undo deletes the imported marks (the bug)', () => {
  const { step, page } = importThenEditThenUndo({ endGestureAfterImport: false });
  equal(step.type, 'fabric:batch', 'the move step wrongly carries the imports as creates');
  equal(step.created.length, 2);
  deepStrictEqual(page.objects.map((o) => o.data.id), ['mine']);
});

test('import -> first edit -> undo keeps the imported marks once the import ends its gesture', () => {
  const { step, page } = importThenEditThenUndo({ endGestureAfterImport: true });
  equal(step.type, 'fabric:update', 'the step is only the move');
  deepStrictEqual(page.objects.map((o) => o.data.id), ['mine', '59R', '63R']);
  equal(page.objects[0].left, 10, 'the move is undone');
});

test('endPagePreviewGesture clears one page, or every page with no key', () => {
  const baselines = new Map([['1', {}], ['2', {}]]);
  const touches = new Map([['1', createGestureTouchRecord()], ['2', createGestureTouchRecord()]]);
  endPagePreviewGesture(baselines, touches, 1);
  deepStrictEqual([...baselines.keys()], ['2']);
  deepStrictEqual([...touches.keys()], ['2']);
  endPagePreviewGesture(baselines, touches);
  equal(baselines.size + touches.size, 0);
});

test('every one-shot skip save in the viewer ends its page gesture, and the history reset clears all', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const endsGesture = /\}\);\s*(?:\/\/[^\n]*\n\s*)*endPagePreviewGesture\(previewBaselineByPageRef\.current, gestureFieldTouchesByPageRef\.current, pageNumber\);/;
  for (const source of ['embedded-import-once', 'fix19:import-pdf-annotations', 'counter:series-delete']) {
    const at = viewer.indexOf(`source: '${source}'`);
    ok(at >= 0, `${source} save exists`);
    ok(endsGesture.test(viewer.slice(at, at + 900)), `${source} ends its page gesture right after saving`);
  }
  ok(
    /objectModifiedInteractionCheckpointRef\.current\.clear\(\);\s*endPagePreviewGesture\(previewBaselineByPageRef\.current, gestureFieldTouchesByPageRef\.current\);/.test(viewer),
    'the full-history reset clears every page\'s baseline and touch record',
  );
});

test('a mark deleted and re-added (same id) within one drag keeps its full change in the step', () => {
  const baseline = { objects: [rect('A')] };
  const record = createGestureTouchRecord();
  collectAnnotationFieldTouches(baseline, { objects: [] }, record);
  const release = { objects: [rect('A', { left: 80, stroke: '#f00' })] };
  collectAnnotationFieldTouches({ objects: [] }, release, record);
  const step = restrictAnnotationHistoryActionFields(
    buildAnnotationHistoryAction({ pageNumber: 1, previousPage: baseline, nextPage: release }),
    record,
  );
  ok(step, 'the step is not empty');
  equal(step.type, 'fabric:update');
  equal(step.fields, undefined, 'the whole change is kept');
  const undone = applyAnnotationHistoryAction({ 1: release }, invertAnnotationHistoryAction(step));
  deepStrictEqual(undone[1].objects[0], rect('A'));
});
