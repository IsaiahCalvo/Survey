import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const sql = readFileSync(new URL('../supabase/migrations/20260909091000_document_generation_read_fences.sql', import.meta.url), 'utf8');
const script = fileURLToPath(new URL('../scripts/test-document-generation-read-fences-postgres.mjs', import.meta.url));
test('read fences are restrictive, explicit and add no activation or Storage permission', () => {
  assert.match(sql, /AS RESTRICTIVE FOR SELECT TO anon,authenticated/);
  assert.match(sql, /ERRCODE='SG001'/); assert.match(sql, /SELECT survey_private.has_annotation_generation_heads\(\)/);
  assert.doesNotMatch(sql, /SET FORCE ROW LEVEL SECURITY|GRANT SELECT|^\s*UPDATE public\.documents|INSERT INTO survey_private.annotation_generation_heads/m);
  assert.match(sql, /Storage RLS does not revoke issued signed links/);
});
test('legacy content definers retain their original bodies and permissions while acquiring the read fence', () => {
  for (const name of ['kal48_create_revision','kal48_list_revisions','kal48_get_revision','kal48_restore_revision','kal309_fetch_since','kal49_lock_document','kal49_unlock_document']) assert.ok(sql.includes(name));
  assert.match(sql, /pg_get_functiondef/); assert.match(sql, /Unrecognized legacy content reader/);
  assert.match(sql, /pg_try_advisory_xact_lock/); assert.match(sql, /FOR SHARE NOWAIT/);
});
test('actual installed PostgreSQL verifies legacy, adopted, stranger, definer and Storage read boundaries', {
  skip: process.env.SURVEY_POSTGRES_INTEGRATION !== '1' && 'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL',
}, () => {
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error?.message || ''}`);
  assert.match(result.stdout, /Document generation read fence PostgreSQL checks passed:/);
  assert.match(result.stdout, /Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
