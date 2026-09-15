import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const migrationUrl = new URL(
  '../supabase/migrations/20260915106000_document_definition_retirement_v2.sql', import.meta.url);
const migration = readFileSync(migrationUrl, 'utf8');
const runner = fileURLToPath(new URL(
  '../scripts/test-document-definition-retirement-v2-postgres.mjs', import.meta.url));
const tool = command => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
const unsupported = process.platform === 'win32' || process.getuid?.() === 0;
const postgresUnavailable = !tool('initdb') || !tool('pg_ctl') || !tool('psql');

test('retirement V2 keeps V1 RPCs and exposes least-privilege V2 wrappers', () => {
  for (const signature of [
    'public.preview_document_definition_revision_upgrade(uuid,uuid,uuid,jsonb,uuid)',
    'public.apply_reviewed_document_definition_revision(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,uuid,text)',
    'public.preview_document_definition_revision_upgrade_v2(uuid,uuid,uuid,jsonb,jsonb,uuid)',
    'public.apply_reviewed_document_definition_revision_v2(uuid,bigint,text,uuid,timestamptz,text,uuid,timestamptz,text,jsonb,jsonb,uuid,text)',
  ]) {
    assert.match(migration, new RegExp(signature.replace(/[().]/g, '\\$&')));
  }
  assert.match(migration, /document_definition_candidate_core/);
  assert.match(migration, /publish_document_definition_revision_core/);
  assert.match(migration, /document_definition_retirement_request_digest/);
  assert.match(migration, /'version', 2/);
  assert.match(migration, /'sourceModes'/);
  assert.match(migration, /'retirement-required'/);
  assert.match(migration, /'removedRoots'/);
  assert.match(migration, /'autoRetainedRoots'/);
  assert.match(migration, /'retiredSemanticRoots'/);
  assert.doesNotMatch(migration,
    /GRANT (SELECT|INSERT|UPDATE|DELETE|TRUNCATE).*document_definition_revision/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
});

test('retirement V2 passes real disposable PostgreSQL behavior cases', {
  skip: (unsupported || postgresUnavailable) &&
    'requires installed PostgreSQL under a non-root Unix user',
  timeout: 120_000,
}, () => {
  const result = spawnSync(process.execPath, [runner], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout,
    /document definition retirement V2: \d+\/\d+ passed; cleanup complete/);
});
