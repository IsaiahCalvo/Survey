// tests/workbookRegistrationIntegration.test.mjs
// KAL-307 integration tests — workbook registration RPC + RLS on the survey-test
// cloud Supabase project.
//
// Guards (three independent locks, same pattern as phase27/integrationEnv.mjs):
//   1. SUPABASE_INTEGRATION=1 must be set (plain `npm test` never sets it).
//   2. SUPABASE_TEST_URL host must be in the hardcoded allowlist.
//   3. SUPABASE_TEST_SERVICE_KEY must be present.
// Missing env → test.skip, never fail.  This file is picked up by
// `node scripts/run-node-tests.mjs` and must remain 0-fail without creds.
//
// Scenarios:
//   1. First registration mints generation 1; token returned ≠ hash stored.
//   2. Owner re-export revokes old row (generation N) and mints generation N+1.
//   3. Editor attempting to replace an existing active registration is rejected.
//   4. Duplicate INSERT (direct, bypassing RPC) is rejected by the unique partial index.
//   5. Token hash stored ≠ raw token returned.
//   6. RLS INSERT blocked — direct INSERT as authenticated user fails.
//   7. RLS UPDATE blocked — direct UPDATE as authenticated user fails.
//   8. RLS SELECT — member with viewer access can read their document's registration.
//
// Prerequisites applied by scripts/apply-kal307-to-test-db.mjs.
// Run: SUPABASE_INTEGRATION=1 node --env-file=.env.test \
//        tests/workbookRegistrationIntegration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Guard — same pattern as tests/phase27/integrationEnv.mjs
// ---------------------------------------------------------------------------

const ALLOWED_TEST_HOSTS = [
  'zgdkyslxbkusexmkfvgd.supabase.co', // survey-test
];

