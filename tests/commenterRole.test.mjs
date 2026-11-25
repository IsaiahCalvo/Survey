// Owner, 2026-11-24 (audit round 5, #6): a Commenter role between Viewer and
// Editor, offered in Nightly only. A Commenter reads and comments; for every
// drawing check they are a Viewer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canCommentRole, drawingRole, roleNamesHighToLow, roleRank } from '../src/utils/collaboratorRoles.js';
import { KNOWN_DOCUMENT_ROLES, fetchMyDocumentRole, resolveReadOnlyReason } from '../src/lib/collab/documentRole.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('pickers offer Commenter only with the Nightly flag', () => {
  assert.deepEqual(roleNamesHighToLow(false), ['Owner', 'Editor', 'Viewer']);
  assert.deepEqual(roleNamesHighToLow(true), ['Owner', 'Editor', 'Commenter', 'Viewer']);
  assert.equal(FEATURE_FLAGS['commenter-role']?.stage, 'beta');
  assert.match(read('supabase/migrations/20261125180500_commenter_role_flag.sql'), /'commenter-role', 'off'/);
});

test('a Commenter comments but draws as a Viewer', () => {
  for (const role of ['owner', 'editor', 'commenter']) assert.equal(canCommentRole(role), true, role);
  for (const role of ['viewer', null, '', 'guest']) assert.equal(canCommentRole(role), false, String(role));
  assert.equal(drawingRole('commenter'), 'viewer');
  assert.equal(drawingRole('editor'), 'editor');
  assert.equal(drawingRole(null), null);
  assert.equal(resolveReadOnlyReason({ docRole: 'commenter' }), 'viewer');
  assert.ok(roleRank('editor') < roleRank('commenter') && roleRank('commenter') < roleRank('viewer'));
});

test('the document role read keeps commenter (it used to fail open to read-write)', async () => {
  assert.ok(KNOWN_DOCUMENT_ROLES.includes('commenter'));
  const client = { rpc: async () => ({ data: 'commenter', error: null }) };
  assert.equal(await fetchMyDocumentRole(client, 'doc-1'), 'commenter');
});

test('the viewer hands drawing a Viewer and comments a Commenter', () => {
  const provider = read('src/components/collab/YDocProvider.jsx');
  assert.match(provider, /const docRole = drawingRole\(accessRole\);/);
  assert.match(provider, /const canComment = accessRole == null \? null : canCommentRole\(accessRole\);/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const canWriteComments = canRestoreFromHistory\s*\|\| \(yjsCanComment === true && !yjsAccessRevoked && !documentLocked\);/);
  assert.equal((viewer.match(/<PagePins(Host|Layer)\b[^>]*readOnly=\{!canWriteComments\}/gs) || []).length, 2);
  assert.match(read('src/PDFSidebar.jsx'), /canWrite=\{canWriteComments \?\? canEditLayers\}/);
});

test('server: Commenters pass viewer checks and may comment, never draw', () => {
  const sql = read('supabase/migrations/20261125180000_commenter_role.sql');
  for (const table of ['document_collaborators', 'project_collaborators', 'document_invites', 'project_invites']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ADD CONSTRAINT \\w+\\s+CHECK \\(\\w+ IN \\('viewer', 'commenter', 'editor', 'owner'\\)\\)`));
  }
  assert.match(sql, /WHEN 'commenter' THEN user_role IN \('commenter', 'editor', 'owner'\)/);
  for (const fn of ['add_mark_comment', 'add_page_pin', 'edit_mark_comment', 'delete_mark_comment', 'set_mark_comment_resolved', 'update_page_pin']) {
    assert.ok(sql.includes(`'${fn}'`), fn);
  }
  // No row is changed and nothing is dropped but the old role checks.
  assert.doesNotMatch(sql, /\bUPDATE public\.|\bDELETE FROM\b|\bDROP TABLE\b|\bDROP FUNCTION\b/);
});
