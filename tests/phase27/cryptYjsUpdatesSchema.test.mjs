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
// Runs via `npm run test:integration` against the main Survey project. It reads
// PostgREST's OpenAPI schema and performs no database writes.

import { test } from 'node:test';
import { strictEqual, ok, match } from 'node:assert';
import { integrationSkipReason, loadPublicOpenApiSchema } from './integrationEnv.mjs';

const skipReason = integrationSkipReason();

test(
  'AUTH-03: server_ts column is NOT NULL with DEFAULT now() on doc_yjs_updates and activity_log',
  { skip: skipReason },
  async () => {
    const schema = await loadPublicOpenApiSchema();
    for (const tableName of ['doc_yjs_updates', 'activity_log']) {
      const definition = schema.definitions[tableName];
      ok(definition, `${tableName} must be exposed by PostgREST OpenAPI`);
      ok(
        definition.required?.includes('server_ts'),
        `${tableName}.server_ts must be NOT NULL (AUTH-03)`,
      );
      const columnDefault = definition.properties?.server_ts?.default;
      ok(
        columnDefault,
        `${tableName}.server_ts must have a column_default (AUTH-03)`
      );
      match(
        String(columnDefault),
        /^now\(\)/i,
        `${tableName}.server_ts must DEFAULT now() (AUTH-03), got "${columnDefault}"`
      );
    }
  }
);
