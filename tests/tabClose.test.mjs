import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-tab-close.spec.mjs
// Unique leftover after Documents Open file.
// Desktop TabBar Close tab is handleTabClose — not Home click
// (returnToDevHubPreview) and not 390 Back.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('TabBar Close tab is a named button on PDF tabs only', () => {
  const tabBar = read('src/TabBar.jsx');
  assert.match(tabBar, /aria-label="Close tab"/);
  assert.match(tabBar, /title="Close tab"/);
  assert.match(tabBar, /type="button"/);
  assert.match(tabBar, /const handleTabCloseClick = \(e\) => \{/);
  assert.match(tabBar, /onTabClose\(tab\.id\);/);
  assert.match(tabBar, /Home tab is pinned/);
  assert.match(tabBar, /\{!isHome && \(/);
  assert.doesNotMatch(tabBar, /returnToDevHubPreview/);
  assert.doesNotMatch(tabBar, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(tabBar, /__e2eTabClose/);
  assert.doesNotMatch(tabBar, /setCopyModeActive\(true\)/);
});

test('AppShell Close tab does not use returnToDevHubPreview; Home / Back do', () => {
  const shell = read('src/AppShell.jsx');
  assert.match(shell, /const handleTabClose = \(tabId\) => \{/);
  assert.match(shell, /if \(tabId === HOME_TAB_ID\) return;/);
  assert.match(shell, /setCurrentView\('dashboard'\)/);
  assert.match(shell, /onTabClose=\{handleTabClose\}/);
  assert.match(shell, /\{tabs\.length > 0 && !isNarrowShell && \(/);
  assert.match(shell, /const handleBack = \(\) => \{/);
  assert.match(shell, /if \(returnToDevHubPreview\(\)\) return;/);

  const closeFn = shell.slice(shell.indexOf('const handleTabClose'), shell.indexOf('const handleTabReorder'));
  assert.doesNotMatch(closeFn, /returnToDevHubPreview/);

  const homeClick = shell.slice(shell.indexOf('const handleTabClick'), shell.indexOf('const handleViewStateChange'));
  assert.match(homeClick, /if \(tab\.isHome\) \{/);
  assert.match(homeClick, /if \(returnToDevHubPreview\(\)\) return;/);
});

test('Close tab is not Documents Open file and not leftover-18 Upload', () => {
  const docsOpen = read('debug/scenarios/e2e-hub-docs-open-file.spec.mjs');
  assert.match(docsOpen, /returnTab=documents/);
  assert.match(docsOpen, /Open file/);
  assert.doesNotMatch(docsOpen, /handleTabClose/);
  assert.doesNotMatch(docsOpen, /Close tab/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /const handleUpload = \(projectId = null\) => \{/);
  assert.match(preview, /if \(!workflowE2E\) \{/);
  assert.doesNotMatch(preview, /handleTabClose/);

  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /const \[mobileProjectLayout, setMobileProjectLayout\] = useState\('drill'\)/);
  assert.doesNotMatch(tree, /setMobileProjectLayout\(/);
});
