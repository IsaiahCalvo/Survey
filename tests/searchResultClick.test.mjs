import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for the Search result-row click cluster.
// Live proof is debug/scenarios/e2e-search-result-click.spec.mjs.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SearchTextPanel result rows click through navigateToMatch', () => {
  const panel = read('src/sidebar/SearchTextPanel.jsx');

  assert.match(panel, /data-result-index=\{index\}/);
  assert.match(panel, /onClick=\{\(\) => onSelect\(result, index\)\}/);
  assert.match(panel, /const handleResultClick = useCallback\(\(result, index\) => \{\s*\n\s*navigateToMatch\(index\);/);
  assert.match(panel, /<SearchResultRow/);
  assert.match(panel, /onSelect=\{handleResultClick\}/);
  assert.match(panel, /if \(index < 0 \|\| index >= searchResults\.length\) return;/);
  assert.match(panel, /onNavigateToMatch\(result, index\)/);
  assert.match(panel, /querySelector\(`\[data-result-index="\$\{currentMatchIndex\}"\]`\)/);
  assert.doesNotMatch(panel, /caseSensitive|matchCase|Match case/);
  assert.doesNotMatch(panel, /new RegExp\(/);
});

test('PDFViewer match nav updates index and ignores only the busy same-flight', () => {
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const navigateToMatch = useCallback\(\(match, index\) => \{/);
  assert.match(viewer, /if \(!match \|\| !containerRef\.current\) return;/);
  assert.match(viewer, /isNavigatingToMatchRef\.current/);
  assert.match(viewer, /app_match_navigation_ignored_busy/);
  assert.match(viewer, /const handleCurrentMatchIndexChange = useCallback\(\(index\) => \{/);
  assert.match(viewer, /onNavigateToMatch: navigateToMatch/);
  assert.match(viewer, /onCurrentMatchIndexChange: handleCurrentMatchIndexChange/);
});
