// Owner 2026-10-07 ("ok, add the template list change"): the owner links the
// templates a shared document uses; a member claims them while the owner is away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { linkDocumentTemplates, claimDocumentTemplates } from '../src/services/sharedTemplates.js';

const DOC = '11111111-1111-4111-8111-111111111111';
const T1 = '22222222-2222-4222-8222-222222222222';
const ME = '33333333-3333-4333-8333-333333333333';

test('link upserts one row per owned template, ignoring duplicates', async () => {
  const calls = [];
  const client = { from: (table) => ({ upsert: async (rows, opts) => { calls.push({ table, rows, opts }); return { error: null }; } }) };
  assert.equal(await linkDocumentTemplates({ client, documentId: DOC, userId: ME, templateRowIds: [T1, T1, 'not-a-uuid'] }), true);
  assert.deepEqual(calls, [{ table: 'document_templates', rows: [{ document_id: DOC, template_id: T1, linked_by: ME }], opts: { onConflict: 'document_id,template_id', ignoreDuplicates: true } }]);
});

test('link never throws and reports false when the table is missing', async () => {
  const client = { from: () => ({ upsert: async () => ({ error: { message: 'relation "document_templates" does not exist' } }) }) };
  assert.equal(await linkDocumentTemplates({ client, documentId: DOC, userId: ME, templateRowIds: [T1] }), false);
  const throwing = { from: () => { throw new Error('boom'); } };
  assert.equal(await linkDocumentTemplates({ client: throwing, documentId: DOC, userId: ME, templateRowIds: [T1] }), false);
  assert.equal(await linkDocumentTemplates({ client, documentId: DOC, userId: ME, templateRowIds: [] }), false);
});

test('claim calls the rpc with the document id and returns the count; 0 on refusal', async () => {
  const seen = [];
  const ok = { rpc: async (fn, args) => { seen.push([fn, args]); return { data: 2, error: null }; } };
  assert.equal(await claimDocumentTemplates({ client: ok, documentId: DOC }), 2);
  assert.deepEqual(seen, [['claim_document_templates', { p_document_id: DOC }]]);
  const missing = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'function not found' } }) };
  assert.equal(await claimDocumentTemplates({ client: missing, documentId: DOC }), 0);
  assert.equal(await claimDocumentTemplates({ client: ok, documentId: 'x' }), 0);
});
