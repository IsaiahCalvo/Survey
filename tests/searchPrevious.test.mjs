import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for the Search Previous remainder.
// Live proof is debug/scenarios/e2e-search-previous.spec.mjs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SearchTextPanel Previous wraps, is literal, and has no case-toggle', () => {
  const panel = read('src/sidebar/SearchTextPanel.jsx');

  assert.match(panel, /aria-label="Previous match \(Shift\+Enter\)"/);
  assert.match(panel, /const goToPrevMatch = useCallback/);
  assert.match(panel, /currentMatchIndex > 0\s*\n\s*\? currentMatchIndex - 1\s*\n\s*: searchResults\.length - 1/);
  assert.match(panel, /if \(searchResults\.length === 0\) return;/);
  assert.match(panel, /normalizedQuery = trimmedQuery\.toLowerCase\(\)/);
  assert.match(panel, /normalizedText\.indexOf\(normalizedQuery\)/);
  assert.doesNotMatch(panel, /new RegExp\(/);
  assert.doesNotMatch(panel, /caseSensitive|matchCase|Match case/);
  assert.match(panel, /searchResults\.length > 0 && \(/);
  assert.match(panel, /if \(e\.shiftKey\) \{\s*\n\s*goToPrevMatchRef\.current\(\);/);
  assert.match(panel, /if \(e\.key === 'Escape' && isInputFocused\)/);
  assert.match(panel, /onClick=\{clearSearch\}/);
  assert.match(panel, /setSearchResults\(\[\], 'empty-query'\)/);
  assert.match(panel, /onClearTextSearch\?\.\(\)/);
});

test('highlight layer exposes count/active; clear cancels the viewer search', () => {
  const layer = read('src/components/SearchHighlightLayer.jsx');
  assert.match(layer, /data-search-highlight-layer=\{pageNumber\}/);
  assert.match(layer, /data-search-highlight-count=\{preparedHighlights\.length\}/);
  assert.match(layer, /data-search-highlight-active=\{activeMatchId \|\| ''\}/);

  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const handleClearTextSearch = useCallback/);
  assert.match(viewer, /pdfjsViewerRef\.current\?\.cancelTextSearch\?\.\(\)/);
  assert.match(viewer, /onClearTextSearch: handleClearTextSearch/);
});
