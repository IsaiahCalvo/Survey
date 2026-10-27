// Open speed: the "unsaved annotations" check compared the whole page map
// against the saved copy on every change. While a 3,000-mark document reopens,
// the marks are rebuilt five times with equal content and fresh objects, so
// each compare walked every mark (~60 ms each, ~300 ms in all, as long tasks).
// A rebuild that shares no page with the saved copy is now compared a page at
// a time in idle slices, and a newer change drops it. An edit keeps its
// untouched pages and answers at once. Quit asks for the answer at once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { jsonEqual, jsonEqualSteps } from '../src/utils/jsonEqual.js';

const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const start = viewer.indexOf('useEffect(', viewer.indexOf('// Mark annotations as dirty when they change'));
const end = viewer.indexOf('\n  }, [pdfId, annotationsByPage, onUnsavedAnnotationsChange', start);
assert.ok(start > 0 && end > start, 'test the real viewer effect');
const effectSource = viewer.slice(start + 'useEffect('.length, end + '\n  }'.length);
const inputs = ['pdfId', 'annotationsByPage', 'savedAnnotationsByPageRef', 'pendingUnsavedCheckRef',
  'checkedByPageRef', 'waitingByPageRef', 'cloudSyncKeyRef',
  'cloudSyncStatus', 'cloudSyncQueueSize', 'cloudSyncEnabled', 'pdfFile', 'isCloudSaveConfirmed', 'jsonEqual',
  'jsonEqualSteps', 'setHasUnsavedAnnotations', 'onUnsavedAnnotationsChange', 'requestIdleCallback',
  'cancelIdleCallback', 'performance'];
const makeEffect = new Function(...inputs, `return (${effectSource});`);

function viewerHarness(saved, { msPerPage = 0 } = {}) {
  const idle = new Map();
  let nextIdle = 1;
  let clock = 0;
  const state = { fullWalks: 0, pagesCompared: 0, slices: 0, dirty: false, reports: [] };
  const refs = {
    saved: { current: saved }, pending: { current: null }, checked: { current: null }, waiting: { current: null },
    syncKey: { current: null },
  };
  let cleanup = null;
  const render = (annotationsByPage) => {
    if (cleanup) cleanup();
    const effect = makeEffect('doc', annotationsByPage, refs.saved, refs.pending, refs.checked, refs.waiting, refs.syncKey,
      'idle', 0, false, null, () => false,
      (a, b) => { state.fullWalks += 1; return jsonEqual(a, b); },
      function* counted(a, b) {
        const steps = jsonEqualSteps(a, b);
        for (;;) {
          const step = steps.next();
          if (step.done) return step.value;
          state.pagesCompared += 1;
          clock += msPerPage;
          yield;
        }
      },
      (value) => { state.dirty = value; }, (value) => state.reports.push(value),
      (fn) => { idle.set(nextIdle, fn); return nextIdle++; }, (id) => idle.delete(id),
      { now: () => clock });
    cleanup = effect();
  };
  const runIdle = () => {
    while (idle.size) {
      const [id, fn] = idle.entries().next().value;
      idle.delete(id);
      state.slices += 1;
      fn();
    }
  };
  // The viewer loads the saved marks first, then the open's rebuilds follow.
  render(saved);
  Object.assign(state, { fullWalks: 0, reports: [] });
  return { state, refs, render, runIdle, idle, unmount: () => cleanup?.() };
}

const marks = (n, tag = 'a') => Object.fromEntries(Array.from({ length: n }, (_, page) =>
  [String(page + 1), [{ id: `${tag}${page}`, type: 'ink', points: [[page, 1], [2, 3]] }]]));

test('fresh rebuilds with equal content wait for idle, and only the newest is compared', () => {
  const h = viewerHarness(marks(240));
  for (let i = 0; i < 5; i += 1) h.render(marks(240));
  assert.equal(h.state.fullWalks + h.state.pagesCompared, 0, 'no walk while the document opens');
  assert.equal(h.idle.size, 1, 'older waiting compares are dropped');
  h.runIdle();
  assert.equal(h.state.fullWalks, 0);
  assert.equal(h.state.pagesCompared, 240);
  assert.deepEqual(h.state.reports, [false]);
  assert.equal(h.state.dirty, false);
  assert.equal(h.refs.pending.current, null);
});

