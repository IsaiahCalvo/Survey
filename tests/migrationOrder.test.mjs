// scripts/check-migration-order.mjs: a new migration must sort after the
// newest one on the base branch, or `supabase db push` blocks deploys.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { BASELINE_MIGRATION, findOutOfOrderMigrations } from '../scripts/check-migration-order.mjs';

const base = [
  'supabase/migrations/20261020230000_outside_agent_limits.sql',
  'supabase/migrations/20261021013000_custom_kits.sql',
];

test('migration order: a file older than the newest on base is flagged', () => {
  const { newest, late } = findOutOfOrderMigrations(base, ['supabase/migrations/20261021000000_feature_flags.sql']);
  assert.equal(newest, '20261021013000_custom_kits.sql');
  assert.deepEqual(late, ['20261021000000_feature_flags.sql']);
});

test('migration order: a later file, a same-number clash, and non-migrations', () => {
  assert.deepEqual(findOutOfOrderMigrations(base, ['supabase/migrations/20261021030000_feature_flags.sql']).late, []);
  assert.deepEqual(findOutOfOrderMigrations(base, ['supabase/migrations/20261021013000_other.sql']).late, ['20261021013000_other.sql']);
  assert.deepEqual(findOutOfOrderMigrations(base, ['supabase/migrations/README.md']).late, []);
  assert.deepEqual(findOutOfOrderMigrations([], ['supabase/migrations/20200101000000_a.sql']).late, []);
});

test('migration order: only the named baseline may sort first', () => {
  assert.equal(BASELINE_MIGRATION, '20241220000000_baseline.sql');
  assert.deepEqual(findOutOfOrderMigrations(base, [`supabase/migrations/${BASELINE_MIGRATION}`]).late, []);
  assert.deepEqual(
    findOutOfOrderMigrations(base, ['supabase/migrations/20241220000000_other.sql']).late,
    ['20241220000000_other.sql'],
  );
  assert.deepEqual(
    findOutOfOrderMigrations(base, ['supabase/migrations/20241219000000_baseline.sql']).late,
    ['20241219000000_baseline.sql'],
  );
  // Once the baseline is on the base branch it never counts as the newest.
  const withBaseline = [`supabase/migrations/${BASELINE_MIGRATION}`, ...base];
  assert.equal(findOutOfOrderMigrations(withBaseline, []).newest, '20261021013000_custom_kits.sql');
});

test('migration order: the baseline sorts before every other migration in the tree', () => {
  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((n) => /^\d{14}_.+\.sql$/.test(n)).sort();
  assert.equal(names[0], BASELINE_MIGRATION);
});

test('migration order: no two migrations in the tree share a timestamp', () => {
  const names = readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter((n) => /^\d{14}_/.test(n));
  const seen = new Map();
  for (const n of names) {
    const v = n.slice(0, 14);
    assert.ok(!seen.has(v), `${n} and ${seen.get(v)} share version ${v}`);
    seen.set(v, n);
  }
});
