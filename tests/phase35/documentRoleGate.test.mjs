// tests/phase35/documentRoleGate.test.mjs
// 2026-07-01 — Viewer-role read-only gate.
//
// A collaborator whose effective role is 'viewer' must get the read-only
// presentation from document open (dimmed toolbar, suppressed mutation
// keystrokes, view-only banner) — not just silent server-side write rejection.
//
// Two layers under test:
//   1. Pure logic (direct import, mocked rpc — no network):
//      src/lib/collab/documentRole.js
//        - fetchMyDocumentRole: wraps the get_my_document_role RPC; fail-open
//          contract (ANY error → null → read-write presentation stands).
//        - resolveReadOnlyReason: 'revoked' (Phase 28 accessRevoked) wins over
//          'viewer'; anything else → null.
//   2. Wiring (source-grep — node:test cannot load .jsx; same precedent as
//      src/components/collab/__tests__/StorageFailureBanner.syncQueueStuck.test.mjs):
//        - ReadOnlyGate.jsx keys its effect off resolveReadOnlyReason({ accessRevoked, docRole })
//        - YDocProvider.jsx fetches the role per docId and mounts the
//          viewer_access banner gated on !accessRevoked (revoked copy wins)
//        - StorageFailureBanner.jsx carries the locked viewer_access copy and
//          keeps the no-dismiss carve-out restricted to permission_revoked
//          (the viewer banner IS dismissable).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  fetchMyDocumentRole,
  resolveReadOnlyReason,
  KNOWN_DOCUMENT_ROLES,
} from '../../src/lib/collab/documentRole.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const READONLY_GATE = resolve(__dirname, '../../src/components/collab/ReadOnlyGate.jsx');
const READONLY_CSS = resolve(__dirname, '../../src/components/collab/ReadOnlyGate.css');
const YDOC_PROVIDER = resolve(__dirname, '../../src/components/collab/YDocProvider.jsx');
const BANNER = resolve(__dirname, '../../src/components/collab/StorageFailureBanner.jsx');

const DOC_ID = 'doc-test-1234';

/** Minimal supabase-shaped mock: records calls, resolves the given payload. */
function mockClient(payload, { throws = false } = {}) {
  const calls = [];
  return {
    calls,
    rpc: (fnName, args) => {
      calls.push({ fnName, args });
      if (throws) return Promise.reject(new Error('network down'));
      return Promise.resolve(payload);
    },
  };
}

// ---------------------------------------------------------------------------
// 1. fetchMyDocumentRole — pure logic, mocked rpc
// ---------------------------------------------------------------------------

test('fetchMyDocumentRole #1: resolves each known role verbatim', async () => {
  for (const role of KNOWN_DOCUMENT_ROLES) {
    const client = mockClient({ data: role, error: null });
    assert.equal(await fetchMyDocumentRole(client, DOC_ID), role);
  }
});

test('fetchMyDocumentRole #2: calls get_my_document_role with { doc_id }', async () => {
  const client = mockClient({ data: 'viewer', error: null });
  await fetchMyDocumentRole(client, DOC_ID);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].fnName, 'get_my_document_role');
  assert.deepEqual(client.calls[0].args, { doc_id: DOC_ID });
});

test('fetchMyDocumentRole #3: NULL data (no access) resolves null', async () => {
  const client = mockClient({ data: null, error: null });
  assert.equal(await fetchMyDocumentRole(client, DOC_ID), null);
});

test('fetchMyDocumentRole #4: RPC error resolves null (fail open, never lock the owner out)', async () => {
  const client = mockClient({ data: null, error: { message: 'boom', code: '500' } });
  assert.equal(await fetchMyDocumentRole(client, DOC_ID), null);
});

test('fetchMyDocumentRole #5: thrown/network error resolves null (fail open)', async () => {
  const client = mockClient(null, { throws: true });
  assert.equal(await fetchMyDocumentRole(client, DOC_ID), null);
});

test('fetchMyDocumentRole #6: unknown role string resolves null (fail open on malformed payload)', async () => {
  const client = mockClient({ data: 'superadmin', error: null });
  assert.equal(await fetchMyDocumentRole(client, DOC_ID), null);
});

test('fetchMyDocumentRole #7: missing client / missing rpc / missing docId resolve null without calling rpc', async () => {
  assert.equal(await fetchMyDocumentRole(null, DOC_ID), null);
  assert.equal(await fetchMyDocumentRole({}, DOC_ID), null);
  const client = mockClient({ data: 'viewer', error: null });
  assert.equal(await fetchMyDocumentRole(client, null), null);
  assert.equal(await fetchMyDocumentRole(client, ''), null);
  assert.equal(client.calls.length, 0);
});