test('an edit right after a rebuild is checked at once, even while the rebuild still waits', () => {
  const h = viewerHarness(marks(240));
  const rebuilt = marks(240);
  h.render(rebuilt);
  assert.equal(h.state.reports.length, 0, 'the rebuild waits');
  h.render({ ...rebuilt, 7: [...rebuilt[7], { id: 'new', type: 'rect' }] });
  assert.deepEqual(h.state.reports, [true], 'the edit is reported at once');
  assert.equal(h.state.dirty, true);
  assert.equal(h.idle.size, 0, 'the rebuild compare was dropped');
});

test('a re-run for the same marks (a sync status change) keeps waiting instead of walking at once', () => {
  const h = viewerHarness(marks(240));
  const rebuilt = marks(240);
  h.render(rebuilt);
  h.render(rebuilt);
  h.render(rebuilt);
  assert.equal(h.state.fullWalks + h.state.pagesCompared, 0);
  h.runIdle();
  assert.deepEqual(h.state.reports, [false]);
});

test('marks found equal become the saved copy, so a later edit compares only its own pages', () => {
  const h = viewerHarness(marks(240));
  const rebuilt = marks(240);
  h.render(rebuilt);
  h.runIdle();
  assert.equal(h.refs.saved.current, rebuilt);
  const edit = { ...rebuilt, 7: [...rebuilt[7], { id: 'new', type: 'rect' }] };
  h.render(edit);
  assert.deepEqual(h.state.reports, [false, true]);

  const changed = viewerHarness(marks(240));
  const before = changed.refs.saved.current;
  changed.render(marks(240, 'b'));
  changed.runIdle();
  assert.equal(changed.refs.saved.current, before, 'marks that differ never become the saved copy');
});

test('a big compare is spread over idle slices of about 8 ms', () => {
  const h = viewerHarness(marks(240), { msPerPage: 1 });
  h.render(marks(240));
  h.runIdle();
  assert.ok(h.state.slices >= 20 && h.state.slices <= 40, `slices: ${h.state.slices}`);
  assert.deepEqual(h.state.reports, [false]);
});

test('a rebuild that changed something still reports unsaved once idle', () => {
  const h = viewerHarness(marks(240));
  h.render(marks(240, 'b'));
  h.runIdle();
  assert.deepEqual(h.state.reports, [true]);
  assert.equal(h.state.dirty, true);
});

test('if the saved copy moves while a compare is under way, it compares against the new one', () => {
  const next = marks(240);
  const h = viewerHarness({ ...marks(240), 240: [] }, { msPerPage: 1 });
  h.render(next);
  const [id, first] = h.idle.entries().next().value;
  h.idle.delete(id);
  first();
  assert.equal(h.state.reports.length, 0, 'still under way');
  h.refs.saved.current = next;
  h.runIdle();
  assert.deepEqual(h.state.reports, [false]);
});

test('an edit keeps its untouched pages and answers at once', () => {
  const saved = marks(240);
  const h = viewerHarness(saved);
  h.render({ ...saved, 7: [...saved[7], { id: 'new', type: 'rect' }] });
  assert.equal(h.idle.size, 0);
  assert.deepEqual(h.state.reports, [true]);
  assert.equal(h.state.dirty, true);

  const one = viewerHarness({ 1: [] });
  one.render({ 1: [{ id: 'only page' }] });
  assert.deepEqual(one.state.reports, [true], 'a one-page document never waits');
});

test('a compare under way can be answered at once (quit asks for it), and unmount drops it', () => {
  const h = viewerHarness(marks(10));
  h.render(marks(10, 'b'));
  assert.equal(typeof h.refs.pending.current, 'function');
  assert.equal(h.refs.pending.current(), true);
  assert.equal(h.refs.pending.current, null);

  const gone = viewerHarness(marks(10));
  gone.render(marks(10, 'b'));
  gone.unmount();
  assert.equal(gone.idle.size, 0);
  assert.equal(gone.refs.pending.current, null);
});

test('jsonEqualSteps gives the same answer as jsonEqual', () => {
  const finish = (steps) => { for (;;) { const step = steps.next(); if (step.done) return step.value; } };
  const cases = [
    [marks(3), marks(3)], [marks(3), marks(3, 'b')], [marks(3), marks(4)], [{ a: 1, b: 2 }, { b: 2, a: 1 }],
    [{ a: undefined, b: 1 }, { b: 1 }], [{ a: () => 1 }, {}], [[1, 2], [1, 2]], [null, {}], [1, 1], [{ t: { toJSON: () => 1 } }, { t: 1 }],
  ];
  for (const [a, b] of cases) assert.equal(finish(jsonEqualSteps(a, b)), JSON.stringify(a) === JSON.stringify(b), JSON.stringify([a, b]));
});
