import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-hub-projects-thin-chrome.spec.mjs
// Unique leftover after Hub Projects extras (Search / Pin / Duplicate /
// file More Copy-Paste). File Select Move/Copy + project card reorder are
// live local chrome. Team modal writes hit projectInviteService / Supabase
// and must fail-closed on hubPreview — do not invent a backend.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('ProjectsFolderTree file Move/Copy + card reorder are live local chrome', () => {
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /const moveCopyFiles = useCallback\(async \(docIds, destId, mode\) => \{/);
  assert.match(tree, /if \(onMoveCopyDocuments\) \{/);
  assert.match(tree, /await onMoveCopyDocuments\(targets, destId, mode\)/);
  assert.match(tree, />Move\/Copy<\/button>/);
  assert.match(tree, /<MoveCopyModal/);
  assert.match(tree, /onConfirm=\{\(destId, mode\) => moveCopyFiles\(moveIds, destId, mode\)\}/);
  assert.match(tree, /const reorderProjects = useCallback\(\(fromId, toId\) => \{/);
  assert.match(tree, /onProjectPreferencesChange\?\.\(\{ projectOrder: out\.map\(\(project\) => project\.id\) \}\)/);
  assert.match(tree, /<SortableRearrangeList ids=\{filtered\.map\(\(p\) => p\.id\)\} onReorder=\{reorderProjects\}>/);
  assert.match(tree, /<DragRearrangeHandle/);
  assert.doesNotMatch(tree, /setCopyModeActive\(true\)/);
  assert.doesNotMatch(tree, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(tree, /__e2eProjectsThinChrome/);
});

test('HubPreview Move/Copy + projectOrder persist locally; Team writes stay cloud', () => {
  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /const handleMoveCopy = \(docs, projectId, mode\) => \{/);
  assert.match(preview, /if \(mode === 'move'\) \{/);
  assert.match(preview, /onMoveCopyDocuments=\{handleMoveCopy\}/);
  assert.match(preview, /const handleProjectPreferencesChange = \(patch\) => \{/);
  assert.match(preview, /onProjectPreferencesChange=\{handleProjectPreferencesChange\}/);
  assert.match(preview, /\{ id: 'p1', name: 'Tower 5 — Security', user_id: mockUser\.id/);
  assert.match(preview, /\{ id: 'p2', name: 'Lab Reno — MEP', user_id: 'u1'/);
  assert.doesNotMatch(preview, /createProjectInvite/);
  assert.doesNotMatch(preview, /updateProjectCollaboratorRole/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);

  const modal = read('src/home/BulkModals.jsx');
  assert.match(modal, /export function MoveCopyModal/);
  assert.match(modal, /aria-label="Move or copy documents"/);
  assert.match(modal, /modeBtn\('move', 'Move'\)/);
  assert.match(modal, /modeBtn\('copy', 'Copy'\)/);
  assert.match(modal, /setDestId\(null\)/);
  assert.match(modal, /setMode\('move'\)/);
});

test('ManageTeamModal writes are real cloud helpers and fail-closed without a session', () => {
  const modal = read('src/home/ManageTeamModal.jsx');
  assert.match(modal, /createProjectInvite/);
  assert.match(modal, /updateProjectCollaboratorRole/);
  assert.match(modal, /removeProjectCollaborator/);
  assert.match(modal, /if \(blockedReason\) \{ setError\(blockedReason\); return; \}/);
  assert.match(modal, /Press Copy link to create a secure/);
  assert.match(modal, /No recent activity\./);
  assert.doesNotMatch(modal, /__e2eTeamWrite/);
  assert.doesNotMatch(modal, /invented-invite/);

  const service = read('src/services/projectInviteService.js');
  assert.match(service, /if \(!currentUser\?\.id\) return \{ success: false, error: 'Must be signed in' \}/);
  assert.match(service, /export async function createProjectInvite/);
  assert.match(service, /\.from\('project_invites'\)/);
  assert.doesNotMatch(service, /hubPreview.*invite/);
});
