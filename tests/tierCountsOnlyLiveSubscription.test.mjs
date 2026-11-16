// KAL-369: a paid tier counts only while the subscription is live, the caller's
// own id still wins, and a company seat still counts. The behavior itself is
// checked on Postgres by tests/sql/kal369_tier_paid_owner_free_collaborator.sql.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = fs.readFileSync(path.join(repo, 'supabase', 'migrations', '20261116040000_tier_counts_only_live_subscription.sql'), 'utf8');
const body = sql.replace(/^\s*--.*$/gm, '');

test('only active, trialing and past_due subscriptions keep their paid tier', () => {
  assert.match(body, /status::text IN \('active', 'trialing', 'past_due'\) THEN tier::text\s+ELSE 'free'/);
});

test('the caller\'s own id still wins and a company seat still counts', () => {
  assert.match(body, /p_user_id := COALESCE\(auth\.uid\(\), p_user_id\);/);
  assert.match(body, /public\._company_seated\(p_user_id\)/);
  assert.match(body, /SECURITY DEFINER/);
});

test('signed-out callers stay refused', () => {
  assert.match(body, /REVOKE EXECUTE ON FUNCTION public\.get_user_tier\(uuid\) FROM PUBLIC, anon;/);
  assert.match(body, /GRANT EXECUTE ON FUNCTION public\.get_user_tier\(uuid\) TO authenticated, service_role;/);
  assert.doesNotMatch(body, /TO anon/);
});
