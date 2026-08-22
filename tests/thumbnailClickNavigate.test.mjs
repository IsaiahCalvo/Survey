import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { coercePageNumber } from '../src/utils/bookmarkPageIds.js';
import { resolvePageThumbnailClick } from '../src/sidebar/pagesPanelUtils.js';

// Thumbnail left-click is its own navigate path (PagesPanel onClick →
// resolvePageThumbnailClick → onNavigateToPage / goToPage).
// V-06 / UL-07 "jump page 3" was the rail page *input* (commitPageInput).
// Live proof: debug/scenarios/e2e-thumbnail-click.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('thumbnail click navigate is not the page-input coerce path', () => {
  assert.deepEqual(
    resolvePageThumbnailClick({ pageNumber: 3, numPages: 120 }),
    { kind: 'navigate', pageNumber: 3 },
  );
  assert.equal(coercePageNumber(3, 120), 3);

  // Same numeric outcome for a valid page — different reject shape.
  assert.deepEqual(
    resolvePageThumbnailClick({ pageNumber: 0, numPages: 120 }),
    { kind: 'ignore' },
  );
  assert.equal(coercePageNumber(0, 120), null);

  assert.deepEqual(
    resolvePageThumbnailClick({ pageNumber: 99, numPages: 1 }),
    { kind: 'ignore' },
  );
  assert.equal(coercePageNumber(99, 1), null);

  // 1-page thumb still navigates to itself (re-click stay).
  assert.deepEqual(
    resolvePageThumbnailClick({ pageNumber: 1, numPages: 1 }),
    { kind: 'navigate', pageNumber: 1 },
  );

  // Mobile select-mode is not a jump (desktop rail never uses this).
  assert.deepEqual(
    resolvePageThumbnailClick({
      pageNumber: 4,
      numPages: 120,
      mobileMode: true,
      mobileSelectMode: true,
    }),
    { kind: 'toggle-select', pageNumber: 4 },
  );
});

test('PagesPanel click wires onNavigateToPage; page input uses commitPageInput', () => {
  const panel = read('src/sidebar/PagesPanel.jsx');
  assert.match(panel, /resolvePageThumbnailClick\(/);
  assert.match(panel, /onClick=\{\(\) => handlePageClick\(pageNumber\)\}/);
  assert.match(panel, /onNavigateToPage\(action\.pageNumber\)/);
  assert.match(panel, /onDoubleClick=\{\(\) => handlePageDoubleClick\(pageNumber\)\}/);
  assert.doesNotMatch(panel, /commitPageInput/);
  assert.doesNotMatch(panel, /coercePageNumber/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /onNavigateToPage: goToPage/);
  assert.match(viewer, /const commitPageInput = useCallback/);
  assert.match(viewer, /value >= 1 && value <= numPages/);
  assert.match(viewer, /Reset to current pageNum if invalid/);

  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /onNavigateToPage=\{onNavigateToPage\}/);
});
