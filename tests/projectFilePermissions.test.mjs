// Projects file menu: Delete and Share are greyed out for viewers/editors of a
// shared project unless they uploaded the file (the server blocks them).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canManageProjectFile } from '../src/home/projectFilePermissions.js';

const owned = { id: 'p1', user_id: 'owner' };

test('uploader and project owner can manage; others cannot', () => {
  assert.equal(canManageProjectFile({ user_id: 'me' }, owned, 'me'), true);
  assert.equal(canManageProjectFile({ user_id: 'x' }, owned, 'owner'), true);
  assert.equal(canManageProjectFile({ user_id: 'x', my_role: 'owner' }, owned, 'me'), true);
  assert.equal(canManageProjectFile({ user_id: 'owner', my_role: 'viewer' }, owned, 'me'), false);
  assert.equal(canManageProjectFile({ user_id: 'owner', my_role: 'editor' }, owned, 'me'), false);
  assert.equal(canManageProjectFile({ user_id: 'owner' }, null, 'me'), false);
  assert.equal(canManageProjectFile({ user_id: 'me' }, owned, null), false);
});

test('file menu wires Delete and Share to the check', () => {
  const src = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');
  assert.match(src, /canManageProjectFile\(f, open, user\?\.id\)/);
  assert.match(src, /label: 'Delete', danger: true, reason: canManage \? null : noManageTitle/);
  assert.match(src, /label: 'Share', reason: canManage \? null : noManageTitle/);
  assert.match(src, /tip\(it\.reason\)/);
  // Select bar uses the same rule.
  assert.match(src, /can=\{manageCan\(selectedFiles, open, user\?\.id\)\}/);
});

test('project menu: Share/Delete/Add member are owner-only', async () => {
  const { canManageProject } = await import('../src/home/projectFilePermissions.js');
  assert.equal(canManageProject(owned, 'owner'), true);
  assert.equal(canManageProject({ user_id: 'x', my_role: 'owner' }, 'me'), true);
  assert.equal(canManageProject(owned, 'me'), false);
  assert.equal(canManageProject(owned, null), false);
  const src = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');
  assert.match(src, /canManageProject\(proj, user\?\.id\)/);
  assert.match(src, /label: 'Share', reason: ownerOnly/);
  assert.match(src, /label: 'Delete', danger: true, reason: ownerOnly/);
  assert.match(src, /label: 'Add member', reason: ownerOnly/);
});
