import test from 'node:test';
import assert from 'node:assert/strict';
import { documentTeamRows } from '../src/home/documentTeam.js';

const doc = { id: 'd1', user_id: 'owner' };

test('owner first, then collaborators, deduped', () => {
  const rows = documentTeamRows(doc, [
    { user_id: 'ed', role: 'editor', email: 'ed@x.com' },
    { user_id: 'owner', role: 'owner', email: 'boss@x.com' },
    { user_id: 'vi', role: 'Viewer', email: 'vi@x.com' },
    { user_id: 'ed', role: 'editor', email: 'ed@x.com' },
  ], { id: 'vi', email: 'vi@x.com', name: 'Vic' });
  assert.deepEqual(rows.map((r) => [r.id, r.name, r.role, r.isMe]), [
    ['owner', 'boss', 'owner', false],
    ['ed', 'ed', 'editor', false],
    ['vi', 'Vic', 'viewer', true],
  ]);
});

test('signed-in owner with no collaborators shows just the owner', () => {
  const rows = documentTeamRows(doc, [], { id: 'owner', email: 'me@x.com' });
  assert.deepEqual(rows, [{ id: 'owner', name: 'me', role: 'owner', isMe: true }]);
});

test('owner not listed and not me falls back to "Owner", not the viewer', () => {
  const rows = documentTeamRows(doc, null, { id: 'someone', email: 's@x.com' });
  assert.equal(rows[0].name, 'Owner');
  assert.equal(rows.length, 1);
});
