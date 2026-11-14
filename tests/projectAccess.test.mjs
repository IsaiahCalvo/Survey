// Project settings and access (flag project-access): the pure rules in
// src/projectAccess/projectAccess.js, the activity lines, and the database
// rules in supabase/migrations/20261114130000_project_access.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  coverPath, accessOf, accessSummary, accessRoleToSave, settingsChanges, settingsProblem, projectsForList, closedCount,
  leaveBlock, ROLE_GUIDE,
} from '../src/projectAccess/projectAccess.js';
import { describeProjectEvent } from '../src/projectItems/projectActivity.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const P = 'AAAAAAAA-0000-4000-8000-000000000001';
const p = P.toLowerCase();

test('cover paths count up and keep to jpeg / png / webp', () => {
  assert.equal(coverPath(P, null, 'image/png'), `${p}/cover-1.png`);
  assert.equal(coverPath(P, `${p}/cover-1.png`, 'image/jpeg'), `${p}/cover-2.jpg`);
  assert.equal(coverPath(P, `${p}/cover-999999.webp`, 'image/webp'), `${p}/cover-1.webp`);
  assert.equal(coverPath(P, null, 'image/gif'), null);
  assert.equal(coverPath('nope', null, 'image/png'), null);
});

test('access reads Private or company with a role, and says so', () => {
  assert.deepEqual(accessOf({}), { kind: 'private', role: 'viewer' });
  assert.deepEqual(accessOf({ company_access: 'editor' }), { kind: 'company', role: 'editor' });
  assert.match(accessSummary({}), /^Private/);
  assert.equal(accessSummary({ company_access: 'viewer' }, 'Acme'), 'Everyone in Acme can open this project as a Viewer.');
  assert.equal(accessRoleToSave('company', 'editor'), 'editor');
  assert.equal(accessRoleToSave('private', 'editor'), null);
  assert.equal(accessRoleToSave('company', 'owner'), null);
});

test('Save sends only what changed', () => {
  const project = { name: 'Tower', description: 'Old', company_access: null, cover_path: `${p}/cover-1.png` };
  assert.deepEqual(settingsChanges(project, { name: ' Tower ', description: 'Old', access: 'private', role: 'viewer' }), {});
  assert.deepEqual(settingsChanges(project, { name: 'Tower B', description: ' New ', access: 'company', role: 'editor' }),
    { name: 'Tower B', description: 'New', access: 'editor' });
  assert.deepEqual(settingsChanges({ ...project, company_access: 'editor' }, { name: 'Tower', description: 'Old', access: 'private' }), { access: null });
  assert.deepEqual(settingsChanges(project, { name: 'Tower', description: 'Old', access: 'private', removeCover: true }), { removeCover: true });
  assert.equal(settingsProblem({ name: '  ' }), 'Give the project a name.');
  assert.equal(settingsProblem({ name: 'x'.repeat(121) }), 'Keep the name under 120 characters.');
  assert.equal(settingsProblem({ name: 'ok', description: 'y'.repeat(1001) }), 'Keep the description under 1000 characters.');
  assert.equal(settingsProblem({ name: 'ok' }), null);
});

test('closed projects swap places with the open list; the owner cannot leave', () => {
  const list = [{ id: 'a' }, { id: 'b', closed_at: '2026-11-14T00:00:00Z' }, { id: 'c' }];
  assert.deepEqual(projectsForList(list, false).map((x) => x.id), ['a', 'c']);
  assert.deepEqual(projectsForList(list, true).map((x) => x.id), ['b']);
  assert.equal(closedCount(list), 1);
  assert.match(leaveBlock({ user_id: 'me' }, 'me', 'owner'), /own this project/);
  assert.equal(leaveBlock({ user_id: 'boss' }, 'me', 'viewer'), null);
  assert.ok(ROLE_GUIDE.every((r) => r.owner !== undefined && r.editor !== undefined && r.viewer !== undefined));
  assert.equal(ROLE_GUIDE.find((r) => r.can === 'Leave the project').owner, false);
});

test('activity says who left, access changes and closing', () => {
  assert.equal(describeProjectEvent({ action: 'member_removed', actor_id: 'u1', subject_id: 'u1', subject_name: 'a@b.c' }), 'left the project');
  assert.equal(describeProjectEvent({ action: 'member_removed', actor_id: 'u0', subject_id: 'u1', subject_name: 'a@b.c' }), 'removed a@b.c');
  assert.equal(describeProjectEvent({ action: 'project_access', from_value: 'private', to_value: 'editor' }),
    'changed who can open the project from invited people only to everyone in the company as Editors');
  assert.equal(describeProjectEvent({ action: 'project_closed' }), 'closed the project');
  assert.equal(describeProjectEvent({ action: 'project_reopened' }), 'reopened the project');
});

test('flag is a Nightly beta flag and the database keeps its rules', () => {
  assert.equal(FEATURE_FLAGS['project-access']?.stage, 'beta');
  const sql = readFileSync(new URL('../supabase/migrations/20261114130000_project_access.sql', import.meta.url), 'utf8');
  assert.match(sql, /'project-access',\s*'off'/);
  assert.match(sql, /use project settings to change access/);
  assert.match(sql, /only the project owner can change access/);
  assert.match(sql, /Members can leave a project/);
  assert.match(sql, /access_source = 'company'/);
  assert.match(sql, /cover-\[1-9\]/);
  // user_can_access_project is left alone: company access rides on rows.
  assert.doesNotMatch(sql, /FUNCTION public\.user_can_access_project/i);
});
