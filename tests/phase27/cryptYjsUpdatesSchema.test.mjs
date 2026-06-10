// tests/phase27/cryptYjsUpdatesSchema.test.mjs
// Phase 27 Wave 0 scaffold — runs as test.skip until Plan 27-03 schema migration lands.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md § AUTH-03 verification.
//
// UX/architecture rationale: AUTH-03 requires server-authoritative timestamps on
// every CRDT update + activity log entry. Client clocks lie (NTP drift, clock
// skew, malicious tampering). This test pins the AUTH-03 contract at the schema
// level: `server_ts` MUST be NOT NULL with DEFAULT now() on both
// `doc_yjs_updates` and `activity_log` so Postgres stamps the time even if the
// inserting client omits it.
//
// Why this matters: Phase 28's transport orders updates by server_ts for cross-
// device merge. If server_ts were nullable, a malicious or buggy client could
// INSERT NULL and break the merge order silently.
//
// Re-enabled by KAL-257 (2026-06-10): runs via `npm run test:integration`
// against an allowlisted cloud TEST project (see ./integrationEnv.mjs).
// PostgREST does NOT expose information_schema, so this reads the test-only
// view public.test_schema_columns created by scripts/bootstrap-test-db.sql
// (same columns, same filters — assertions unchanged).

import { test } from 'node:test';
import { strictEqual, ok, match } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { integrationSkipReason } from './integrationEnv.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const skipReason = integrationSkipReason()
  || (!existsSync(resolve(REPO_ROOT, 'node_modules/@supabase/supabase-js/package.json'))
    ? '@supabase/supabase-js not installed yet'
    : false);

test(
  'AUTH-03: server_ts column is NOT NULL with DEFAULT now() on doc_yjs_updates and activity_log',
  { skip: skipReason },
  async () => {
    const { createClient } = await import('@supabase/supabase-js');
    // Service key only — no anon fallback (see integrationEnv.mjs).
    const client = createClient(
      process.env.SUPABASE_TEST_URL,
      process.env.SUPABASE_TEST_SERVICE_KEY
    );

    const { data: rows, error } = await client
      .from('test_schema_columns')
      .select('table_name, column_name, is_nullable, column_default')
      .eq('table_schema', 'public')
      .in('table_name', ['doc_yjs_updates', 'activity_log'])
      .eq('column_name', 'server_ts');

    ok(!error, `query must succeed: ${error?.message}`);
    ok(Array.isArray(rows), 'expected an array of rows');
    strictEqual(
      rows.length,
      2,
      'expected exactly 2 rows (one per table) — verifies server_ts exists on BOTH tables'
    );

    for (const row of rows) {
      strictEqual(
        row.is_nullable,
        'NO',
        `${row.table_name}.server_ts must be NOT NULL (AUTH-03)`
      );
      // Postgres reports DEFAULTs as `now()` (lower-case, with parens) — match
      // case-insensitively to allow either `now()` or `NOW()`.
      ok(
        row.column_default,
        `${row.table_name}.server_ts must have a column_default (AUTH-03)`
      );
      match(
        String(row.column_default),
        /^now\(\)/i,
        `${row.table_name}.server_ts must DEFAULT now() (AUTH-03), got "${row.column_default}"`
      );
    }
  }
);
