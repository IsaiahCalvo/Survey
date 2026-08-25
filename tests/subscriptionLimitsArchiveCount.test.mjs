import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Archived documents must not count toward the free-tier 5-document cap.
// Aligns useSubscriptionLimits' count query with useDatabase's list query.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const LIMITS = read('src/hooks/useSubscriptionLimits.js');
const DATABASE = read('src/hooks/useDatabase.js');

function documentCountQuery(source) {
  const start = source.indexOf("supabase.from('documents').select('*', { count: 'exact', head: true })");
  assert.ok(start >= 0, 'usage count must query documents with exact head count');
  return source.slice(start, start + 700);
}

test('usage document count applies the same archive filters as the library list', () => {
  const countQuery = documentCountQuery(LIMITS);
  assert.match(countQuery, /\.eq\('user_id', userId\)/);
  assert.match(countQuery, /\.eq\('archived', false\)/);
  assert.match(countQuery, /\.is\('user_archived_at', null\)/);

  assert.match(
    DATABASE,
    /\.eq\('archived', false\)\s*\n[\s\S]{0,400}?\.is\('user_archived_at', null\)/,
  );
});

test('usage count still keys off the signed-in user and does not invent a cap', () => {
  const countQuery = documentCountQuery(LIMITS);
  assert.match(countQuery, /\.eq\('user_id', userId\)/);
  assert.doesNotMatch(countQuery, /documents:\s*5/);
  assert.match(LIMITS, /documents: 5,/);
  assert.match(LIMITS, /if \(usage\.documents >= limits\.documents\)/);
});

test('usage count break: missing user still short-circuits without a documents read', () => {
  assert.match(LIMITS, /if \(!userId \|\| !isSupabaseAvailable\(\)\) \{\s*setLoading\(false\);\s*return;/);
});
