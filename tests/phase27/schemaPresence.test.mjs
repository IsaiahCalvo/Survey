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
// Skip condition: SUPABASE_TEST_URL env var not set. The schema test only runs in
// CI (or local-supabase mode) where a Supabase instance is reachable. Plan 27-03
// owns wiring the CI env var; until then this skips cleanly.

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const skipReason = !process.env.SUPABASE_TEST_URL
  ? 'SUPABASE_TEST_URL env not set — schema test only runs in CI/local-supabase mode'
  : !existsSync(resolve(REPO_ROOT, 'node_modules/@supabase/supabase-js/package.json'))
    ? '@supabase/supabase-js not installed yet'
    : false;

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
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(
      process.env.SUPABASE_TEST_URL,
      process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_TEST_ANON_KEY
    );

    for (const [tableName, expectedColumns] of Object.entries(EXPECTED)) {
      const { data: rows, error } = await client
        .from('information_schema.columns')
        .select('column_name, data_type')
        .eq('table_schema', 'public')
        .eq('table_name', tableName);
      ok(!error, `query for ${tableName} columns must not error: ${error?.message}`);
      ok(Array.isArray(rows), `expected an array of column rows for ${tableName}`);
      for (const expected of expectedColumns) {
        const actual = rows.find((r) => r.column_name === expected.column_name);
        ok(actual, `${tableName}.${expected.column_name} column must exist`);
        strictEqual(
          actual.data_type,
          expected.data_type,
          `${tableName}.${expected.column_name} expected ${expected.data_type}, got ${actual.data_type}`
        );
      }
    }
  }
);
