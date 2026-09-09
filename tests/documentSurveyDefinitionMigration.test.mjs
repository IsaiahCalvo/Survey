import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createDocumentSurveyDefinitionClient,
  validateDocumentSurveyDefinition,
} from '../src/services/documentSurveyDefinition.js';

const migrationUrl = new URL('../supabase/migrations/20260909106000_document_survey_definition.sql', import.meta.url);
const migration = readFileSync(migrationUrl, 'utf8');
const tool = command => spawnSync(command, ['--version'], { encoding: 'utf8' }).status === 0;
const unsupported = process.platform === 'win32' || process.getuid?.() === 0;
const postgresUnavailable = !tool('initdb') || !tool('pg_ctl') || !tool('psql');

test('survey definition migration keeps one private immutable snapshot behind bounded RPCs', () => {
  assert.match(migration, /CREATE TABLE survey_private\.document_survey_definitions/);
  assert.match(migration, /definition_revision/);
  assert.match(migration, /source_structure_sha256/);
  assert.match(migration, /seed_operation_id/);
  assert.match(migration, /preview_document_survey_definition_adoption/);
  assert.match(migration, /adopt_document_survey_definition/);
  assert.match(migration, /read_document_survey_definition/);
  assert.doesNotMatch(migration, /UPDATE public\.documents SET template_id/i);
  assert.doesNotMatch(migration, /GRANT (SELECT|INSERT|UPDATE|DELETE|TRUNCATE).*document_survey_definitions/i);
});

test('survey definition migration passes disposable PostgreSQL and its real JSON passes the client', {
  skip: (unsupported || postgresUnavailable) && 'requires installed PostgreSQL under a non-root Unix user',
  timeout: 90_000,
}, async () => {
  const script = fileURLToPath(new URL('../scripts/test-document-survey-definition-postgres.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /document survey definition: 10\/10 passed; cleanup complete/);
  const line = result.stdout.split('\n').find(value => value.startsWith('SURVEY_DEFINITION_CONTRACT '));
  assert.ok(line);
  const actual = JSON.parse(line.slice('SURVEY_DEFINITION_CONTRACT '.length));
  const calls = [];
  const client = createDocumentSurveyDefinitionClient({ enabled: true, rpc: async name => {
    calls.push(name);
    if (name === 'preview_document_survey_definition_adoption') return { data: actual.preview };
    if (name === 'adopt_document_survey_definition') return { data: actual.accepted };
    return { data: actual.read };
  } });
  const preview = await client.preview({ documentId: actual.preview.documentId,
    templateId: actual.preview.source.templateId });
  const adopted = await client.adopt({ preview, operationId: actual.accepted.seed.operationId });
  const read = await client.read({ documentId: actual.read.documentId });
  assert.deepEqual(validateDocumentSurveyDefinition(adopted, adopted.documentId), actual.accepted);
  assert.deepEqual(read, actual.read);
  assert.deepEqual(calls, ['preview_document_survey_definition_adoption',
    'adopt_document_survey_definition', 'read_document_survey_definition']);
});
