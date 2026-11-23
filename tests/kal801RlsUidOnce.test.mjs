import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../supabase/migrations/20261123210000_kal801_rls_uid_once.sql', import.meta.url), 'utf8');
const code = sql.replace(/--.*$/gm, '');

test('KAL-801: every auth.uid() in the rewritten rules runs once per query', () => {
  const bare = code.match(/(?<!select )auth\.uid\(\)/g) || [];
  assert.equal(bare.length, 0, 'auth.uid() must be wrapped as (select auth.uid())');
  assert.ok((code.match(/\(select auth\.uid\(\)\)/g) || []).length >= 16);
});

test('KAL-801: rules are altered in place, not dropped (except the merged DELETE pair)', () => {
  assert.equal((code.match(/alter policy/gi) || []).length, 14);
  const drops = code.match(/drop policy if exists "([^"]+)"/gi) || [];
  assert.equal(drops.length, 2);
  assert.match(code, /drop policy if exists "Members can leave a project" on public\.project_collaborators/);
  assert.match(code, /drop policy if exists "Project owners can remove collaborators" on public\.project_collaborators/);
});

test('KAL-801: the merged DELETE rule keeps both cases', () => {
  const merged = code.slice(code.indexOf('create policy'));
  assert.match(merged, /for delete/);
  assert.match(merged, /user_can_access_project\(project_id, 'owner'::text\)\s+or \(/);
  assert.match(merged, /role <> 'owner'::text/);
  assert.match(merged, /not is_guest_session\(\)/);
  assert.match(merged, /not is_agent_session\(\)/);
  assert.match(merged, /p\.user_id = \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(code, /\b(insert into|update public|delete from)\b/i, 'no data change');
});