// ---------------------------------------------------------------------------
// 2. resolveReadOnlyReason — precedence contract
// ---------------------------------------------------------------------------

test("resolveReadOnlyReason #1: docRole 'viewer' → 'viewer' (the new from-the-start trigger)", () => {
  assert.equal(resolveReadOnlyReason({ accessRevoked: false, docRole: 'viewer' }), 'viewer');
});

test("resolveReadOnlyReason #2: accessRevoked wins over 'viewer' (revoked copy takes precedence)", () => {
  assert.equal(resolveReadOnlyReason({ accessRevoked: true, docRole: 'viewer' }), 'revoked');
  assert.equal(resolveReadOnlyReason({ accessRevoked: true, docRole: null }), 'revoked');
  assert.equal(resolveReadOnlyReason({ accessRevoked: true, docRole: 'editor' }), 'revoked');
});

test('resolveReadOnlyReason #3: owner/editor/null/undefined roles stay read-write (fail open)', () => {
  assert.equal(resolveReadOnlyReason({ accessRevoked: false, docRole: 'owner' }), null);
  assert.equal(resolveReadOnlyReason({ accessRevoked: false, docRole: 'editor' }), null);
  assert.equal(resolveReadOnlyReason({ accessRevoked: false, docRole: null }), null);
  assert.equal(resolveReadOnlyReason({ accessRevoked: false }), null);
  assert.equal(resolveReadOnlyReason({}), null);
  assert.equal(resolveReadOnlyReason(), null);
});

// ---------------------------------------------------------------------------
// 3. Wiring — source assertions (node:test cannot render .jsx)
// ---------------------------------------------------------------------------

test(
  'wiring #1: ReadOnlyGate keys its effect off resolveReadOnlyReason({ accessRevoked, docRole })',
  { skip: !existsSync(READONLY_GATE) ? 'ReadOnlyGate.jsx missing' : false },
  () => {
    const src = readFileSync(READONLY_GATE, 'utf8');
    assert.ok(src.includes('resolveReadOnlyReason'), 'ReadOnlyGate must import/use resolveReadOnlyReason');
    assert.ok(src.includes('docRole'), 'ReadOnlyGate must read docRole from useYDoc()');
    assert.ok(src.includes('accessRevoked'), 'ReadOnlyGate must still honor the Phase 28 accessRevoked trigger');
  }
);

test(
  'wiring #1b: view-only mode blocks pointer interaction with the annotation SVG',
  { skip: !existsSync(READONLY_CSS) ? 'ReadOnlyGate.css missing' : false },
  () => {
    const src = readFileSync(READONLY_CSS, 'utf8');
    assert.match(src, /body\[data-readonly="true"\][\s\S]*\.survey-pdfjs-page-div[\s\S]*svg\[style\*="pointer-events: auto"\][\s\S]*pointer-events:\s*none/);
  },
);

// The mounted provider tests verify role resolution and context delivery;
// avoid pinning the provider's internal import path here.

test(
  'wiring #3: YDocProvider mounts the viewer_access banner gated on !accessRevoked (revoked copy wins)',
  { skip: !existsSync(YDOC_PROVIDER) ? 'YDocProvider.jsx missing' : false },
  () => {
    const src = readFileSync(YDOC_PROVIDER, 'utf8');
    assert.ok(
      src.includes('"viewer_access"') || src.includes("'viewer_access'"),
      'YDocProvider must render the viewer_access banner variant'
    );
    assert.ok(
      src.includes("docRole === 'viewer' && !accessRevoked"),
      'viewer banner gate must yield to the Phase 28 permission_revoked banner'
    );
  }
);

test(
  'wiring #4: StorageFailureBanner carries the locked viewer_access copy',
  { skip: !existsSync(BANNER) ? 'StorageFailureBanner.jsx missing' : false },
  () => {
    const src = readFileSync(BANNER, 'utf8');
    assert.ok(src.includes('viewer_access'), 'viewer_access code present in the copy maps');
    assert.ok(src.includes('View-only access'), "heading 'View-only access' present");
    assert.ok(
      src.includes('You have view-only access to this document'),
      'viewer body copy present and distinct from the revoked-access copy'
    );
  }
);

test(
  'wiring #5: viewer banner stays dismissable — no-dismiss carve-out remains permission_revoked-only',
  { skip: !existsSync(BANNER) ? 'StorageFailureBanner.jsx missing' : false },
  () => {
    const src = readFileSync(BANNER, 'utf8');
    assert.ok(
      src.includes("code !== 'permission_revoked'"),
      'showDismiss gate must remain restricted to permission_revoked (viewer_access inherits the standard dismiss)'
    );
  }
);