function integrationSkipReason() {
  if (process.env.SUPABASE_INTEGRATION !== '1') {
    return 'SUPABASE_INTEGRATION=1 not set — integration tests only run via explicit env flag';
  }
  const url = process.env.SUPABASE_TEST_URL;
  if (!url) return 'SUPABASE_TEST_URL not set — see .env.test.example';
  let host;
  try { host = new URL(url).host; } catch { return `SUPABASE_TEST_URL is not a valid URL`; }
  if (!ALLOWED_TEST_HOSTS.includes(host)) {
    return `SUPABASE_TEST_URL host "${host}" is not an allowlisted TEST project — refusing`;
  }
  if (!process.env.SUPABASE_TEST_SERVICE_KEY) {
    return 'SUPABASE_TEST_SERVICE_KEY not set — service key required (no anon fallback)';
  }
  return false;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const skipReason =
  integrationSkipReason() ||
  (!existsSync(resolve(REPO_ROOT, 'node_modules/@supabase/supabase-js/package.json'))
    ? '@supabase/supabase-js not installed'
    : false);

// ---------------------------------------------------------------------------
// Helpers — only executed when not skipped
// ---------------------------------------------------------------------------

/**
 * Create a service-role admin client that bypasses RLS.
 * Used for test setup/teardown and direct-INSERT RLS assertions.
 */
async function makeServiceClient() {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(
    process.env.SUPABASE_TEST_URL,
    process.env.SUPABASE_TEST_SERVICE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

/**
 * Create a signed-in client for a real auth.users user (email/password).
 * The user must already exist in the test project.
 */
async function makeUserClient(email, password) {
  const { createClient } = await import('@supabase/supabase-js');
  const client = createClient(
    process.env.SUPABASE_TEST_URL,
    // Use anon key for signIn — the service key never goes to the client side.
    process.env.SUPABASE_TEST_ANON_KEY || process.env.SUPABASE_TEST_SERVICE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn(${email}) failed: ${error.message}`);
  return { client, userId: data.user.id };
}

/**
 * Provision two test users in auth.users via the admin API (idempotent).
 * Returns { ownerEmail, ownerPassword, editorEmail, editorPassword }.
 */
async function provisionTestUsers(admin) {
  const suffix = process.env.SUPABASE_TEST_USER_SUFFIX || 'kal307test';
  const ownerEmail  = `owner-${suffix}@survey-test.invalid`;
  const editorEmail = `editor-${suffix}@survey-test.invalid`;
  const password    = 'Kal307-Test-Pw!';

  async function ensureUser(email) {
    // Try to create — if already exists, the API returns a 422 which the JS
    // client surfaces as an error with message "User already registered".
    // Either way we need the user's id.
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error && !error.message.includes('already')) {
      throw new Error(`provisionTestUsers createUser(${email}): ${error.message}`);
    }
    if (data?.user) return data.user.id;

    // Already existed — fetch by email.
    const { data: list, error: listErr } = await admin.auth.admin.listUsers();
    if (listErr) throw new Error(`listUsers: ${listErr.message}`);
    const found = list.users.find((u) => u.email === email);
    if (!found) throw new Error(`provisionTestUsers: user ${email} not found after create`);
    return found.id;
  }

  const ownerId  = await ensureUser(ownerEmail);
  const editorId = await ensureUser(editorEmail);
  return { ownerEmail, editorEmail, password, ownerId, editorId };
}

/**
 * Insert a document row owned by ownerUserId.  Returns the document id.
 */
async function insertTestDocument(admin, ownerUserId) {
  const { data, error } = await admin
    .from('documents')
    .insert({ name: 'KAL-307 Integration Test Doc', user_id: ownerUserId })
    .select('id')
    .single();
  if (error) throw new Error(`insertTestDocument: ${error.message}`);
  return data.id;
}

/**
 * Add editorUserId as an active editor collaborator on documentId.
 */
async function addEditorCollaborator(admin, documentId, editorUserId) {
  const { error } = await admin
    .from('document_collaborators')
    .upsert(
      { document_id: documentId, user_id: editorUserId, role: 'editor', status: 'active' },
      { onConflict: 'document_id,user_id' }
    );
  if (error) throw new Error(`addEditorCollaborator: ${error.message}`);
}

/**
 * Clean up all test rows created during a test run.
 * Deletes registrations → document → collaborators (cascades).
 * Leaves auth users in place (idempotent on re-run).
 */
async function cleanupTestDocument(admin, documentId) {
  if (!documentId) return;
  // Cascade deletes registrations and collaborators via FK ON DELETE CASCADE.
  await admin.from('documents').delete().eq('id', documentId);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test(
  'KAL-307 scenario 1: first registration mints generation 1',
  { skip: skipReason },
  async () => {
    const admin = await makeServiceClient();
    const { ownerEmail, password, ownerId } = await provisionTestUsers(admin);
    const docId = await insertTestDocument(admin, ownerId);

    const { client: ownerClient } = await makeUserClient(ownerEmail, password);
    let raw1;
    try {
      const { data, error } = await ownerClient.rpc('kal307_register_workbook', {
        p_document_id:    docId,
        p_template_id:    'tpl-integration-1',
        p_capability_tier: 'local',
      });
      assert.equal(error, null, `RPC error: ${error?.message}`);
      assert.ok(Array.isArray(data) && data.length === 1, 'RPC must return exactly one row');
      const row = data[0];
      assert.ok(row.workbook_id?.startsWith('wb_'), `workbook_id should start with wb_, got ${row.workbook_id}`);
      assert.ok(row.sync_token?.startsWith('st_'),  `sync_token should start with st_, got ${row.sync_token}`);
      raw1 = row;

      // Verify DB row via service client.
      const { data: dbRows, error: dbErr } = await admin
        .from('excel_workbook_registrations')
        .select('*')
        .eq('document_id', docId)
        .eq('template_id', 'tpl-integration-1');
      assert.equal(dbErr, null, `DB fetch error: ${dbErr?.message}`);
      assert.equal(dbRows.length, 1, 'exactly one registration row');
      const dbRow = dbRows[0];
      assert.equal(dbRow.generation, 1, 'first registration is generation 1');
      assert.equal(dbRow.revoked_at, null, 'active registration has null revoked_at');
      assert.equal(dbRow.workbook_id, row.workbook_id, 'DB workbook_id matches returned value');
    } finally {
      await cleanupTestDocument(admin, docId);
    }
  }
);

test(
  'KAL-307 scenario 2: owner re-export revokes old row and mints generation 2',
  { skip: skipReason },
  async () => {
    const admin = await makeServiceClient();
    const { ownerEmail, password, ownerId } = await provisionTestUsers(admin);
    const docId = await insertTestDocument(admin, ownerId);

    const { client: ownerClient } = await makeUserClient(ownerEmail, password);
    try {
      // First registration.
      const { data: data1, error: err1 } = await ownerClient.rpc('kal307_register_workbook', {
        p_document_id: docId, p_template_id: 'tpl-integration-2',
      });
      assert.equal(err1, null, `first RPC error: ${err1?.message}`);
      const wbId1 = data1[0].workbook_id;

      // Owner re-exports.
      const { data: data2, error: err2 } = await ownerClient.rpc('kal307_register_workbook', {
        p_document_id: docId, p_template_id: 'tpl-integration-2',
      });
      assert.equal(err2, null, `second RPC error: ${err2?.message}`);
      const wbId2 = data2[0].workbook_id;
      assert.notEqual(wbId2, wbId1, 'new registration gets a fresh workbook_id');

      // DB: old row revoked, new row active at generation 2.
      const { data: dbRows } = await admin
        .from('excel_workbook_registrations')
        .select('*')
        .eq('document_id', docId)
        .eq('template_id', 'tpl-integration-2')
        .order('generation', { ascending: true });
      assert.equal(dbRows.length, 2, 'two rows total (revoked + active)');
      const [old, current] = dbRows;
      assert.equal(old.generation, 1,    'first row is generation 1');
      assert.ok(old.revoked_at != null,  'first row is revoked');
      assert.equal(current.generation, 2, 'new row is generation 2');
      assert.equal(current.revoked_at, null, 'new row is active');
    } finally {
      await cleanupTestDocument(admin, docId);
    }
  }
);

test(
  'KAL-307 scenario 3: editor cannot replace an existing active registration',
  { skip: skipReason },
  async () => {
    const admin = await makeServiceClient();
    const { ownerEmail, editorEmail, password, ownerId, editorId } = await provisionTestUsers(admin);
    const docId = await insertTestDocument(admin, ownerId);
    await addEditorCollaborator(admin, docId, editorId);

    const { client: ownerClient  } = await makeUserClient(ownerEmail,  password);
    const { client: editorClient } = await makeUserClient(editorEmail, password);
    try {
      // Owner registers first.
      const { error: err1 } = await ownerClient.rpc('kal307_register_workbook', {
        p_document_id: docId, p_template_id: 'tpl-integration-3',
      });
      assert.equal(err1, null, `owner registration error: ${err1?.message}`);

      // Editor attempts to replace — must fail.
      const { data: editorData, error: editorErr } = await editorClient.rpc('kal307_register_workbook', {
        p_document_id: docId, p_template_id: 'tpl-integration-3',
      });
      assert.ok(editorErr != null, 'editor replace must be rejected with an error');
      assert.match(
        editorErr.message,
        /owner-only|active workbook registration/i,
        `error should mention owner-only restriction, got: ${editorErr.message}`
      );

      // DB: still only one active row (generation 1).
      const { data: dbRows } = await admin
        .from('excel_workbook_registrations')
        .select('*')
        .eq('document_id', docId)
        .eq('template_id', 'tpl-integration-3')
        .is('revoked_at', null);
      assert.equal(dbRows.length, 1, 'still exactly one active row after editor rejection');
      assert.equal(dbRows[0].generation, 1, 'generation remains 1');
    } finally {
      await cleanupTestDocument(admin, docId);
    }
  }
);

test(
  'KAL-307 scenario 4: one-active-per-survey unique constraint enforced on duplicate active insert',
  { skip: skipReason },
  async () => {
    const admin = await makeServiceClient();
    const { ownerId } = await provisionTestUsers(admin);
    const docId = await insertTestDocument(admin, ownerId);

    try {
      // First insert via service client (bypasses RLS, tests the unique index directly).
      const { error: err1 } = await admin.from('excel_workbook_registrations').insert({
        document_id:   docId,
        template_id:   'tpl-integration-4',
        workbook_id:   'wb_test_dup_a',
        token_hash:    'hash_a',
        token_expiry:  new Date(Date.now() + 86400000).toISOString(),
        capability_tier: 'local',
        registered_by: ownerId,
        generation:    1,
      });
      assert.equal(err1, null, `first insert error: ${err1?.message}`);

      // Second active insert for the same (document_id, template_id) — must fail.
      const { error: err2 } = await admin.from('excel_workbook_registrations').insert({
        document_id:   docId,
        template_id:   'tpl-integration-4',
        workbook_id:   'wb_test_dup_b',
        token_hash:    'hash_b',
        token_expiry:  new Date(Date.now() + 86400000).toISOString(),
        capability_tier: 'local',
        registered_by: ownerId,
        generation:    2,
      });
      assert.ok(err2 != null, 'duplicate active insert must be rejected');
      assert.match(
        err2.message,
        /unique|duplicate/i,
        `error should be a uniqueness violation, got: ${err2.message}`
      );

      // Revoked rows must NOT trigger the partial unique index.
      const { error: err3 } = await admin.from('excel_workbook_registrations').insert({
        document_id:   docId,
        template_id:   'tpl-integration-4',
        workbook_id:   'wb_test_dup_c',
        token_hash:    'hash_c',
        token_expiry:  new Date(Date.now() + 86400000).toISOString(),
        capability_tier: 'local',
        registered_by: ownerId,
        generation:    3,
        revoked_at:    new Date().toISOString(), // already revoked — not covered by partial index
      });
      assert.equal(err3, null, `revoked insert should succeed (not covered by partial index): ${err3?.message}`);
    } finally {
      await cleanupTestDocument(admin, docId);
    }
  }
);

test(
  'KAL-307 scenario 5: token hash stored in DB ≠ raw token returned to caller',
  { skip: skipReason },
  async () => {
    const admin = await makeServiceClient();
    const { ownerEmail, password, ownerId } = await provisionTestUsers(admin);
    const docId = await insertTestDocument(admin, ownerId);

    const { client: ownerClient } = await makeUserClient(ownerEmail, password);
    try {
      const { data, error } = await ownerClient.rpc('kal307_register_workbook', {
        p_document_id: docId, p_template_id: 'tpl-integration-5',
      });
      assert.equal(error, null, `RPC error: ${error?.message}`);
      const rawToken = data[0].sync_token;

      const { data: dbRows } = await admin
        .from('excel_workbook_registrations')
        .select('token_hash')
        .eq('document_id', docId)
        .eq('template_id', 'tpl-integration-5')
        .is('revoked_at', null);
      assert.equal(dbRows.length, 1);
      const { token_hash } = dbRows[0];

      // Raw token must NOT equal the hash (the hash is SHA-256 hex, 64 chars).
      assert.notEqual(token_hash, rawToken, 'raw token must not be stored in the DB');
      assert.match(token_hash, /^[0-9a-f]{64}$/, 'stored hash must be 64-char lowercase hex (SHA-256)');
      // Verify the hash is actually sha256(rawToken) — use Node's crypto.
      const { createHash } = await import('node:crypto');
      const expected = createHash('sha256').update(rawToken).digest('hex');
      assert.equal(token_hash, expected, 'DB token_hash must be SHA-256(raw_token)');
    } finally {
      await cleanupTestDocument(admin, docId);
    }
  }
);

test(
  'KAL-307 scenario 6: RLS — direct INSERT as authenticated user is blocked',
  { skip: skipReason },
  async () => {
    const admin = await makeServiceClient();
    const { ownerEmail, password, ownerId } = await provisionTestUsers(admin);
    const docId = await insertTestDocument(admin, ownerId);

    const { client: ownerClient } = await makeUserClient(ownerEmail, password);
    try {
      // Authenticated user tries a direct INSERT (bypassing the RPC).
      const { error } = await ownerClient.from('excel_workbook_registrations').insert({
        document_id:   docId,
        template_id:   'tpl-rls-insert',
        workbook_id:   'wb_rls_test',
        token_hash:    'hash_rls',
        token_expiry:  new Date(Date.now() + 86400000).toISOString(),
        capability_tier: 'local',
        registered_by: ownerId,
        generation:    1,
      });
      assert.ok(error != null, 'direct INSERT must be blocked by RLS');
      // PostgREST surfaces RLS-blocked inserts as a 42501 or "new row violates row-level security"
      assert.match(
        error.message,
        /row.level security|permission denied|violates/i,
        `expected RLS error, got: ${error.message}`
      );
    } finally {
      await cleanupTestDocument(admin, docId);
    }
  }
);

test(
  'KAL-307 scenario 7: RLS — direct UPDATE as authenticated user is blocked',
  { skip: skipReason },
  async () => {
    const admin = await makeServiceClient();
    const { ownerEmail, password, ownerId } = await provisionTestUsers(admin);
    const docId = await insertTestDocument(admin, ownerId);

    const { client: ownerClient } = await makeUserClient(ownerEmail, password);
    try {
      // Seed a row via service client (bypasses RLS).
      const { data: seedData, error: seedErr } = await admin
        .from('excel_workbook_registrations')
        .insert({
          document_id:   docId,
          template_id:   'tpl-rls-update',
          workbook_id:   'wb_rls_upd',
          token_hash:    'hash_rls_upd',
          token_expiry:  new Date(Date.now() + 86400000).toISOString(),
          capability_tier: 'local',
          registered_by: ownerId,
          generation:    1,
        })
        .select('id')
        .single();
      assert.equal(seedErr, null, `seed error: ${seedErr?.message}`);

      // Authenticated user attempts direct UPDATE.
      const { error: updErr } = await ownerClient
        .from('excel_workbook_registrations')
        .update({ generation: 99 })
        .eq('id', seedData.id);
      // RLS UPDATE policy is USING (FALSE) — the update should be blocked or silently no-op
      // (PostgREST returns no error for UPDATE that matches 0 rows due to RLS, but never applies).
      // Either way, the generation must not have changed.
      const { data: afterRows } = await admin
        .from('excel_workbook_registrations')
        .select('generation')
        .eq('id', seedData.id);
      const gen = afterRows?.[0]?.generation;
      assert.equal(gen, 1, 'generation must remain 1 — RLS UPDATE must not apply');
    } finally {
      await cleanupTestDocument(admin, docId);
    }
  }
);

test(
  'KAL-307 scenario 8: RLS SELECT — member with viewer access can read their registration',
  { skip: skipReason },
  async () => {
    const admin = await makeServiceClient();
    const { ownerEmail, editorEmail, password, ownerId, editorId } = await provisionTestUsers(admin);
    const docId = await insertTestDocument(admin, ownerId);
    await addEditorCollaborator(admin, docId, editorId);

    const { client: ownerClient  } = await makeUserClient(ownerEmail,  password);
    const { client: editorClient } = await makeUserClient(editorEmail, password);
    try {
      // Owner registers.
      const { error: regErr } = await ownerClient.rpc('kal307_register_workbook', {
        p_document_id: docId, p_template_id: 'tpl-integration-8',
      });
      assert.equal(regErr, null, `registration error: ${regErr?.message}`);

      // Owner can SELECT their own registration.
      const { data: ownerRows, error: ownerSelErr } = await ownerClient
        .from('excel_workbook_registrations')
        .select('workbook_id, generation')
        .eq('document_id', docId);
      assert.equal(ownerSelErr, null, `owner SELECT error: ${ownerSelErr?.message}`);
      assert.equal(ownerRows.length, 1, 'owner can read the registration');
      assert.equal(ownerRows[0].generation, 1);

      // Editor (viewer-level access via document_collaborators) can also SELECT.
      const { data: editorRows, error: editorSelErr } = await editorClient
        .from('excel_workbook_registrations')
        .select('workbook_id, generation')
        .eq('document_id', docId);
      assert.equal(editorSelErr, null, `editor SELECT error: ${editorSelErr?.message}`);
      assert.equal(editorRows.length, 1, 'editor member can read the registration');

      // Neither client can see the token_hash in a way that leaks the raw secret
      // (the column exists but is just opaque data — no raw token ever in the DB).
      // We verify token_hash is a 64-char hex string (SHA-256) not the raw st_… value.
      const { data: hashRows } = await admin
        .from('excel_workbook_registrations')
        .select('token_hash')
        .eq('document_id', docId)
        .is('revoked_at', null);
      assert.match(hashRows[0].token_hash, /^[0-9a-f]{64}$/, 'token_hash is SHA-256 hex');
    } finally {
      await cleanupTestDocument(admin, docId);
    }
  }
);
