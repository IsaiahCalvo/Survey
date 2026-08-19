// src/utils/spacePdfPageRender.js
//
// KAL-445 — rendering a PDF page onto an OFF-SCREEN canvas for the "export a
// space" feature.
//
// Why this exists (the bug it fixes): pdf.js steps a `intent: 'display'` render
// forward with requestAnimationFrame. Browsers stop issuing animation frames
// whenever the window is hidden, minimised, or fully covered by another window
// — and an export renders to a canvas that is never in the document, so nothing
// else forces frames either. The render simply stops part-way and its promise
// NEVER settles: the export silently hangs with no file, no error, and nothing
// to retry. That is the worst possible failure mode for a paid feature.
//
// `intent: 'print'` is pdf.js's own off-screen path. It steps the identical
// render on microtasks instead of animation frames, so a space export finishes
// whether or not the app window is on screen. It also gets its own operator-list
// cache key, so an export can never contend with the on-screen viewer's render
// of the same page.
//
// The timeout is the safety net, not the fix. If a page render still fails to
// settle we cancel it and reject with a real error, because a visible failure
// the user can retry is far better than a screen that looks frozen and says
// nothing.

/**
 * How long a single page may take before the export gives up on it and reports
 * an error. Generous on purpose: a dense architectural sheet can legitimately
 * take many seconds, and a false failure on a slow machine would be its own bug.
 */
export const SPACE_PDF_PAGE_RENDER_TIMEOUT_MS = 60000;

/**
 * Render one pdf.js page onto an off-screen 2D context.
 *
 * @param {object} args
 * @param {{ render: Function }} args.page      pdf.js PDFPageProxy
 * @param {CanvasRenderingContext2D} args.canvasContext
 * @param {object} args.viewport                pdf.js page viewport
 * @param {number} [args.pageNumber]            1-based page number, for the error text
 * @param {number} [args.timeoutMs]
 * @returns {Promise<void>} resolves when the page is fully painted
 */
export async function renderPdfPageForExport({
  page,
  canvasContext,
  viewport,
  pageNumber = null,
  timeoutMs = SPACE_PDF_PAGE_RENDER_TIMEOUT_MS,
}) {
  const renderTask = page.render({
    canvasContext,
    viewport,
    // Off-screen render — see the file header. Must stay 'print': 'display'
    // makes this depend on animation frames the export will never receive.
    intent: 'print',
  });

  let timer = null;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        timer = null;
        try {
          renderTask.cancel?.();
        } catch (_cancelError) {
          // Cancelling is best-effort; the timeout error below is what matters.
        }
        reject(new Error(
          pageNumber == null
            ? `Timed out rendering a page for export after ${timeoutMs}ms.`
            : `Timed out rendering page ${pageNumber} for export after ${timeoutMs}ms.`
        ));
      }, timeoutMs);

      Promise.resolve(renderTask.promise).then(resolve, reject);
    });
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}
