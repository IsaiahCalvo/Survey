// Manage team: the bulk-pick button says Select and hides with no one to pick
// (KAL-652, batch 19).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/home/ManageTeamModal.jsx', import.meta.url), 'utf8');

test('Select, not Edit, and only when someone can be picked', () => {
  assert.match(src, /\(\(canManageMembers && selectable\.length > 0\) \|\| editMode\) && \(\s*<button onClick=\{toggleEdit\} className="hub-btn hub-btn--tertiary">\{editMode \? "Done" : "Select"\}<\/button>/);
  assert.ok(!src.includes('{editMode ? "Done" : "Edit"}'));
});
