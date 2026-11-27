import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('PDFSidebar defers SearchTextPanel until Search opens and guards lazy chunks (#1819)', () => {
  const sidebarSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/PDFSidebar.jsx'),
    'utf8',
  );
  assert.match(sidebarSrc, /const SearchTextPanel = safeLazyPanel\(/);
  assert.match(sidebarSrc, /const MarkLibraryPanel = safeLazyPanel\(/);
  assert.match(sidebarSrc, /\{\(searchPanelMounted \|\| activeTab === 'search'\) && \(/);
  assert.match(sidebarSrc, /<SidebarPanelErrorBoundary label="Search">/);
  assert.match(sidebarSrc, /<SidebarPanelErrorBoundary label="Mark library">/);
});

test('lazyPanel guards undefined / rejecting dynamic imports without throwing undefined.default (#1819)', () => {
  const helperSrc = fs.readFileSync(
    path.resolve(process.cwd(), 'src/sidebar/lazyPanel.jsx'),
    'utf8',
  );
  assert.match(helperSrc, /if \(mod && typeof mod\.default !== 'undefined' && mod\.default !== null\)/);
  assert.match(helperSrc, /return \{ default: Fallback \};/);
  assert.match(helperSrc, /class SidebarPanelErrorBoundary/);
});
