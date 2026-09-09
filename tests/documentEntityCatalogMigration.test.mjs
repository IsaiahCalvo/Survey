import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateDocumentEntityCatalog } from '../src/services/documentEntityCatalog.js';

const migration = readFileSync(new URL('../supabase/migrations/20260909105000_document_entity_catalog.sql', import.meta.url), 'utf8');
const tool = command => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
const unsupportedHost = process.platform === 'win32' || process.getuid?.() === 0;
const postgresUnavailable = !tool('initdb') || !tool('pg_ctl') || !tool('psql');

test('document Entity catalog migration exposes only bounded adoption and read RPCs', () => {
  assert.match(migration, /CREATE TABLE survey_private\.document_entity_catalogs/);
  assert.match(migration, /CREATE TABLE survey_private\.document_entity_definitions/);
  assert.match(migration, /source_entities_sha256 text NOT NULL/);
  assert.match(migration, /seed_operation_id uuid NOT NULL UNIQUE/);
  assert.match(migration, /jsonb_array_length\(source_entities\)/);
  assert.match(migration, /octet_length\(source_entities::text\) > 262144/);
  assert.match(migration, /document_row\.user_id IS DISTINCT FROM actor/);
  assert.match(migration, /template_owner IS DISTINCT FROM actor/);
  assert.match(migration, /template_updated_at IS DISTINCT FROM p_expected_template_updated_at/);
  assert.match(migration, /entities_sha256 IS DISTINCT FROM p_expected_entities_sha256/);
  assert.match(migration, /UPDATE public\.documents SET template_id = p_template_id/);
  assert.match(migration, /public\.user_can_access_document\(p_document_id, 'viewer'\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.preview_document_entity_catalog_adoption/);
  assert.doesNotMatch(migration, /GRANT (SELECT|INSERT|UPDATE|DELETE|TRUNCATE).*document_entity_/);
  assert.doesNotMatch(migration, /CREATE (OR REPLACE )?FUNCTION public\.[^(]*(rename|retire|update|delete)_document_entity/i);
});

test('document Entity catalog migration passes disposable PostgreSQL cases', {
  skip: (unsupportedHost || postgresUnavailable) && 'requires installed PostgreSQL under a non-root Unix user',
  timeout: 90_000,
}, () => {
  const script = fileURLToPath(new URL('../scripts/test-document-entity-catalog-postgres.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /document entity catalog: 15\/15 passed; cleanup complete/);
  const contractLine = result.stdout.split('\n').find(line => line.startsWith('ENTITY_CATALOG_CONTRACT '));
  assert.ok(contractLine, 'disposable PostgreSQL must emit its actual accepted receipt');
  const receipt = JSON.parse(contractLine.slice('ENTITY_CATALOG_CONTRACT '.length));
  assert.deepEqual(validateDocumentEntityCatalog(receipt, receipt.documentId), receipt);
});
