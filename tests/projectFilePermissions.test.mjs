// Projects file menu: Share is greyed out for viewers/editors of a shared
// project unless they uploaded the file or own the project. Delete is stricter
// — archive_document only accepts the file's user_id.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canDeleteProjectFile, canManageProjectFile } from '../src/home/projectFilePermissions.js';

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

test('only the file owner can delete; project and collaborator owners cannot', () => {
  assert.equal(canDeleteProjectFile({ user_id: 'me' }, 'me'), true);
  assert.equal(canDeleteProjectFile({ user_id: 'x' }, 'owner'), false);
  assert.equal(canDeleteProjectFile({ user_id: 'x', my_role: 'owner' }, 'me'), false);
  assert.equal(canDeleteProjectFile({ user_id: 'owner' }, 'me'), false);
  assert.equal(canDeleteProjectFile({ user_id: 'me' }, null), false);
  assert.equal(canDeleteProjectFile(null, 'me'), false);
});

test('file menu wires Delete to archive ownership and Share to manage', () => {
  const src = readFileSync(new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url), 'utf8');
  assert.match(src, /canDeleteProjectFile\(f, user\?\.id\)/);
  assert.match(src, /canManageProjectFile\(f, open, user\?\.id\)/);
  assert.match(src, /label: 'Delete', danger: true, disabled: !canDelete, title:/);
  assert.match(src, /label: 'Share', disabled: !canManage, title:/);
  assert.match(src, /tip\(it\.title\)/);
});
