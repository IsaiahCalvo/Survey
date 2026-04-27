// tests/phase27/byteaRoundTrip.test.mjs
// Phase 27 Wave 0 scaffold — runs as test.skip until Plan 27-02 (yjs install) +
// Plan 27-03 (schema migration) land.
// Source: .planning/phases/27-crdt-foundation/27-RESEARCH.md § Validation Architecture.
//
// UX/architecture rationale: Yjs updates are binary. Any encode/decode delta in the
// transport will corrupt CRDT history irreversibly (state vectors stop matching,
// merge becomes nondeterministic). This test does the full round-trip:
//   1. Create Y.Doc, write a Y.Map field.
//   2. Encode update via Y.encodeStateAsUpdate(doc).
//   3. INSERT bytes into doc_yjs_updates as bytea.
//   4. SELECT row back, decode bytes via Y.applyUpdate(doc2, returnedBytes).
//   5. Assert doc2's Y.Map field equals the original.
//
// Skip conditions:
//   - SUPABASE_TEST_URL not set (no Supabase instance reachable).
//   - node_modules/yjs not present (Plan 27-02 has not installed yjs yet).

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const yjsAvailable = existsSync(resolve(REPO_ROOT, 'node_modules/yjs/package.json'));
const supabaseLibAvailable = existsSync(
  resolve(REPO_ROOT, 'node_modules/@supabase/supabase-js/package.json')
);

const skipReason = !process.env.SUPABASE_TEST_URL
  ? 'SUPABASE_TEST_URL env not set — bytea round-trip only runs in CI/local-supabase mode'
  : !yjsAvailable
    ? 'yjs not yet installed (Plan 27-02 owns the install)'
    : !supabaseLibAvailable
      ? '@supabase/supabase-js not installed yet'
      : false;

test(
  'Yjs binary update round-trips through doc_yjs_updates.update (bytea)',
  { skip: skipReason },
  async () => {
    const Y = await import('yjs');
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(
      process.env.SUPABASE_TEST_URL,
      process.env.SUPABASE_TEST_SERVICE_KEY || process.env.SUPABASE_TEST_ANON_KEY
    );

    // 1. Build a Y.Doc with a known Y.Map field.
    const doc1 = new Y.Doc();
    doc1.getMap('annotations').set('test-key', 'test-value');
    const encoded = Y.encodeStateAsUpdate(doc1);
    ok(encoded instanceof Uint8Array, 'encoded update must be a Uint8Array');
    ok(encoded.length > 0, 'encoded update must contain bytes');

    // 2. INSERT into doc_yjs_updates. Use a synthetic document_id so the
    // test doesn't collide with real production rows.
    const documentId = '00000000-0000-0000-0000-000000000027';
    const clientId = 'phase27-roundtrip-test';
    // Supabase expects bytea as base64 over the wire when using PostgREST.
    // The client library handles Uint8Array → base64 transparently.
    const { data: inserted, error: insertErr } = await client
      .from('doc_yjs_updates')
      .insert({
        document_id: documentId,
        client_id: clientId,
        seq: Date.now(),
        update: encoded,
        origin: { source: 'phase27-byteaRoundTrip-test' },
      })
      .select('id, update')
      .single();
    ok(!insertErr, `INSERT must succeed: ${insertErr?.message}`);
    ok(inserted, 'expected one inserted row back');

    // 3. SELECT it back fresh.
    const { data: row, error: selectErr } = await client
      .from('doc_yjs_updates')
      .select('update')
      .eq('id', inserted.id)
      .single();
    ok(!selectErr, `SELECT must succeed: ${selectErr?.message}`);

    // 4. Apply the returned bytes onto a fresh doc.
    const returnedBytes = row.update instanceof Uint8Array
      ? row.update
      : new Uint8Array(Buffer.from(row.update, 'base64'));
    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, returnedBytes);

    // 5. Assert the Y.Map field is restored.
    strictEqual(
      doc2.getMap('annotations').get('test-key'),
      'test-value',
      'round-tripped Y.Doc must preserve the Y.Map field'
    );

    // Clean up — best-effort delete so the test row doesn't leak.
    await client.from('doc_yjs_updates').delete().eq('id', inserted.id);
  }
);
