// tests/phase27/byteaRoundTrip.test.mjs
// Phase 27 Wave 0 scaffold — re-enabled by KAL-257 (2026-06-10) against an
// allowlisted cloud TEST project (see ./integrationEnv.mjs; never production).
//
// UX/architecture rationale: Yjs updates are binary. Any encode/decode delta in the
// transport will corrupt CRDT history irreversibly (state vectors stop matching,
// merge becomes nondeterministic). This test does the full round-trip:
//   1. Create Y.Doc, write a Y.Map field.
//   2. Encode update via Y.encodeStateAsUpdate(doc).
//   3. INSERT into doc_yjs_updates as PostgREST hex bytea — the SAME wire format
//      the app uses (bytesToPgHex/pgHexToBytes mirror src/services/annotationDocSync.js).
//   4. SELECT the row back, decode the hex, Y.applyUpdate onto a fresh doc.
//   5. Assert the Y.Map field survived byte-exactly.
//
// Hygiene (Codex round-1/2 findings): per-run randomUUID document id (no
// cross-run collisions), seq=1 (no Date.now() semantics), parent documents row
// for the FK, all cleanup in finally with allocation-gated leak assertions.

import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { integrationSkipReason, maskedTestRef } from './integrationEnv.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const yjsAvailable = existsSync(resolve(REPO_ROOT, 'node_modules/yjs/package.json'));
const supabaseLibAvailable = existsSync(
  resolve(REPO_ROOT, 'node_modules/@supabase/supabase-js/package.json')
);

const skipReason = integrationSkipReason()
  || (!yjsAvailable ? 'yjs not installed' : false)
  || (!supabaseLibAvailable ? '@supabase/supabase-js not installed' : false);

// PostgREST returns/accepts bytea as '\x<hex>'. These mirror the production
// transport helpers in src/services/annotationDocSync.js EXACTLY — the point
// of this test is to pin that wire format, not a hypothetical base64 one.
function bytesToPgHex(u8) {
  let hex = '';
  for (let i = 0; i < u8.length; i += 1) hex += u8[i].toString(16).padStart(2, '0');
  return `\\x${hex}`;
}
function pgHexToBytes(str) {
  const hex = (typeof str === 'string' && str.startsWith('\\x')) ? str.slice(2) : (str || '');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

test(
  'Yjs binary update round-trips through doc_yjs_updates.update (bytea)',
  { skip: skipReason },
  async () => {
    const Y = await import('yjs');
    const { createClient } = await import('@supabase/supabase-js');
    // Service key only — the phase27 tables have deny-all RLS stubs, and the
    // guard in integrationEnv.mjs already proved this is an allowlisted TEST
    // project. No anon fallback by design.
    const client = createClient(
      process.env.SUPABASE_TEST_URL,
      process.env.SUPABASE_TEST_SERVICE_KEY
    );

    const documentId = randomUUID();
    const clientId = 'phase27-byteaRoundTrip-test';
    let parentInserted = false;
    let insertedUpdateId = null;

    try {
      // 0. Parent row — doc_yjs_updates.document_id FK → documents(id).
      const { error: parentErr } = await client
        .from('documents')
        .insert({ id: documentId, name: 'phase27-byteaRoundTrip-test' });
      ok(!parentErr, `parent documents INSERT must succeed: ${parentErr?.message}`);
      parentInserted = true;

      // 1. Build a Y.Doc with a known Y.Map field.
      const doc1 = new Y.Doc();
      doc1.getMap('annotations').set('test-key', 'test-value');
      const encoded = Y.encodeStateAsUpdate(doc1);
      ok(encoded instanceof Uint8Array, 'encoded update must be a Uint8Array');
      ok(encoded.length > 0, 'encoded update must contain bytes');

      // 2. INSERT as PostgREST hex — the app's wire format.
      const { data: inserted, error: insertErr } = await client
        .from('doc_yjs_updates')
        .insert({
          document_id: documentId,
          client_id: clientId,
          seq: 1,
          update: bytesToPgHex(encoded),
          origin: { source: 'phase27-byteaRoundTrip-test' },
        })
        .select('id')
        .single();
      ok(!insertErr, `INSERT must succeed: ${insertErr?.message}`);
      ok(inserted, 'expected one inserted row back');
      insertedUpdateId = inserted.id;

      // 3. SELECT it back fresh.
      const { data: row, error: selectErr } = await client
        .from('doc_yjs_updates')
        .select('update')
        .eq('id', insertedUpdateId)
        .single();
      ok(!selectErr, `SELECT must succeed: ${selectErr?.message}`);

      // 4. Decode the returned hex and apply onto a fresh doc.
      const returnedBytes = pgHexToBytes(row.update);
      strictEqual(
        returnedBytes.length,
        encoded.length,
        'returned byte length must equal sent byte length (no encoding drift)'
      );
      const doc2 = new Y.Doc();
      Y.applyUpdate(doc2, returnedBytes);

      // 5. Assert the Y.Map field is restored.
      strictEqual(
        doc2.getMap('annotations').get('test-key'),
        'test-value',
        'round-tripped Y.Doc must preserve the Y.Map field'
      );
    } finally {
      // Cleanup + leak verification, gated on what was actually allocated so a
      // failed setup can never fake a clean pass. Every cleanup call asserts
      // its own success — a Supabase error here must fail the test, not let
      // the leak checks false-pass on empty data.
      if (insertedUpdateId !== null) {
        const { error: delUpdErr } = await client
          .from('doc_yjs_updates').delete().eq('id', insertedUpdateId);
        ok(!delUpdErr, `cleanup DELETE of update row must succeed: ${delUpdErr?.message}`);
      }
      if (parentInserted) {
        const { error: delByDocErr } = await client
          .from('doc_yjs_updates').delete().eq('document_id', documentId);
        ok(!delByDocErr, `cleanup DELETE by document_id must succeed: ${delByDocErr?.message}`);
        const { error: delDocErr } = await client
          .from('documents').delete().eq('id', documentId);
        ok(!delDocErr, `cleanup DELETE of parent document must succeed: ${delDocErr?.message}`);
        const { data: leftovers, error: leftoverErr } = await client
          .from('doc_yjs_updates').select('id').eq('document_id', documentId);
        ok(!leftoverErr, `leak-check SELECT on doc_yjs_updates must succeed: ${leftoverErr?.message}`);
        strictEqual((leftovers || []).length, 0,
          `leaked doc_yjs_updates rows on test project ${maskedTestRef()}`);
        const { data: docLeft, error: docLeftErr } = await client
          .from('documents').select('id').eq('id', documentId);
        ok(!docLeftErr, `leak-check SELECT on documents must succeed: ${docLeftErr?.message}`);
        strictEqual((docLeft || []).length, 0,
          `leaked documents row on test project ${maskedTestRef()}`);
      }
    }
  }
);
