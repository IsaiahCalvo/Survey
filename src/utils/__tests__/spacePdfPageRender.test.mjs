import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderPdfPageForExport,
  SPACE_PDF_PAGE_RENDER_TIMEOUT_MS,
} from '../spacePdfPageRender.js';

// KAL-445 — "exporting a space appears to hang the app".
//
// The space PDF export renders every assigned page onto an off-screen canvas.
// pdf.js drives a `intent: 'display'` render forward with requestAnimationFrame,
// and a browser stops issuing animation frames whenever the window is hidden,
// minimised or covered. An off-screen canvas never forces frames either, so the
// render stopped part-way and its promise never settled: the export hung
// forever with no file, no error and no message.
//
// `fakePdfPage` below models exactly that pdf.js behaviour: a 'display' render
// only completes when an animation frame is delivered, a 'print' render steps
// itself on microtasks. The test harness deliberately never delivers a frame,
// which is what a backgrounded window looks like.

function fakePdfPage({ deliverFrames = false } = {}) {
  const calls = [];
  return {
    calls,
    render(params) {
      calls.push(params);
      let cancelled = false;
      const promise = new Promise((resolve, reject) => {
        if (params.intent === 'print') {
          // pdf.js steps print-intent renders on microtasks — always runs.
          Promise.resolve().then(() => {
            if (!cancelled) resolve();
          });
          return;
        }
        // Display intent: only completes if an animation frame arrives.
        if (deliverFrames) {
          setTimeout(() => {
            if (!cancelled) resolve();
          }, 0);
        }
        // deliverFrames === false: never settles, exactly like the bug.
        void reject;
      });
      return {
        promise,
        cancel() {
          cancelled = true;
        },
      };
    },
  };
}

test('space export renders with print intent so it does not depend on animation frames', async () => {
  const page = fakePdfPage();
  const canvasContext = {};
  const viewport = { width: 595, height: 842 };

  await renderPdfPageForExport({ page, canvasContext, viewport, pageNumber: 1 });

  assert.equal(page.calls.length, 1);
  assert.equal(
    page.calls[0].intent,
    'print',
    'display intent would stall forever on a window that is not producing animation frames'
  );
  assert.equal(page.calls[0].canvasContext, canvasContext);
  assert.equal(page.calls[0].viewport, viewport);
});

test('a page render that never settles fails with a clear error instead of hanging', async () => {
  // A page whose render promise never settles at all — the shape of the
  // original freeze. The export must surface an error, not wait forever.
  let cancelCount = 0;
  const page = {
    render() {
      return {
        promise: new Promise(() => {}),
        cancel() { cancelCount += 1; },
      };
    },
  };

  await assert.rejects(
    renderPdfPageForExport({
      page,
      canvasContext: {},
      viewport: {},
      pageNumber: 4,
      timeoutMs: 25,
    }),
    (error) => {
      assert.match(error.message, /Timed out rendering page 4 for export/);
      return true;
    }
  );
  assert.equal(cancelCount, 1, 'the stalled render task must be cancelled, not left running');
});

test('a page render failure is propagated rather than swallowed', async () => {
  const page = {
    render() {
      return {
        promise: Promise.reject(new Error('bad xref')),
        cancel() {},
      };
    },
  };

  await assert.rejects(
    renderPdfPageForExport({ page, canvasContext: {}, viewport: {}, pageNumber: 2 }),
    /bad xref/
  );
});

test('the per-page timeout is generous enough not to fail a slow real page', () => {
  // A dense architectural sheet can legitimately take several seconds; a tight
  // budget here would turn the safety net into its own bug.
  assert.ok(SPACE_PDF_PAGE_RENDER_TIMEOUT_MS >= 30000);
});
