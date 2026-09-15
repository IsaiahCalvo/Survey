import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = readFileSync(new URL('../supabase/migrations/20260915100000_checked_legacy_sidecar_retirement.sql', import.meta.url), 'utf8');
const script = fileURLToPath(new URL('../scripts/test-checked-legacy-sidecar-retirement-postgres.mjs', import.meta.url));

test('checked legacy sidecar retirement stays private, marker-only, and versioned', () => {
  assert.match(source, /read_document_generation_replacement_v4/);
  assert.match(source, /publish_document_generation_v4/);
  assert.match(source, /read_document_generation_open_v4/);
  assert.match(source, /read_document_generation_legacy_sidecar_archive_v1/);
  assert.match(source, /offered_archive_operation_ids/);
  assert.match(source, /used_archive_operation_ids/);
  assert.match(source, /legacy_sidecar_migration/);
  assert.match(source, /Legacy sidecar entities require an accepted document entity catalog/);
  assert.match(source, /FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(source, /p_plan->'projection'->'sidecars'<>'\[\]'::jsonb/);
});

test('actual isolated PostgreSQL proves archive retirement, replay, privacy, and carry-forward', {
  skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL',
}, () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 300000, maxBuffer: 8 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error?.message || ''}`);
  assert.match(result.stdout, /Checked legacy sidecar retirement PostgreSQL checks passed: 13/);
  assert.match(result.stdout, /Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
