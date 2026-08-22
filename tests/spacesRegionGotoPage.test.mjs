import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-spaces-region-goto-page.spec.mjs
// Unique leftover after Spaces region-row Hide/Show survey annotations:
// region-row Go to page (aria-label="Go to page N" / onNavigateToPage /
// handleNavigateToSpacePage). Distinct from thumbnail left-click
// (PagesPanel → resolvePageThumbnailClick → goToPage) and from the
// rail page-number input (commitPageInput).

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SpacesPanel region-row Go to page is distinct from thumbnail click and page input', () => {
  const panel = read('src/sidebar/SpacesPanel.jsx');
  const pillStart = panel.indexOf('className="region-page-pill region-page-pill-leading"');
  assert.ok(pillStart > 0, 'region-page-pill');
  const pill = panel.slice(pillStart, panel.indexOf('Region Overlay Toggle Switch', pillStart));
  assert.match(pill, /aria-label=\{`Go to page \$\{page\.pageId\}`\}/);
  assert.match(pill, /onNavigateToPage\?\.\(page\.pageId\)/);
  assert.doesNotMatch(pill, /commitPageInput/);
  assert.doesNotMatch(pill, /resolvePageThumbnailClick/);
  assert.doesNotMatch(pill, /__e2eSpaces/);
  assert.doesNotMatch(pill, /__navigateToPage/);

  const pages = read('src/sidebar/PagesPanel.jsx');
  assert.match(pages, /resolvePageThumbnailClick\(/);
  assert.match(pages, /onNavigateToPage\(action\.pageNumber\)/);
  assert.doesNotMatch(pages, /region-page-pill/);
  assert.doesNotMatch(pages, /Go to page \$\{page\.pageId\}/);
});

test('Spaces tab wires handleNavigateToSpacePage; Pages tab wires goToPage', () => {
  const sidebar = read('src/PDFSidebar.jsx');
  const spacesStart = sidebar.indexOf('<SpacesPanel');
  const spacesEnd = sidebar.indexOf('/>', sidebar.indexOf('onMobilePanelMetricsChange'));
  assert.ok(spacesStart > 0 && spacesEnd > spacesStart, 'SpacesPanel JSX');
  const spacesBlock = sidebar.slice(spacesStart, spacesEnd);
  assert.match(spacesBlock, /onNavigateToPage=\{onNavigateToSpacePage\}/);
  assert.doesNotMatch(spacesBlock, /onNavigateToPage=\{onNavigateToPage\}/);

  const pagesStart = sidebar.indexOf('<PagesPanel');
  const pagesEnd = sidebar.indexOf('/>', sidebar.indexOf('onPageDragStart'));
  const pagesBlock = sidebar.slice(pagesStart, pagesEnd);
  assert.match(pagesBlock, /onNavigateToPage=\{onNavigateToPage\}/);
  assert.doesNotMatch(pagesBlock, /onNavigateToSpacePage/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /onNavigateToPage: goToPage/);
  assert.match(viewer, /onNavigateToSpacePage: handleNavigateToSpacePage/);
  assert.match(viewer, /const commitPageInput = useCallback/);
});

test('handleNavigateToSpacePage bypasses active-space clamp and ignores invalid ids', () => {
  const viewer = read('src/PDFViewer.jsx');
  const start = viewer.indexOf('const handleNavigateToSpacePage = useCallback');
  assert.ok(start > 0, 'handleNavigateToSpacePage');
  const block = viewer.slice(start, viewer.indexOf('useEffect(() => () => {', start));
  assert.match(block, /coercePageNumber\(pageId, Number\.POSITIVE_INFINITY\)/);
  assert.match(block, /if \(!targetPage\) return;/);
  assert.match(block, /goToPage\(targetPage, \{ fallback: 'nearest', bypassActiveSpace: true \}\)/);
  assert.doesNotMatch(block, /commitPageInput/);
  assert.doesNotMatch(block, /resolvePageThumbnailClick/);
  assert.doesNotMatch(block, /__e2eSpaces/);
  assert.doesNotMatch(block, /file\.id/);
});
