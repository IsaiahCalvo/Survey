// tests/phase27/byteaRoundTrip.test.mjs
// Phase 27 bytea transport check. It runs against the main Survey project but
// writes only to public.integration_test_bytea_roundtrip, a service-role-only
// table with RLS enabled and no user policies.
//
// UX/architecture rationale: Yjs updates are binary. Any encode/decode delta in the
// transport will corrupt CRDT history irreversibly (state vectors stop matching,
// merge becomes nondeterministic). This test does the full round-trip:
//   1. Create Y.Doc, write a Y.Map field.
//   2. Encode update via Y.encodeStateAsUpdate(doc).
//   3. INSERT into the isolated transport table as PostgREST hex bytea — the SAME wire format
//      the app uses (bytesToPgHex/pgHexToBytes mirror src/services/annotationDocSync.js).
//   4. SELECT the row back, decode the hex, Y.applyUpdate onto a fresh doc.
//   5. Assert the Y.Map field survived byte-exactly.
//
// Hygiene: per-run randomUUID row id, all cleanup in finally, and an exact
// leak assertion. No customer/user/document row is created or modified.

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
  'Yjs binary update round-trips through the isolated PostgREST bytea transport',
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

    const rowId = randomUUID();
    let rowInserted = false;

    try {
      // 1. Build a Y.Doc with a known Y.Map field.
      const doc1 = new Y.Doc();
      doc1.getMap('annotations').set('test-key', 'test-value');
      const encoded = Y.encodeStateAsUpdate(doc1);
      ok(encoded instanceof Uint8Array, 'encoded update must be a Uint8Array');
      ok(encoded.length > 0, 'encoded update must contain bytes');

      // 2. INSERT as PostgREST hex — the app's wire format.
      const { data: inserted, error: insertErr } = await client
        .from('integration_test_bytea_roundtrip')
        .insert({
          id: rowId,
          payload: bytesToPgHex(encoded),
        })
        .select('id')
        .single();
      ok(!insertErr, `INSERT must succeed: ${insertErr?.message}`);
      ok(inserted, 'expected one inserted row back');
      strictEqual(inserted.id, rowId, 'inserted row id must match the isolated run id');
      rowInserted = true;

      // 3. SELECT it back fresh.
      const { data: row, error: selectErr } = await client
        .from('integration_test_bytea_roundtrip')
        .select('payload')
        .eq('id', rowId)
        .single();
      ok(!selectErr, `SELECT must succeed: ${selectErr?.message}`);

      // 4. Decode the returned hex and apply onto a fresh doc.
      const returnedBytes = pgHexToBytes(row.payload);
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
      if (rowInserted) {
        const { error: deleteError } = await client
          .from('integration_test_bytea_roundtrip').delete().eq('id', rowId);
        ok(!deleteError, `cleanup DELETE must succeed: ${deleteError?.message}`);
        const { data: leftovers, error: leftoverError } = await client
          .from('integration_test_bytea_roundtrip').select('id').eq('id', rowId);
        ok(!leftoverError, `leak-check SELECT must succeed: ${leftoverError?.message}`);
        strictEqual((leftovers || []).length, 0,
          `leaked isolated bytea row on project ${maskedTestRef()}`);
      }
    }
  }
);
