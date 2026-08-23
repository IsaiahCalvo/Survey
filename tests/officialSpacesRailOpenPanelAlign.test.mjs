import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Official leftover after overlay-mount align (`0e812b9f` / `5b7114de`).
// Search/Bookmarks/Pages leftover contracts already require openPanel(tab.id).
// spacesRailToggle still required the pre-openPanel collapsed click
// setIsCollapsed(false) + setActiveTab(tab.id) — official fail 1 / 4.
// Distinct from leftover-18 / overlay-mount / dismiss-family / Home `?` /
// Spaces rail-toggle product replay / isolated 8448.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('live collapsed and expanded rail tabs call openPanel(tab.id)', () => {
  const sidebar = read('src/PDFSidebar.jsx');
  assert.match(sidebar, /const openPanel = useCallback/);
  assert.match(sidebar, /setIsCollapsed\(false\);\s*setActiveTab\(validPanel\)/);
  assert.match(sidebar, /if \(validPanel === 'search' && focus\) \{/);

  const collapsed = sidebar.slice(sidebar.indexOf('Collapsed State'));
  assert.match(collapsed, /openPanel\(tab\.id\)/);
  assert.doesNotMatch(collapsed, /setIsCollapsed\(false\);\s*setActiveTab\(tab\.id\)/);

  const expanded = sidebar.slice(sidebar.indexOf('Tab Navigation'), sidebar.indexOf('Collapsed State'));
  assert.match(expanded, /openPanel\(tab\.id\)/);
  assert.doesNotMatch(expanded, /setActiveTab\(tab\.id\);/);
});

test('leftover official spacesRailToggle no longer requires the pre-openPanel click', () => {
  const leftover = read('tests/spacesRailToggle.test.mjs');
  assert.match(leftover, /openPanel\\\(tab\\\.id\\\)/);
  assert.match(leftover, /collapsed Spaces must use openPanel after the Search focus-token SHA/);
  assert.match(leftover, /expanded Spaces tab must also route through openPanel/);
  assert.doesNotMatch(leftover, /assert\.match\(collapsed, \/setIsCollapsed\\\(false\\\)\/\)/);
  assert.doesNotMatch(leftover, /assert\.match\(collapsed, \/setActiveTab\\\(tab\\\.id\\\)\/\)/);
  assert.doesNotMatch(leftover, /assert\.match\(expanded, \/setActiveTab\\\(tab\\\.id\\\)\/\)/);
});
