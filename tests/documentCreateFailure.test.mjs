// Round 4 audit (r4d #11): a 6th document on Free said "new row violates
// row-level security policy for table documents". At the plan limit it now
// says the limit, as the project limit does.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { documentCreateFailure, isRowRuleRefusal } from '../src/utils/documentCreateFailure.js';

const RLS = { code: '42501', message: 'new row violates row-level security policy for table "documents"' };
const client = ({ limit, count }) => ({
  rpc: async (name) => { assert.equal(name, 'get_document_limit'); return { data: limit, error: null }; },
  from: () => ({ select: () => ({ eq: async () => ({ count, error: null }) }) }),
});

test('a row-rule refusal is recognised by code or words', () => {
  assert.equal(isRowRuleRefusal(RLS), true);
  assert.equal(isRowRuleRefusal({ message: 'new row violates row-level security policy' }), true);
  assert.equal(isRowRuleRefusal({ message: 'network down' }), false);
});

test('at the document limit: the plan message, never the server words', async () => {
  const out = await documentCreateFailure(RLS, { client: client({ limit: 5, count: 5 }), userId: 'u1', tier: 'free' });
  assert.equal(out.limit, true);
  assert.match(out.text, /^You've reached the limit of 5 documents on the Free plan\./);
  assert.doesNotMatch(out.text, /row-level|policy/i);
});

test('refused below the limit: plain words, not the raw text', async () => {
  const out = await documentCreateFailure(RLS, { client: client({ limit: 5, count: 2 }), userId: 'u1' });
  assert.equal(out.limit, false);
  assert.doesNotMatch(out.text, /row-level|policy/i);
});

test('other failures keep their own reason', async () => {
  const out = await documentCreateFailure({ message: 'Failed to fetch' }, { client: client({ limit: 5, count: 5 }), userId: 'u1' });
  assert.equal(out.limit, false);
  assert.match(out.text, /Failed to fetch/);
});

test('both upload paths in Dashboard use it', () => {
  const src = fs.readFileSync(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  assert.equal((src.match(/await reportDocumentCreateFailure\(createErr\)/g) || []).length, 2);
  assert.doesNotMatch(src, /prepare the document in the cloud: ' \+/);
});
