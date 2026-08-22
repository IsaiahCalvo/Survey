import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-hub-projects-file-delete.spec.mjs
// Unique leftover after Hub Projects file Search + file-row reorder.
// File More/Select Delete is `deleteFiles` — not project delete, not
// file More Copy/Paste. Immediate (no ConfirmModal). Host-backed in
// hubPreview; session-only unless workflowE2E.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('ProjectsFolderTree deleteFiles is live local chrome on More and Select', () => {
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /const deleteFiles = useCallback\(\(docIds\) => \{/);
  assert.match(tree, /const targets = pickByIds\(openFiles, docIds\)/);
  assert.match(tree, /if \(targets\.length === 0\) return/);
  assert.match(tree, /if \(onDeleteDocuments\) \{/);
  assert.match(tree, /onDeleteDocuments\(targets\)/);
  assert.match(tree, /setLocalDocs\(\(prev\) => prev\.filter\(\(d\) => !ids\.has\(d\.id\)\)\)/);
  assert.match(tree, /setSelFiles\(new Set\(\)\)/);
  assert.match(tree, /\{ label: 'Delete', danger: true, onClick: \(\) => deleteFiles\(\[fileMenu\.id\]\) \}/);
  assert.match(tree, /onClick=\{\(\) => deleteFiles\(selectedFiles\.map\(\(f\) => f\.id\)\)\}/);
  assert.match(tree, /title="Delete"/);
  assert.doesNotMatch(tree, /ConfirmModal/);
  assert.doesNotMatch(tree, /Are you sure/);
  assert.doesNotMatch(tree, /setCopyModeActive\(true\)/);
  assert.doesNotMatch(tree, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(tree, /__e2eProjectsFileDelete/);
  assert.match(tree, /const \[mobileProjectLayout, setMobileProjectLayout\] = useState\('drill'\)/);
  assert.doesNotMatch(tree, /setMobileProjectLayout\(/);
});

test('HubPreview handleDelete is session state unless workflowE2E', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /const handleDelete = \(docs\) => \{/);
  assert.match(preview, /setDocuments\(\(prev\) => prev\.filter\(\(d\) => !ids\.has\(d\.id\)\)\)/);
  assert.match(preview, /onDeleteDocuments=\{handleDelete\}/);
  assert.match(preview, /\{ id: 'd1', name: 'SE-011 Security Shop Drawings\.pdf'/);
  assert.match(preview, /\{ id: 'd3', name: 'RFI-014 Lobby Camera Coverage\.pdf'/);
  assert.match(preview, /\{ id: 'd4', name: 'Door Hardware Schedule — A\.601\.pdf'/);
  assert.match(preview, /\{ id: 'd5', name: 'MEP Coordination — Level 3\.pdf'/);
  assert.match(preview, /if \(!workflowE2E\) return/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(preview, /createProjectInvite/);
});

test('deleteFiles is not project delete or file Copy/Paste replay', () => {
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /data-testid="delete-selected-projects"/);
  assert.match(tree, /void deleteProjects\(\[\.\.\.selProj\]\)/);
  assert.match(tree, /const copyFile = useCallback/);
  assert.match(tree, /const pasteFile = useCallback/);
  assert.match(tree, /\{ label: 'Copy', onClick: \(\) => copyFile\(f\) \}/);
  assert.match(tree, /\{ label: 'Paste', disabled: !clipboard, onClick: \(\) => pasteFile\(\) \}/);

  const extras = read('debug/scenarios/e2e-hub-projects-extras.spec.mjs');
  assert.match(extras, /file More Copy\/Paste/);
  assert.doesNotMatch(extras, /deleteFiles/);
  assert.doesNotMatch(extras, /menuitem', \{ name: 'Delete'/);

  const search = read('debug/scenarios/e2e-hub-projects-file-search-reorder.spec.mjs');
  assert.match(search, /Search files\.\.\./);
  assert.match(search, /reorderFiles/);
  assert.doesNotMatch(search, /deleteFiles/);
});
