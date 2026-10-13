// Coalesces the progressive page-sizing results of a document open into a
// few React commits.
//
// PDFViewer measures page sizes in small batches as a document opens (two
// pages per batch on a 4-core phone: ~60 batches for a 120-page file). It
// used to commit pageHeights/pageSizes/pageObjects after every batch, and each
// of those commits re-ran PDFViewer effects that set state again (annotation
// re-projection, tool bar / side panel publishing, the Excel link check). In
// WebKit (iPhone) that became a chain of 50+ back-to-back effect updates and
// React warned "Maximum update depth exceeded" on open. Committing at most
// once per interval (and once at the end) keeps the same final state with a
// handful of commits.
export const PAGE_SIZE_COMMIT_INTERVAL_MS = 250;

const defaultNow = () => (typeof performance !== 'undefined' && typeof performance.now === 'function'
  ? performance.now()
  : Date.now());

/**
 * @param {object} options
 * @param {(batch: { heights: object, sizes: object, pages: object }) => void} options.commit
 * @param {() => number} [options.now]
 * @param {number} [options.intervalMs]
 */
export function createPageSizeCommitBatcher({ commit, now = defaultNow, intervalMs = PAGE_SIZE_COMMIT_INTERVAL_MS }) {
  let heights = {};
  let sizes = {};
  let pages = {};
  let pendingCount = 0;
  let lastCommitAt = now();

  const flush = () => {
    if (pendingCount === 0) return false;
    const batch = { heights, sizes, pages };
    heights = {};
    sizes = {};
    pages = {};
    pendingCount = 0;
    lastCommitAt = now();
    commit(batch);
    return true;
  };

  const add = (batchHeights, batchSizes, batchPages) => {
    Object.assign(heights, batchHeights);
    Object.assign(sizes, batchSizes);
    Object.assign(pages, batchPages);
    pendingCount += Object.keys(batchSizes || {}).length;
    if (now() - lastCommitAt >= intervalMs) return flush();
    return false;
  };

  return {
    add,
    flush,
    get pendingCount() { return pendingCount; },
  };
}
