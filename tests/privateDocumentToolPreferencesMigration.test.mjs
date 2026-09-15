import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const migration = readFileSync(new URL('../supabase/migrations/20260909116000_private_document_tool_preferences.sql', import.meta.url), 'utf8');
const tool = command => spawnSync(command, ['--version'], { encoding:'utf8' }).status === 0;
const unsupportedHost = process.platform === 'win32' || process.getuid?.() === 0;
const postgresUnavailable = !tool('initdb') || !tool('pg_ctl') || !tool('psql');

test('private document tool preferences migration has bounded actor-only RPC storage', () => {
  assert.match(migration, /CREATE TABLE survey_private\.document_tool_preferences \(/);
  assert.match(migration, /PRIMARY KEY \(user_id, document_id\)/);
  assert.match(migration, /expected_revision bigint NOT NULL/);
  assert.match(migration, /document_id uuid NOT NULL REFERENCES public\.documents\(id\) ON DELETE CASCADE/);
  assert.match(migration, /CREATE INDEX document_tool_preferences_document_id_idx/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /user_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /public\.user_can_access_document\(document_id, 'viewer'\) IS TRUE/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path = ''/);
  assert.match(migration, /pg_catalog\.octet_length\(p_preferences::text\) > 32768/);
  assert.match(migration, /'strokeColor','strokeWidth','strokeOpacity','fillColor','fillOpacity'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.read_document_tool_preferences\(uuid\)/);
  assert.doesNotMatch(migration, /GRANT (SELECT|INSERT|UPDATE|DELETE|TRUNCATE).*document_tool_preferences/i);
  assert.doesNotMatch(migration, /(?:UPDATE|ALTER TABLE|DROP|INSERT INTO) public\.documents/i);
  assert.doesNotMatch(migration, /documents\.tool_preferences/);
  assert.doesNotMatch(migration, /document_tool_preference_write_receipts/);
});

test('private document tool preferences migration passes disposable PostgreSQL cases', {
  skip:(unsupportedHost || postgresUnavailable) && 'requires installed PostgreSQL under a non-root Unix user',
  timeout:90_000,
}, () => {
  const script = fileURLToPath(new URL('../scripts/test-private-document-tool-preferences-postgres.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding:'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /private document tool preferences: 10\/10 passed; cleanup complete/);
  const contractLine = result.stdout.split('\n').find(line => line.startsWith('PRIVATE_TOOL_PREFERENCES_CONTRACT '));
  assert.ok(contractLine, 'disposable PostgreSQL must emit an actual write receipt');
  const receipt = JSON.parse(contractLine.slice('PRIVATE_TOOL_PREFERENCES_CONTRACT '.length));
  assert.equal(receipt.status, 'written');
  assert.equal(receipt.version, 1);
  assert.equal(receipt.revision, 1);
});
