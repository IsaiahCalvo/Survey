// Audit round 5 (two people), #2 and #5 (2026-11-24): team lists and presence
// named people by email ("qa-c", "Teammate", "qa-c@example.com") while
// comments said "Cal Tester". One account name everywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { presenceDisplayName, presenceLabel } from '../src/components/presenceIdentity.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('presence writes the account name, else the email', () => {
  assert.equal(presenceDisplayName({ email: 'qa-c@example.com', user_metadata: { full_name: 'Cal Tester' } }), 'Cal Tester');
  assert.equal(presenceDisplayName({ email: 'qa-c@example.com', user_metadata: { name: 'Cal' } }), 'Cal');
  assert.equal(presenceDisplayName({ email: 'qa-c@example.com', user_metadata: { full_name: '  ' } }), 'qa-c@example.com');
  assert.equal(presenceDisplayName(null), 'Anonymous');
  assert.equal(presenceLabel({ display_name: presenceDisplayName({ email: 'a@b.c', user_metadata: { full_name: 'Ben Tester' } }) }), 'Ben Tester');
  const viewer = read('src/PDFViewer.jsx');
  assert.equal(viewer.includes("displayName: user.email || user.user_metadata?.full_name"), false, 'no presence write puts the email first');
  assert.ok((viewer.match(/displayName: presenceDisplayName\(user\)/g) || []).length >= 3);
});

test('project people lookup: members only, owners included, adds no data', () => {
  const sql = read('supabase/migrations/20261125170000_project_people_names.sql');
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = ''/);
  assert.match(sql, /project_item_member\(pid, auth\.uid\(\)\)/, 'only projects the caller belongs to');
  assert.match(sql, /FROM public\.projects p/, 'the owner is named too');
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.project_people_names\(uuid\[\]\) FROM PUBLIC, anon/);
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP TABLE|ALTER TABLE)\b/);
});

test('team lists read the looked-up name before the email', () => {
  const service = read('src/services/projectInviteService.js');
  assert.match(service, /rpc\('project_people_names'/);
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /r\.name \|\| person\?\.name \|\| email\.split\('@'\)\[0\]/);
  const modal = read('src/home/ManageTeamModal.jsx');
  assert.match(modal, /name: r\.name \|\| \(r\.email \|\| ''\)\.split\('@'\)\[0\]/);
});
