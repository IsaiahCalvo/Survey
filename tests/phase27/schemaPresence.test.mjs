// tests/phase27/schemaPresence.test.mjs
// Phase 27 Wave 0 scaffold — runs as test.skip until Plan 27-03's schema migration lands.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md § Validation Architecture.
//
// UX/architecture rationale: Phase 28's transport layer reads + writes against the
// `doc_yjs_updates`, `doc_yjs_state`, and `activity_log` tables. This test asserts
// the schema is shaped correctly so Phase 28 cannot be blocked by missing columns.
// Specifically, it pins the bytea storage columns (`update`, `state`, `state_vector`)
// because Yjs binary updates MUST round-trip exactly — any encoding-layer rewrite
// (text, jsonb) would corrupt CRDT history.
//
// Runs via `npm run test:integration` against the main Survey project. It reads
// PostgREST's OpenAPI schema and performs no database writes.

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { integrationSkipReason, loadPublicOpenApiSchema } from './integrationEnv.mjs';

const skipReason = integrationSkipReason();

// Expected columns per table — sourced from 27-RESEARCH.md schema design.
// information_schema.columns reports types in lower-case canonical form.
const EXPECTED = {
  doc_yjs_updates: [
    { column_name: 'id', data_type: 'bigint' },
    { column_name: 'document_id', data_type: 'uuid' },
    { column_name: 'client_id', data_type: 'text' },
    { column_name: 'seq', data_type: 'bigint' },
    { column_name: 'update', data_type: 'bytea' },
    { column_name: 'origin', data_type: 'jsonb' },
    { column_name: 'client_ts', data_type: 'timestamp with time zone' },
    { column_name: 'server_ts', data_type: 'timestamp with time zone' },
  ],
  doc_yjs_state: [
    { column_name: 'document_id', data_type: 'uuid' },
    { column_name: 'state', data_type: 'bytea' },
    { column_name: 'state_vector', data_type: 'bytea' },
    { column_name: 'through_seq', data_type: 'bigint' },
    { column_name: 'encoding_version', data_type: 'smallint' },
    { column_name: 'updated_at', data_type: 'timestamp with time zone' },
  ],
  activity_log: [
    { column_name: 'id', data_type: 'bigint' },
    { column_name: 'document_id', data_type: 'uuid' },
    { column_name: 'user_id', data_type: 'uuid' },
    { column_name: 'device_id', data_type: 'text' },
    { column_name: 'op_type', data_type: 'text' },
    { column_name: 'anno_id', data_type: 'text' },
    { column_name: 'client_ts', data_type: 'timestamp with time zone' },
    { column_name: 'server_ts', data_type: 'timestamp with time zone' },
    { column_name: 'summary', data_type: 'jsonb' },
  ],
};

test(
  'Phase 27 schema: doc_yjs_updates / doc_yjs_state / activity_log columns + types match research spec',
  { skip: skipReason },
  async () => {
    const schema = await loadPublicOpenApiSchema();

    for (const [tableName, expectedColumns] of Object.entries(EXPECTED)) {
      const definition = schema.definitions[tableName];
      ok(definition, `${tableName} must be exposed by PostgREST OpenAPI`);
      for (const expected of expectedColumns) {
        const actual = definition.properties?.[expected.column_name];
        ok(actual, `${tableName}.${expected.column_name} column must exist`);
        strictEqual(
          actual.format,
          expected.data_type,
          `${tableName}.${expected.column_name} expected ${expected.data_type}, got ${actual.format}`
        );
      }
    }
  }
);
