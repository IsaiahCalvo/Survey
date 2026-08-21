/**
 * P2-06 / P2-07 — owner-gated Manage Team + Manage Access.
 *
 * Intended: creator or collaborator role=owner can manage.
 * Non-owner: no modal / no edit affordances / no emails.
 * 0-row writes are failure; notification emails do not fire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel) => readFileSync(resolve(rel), 'utf8');

function loadHelpers() {
  const src = read('src/services/projectInviteService.js');
  const start = src.indexOf('const NO_ROW_UPDATED');
  const end = src.indexOf('function newToken');
  assert.ok(start >= 0 && end > start, 'owner-manage helpers must sit above newToken');
  const body = src.slice(start, end).replace(/^export /gm, '');
  return new Function(`${body}\nreturn {\n  userHasOwnerManagePermission,\n  userCanManageDocumentAccess,\n  userCanManageProjectTeam,\n  confirmMutationAffectedRows,\n  shouldNotifyTeamChange,\n};`)();
}

const {
  userCanManageDocumentAccess,
  userCanManageProjectTeam,
  userHasOwnerManagePermission,
  confirmMutationAffectedRows,
  shouldNotifyTeamChange,
} = loadHelpers();

const CREATOR = { id: 'owner-1' };
const PROMOTED = { id: 'promoted-1' };
const VIEWER = { id: 'viewer-1' };
const DOC = { id: 'doc-1', user_id: 'owner-1', name: 'Site plan' };
const PROJECT = { id: 'proj-1', user_id: 'owner-1', name: 'Job A' };

test('P2-07 intended: creator can manage document access', () => {
  assert.equal(userCanManageDocumentAccess(DOC, CREATOR), true);
});

test('P2-07 intended: collaborator role=owner can manage (payload role)', () => {
  assert.equal(userCanManageDocumentAccess({ ...DOC, role: 'owner' }, PROMOTED), true);
  assert.equal(userCanManageDocumentAccess({ ...DOC, collaborator_role: 'Owner' }, PROMOTED), true);
});

test('P2-07 intended: collaborator role=owner can manage (rows)', () => {
  assert.equal(
    userCanManageDocumentAccess(DOC, PROMOTED, [
      { user_id: 'promoted-1', role: 'owner' },
    ]),
    true,
  );
});

test('P2-07 non-owner: editor/viewer cannot manage', () => {
  assert.equal(userCanManageDocumentAccess({ ...DOC, role: 'editor' }, VIEWER), false);
  assert.equal(userCanManageDocumentAccess({ ...DOC, role: 'viewer' }, VIEWER), false);
  assert.equal(
    userCanManageDocumentAccess(DOC, VIEWER, [{ user_id: 'viewer-1', role: 'viewer' }]),
    false,
  );
  assert.equal(userCanManageDocumentAccess(DOC, VIEWER), false);
  assert.equal(userCanManageDocumentAccess(DOC, null), false);
  assert.equal(userCanManageDocumentAccess(null, CREATOR), false);
});

test('P2-06 intended: project creator or promoted owner can manage team', () => {
  assert.equal(userCanManageProjectTeam(PROJECT, CREATOR), true);
  assert.equal(
    userCanManageProjectTeam(PROJECT, PROMOTED, [{ user_id: 'promoted-1', role: 'owner' }]),
    true,
  );
  assert.equal(userCanManageProjectTeam({ ...PROJECT, role: 'owner' }, PROMOTED), true);
});

test('P2-06 non-owner: viewer/editor cannot open manage', () => {
  assert.equal(userCanManageProjectTeam(PROJECT, VIEWER), false);
  assert.equal(
    userCanManageProjectTeam(PROJECT, VIEWER, [{ user_id: 'viewer-1', role: 'editor' }]),
    false,
  );
  assert.equal(userCanManageProjectTeam(PROJECT, null), false);
  assert.equal(userHasOwnerManagePermission({ user: VIEWER, ownerUserId: 'owner-1' }), false);
});

test('P2-06 0-row updates are failure', () => {
  const empty = confirmMutationAffectedRows([], { action: 'updated' });
  assert.equal(empty.success, false);
  assert.match(String(empty.error), /not saved/);

  const none = confirmMutationAffectedRows(null, { action: 'removed' });
  assert.equal(none.success, false);
  assert.match(String(none.error), /not saved/);

  const ok = confirmMutationAffectedRows([{ id: 'row-1' }], { action: 'updated' });
  assert.equal(ok.success, true);
  assert.equal(ok.data.length, 1);
});

test('P2-06 email is not sent unless the write confirmed', () => {
  const failed = confirmMutationAffectedRows([]);
  assert.equal(shouldNotifyTeamChange(failed), false);
  assert.equal(shouldNotifyTeamChange({ success: false, error: 'RLS' }), false);
  assert.equal(shouldNotifyTeamChange({ success: true }), true);
  assert.equal(shouldNotifyTeamChange(null), false);
});

test('wiring: SurveyHub derives manage from creator OR role=owner', () => {
  const hub = read('src/home/SurveyHub.jsx');
  assert.match(hub, /userCanManageDocumentAccess/);
  assert.match(hub, /getDocumentCollaborators/);
  assert.doesNotMatch(hub, /manage:\s*!!single\s*&&\s*!!user\?\.id\s*&&\s*single\.user_id\s*===\s*user\.id/);
});

test('wiring: ProjectsFolderTree gates every Manage Team opener on owner role', () => {
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /userCanManageProjectTeam/);
  assert.match(tree, /canManageProjectTeam\(open\)/);
  assert.match(tree, /canManageProjectTeam\(mobileDrillProject\)/);
  assert.match(tree, /canManageProjectTeam\(proj\)/);
  const openers = tree.match(/setTeamModalProject\((?!null)[^)]+\)/g) || [];
  assert.ok(openers.length >= 6, `expected gated openers, got ${openers.length}`);
  for (const opener of openers) {
    const idx = tree.indexOf(opener);
    const window = tree.slice(Math.max(0, idx - 180), idx);
    assert.match(
      window,
      /canManageProjectTeam/,
      `${opener} must sit behind canManageProjectTeam`,
    );
  }
});

test('wiring: 0-row select + emails only after shouldNotifyTeamChange', () => {
  const service = read('src/services/projectInviteService.js');
  assert.match(service, /confirmMutationAffectedRows/);
  assert.match(service, /\.select\('id'\)/);
  const updateFn = service.slice(service.indexOf('export async function updateProjectCollaboratorRole'));
  assert.match(updateFn.slice(0, 500), /\.select\('id'\)/);
  const removeFn = service.slice(service.indexOf('export async function removeProjectCollaborator'));
  assert.match(removeFn.slice(0, 500), /\.select\('id'\)/);

  const team = read('src/home/ManageTeamModal.jsx');
  assert.match(team, /shouldNotifyTeamChange\(res\) && m\.email/);
  assert.match(team, /userCanManageProjectTeam/);
  assert.match(team, /Only a project owner can change roles/);

  const access = read('src/home/AccessManagementModal.jsx');
  assert.match(access, /shouldNotifyTeamChange\(res\) && member\.email/);
  assert.match(access, /userCanManageDocumentAccess/);
});
