// tests/rowIdSigningSecretIntegration.test.mjs
// KAL-308a integration tests — server-side Row-ID signing secret RPCs + RLS on the
// survey-test cloud Supabase project. Mirrors workbookRegistrationIntegration.test.mjs.
//
// Guards (three independent locks): SUPABASE_INTEGRATION=1, allowlisted host,
// service key present. Missing env → test.skip, never fail (0-fail under plain npm test).
//
// THE critical scenario is #2: a secret minted by the Postgres RPC must round-trip
// through the pure-JS generateRowIdToken/classifyRowIdToken (the S3 guard — proves
// PG's base64 string is byte-compatible with the JS HMAC key).
//
// Prerequisites applied by scripts/apply-kal308a-to-test-db.mjs.
// Run: SUPABASE_INTEGRATION=1 node --env-file=.env.test \
//        tests/rowIdSigningSecretIntegration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { generateRowIdToken, classifyRowIdToken } from '../src/services/rowIdToken.js';

const ALLOWED_TEST_HOSTS = ['zgdkyslxbkusexmkfvgd.supabase.co']; // survey-test

function integrationSkipReason() {
  if (process.env.SUPABASE_INTEGRATION !== '1') {
    return 'SUPABASE_INTEGRATION=1 not set';
  }
  const url = process.env.SUPABASE_TEST_URL;
  if (!url) return 'SUPABASE_TEST_URL not set';
  let host;
  try { host = new URL(url).host; } catch { return 'SUPABASE_TEST_URL invalid'; }
  if (!ALLOWED_TEST_HOSTS.includes(host)) return `host "${host}" not allowlisted`;
  if (!process.env.SUPABASE_TEST_SERVICE_KEY) return 'SUPABASE_TEST_SERVICE_KEY not set';
  return false;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const skipReason =
  integrationSkipReason() ||
  (!existsSync(resolve(REPO_ROOT, 'node_modules/@supabase/supabase-js/package.json'))
    ? '@supabase/supabase-js not installed'
    : false);

async function makeServiceClient() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_TEST_URL, process.env.SUPABASE_TEST_SERVICE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
async function makeUserClient(email, password) {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(process.env.SUPABASE_TEST_URL,
    process.env.SUPABASE_TEST_ANON_KEY || process.env.SUPABASE_TEST_SERVICE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${email}) failed: ${error.message}`);
  return { client, userId: data.user.id };
}
async function makeAnonClient() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(process.env.SUPABASE_TEST_URL,
    process.env.SUPABASE_TEST_ANON_KEY || process.env.SUPABASE_TEST_SERVICE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
async function provisionUsers(admin) {
  const suffix = 'kal308atest';
  const password = 'Kal308a-Test-Pw!';
  const roles = { owner: `owner-${suffix}@survey-test.invalid`,
                  editor: `editor-${suffix}@survey-test.invalid`,
                  viewer: `viewer-${suffix}@survey-test.invalid` };
  async function ensureUser(email) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error && !error.message.includes('already')) throw new Error(`createUser(${email}): ${error.message}`);
    if (data?.user) return data.user.id;
    const { data: list, error: listErr } = await admin.auth.admin.listUsers();
    if (listErr) throw new Error(`listUsers: ${listErr.message}`);
    const found = list.users.find((u) => u.email === email);
    if (!found) throw new Error(`user ${email} not found after create`);
    return found.id;
  }
  const ids = { ownerId: await ensureUser(roles.owner), editorId: await ensureUser(roles.editor),
                viewerId: await ensureUser(roles.viewer) };
  return { ...roles, password, ...ids };
}
async function insertDoc(admin, ownerId) {
  const { data, error } = await admin.from('documents')
    .insert({ name: 'KAL-308a Integration Doc', user_id: ownerId }).select('id').single();
  if (error) throw new Error(`insertDoc: ${error.message}`);
  return data.id;
}
async function addCollaborator(admin, docId, userId, role) {
  const { error } = await admin.from('document_collaborators')
    .upsert({ document_id: docId, user_id: userId, role, status: 'active' }, { onConflict: 'document_id,user_id' });
  if (error) throw new Error(`addCollaborator(${role}): ${error.message}`);
}
async function cleanup(admin, docId) {
  if (docId) await admin.from('documents').delete().eq('id', docId);
}

test('KAL-308a #1: get_or_create mints + is idempotent over a frozen signing id', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client } = await makeUserClient(owner, password);
  try {
    const { data: d1, error: e1 } = await client.rpc('kal308a_get_or_create_signing_secret',
      { p_document_id: docId, p_signing_id_seed: 'first:floorplan.pdf' });
    assert.equal(e1, null, `rpc error: ${e1?.message}`);
    const r1 = d1[0];
    assert.equal(r1.key_id, 'k1');
    assert.ok(typeof r1.secret_b64 === 'string' && r1.secret_b64.length >= 40, 'secret is a base64 string');
    assert.ok(!r1.secret_b64.includes('\n'), 'secret has no newline (S3-safe)');
    assert.equal(r1.signing_doc_id, 'first:floorplan.pdf');

    // Second call with a DIFFERENT seed must return the SAME secret + FROZEN signing id.
    const { data: d2, error: e2 } = await client.rpc('kal308a_get_or_create_signing_secret',
      { p_document_id: docId, p_signing_id_seed: 'renamed:other-name.pdf' });
    assert.equal(e2, null, `rpc error: ${e2?.message}`);
    assert.equal(d2[0].secret_b64, r1.secret_b64, 'secret is frozen across calls');
    assert.equal(d2[0].signing_doc_id, 'first:floorplan.pdf', 'signing id is frozen at first mint');
  } finally { await cleanup(admin, docId); }
});

test('KAL-308a #2: S3 parity — RPC-minted secret round-trips through generateRowIdToken/classifyRowIdToken', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client } = await makeUserClient(owner, password);
  try {
    const { data, error } = await client.rpc('kal308a_get_or_create_signing_secret',
      { p_document_id: docId, p_signing_id_seed: 'doc-uuid:plan.pdf' });
    assert.equal(error, null, `rpc error: ${error?.message}`);
    const { key_id, secret_b64, signing_doc_id } = data[0];

    // Sign a token with the SERVER secret + frozen id, exactly as the export path will.
    const token = await generateRowIdToken({
      keyId: key_id, secret: secret_b64, documentId: signing_doc_id,
      scopeId: 'mod7:cat3', markerId: 'marker-xyz',
    });
    // Verify with the SAME server secret, over the frozen id — exactly as the import/Edge path will.
    const verdict = await classifyRowIdToken(token, {
      documentId: signing_doc_id, scopeId: 'mod7:cat3',
      resolveSecret: (kid) => (kid === key_id ? secret_b64 : null),
    });
    assert.equal(verdict.status, 'valid', 'server-minted secret must verify a JS-signed token');
    assert.equal(verdict.markerId, 'marker-xyz');
  } finally { await cleanup(admin, docId); }
});

test('KAL-308a #3: viewer + anon are denied get_or_create (the forging wall)', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { viewer, password, ownerId, viewerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  await addCollaborator(admin, docId, viewerId, 'viewer');
  const { client: viewerClient } = await makeUserClient(viewer, password);
  const anon = await makeAnonClient();
  try {
    const { error: vErr } = await viewerClient.rpc('kal308a_get_or_create_signing_secret',
      { p_document_id: docId, p_signing_id_seed: 'x:y' });
    assert.ok(vErr != null, 'viewer must be denied');
    assert.match(vErr.message, /insufficient role|editor or owner/i, `got: ${vErr.message}`);

    const { error: aErr } = await anon.rpc('kal308a_get_or_create_signing_secret',
      { p_document_id: docId, p_signing_id_seed: 'x:y' });
    assert.ok(aErr != null, 'anon must be denied');
  } finally { await cleanup(admin, docId); }
});

test('KAL-308a #4: get_signing_secret reads the row; empty for a doc with no key', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const freshDocId = await insertDoc(admin, ownerId);
  const { client } = await makeUserClient(owner, password);
  try {
    await client.rpc('kal308a_get_or_create_signing_secret', { p_document_id: docId, p_signing_id_seed: 's:t' });
    const { data: got, error: gErr } = await client.rpc('kal308a_get_signing_secret', { p_document_id: docId });
    assert.equal(gErr, null, `get error: ${gErr?.message}`);
    assert.equal(got.length, 1, 'returns the minted row');
    assert.equal(got[0].signing_doc_id, 's:t');

    const { data: none, error: nErr } = await client.rpc('kal308a_get_signing_secret', { p_document_id: freshDocId });
    assert.equal(nErr, null, `get error: ${nErr?.message}`);
    assert.equal(none.length, 0, 'no key → empty (client treats as key-unavailable → review)');
  } finally { await cleanup(admin, docId); await cleanup(admin, freshDocId); }
});

test('KAL-308a #5: has_server_key true after mint, false before', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client } = await makeUserClient(owner, password);
  try {
    const { data: before } = await client.rpc('kal308a_has_server_key', { p_document_id: docId });
    assert.equal(before, false, 'no key before mint');
    await client.rpc('kal308a_get_or_create_signing_secret', { p_document_id: docId, p_signing_id_seed: 'a:b' });
    const { data: after } = await client.rpc('kal308a_has_server_key', { p_document_id: docId });
    assert.equal(after, true, 'key present after mint');
  } finally { await cleanup(admin, docId); }
});

test('KAL-308a #6: RLS — authenticated direct SELECT on rowid_signing_secrets is blocked/empty', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client } = await makeUserClient(owner, password);
  try {
    await client.rpc('kal308a_get_or_create_signing_secret', { p_document_id: docId, p_signing_id_seed: 'a:b' });
    // The secret exists (service client can see it) ...
    const { data: svc } = await admin.from('rowid_signing_secrets').select('secret_b64').eq('document_id', docId);
    assert.equal(svc.length, 1, 'service role can read the secret');
    // ... but an authenticated editor/owner gets permission-denied OR empty (REVOKE ALL + RLS).
    const { data: cliData, error: cliErr } = await client.from('rowid_signing_secrets').select('secret_b64').eq('document_id', docId);
    const blocked = (cliErr != null) || (Array.isArray(cliData) && cliData.length === 0);
    assert.ok(blocked, `direct client SELECT must be denied or empty; got data=${JSON.stringify(cliData)} err=${cliErr?.message}`);
  } finally { await cleanup(admin, docId); }
});
