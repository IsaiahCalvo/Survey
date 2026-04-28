// tests/phase28/originBuilder.test.mjs
// Phase 28 Wave 0 scaffold — runs as test.skip until Plan 28-02 lands originBuilder.js.
// Source: .planning/phases/28-transport-spike-auth-validator/28-RESEARCH.md § Pattern 3 (origin payload).
//
// UX/architecture rationale: every Yjs transaction in v2.4 carries an origin payload of
// `{ userId, deviceId, sessionId, clientID, source }`. The builder is the single source
// of truth for that shape — Phase 29's per-user undo (Y.UndoManager.trackedOrigins) and
// Phase 33's activity-log writes both consume it verbatim. The frozen-object contract
// short-circuits transport echo loops (REMOTE_BC_ORIGIN / REMOTE_REALTIME_ORIGIN) by
// reference equality.
//
// Skip condition: src/lib/collab/originBuilder.js has not been created yet (Plan 28-02
// owns it). Once landed, this scaffold flips automatically from skip → green.

import { test } from 'node:test';
import { strictEqual, ok, notStrictEqual } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const TARGET = resolve(REPO_ROOT, 'src/lib/collab/originBuilder.js');

// Each test inlines the skip-guard pattern verbatim — kept consistent across all
// 5 tests so the acceptance-criteria grep `grep -c "skip: !existsSync(TARGET)"`
// matches every invocation. Pattern lifted from tests/phase27/schemaPresence.test.mjs.

test(
  'originBuilder: returns object with userId/deviceId/sessionId/clientID/source=local',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/originBuilder.js not yet present (Plan 28-02)' : false },
  async () => {
    const { buildOrigin } = await import(TARGET);
    const origin = buildOrigin({
      userId: 'user-uuid-1',
      deviceId: 'Isaiahs-MacBook-Pro.local',
      sessionId: 'session-1',
      clientID: 12345,
    });
    strictEqual(origin.userId, 'user-uuid-1');
    strictEqual(origin.deviceId, 'Isaiahs-MacBook-Pro.local');
    strictEqual(origin.sessionId, 'session-1');
    strictEqual(origin.clientID, 12345);
    strictEqual(origin.source, 'local', 'local-origin payloads must carry source: "local"');
  }
);

test(
  'originBuilder: returned object is Object.frozen',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/originBuilder.js not yet present (Plan 28-02)' : false },
  async () => {
    const { buildOrigin } = await import(TARGET);
    const origin = buildOrigin({
      userId: 'u',
      deviceId: 'd',
      sessionId: 's',
      clientID: 1,
    });
    ok(Object.isFrozen(origin), 'origin must be Object.frozen so transport echo guards can compare by reference');
  }
);

test(
  'originBuilder: partial input still returns full shape (undefined for missing keys)',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/originBuilder.js not yet present (Plan 28-02)' : false },
  async () => {
    const { buildOrigin } = await import(TARGET);
    // Should not throw — must be defensive against partial wiring during boot.
    const origin = buildOrigin({ userId: 'u' });
    strictEqual(origin.userId, 'u');
    strictEqual(origin.deviceId, undefined);
    strictEqual(origin.sessionId, undefined);
    strictEqual(origin.clientID, undefined);
    strictEqual(origin.source, 'local');
  }
);

test(
  'originBuilder: serverTs is NOT set client-side (server fills via DEFAULT NOW())',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/originBuilder.js not yet present (Plan 28-02)' : false },
  async () => {
    const { buildOrigin } = await import(TARGET);
    const origin = buildOrigin({
      userId: 'u',
      deviceId: 'd',
      sessionId: 's',
      clientID: 1,
    });
    strictEqual(
      'serverTs' in origin,
      false,
      'client must NOT fabricate serverTs — Postgres DEFAULT NOW() is server-authoritative (AUTH-03)'
    );
  }
);

test(
  'originBuilder: payload distinct from REMOTE_BC_ORIGIN and REMOTE_REALTIME_ORIGIN by source string',
  { skip: !existsSync(TARGET) ? 'src/lib/collab/originBuilder.js not yet present (Plan 28-02)' : false },
  async () => {
    const { buildOrigin, REMOTE_BC_ORIGIN, REMOTE_REALTIME_ORIGIN } = await import(TARGET);
    const local = buildOrigin({ userId: 'u', deviceId: 'd', sessionId: 's', clientID: 1 });
    notStrictEqual(local, REMOTE_BC_ORIGIN, 'local origin must not be the BroadcastChannel sentinel');
    notStrictEqual(local, REMOTE_REALTIME_ORIGIN, 'local origin must not be the Realtime sentinel');
    notStrictEqual(local.source, REMOTE_BC_ORIGIN?.source, 'source strings must differ');
    notStrictEqual(local.source, REMOTE_REALTIME_ORIGIN?.source, 'source strings must differ');
  }
);
