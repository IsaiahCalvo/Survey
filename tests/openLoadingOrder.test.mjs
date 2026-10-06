// Owner 2026-10-04: one calm loading state, the page in view drawn first and
// only once, and no second loading screen after the first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { comparePageRasterPriority, createPageRasterQueue } from '../src/utils/pageRasterQueue.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const QUIET = read('../src/components/QuietLoading.jsx');
const CONTAINER = read('../src/components/PdfjsViewerContainer.jsx');
const VIEWER = read('../src/PDFViewer.jsx');
const SHELL = read('../src/AppShell.jsx');

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test('pages on screen draw before pages off screen, nearest the current page first', () => {
  const order = { isVisible: (i) => i <= 1, focusIndex: () => 0 };
  const sorted = [3, 2, 1, 0].sort((a, b) => comparePageRasterPriority(a, b, order));
  assert.deepEqual(sorted, [0, 1, 2, 3]);
  const midDocument = { isVisible: (i) => i === 5, focusIndex: () => 5 };
  assert.deepEqual([4, 6, 5, 7].sort((a, b) => comparePageRasterPriority(a, b, midDocument)), [5, 4, 6, 7]);
});

test('one page draws at a time, in order from the page in view', async () => {
  const queue = createPageRasterQueue({ isVisible: () => true, focusIndex: () => 0 });
  const started = [];
  const p1 = queue.request(0); p1.ready.then(() => started.push(1));
  const p3 = queue.request(2); p3.ready.then(() => started.push(3));
  const p2 = queue.request(1); p2.ready.then(() => started.push(2));
  await tick();
  assert.deepEqual(started, [1], 'only one page draws at a time');
  p1.release();
  await tick();
  assert.deepEqual(started, [1, 2]);
  p2.release(); p2.release();
  await tick();
  assert.deepEqual(started, [1, 2, 3], 'release is safe to call twice');
  p3.release();
  assert.equal(queue.activeIndex, null);
});

test('waiting pages are re-ordered by what is on screen when the turn frees up', async () => {
  let focus = 0;
  const queue = createPageRasterQueue({ isVisible: () => true, focusIndex: () => focus });
  const started = [];
  const a = queue.request(0); a.ready.then(() => started.push(0));
  const far = queue.request(9); far.ready.then(() => started.push(9));
  const near = queue.request(1); near.ready.then(() => started.push(1));
  await tick();
  focus = 9; // the reader jumped to page 10 while page 1 drew
  a.release();
  await tick();
  assert.deepEqual(started, [0, 9]);
  far.release(); near.release();
});

test('a page off screen gives way to a page on screen and can ask again', async () => {
  let visible = new Set([3]);
  const queue = createPageRasterQueue({ isVisible: (i) => visible.has(i), focusIndex: () => 0 });
  let stopped = 0;
  const off = queue.request(3, { onPreempt: () => { stopped += 1; } });
  await off.ready;
  visible = new Set([0]); // scrolled: page 4 left the screen, page 1 came in
  const on = queue.request(0);
  assert.equal(stopped, 1, 'the off-screen draw is asked to stop');
  assert.equal(off.preempted, true);
  let onStarted = false;
  on.ready.then(() => { onStarted = true; });
  await tick();
  assert.equal(onStarted, false, 'the turn is handed over only once the stopped draw lets go');
  off.release();
  await tick();
  assert.equal(onStarted, true);
  on.release();
});

// Review 9 / robust 10 item 3: `ready` resolves inside pump(), but the page
// creates its render task a microtask later. A page on screen that asked in
// that gap used to find nothing to cancel, so the off-screen page drew to the
// end while the page in view waited one full extra draw.
test('a page on screen that asks before an off-screen draw has begun goes first', async () => {
  // Same loop as PdfPageCanvas: request -> await ready -> (claim) -> draw.
  const run = async ({ claim }) => {
    let visible = new Set();
    const queue = createPageRasterQueue({ isVisible: (i) => visible.has(i), focusIndex: () => 0 });
    const log = [];
    const holder = async (index, ms) => {
      let task = null;
      for (;;) {
        const turn = queue.request(index, { onPreempt: () => task?.cancel() });
        await turn.ready;
        if (claim && !turn.claim()) { turn.release(); continue; }
        let cancelled = false;
        let finish;
        task = { cancel: () => { cancelled = true; finish(); } };
        log.push(`start ${index}`);
        await new Promise((resolve) => { finish = resolve; setTimeout(resolve, ms); });
        task = null;
        turn.release();
        if (cancelled) { log.push(`stopped ${index}`); continue; }
        log.push(`done ${index}`);
        return;
      }
    };
    // Every mounted page's effect runs in one batch: the off-screen page 3
    // wins the first turn, then (same task, before its continuation runs)
    // the page on screen asks.
    const off = holder(3, 40);
    visible = new Set([0]);
    const on = holder(0, 10);
    await Promise.all([off, on]);
    return log;
  };
  assert.deepEqual(await run({ claim: false }), ['start 3', 'done 3', 'start 0', 'done 0'], 'before: the page in view waited for the whole off-screen draw');
  assert.deepEqual(await run({ claim: true }), ['start 0', 'done 0', 'start 3', 'done 3'], 'after: the page in view draws first, page 3 asks again');
  // claim() is false once released, true for an untouched turn
  const queue = createPageRasterQueue();
  const t = queue.request(0);
  await t.ready;
  assert.equal(t.claim(), true);
  t.release();
  assert.equal(t.claim(), false);
  assert.match(CONTAINER, /if \(turn && !turn\.claim\(\)\) \{ turn\.release\(\); continue; \}/);
});

