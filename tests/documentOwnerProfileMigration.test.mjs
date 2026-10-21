import test from 'node:test';
import { match, doesNotMatch, deepEqual } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { documentTeamRows } from '../src/home/documentTeam.js';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const sql = fs.readFileSync(path.join(repoRoot,
  'supabase/migrations/20261022020000_get_document_owner_profile.sql'), 'utf8');

test('owner profile RPC only answers for documents the caller can access', () => {
  match(sql, /SECURITY DEFINER/);
  match(sql, /SET search_path = ''/);
  match(sql, /auth\.uid\(\) IS NULL OR NOT public\.user_can_access_document\(doc_id, 'viewer'\)/);
  match(sql, /JOIN auth\.users u ON u\.id = d\.user_id\s+WHERE d\.id = doc_id/);
  match(sql, /REVOKE ALL ON FUNCTION public\.get_document_owner_profile\(UUID\) FROM PUBLIC, anon/);
  // Takes only a document id: no way to ask for an arbitrary user.
  doesNotMatch(sql, /get_document_owner_profile\([^)]*user/i);
});

test('team list uses the owner profile name for non-owners', () => {
  const rows = documentTeamRows({ user_id: 'o1' }, [], { id: 'v1' },
    { user_id: 'o1', name: null, email: 'boss@example.com' });
  deepEqual(rows[0], { id: 'o1', name: 'boss', role: 'owner', isMe: false });
  const named = documentTeamRows({ user_id: 'o1' }, [], { id: 'v1' }, { user_id: 'o1', name: 'Ann B' });
  deepEqual(named[0].name, 'Ann B');
  const wrong = documentTeamRows({ user_id: 'o1' }, [], { id: 'v1' }, { user_id: 'x', name: 'Eve' });
  deepEqual(wrong[0].name, 'Owner');
});
