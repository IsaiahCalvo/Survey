import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-hub-projects-file-search-reorder.spec.mjs
// Unique leftover after Hub Projects thin chrome (file Move/Copy / card
// reorder / Team write). File Search is the mobile-drill `Search files...`
// filter — not `Search projects...`. File-row reorder is `reorderFiles` —
// not project card `reorderProjects`. Do not invent a desktop file Search.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('ProjectsFolderTree file Search + file-row reorder are live local chrome', () => {
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /const \[fileSearch, setFileSearch\] = useState\(''\)/);
  assert.match(tree, /placeholder=\{mobileDrillProject \? 'Search files\.\.\.' : 'Search projects\.\.\.'\}/);
  assert.match(tree, /value=\{mobileDrillProject \? fileSearch : search\}/);
  assert.match(tree, /onChange=\{mobileDrillProject \? setFileSearch : setSearch\}/);
  assert.match(tree, /const q = fileSearch\.trim\(\)\.toLowerCase\(\)/);
  assert.match(tree, /return mobileDrillAllFiles\.filter\(\(d\) => \(d\.name \|\| ''\)\.toLowerCase\(\)\.includes\(q\)\)/);
  assert.match(tree, /No files match your search\./);
  assert.match(tree, /setFileSearch\(''\)/);
  assert.match(tree, /const reorderFiles = useCallback\(\(fromId, toId\) => \{/);
  assert.match(tree, /if \(fromId == null \|\| toId == null \|\| fromId === toId \|\| !open\) return/);
  assert.match(tree, /mergeProjectDocumentOrder\(/);
  assert.match(tree, /<SortableRearrangeList ids=\{openFiles\.map\(\(f\) => f\.id\)\} onReorder=\{reorderFiles\}>/);
  assert.match(tree, /<SortableRearrangeList ids=\{mobileDrillFiles\.map\(\(f\) => f\.id\)\} onReorder=\{reorderFiles\}>/);
  assert.doesNotMatch(tree, /placeholder="Search files\.\.\."/);
  assert.doesNotMatch(tree, /setCopyModeActive\(true\)/);
  assert.doesNotMatch(tree, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(tree, /__e2eProjectsFileSearch/);
});

test('HubPreview documentOrderByProject is session state unless workflowE2E', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /const handleProjectPreferencesChange = \(patch\) => \{/);
  assert.match(preview, /onProjectPreferencesChange=\{handleProjectPreferencesChange\}/);
  assert.match(preview, /\{ id: 'd1', name: 'SE-011 Security Shop Drawings\.pdf'/);
  assert.match(preview, /\{ id: 'd3', name: 'RFI-014 Lobby Camera Coverage\.pdf'/);
  assert.match(preview, /\{ id: 'd4', name: 'Door Hardware Schedule — A\.601\.pdf'/);
  assert.match(preview, /workflowE2E\s*\n\s*\? readWorkflowObject\(MOBILE_WORKFLOW_STORAGE_KEYS\.projectPreferences\)/);
  assert.match(preview, /if \(!workflowE2E\) return/);
  assert.doesNotMatch(preview, /createProjectInvite/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);

  const order = read('src/home/projectDocumentOrder.js');
  assert.match(order, /export function mergeProjectDocumentOrder/);
  assert.match(order, /documentOrderByProject:/);
  assert.match(order, /export function orderDocumentsByProject/);
});

test('File Search / reorderFiles are not project Search or card reorder replay', () => {
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /placeholder="Search projects\.\.\."/);
  assert.match(tree, /const reorderProjects = useCallback\(\(fromId, toId\) => \{/);
  assert.match(tree, /onProjectPreferencesChange\?\.\(\{ projectOrder: out\.map\(\(project\) => project\.id\) \}\)/);
  assert.match(tree, /const moveCopyFiles = useCallback\(async \(docIds, destId, mode\) => \{/);
  assert.doesNotMatch(tree, /lockDocument\(/);
  assert.doesNotMatch(tree, /kal49_lock_document/);
  assert.doesNotMatch(tree, /setCopyModeActive\(true\)/);

  const extras = read('debug/scenarios/e2e-hub-projects-extras.spec.mjs');
  assert.match(extras, /Search projects\.\.\./);
  assert.doesNotMatch(extras, /Search files\.\.\./);
  assert.doesNotMatch(extras, /reorderFiles/);

  const thin = read('debug/scenarios/e2e-hub-projects-thin-chrome.spec.mjs');
  assert.match(thin, /card reorder/);
  assert.match(thin, /projectRow\(page, TOWER\)\.locator\('\[title="Drag to rearrange"\]'\)/);
  assert.doesNotMatch(thin, /Search files\.\.\./);
  assert.doesNotMatch(thin, /reorderFiles/);
});