test('a page that unmounts while waiting leaves the line', async () => {
  const queue = createPageRasterQueue();
  const first = queue.request(0);
  const gone = queue.request(1);
  gone.release();
  assert.equal(queue.waitingCount, 0);
  first.release();
  assert.equal(queue.activeIndex, null);
});

test('the PDF engine draws through the queue and starts on Fit page', () => {
  assert.match(CONTAINER, /rasterQueue\.request\(pageIndex,/);
  assert.match(CONTAINER, /rasterQueue=\{rasterQueueRef\.current\}/);
  assert.match(CONTAINER, /visiblePageRangeRef\.current = \[visibleFirst, visibleLast\];\s*\n\s*rasterQueueRef\.current\?\.pump\(\);/);
  assert.match(CONTAINER, /mode: 'fitPage',\s*\n\s*pageW: firstSize\.w,/);
  assert.doesNotMatch(CONTAINER, /RASTERDBG/);
});

test('one quiet loading state: a short wait, one line of text, nothing spinning', async () => {
  const { resolveQuietLoadingDelay, continuesQuietLoading, openingLabel, QUIET_LOADING_SHOW_AFTER_MS } = await import('../src/components/QuietLoading.jsx')
    .catch(() => ({}));
  // The .jsx module needs a JSX loader under plain node; fall back to source checks.
  if (resolveQuietLoadingDelay) {
    assert.equal(QUIET_LOADING_SHOW_AFTER_MS, 300);
    assert.equal(resolveQuietLoadingDelay({ startedAtMs: 1000, nowMs: 1000 }), 300);
    assert.equal(resolveQuietLoadingDelay({ startedAtMs: 1000, nowMs: 1500 }), -200);
    assert.equal(continuesQuietLoading({ mounted: 1, lastGoneAtMs: -Infinity, nowMs: 0 }), true);
    assert.equal(continuesQuietLoading({ mounted: 0, lastGoneAtMs: 1000, nowMs: 1300 }), true);
    assert.equal(continuesQuietLoading({ mounted: 0, lastGoneAtMs: 1000, nowMs: 2000 }), false);
    assert.equal(openingLabel('Site plan.PDF'), 'Opening Site plan…');
    assert.equal(openingLabel(''), 'Opening…');
  }
  assert.match(QUIET, /export const QUIET_LOADING_SHOW_AFTER_MS = 300;/);
  assert.match(QUIET, /animationDelay: `\$\{delayMs\}ms`/);
  assert.doesNotMatch(QUIET, /animation:[^;]*infinite|import Spinner|role="progressbar"/);
  assert.match(VIEWER, /<QuietLoading label=\{openingLabel\(pdfFile\?\.name\)\} \/>/);
  assert.doesNotMatch(VIEWER, /Loading PDF\.\.\./);
  assert.match(SHELL, /<Suspense fallback=\{<QuietLoading label=\{openingLabel\(tab\.file\?\.name\)\}/);
  assert.doesNotMatch(SHELL, /Loading document\.\.\./);
  assert.match(CONTAINER, /<QuietLoading \/>/);
  assert.doesNotMatch(CONTAINER, /\n\s*Loading…\n/);
});

test('the project data read starts with the PDF download, not after it', () => {
  assert.match(VIEWER, /const surveyDataBlobPromise = pdfFile\.projectId/);
  assert.match(VIEWER, /await loadSurveyDataFromSupabase\(pdfFile, surveyDataBlobPromise\);/);
  assert.match(VIEWER, /prefetchedDataBlob !== undefined\s*\n\s*\? await prefetchedDataBlob/);
});
