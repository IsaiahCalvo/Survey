import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const migrationUrl = new URL('../supabase/migrations/20260915102000_document_definition_revisions.sql', import.meta.url);
const migration = readFileSync(migrationUrl, 'utf8');
const tool = command => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
const unsupported = process.platform === 'win32' || process.getuid?.() === 0;
const postgresUnavailable = !tool('initdb') || !tool('pg_ctl') || !tool('psql');

test('definition revision migration exposes append-only private rows through bounded RPCs', () => {
  assert.match(migration, /CREATE TABLE survey_private\.document_definition_revisions/);
  assert.match(migration, /PRIMARY KEY \(document_id, definition_revision\)/);
  assert.match(migration, /CREATE TABLE survey_private\.document_definition_revision_heads/);
  assert.match(migration, /FOREIGN KEY \(document_id, current_revision, current_digest\)/);
  assert.match(migration, /p_expected_current_revision bigint/);
  assert.match(migration, /p_expected_current_digest text/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /document_definition_stable_json/);
  assert.match(migration, /SET extra_float_digits = '3'/);
  assert.match(migration, /BETWEEN 1 AND 9007199254740991/);
  assert.match(migration, /'documentId', p_document_id/);
  assert.match(migration, /'actorId', p_actor_id/);
  assert.match(migration, /'archivedSemanticIds', p_archived_semantic_ids/);
  assert.match(migration, /preview_document_definition_revision_upgrade\(\s*p_document_id uuid,[\s\S]*p_operation_id uuid\)/);
  assert.match(migration, /public\.user_can_access_document\(p_document_id, 'viewer'\)/);
  assert.match(migration, /document_row\.user_id IS DISTINCT FROM actor/);
  assert.match(migration, /DOCUMENT_DEFINITION_SEMANTIC_ID_REMOVED/);
  assert.match(migration, /DOCUMENT_DEFINITION_SEMANTIC_ID_REUSED/);
  assert.doesNotMatch(migration,
    /GRANT (SELECT|INSERT|UPDATE|DELETE|TRUNCATE).*document_definition_revision/i);
  assert.doesNotMatch(migration,
    /CREATE OR REPLACE FUNCTION public\.read_document_(survey_definition|entity_catalog)/);
});

test('definition revision migration passes disposable PostgreSQL behavior cases', {
  skip: (unsupported || postgresUnavailable) && 'requires installed PostgreSQL under a non-root Unix user',
  timeout: 90_000,
}, () => {
  const script = fileURLToPath(new URL('../scripts/test-document-definition-revision-postgres.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /document definition revisions: 9\/9 passed; cleanup complete/);
});
