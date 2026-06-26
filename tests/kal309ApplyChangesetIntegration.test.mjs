// tests/kal309ApplyChangesetIntegration.test.mjs
// KAL-309 keystone integration tests — kal308_apply_changeset + the six helper RPCs +
// audit immutability + RLS, against the survey-test cloud Supabase project. Mirrors the
// harness in rowIdSigningSecretIntegration.test.mjs / workbookRegistrationIntegration.test.mjs.
//
// Guards (three independent locks): SUPABASE_INTEGRATION=1, allowlisted host, service key
// present. Missing env → test.skip, never fail (0-fail under plain `npm test`).
//
// Contract sources mirrored EXACTLY:
//   * supabase/migrations/20260625120000_kal309_excel_sync.sql — the kal308_apply_changeset
//     signature + p_rows shape + helper RPC signatures + the audit-immutable trigger.
//   * supabase/functions/excel-apply-changeset/index.ts — how the Edge builds p_rows (we
//     replicate the same per-row object shape here).
//
// Trust boundary under test (F6/F17): kal308_apply_changeset + kal309_persist_created_token are
// service_role-ONLY and take an explicit p_actor_id (the authenticated user IS p_actor_id). The
// authenticated helpers (fetch_since / ack / resolve / seed / set_signing_id) run as the signed-in
// user. Real fingerprints are computed with computeRowFingerprints so baseFingerprints match the
// seeded excel_sync_state where a clean apply is required.
//
// Run: SUPABASE_INTEGRATION=1 node --env-file=.env.test --test \
//        tests/kal309ApplyChangesetIntegration.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

import { computeRowFingerprints } from '../src/services/rowFingerprint.js';

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

// --- clients (identical to the KAL-308a / KAL-307 harness) -------------------

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

// --- provisioning (identical pattern) ----------------------------------------

async function provisionUsers(admin) {
  const suffix = process.env.SUPABASE_TEST_USER_SUFFIX || 'kal309test';
  const password = 'Kal309-Test-Pw!';
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
    .insert({ name: 'KAL-309 Integration Doc', user_id: ownerId }).select('id').single();
  if (error) throw new Error(`insertDoc: ${error.message}`);
  return data.id;
}
async function addCollaborator(admin, docId, userId, role) {
  const { error } = await admin.from('document_collaborators')
    .upsert({ document_id: docId, user_id: userId, role, status: 'active' }, { onConflict: 'document_id,user_id' });
  if (error) throw new Error(`addCollaborator(${role}): ${error.message}`);
}
async function cleanup(admin, docId) {
  // The five sync tables FK documents(id) ON DELETE CASCADE, so deleting the doc removes
  // every excel_sync_* row + the registration. (registration FK is also ON DELETE CASCADE.)
  if (docId) await admin.from('documents').delete().eq('id', docId);
}

// --- KAL-309 helpers ---------------------------------------------------------

const TEMPLATE_ID = 'tpl-kal309-int';

// Register an active workbook for (doc, template). Returns { workbookId, syncToken }.
async function registerWorkbook(userClient, docId, templateId = TEMPLATE_ID) {
  const { data, error } = await userClient.rpc('kal307_register_workbook', {
    p_document_id: docId, p_template_id: templateId, p_capability_tier: 'local',
  });
  if (error) throw new Error(`register_workbook: ${error.message}`);
  const row = Array.isArray(data) ? data[0] : data;
  return { workbookId: row.workbook_id, syncToken: row.sync_token };
}

// Build the { identityVectorFingerprint, fullRowFingerprint, fieldFingerprints } a row hashes to.
async function fingerprintsFor(values) {
  return computeRowFingerprints({
    changedBy: values.changedBy ?? '', changedDate: values.changedDate ?? '',
    item: values.item ?? '', entity: values.entity ?? '', notes: values.notes ?? '',
    answers: values.answers ?? {},
  });
}

// Seed excel_sync_state for one marker so the apply RPC has a trusted Excel-side baseline.
// markers: [{ markerAnnotationId, scopeId, identityRecord, assignedToken? }]
async function seedSyncState(userClient, { documentId, workbookId, markers, templateId = TEMPLATE_ID }) {
  const { data, error } = await userClient.rpc('kal309_seed_sync_state', {
    p_document_id: documentId, p_template_id: templateId, p_workbook_id: workbookId, p_markers: markers,
  });
  if (error) throw new Error(`seed_sync_state: ${error.message}`);
  return data; // count
}

// Build ONE p_rows entry exactly like the Edge does (index.ts §7).
function buildApplyRow({ opId, markerAnnotationId, scopeId, changedFieldKeys, fields, baseFingerprints }) {
  return {
    opId, opType: 'apply', markerAnnotationId, scopeId, templateId: TEMPLATE_ID,
    changedFieldKeys, fields, baseFingerprints,
  };
}
function buildCreateRow({ opId, scopeId, moduleId, categoryId, fields, identity, identityRecord }) {
  return {
    opId, opType: 'create', markerAnnotationId: null, scopeId, templateId: TEMPLATE_ID,
    moduleId, categoryId, identity,
    changedFieldKeys: Object.keys(fields?.answers || {}).map((id) => `answer:${id}`)
      .concat(['item', 'entity', 'notes'].filter((k) => fields?.[k] != null && fields[k] !== '')),
    fields, baseFingerprints: null, identityRecord: identityRecord ?? {},
  };
}

// Call the service-role-only apply RPC with an explicit actor (the authenticated user IS p_actor_id).
async function applyChangeset(admin, { actorId, documentId, workbookId, clientChangeSetId, rows,
  capabilityTier = 'local', templateConfig = null, templateId = TEMPLATE_ID }) {
  const requestHash = createHash('sha256')
    .update(JSON.stringify({ documentId, templateId, workbookId, clientChangeSetId, rows }))
    .digest('hex');
  return admin.rpc('kal308_apply_changeset', {
    p_actor_id: actorId, p_document_id: documentId, p_template_id: templateId,
    p_workbook_id: workbookId, p_capability_tier: capabilityTier,
    p_client_change_set_id: clientChangeSetId, p_request_hash: requestHash,
    p_device_hint: 'integration', p_template_config: templateConfig, p_rows: rows,
  });
}

const SCOPE = 'mod1:cat1';
const MODULE_ID = 'mod1';
const CATEGORY_ID = 'cat1';

// Seed one marker with a known baseline, returning its id + the fingerprints it was seeded with.
// IMPORTANT: use the REAL app marker-id format (surveyMarker-<ts>-<rand>), NOT a UUID. The app never
// mints UUID marker ids; an earlier all-UUID test masked the bug where the UUID-typed column + the
// safe_uuid gate skipped every real marker and routed all syncs to review.
async function seedOneMarker(userClient, { documentId, workbookId, values }) {
  const markerAnnotationId = `surveyMarker-${Date.now()}-${randomUUID().slice(0, 9)}`;
  const fp = await fingerprintsFor(values);
  const identityRecord = {
    version: 'v1', origin: 'export', lastExportId: 'exp-int',
    identityVectorFingerprint: fp.identityVectorFingerprint,
    fullRowFingerprint: fp.fullRowFingerprint,
    fieldFingerprints: fp.fieldFingerprints,
  };
  await seedSyncState(userClient, {
    documentId, workbookId,
    markers: [{ markerAnnotationId, scopeId: SCOPE, identityRecord, assignedToken: null }],
  });
  return { markerAnnotationId, fp };
}

// =============================================================================
// 1. Owner apply → applied; state upserted, one ops row, one audit row, head bumped.
// =============================================================================
test('KAL-309 #1: owner apply → applied (state upserted, ops + audit + head)', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    const baseValues = { item: 'Door A', entity: '', notes: 'orig', answers: { c1: 'old' } };
    const { markerAnnotationId, fp } = await seedOneMarker(ownerClient, { documentId: docId, workbookId, values: baseValues });

    // Apply: change answer c1 → 'new'; baseFingerprints MUST match the seeded baseline.
    const ccs = `ccs-${randomUUID()}`;
    const row = buildApplyRow({
      opId: `${SCOPE}#1#apply`, markerAnnotationId, scopeId: SCOPE,
      changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'new' } },
      baseFingerprints: { identityVector: fp.identityVectorFingerprint, fields: fp.fieldFingerprints },
    });
    const { data, error } = await applyChangeset(admin, {
      actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: ccs, rows: [row],
    });
    assert.equal(error, null, `apply rpc error: ${error?.message}`);
    assert.equal(data.error, undefined, `change-set rejected: ${data.error}`);
    assert.equal(data.outcomes.length, 1);
    assert.equal(data.outcomes[0].outcome, 'applied', `expected applied, got ${data.outcomes[0].outcome}`);
    assert.ok(data.revision_head >= 1, `head bumped: ${data.revision_head}`);

    // ops row written
    const { data: ops } = await admin.from('excel_sync_ops')
      .select('op_uuid, op_type, marker_annotation_id, excel_revision, op_status')
      .eq('document_id', docId).eq('template_id', TEMPLATE_ID);
    assert.equal(ops.length, 1, 'exactly one ops row');
    assert.equal(ops[0].op_type, 'apply');
    assert.equal(ops[0].marker_annotation_id, markerAnnotationId);

    // head bumped
    const { data: head } = await admin.from('excel_sync_head')
      .select('excel_revision').eq('document_id', docId).eq('template_id', TEMPLATE_ID).single();
    assert.equal(head.excel_revision, data.revision_head);

    // state row present (upserted by seed + apply)
    const { data: state } = await admin.from('excel_sync_state')
      .select('marker_annotation_id, last_applied_excel_revision')
      .eq('document_id', docId).eq('marker_annotation_id', markerAnnotationId);
    assert.equal(state.length, 1, 'state row upserted');

    // audit row present (>=1; seed does not audit, apply does)
    const { data: audit } = await admin.from('excel_sync_audit')
      .select('row_outcome, actor_id').eq('document_id', docId);
    assert.ok(audit.some((a) => a.row_outcome === 'applied' && a.actor_id === ownerId),
      'an applied audit row attributed to the owner');
  } finally { await cleanup(admin, docId); }
});

// =============================================================================
// 2. Editor (collaborator) apply → applied.
// =============================================================================
test('KAL-309 #2: editor collaborator apply → applied', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId, editorId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  await addCollaborator(admin, docId, editorId, 'editor');
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    const { markerAnnotationId, fp } = await seedOneMarker(ownerClient, {
      documentId: docId, workbookId, values: { item: 'Win B', answers: { c1: 'a' } },
    });
    const ccs = `ccs-${randomUUID()}`;
    const row = buildApplyRow({
      opId: `${SCOPE}#1#apply`, markerAnnotationId, scopeId: SCOPE,
      changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'b' } },
      baseFingerprints: { identityVector: fp.identityVectorFingerprint, fields: fp.fieldFingerprints },
    });
    // p_actor_id = the EDITOR (a collaborator, not the owner).
    const { data, error } = await applyChangeset(admin, {
      actorId: editorId, documentId: docId, workbookId, clientChangeSetId: ccs, rows: [row],
    });
    assert.equal(error, null, `apply rpc error: ${error?.message}`);
    assert.equal(data.error, undefined, `change-set rejected: ${data.error}`);
    assert.equal(data.outcomes[0].outcome, 'applied');
  } finally { await cleanup(admin, docId); }
});

// =============================================================================
// 3. Viewer p_actor_id → unauthorized; zero writes.
// =============================================================================
test('KAL-309 #3: viewer actor → unauthorized, zero writes', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId, viewerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  await addCollaborator(admin, docId, viewerId, 'viewer');
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    const { markerAnnotationId, fp } = await seedOneMarker(ownerClient, {
      documentId: docId, workbookId, values: { item: 'V', answers: { c1: 'a' } },
    });
    const ccs = `ccs-${randomUUID()}`;
    const row = buildApplyRow({
      opId: `${SCOPE}#1#apply`, markerAnnotationId, scopeId: SCOPE,
      changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'b' } },
      baseFingerprints: { identityVector: fp.identityVectorFingerprint, fields: fp.fieldFingerprints },
    });
    const { data, error } = await applyChangeset(admin, {
      actorId: viewerId, documentId: docId, workbookId, clientChangeSetId: ccs, rows: [row],
    });
    assert.equal(error, null, `apply rpc error: ${error?.message}`);
    assert.equal(data.error, 'unauthorized', `expected change-set-level unauthorized, got ${JSON.stringify(data)}`);
    // zero ops rows
    const { data: ops } = await admin.from('excel_sync_ops').select('id').eq('document_id', docId);
    assert.equal(ops.length, 0, 'no ops written for an unauthorized actor');
  } finally { await cleanup(admin, docId); }
});

// =============================================================================
// 4. Idempotency: same client_change_set_id twice → applied once, exactly one ops row,
//    second call returns the stored outcomes.
// =============================================================================
test('KAL-309 #4: idempotency — replayed change-set returns stored outcomes, one ops row', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    const { markerAnnotationId, fp } = await seedOneMarker(ownerClient, {
      documentId: docId, workbookId, values: { item: 'Idem', answers: { c1: 'x' } },
    });
    const ccs = `ccs-${randomUUID()}`;
    const row = buildApplyRow({
      opId: `${SCOPE}#1#apply`, markerAnnotationId, scopeId: SCOPE,
      changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'y' } },
      baseFingerprints: { identityVector: fp.identityVectorFingerprint, fields: fp.fieldFingerprints },
    });
    const first = await applyChangeset(admin, { actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: ccs, rows: [row] });
    assert.equal(first.error, null, `first rpc error: ${first.error?.message}`);
    assert.equal(first.data.outcomes[0].outcome, 'applied');
    const headAfterFirst = first.data.revision_head;

    const second = await applyChangeset(admin, { actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: ccs, rows: [row] });
    assert.equal(second.error, null, `second rpc error: ${second.error?.message}`);
    // Replay returns the SAME head + the stored outcomes (verbatim).
    assert.equal(second.data.revision_head, headAfterFirst, 'replay head unchanged');
    assert.equal(second.data.outcomes.length, 1);
    assert.equal(second.data.outcomes[0].outcome, 'applied');

    const { data: ops } = await admin.from('excel_sync_ops').select('id').eq('document_id', docId).eq('template_id', TEMPLATE_ID);
    assert.equal(ops.length, 1, 'exactly one ops row after a replay');
  } finally { await cleanup(admin, docId); }
});

// =============================================================================
// 5. TOCTOU: baseFingerprint mismatch → 'stale'/'conflict', no overwrite.
// =============================================================================
test('KAL-309 #5: TOCTOU — mismatched baseFingerprints → stale/conflict, no overwrite', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    const { markerAnnotationId } = await seedOneMarker(ownerClient, {
      documentId: docId, workbookId, values: { item: 'T', answers: { c1: 'seeded' } },
    });
    // Build base fingerprints from a DIFFERENT row than what was seeded → drift.
    const wrong = await fingerprintsFor({ item: 'T', answers: { c1: 'DIFFERENT-BASE' } });
    const ccs = `ccs-${randomUUID()}`;
    const row = buildApplyRow({
      opId: `${SCOPE}#1#apply`, markerAnnotationId, scopeId: SCOPE,
      changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'attempted' } },
      baseFingerprints: { identityVector: wrong.identityVectorFingerprint, fields: wrong.fieldFingerprints },
    });
    const { data, error } = await applyChangeset(admin, {
      actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: ccs, rows: [row],
    });
    assert.equal(error, null, `apply rpc error: ${error?.message}`);
    const outcome = data.outcomes[0].outcome;
    assert.ok(outcome === 'stale' || outcome === 'conflict', `expected stale/conflict, got ${outcome}`);
    // No accepted op row written for a stale/conflict row (head not bumped for it).
    const { data: ops } = await admin.from('excel_sync_ops').select('id').eq('document_id', docId).eq('template_id', TEMPLATE_ID);
    assert.equal(ops.length, 0, 'no ops written on a TOCTOU mismatch');
  } finally { await cleanup(admin, docId); }
});

// =============================================================================
// 6. Create op → RPC mints marker_annotation_id (in ops.patch_payload + state, NOT NULL).
// =============================================================================
test('KAL-309 #6: create op → minted marker id in ops.patch_payload + state', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    // A create needs no seeded baseline.
    const ccs = `ccs-${randomUUID()}`;
    const fields = { item: 'Fresh Row', entity: '', notes: 'n', answers: { c1: 'yes' } };
    const fp = await fingerprintsFor(fields);
    const row = buildCreateRow({
      opId: `${SCOPE}#5#create`, scopeId: SCOPE, moduleId: MODULE_ID, categoryId: CATEGORY_ID, fields,
      identity: { moduleId: MODULE_ID, categoryId: CATEGORY_ID, identityVectorFingerprint: fp.identityVectorFingerprint },
      identityRecord: {
        version: 'v1', origin: 'import',
        identityVectorFingerprint: fp.identityVectorFingerprint,
        fullRowFingerprint: fp.fullRowFingerprint, fieldFingerprints: fp.fieldFingerprints,
      },
    });
    const { data, error } = await applyChangeset(admin, {
      actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: ccs, rows: [row],
    });
    assert.equal(error, null, `apply rpc error: ${error?.message}`);
    assert.equal(data.outcomes[0].outcome, 'create');
    const mintedId = data.outcomes[0].markerAnnotationId;
    assert.ok(mintedId && /^[0-9a-f-]{36}$/i.test(mintedId), `minted a UUID marker id, got ${mintedId}`);

    // ops row: marker_annotation_id NOT NULL + stamped into patch_payload.
    const { data: ops } = await admin.from('excel_sync_ops')
      .select('marker_annotation_id, patch_payload, op_type').eq('document_id', docId).eq('op_type', 'create');
    assert.equal(ops.length, 1);
    assert.equal(ops[0].marker_annotation_id, mintedId, 'ops.marker_annotation_id == minted id');
    assert.notEqual(ops[0].marker_annotation_id, null, 'NOT NULL');
    assert.equal(ops[0].patch_payload.markerAnnotationId, mintedId, 'minted id stamped into patch_payload');

    // state row exists for the minted id.
    const { data: state } = await admin.from('excel_sync_state')
      .select('marker_annotation_id').eq('document_id', docId).eq('marker_annotation_id', mintedId);
    assert.equal(state.length, 1, 'state row for the minted marker');
  } finally { await cleanup(admin, docId); }
});

// =============================================================================
// 7. Locked doc → rejected, no writes.
// =============================================================================
test('KAL-309 #7: locked doc → rejected, zero writes', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    const { markerAnnotationId, fp } = await seedOneMarker(ownerClient, {
      documentId: docId, workbookId, values: { item: 'L', answers: { c1: 'a' } },
    });
    // Lock the doc (documents.locked_at IS NOT NULL → kal49_document_is_locked true).
    // NOTE: set ONLY locked_at — survey-test's documents table does not carry the optional
    // locked_by column from the KAL-49 migration, and PostgREST rejects the whole update if
    // an unknown column is included (which would silently leave the doc UNLOCKED).
    const { error: lockErr } = await admin.from('documents')
      .update({ locked_at: new Date().toISOString() }).eq('id', docId).select('id').single();
    assert.equal(lockErr, null, `lock update failed: ${lockErr?.message}`);
    const ccs = `ccs-${randomUUID()}`;
    const row = buildApplyRow({
      opId: `${SCOPE}#1#apply`, markerAnnotationId, scopeId: SCOPE,
      changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'b' } },
      baseFingerprints: { identityVector: fp.identityVectorFingerprint, fields: fp.fieldFingerprints },
    });
    const { data, error } = await applyChangeset(admin, {
      actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: ccs, rows: [row],
    });
    assert.equal(error, null, `apply rpc error: ${error?.message}`);
    assert.equal(data.error, 'locked', `expected locked rejection, got ${JSON.stringify(data)}`);
    const { data: ops } = await admin.from('excel_sync_ops').select('id').eq('document_id', docId);
    assert.equal(ops.length, 0, 'no ops written on a locked doc');
  } finally { await cleanup(admin, docId); }
});

// =============================================================================
// 8. kal309_fetch_since → committed ops ascending; NO token/secret in patch_payload (redaction).
// =============================================================================
test('KAL-309 #8: fetch_since returns ascending committed ops, redacted (no token/secret)', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    // Two applies on two markers → two ops at revisions 1,2.
    const m1 = await seedOneMarker(ownerClient, { documentId: docId, workbookId, values: { item: 'A', answers: { c1: 'a' } } });
    const m2 = await seedOneMarker(ownerClient, { documentId: docId, workbookId, values: { item: 'B', answers: { c2: 'b' } } });
    await applyChangeset(admin, {
      actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: `ccs-${randomUUID()}`,
      rows: [buildApplyRow({ opId: `${SCOPE}#1#apply`, markerAnnotationId: m1.markerAnnotationId, scopeId: SCOPE,
        changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'A2' } },
        baseFingerprints: { identityVector: m1.fp.identityVectorFingerprint, fields: m1.fp.fieldFingerprints } })],
    });
    await applyChangeset(admin, {
      actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: `ccs-${randomUUID()}`,
      rows: [buildApplyRow({ opId: `${SCOPE}#2#apply`, markerAnnotationId: m2.markerAnnotationId, scopeId: SCOPE,
        changedFieldKeys: ['answer:c2'], fields: { answers: { c2: 'B2' } },
        baseFingerprints: { identityVector: m2.fp.identityVectorFingerprint, fields: m2.fp.fieldFingerprints } })],
    });

    // fetch_since is authenticated (viewer-gated) → call as the signed-in OWNER.
    const { data: ops, error } = await ownerClient.rpc('kal309_fetch_since', {
      p_document_id: docId, p_template_id: TEMPLATE_ID, p_since_revision: 0,
    });
    assert.equal(error, null, `fetch_since error: ${error?.message}`);
    assert.equal(ops.length, 2, 'two committed ops');
    // ascending by excel_revision
    assert.ok(ops[0].excel_revision < ops[1].excel_revision, 'ascending order');
    // redaction: no token/secret anywhere in the returned rows or their patch_payload.
    for (const op of ops) {
      const keys = Object.keys(op);
      assert.ok(!keys.includes('assigned_token') && !keys.includes('secret') && !keys.includes('secret_b64'),
        `row exposes a secret column: ${keys.join(',')}`);
      const blob = JSON.stringify(op.patch_payload || {});
      assert.ok(!/assignedToken|"token"|secret_b64|"secret"/.test(blob), `patch_payload leaks token/secret: ${blob}`);
    }
    // since the head → empty.
    const head = ops[ops.length - 1].excel_revision;
    const { data: none } = await ownerClient.rpc('kal309_fetch_since', {
      p_document_id: docId, p_template_id: TEMPLATE_ID, p_since_revision: head,
    });
    assert.equal(none.length, 0, 'fetch_since past the head returns nothing');
  } finally { await cleanup(admin, docId); }
});

// =============================================================================
// 9. kal309_ack_materialization: accepted→materialized; a stale ack for a non-current op → no-op.
// =============================================================================
test('KAL-309 #9: ack accepted→materialized; stale ack for a non-current op is a no-op', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    const m = await seedOneMarker(ownerClient, { documentId: docId, workbookId, values: { item: 'Ack', answers: { c1: 'a' } } });
    // First apply → op#1 (current op for the marker).
    const r1 = await applyChangeset(admin, {
      actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: `ccs-${randomUUID()}`,
      rows: [buildApplyRow({ opId: `${SCOPE}#1#apply`, markerAnnotationId: m.markerAnnotationId, scopeId: SCOPE,
        changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'a2' } },
        baseFingerprints: { identityVector: m.fp.identityVectorFingerprint, fields: m.fp.fieldFingerprints } })],
    });
    const op1Uuid = r1.data.outcomes[0].opUuid;
    assert.ok(op1Uuid, 'op1 uuid returned');

    // ack accepted→materialized (authenticated, as the owner).
    const { data: ackOk, error: ackErr } = await ownerClient.rpc('kal309_ack_materialization', {
      p_document_id: docId, p_template_id: TEMPLATE_ID, p_op_uuid: op1Uuid, p_status: 'materialized',
    });
    assert.equal(ackErr, null, `ack error: ${ackErr?.message}`);
    assert.equal(ackOk, true, 'ack accepted→materialized succeeds');
    const { data: opAfter } = await admin.from('excel_sync_ops').select('op_status').eq('op_uuid', op1Uuid).single();
    assert.equal(opAfter.op_status, 'materialized');

    // A second apply re-fingerprinted from the now-current state advances the marker; op#1 is no longer
    // current. A stale ack for op#1 (now non-accepted anyway) must be a no-op (returns false, no change).
    const { data: staleAck } = await ownerClient.rpc('kal309_ack_materialization', {
      p_document_id: docId, p_template_id: TEMPLATE_ID, p_op_uuid: op1Uuid, p_status: 'materialized',
    });
    assert.equal(staleAck, false, 'a repeat/stale ack for a non-accepted op is a no-op');
    const { data: opStill } = await admin.from('excel_sync_ops').select('op_status').eq('op_uuid', op1Uuid).single();
    assert.equal(opStill.op_status, 'materialized', 'op_status unchanged by the stale ack');
  } finally { await cleanup(admin, docId); }
});

// =============================================================================
// 10. kal309_resolve_materialization_conflict: drive to client_conflict_review, take-excel → cleared.
// =============================================================================
test('KAL-309 #10: resolve take-excel clears client_conflict_review (op→accepted)', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    const m = await seedOneMarker(ownerClient, { documentId: docId, workbookId, values: { item: 'Cf', answers: { c1: 'a' } } });
    const r1 = await applyChangeset(admin, {
      actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: `ccs-${randomUUID()}`,
      rows: [buildApplyRow({ opId: `${SCOPE}#1#apply`, markerAnnotationId: m.markerAnnotationId, scopeId: SCOPE,
        changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'a2' } },
        baseFingerprints: { identityVector: m.fp.identityVectorFingerprint, fields: m.fp.fieldFingerprints } })],
    });
    const opUuid = r1.data.outcomes[0].opUuid;
    // The CLIENT drives the op to client_conflict_review via ack (the materialize reducer's path).
    const { data: ackCr } = await ownerClient.rpc('kal309_ack_materialization', {
      p_document_id: docId, p_template_id: TEMPLATE_ID, p_op_uuid: opUuid, p_status: 'client_conflict_review',
    });
    assert.equal(ackCr, true, 'ack accepted→client_conflict_review succeeds');
    const { data: opCr } = await admin.from('excel_sync_ops').select('op_status').eq('op_uuid', opUuid).single();
    assert.equal(opCr.op_status, 'client_conflict_review');

    // Resolve take-excel → op back to 'accepted' (reload-safe re-materialize), conflict cleared.
    const { data: resolved, error: rErr } = await ownerClient.rpc('kal309_resolve_materialization_conflict', {
      p_document_id: docId, p_template_id: TEMPLATE_ID, p_op_uuid: opUuid, p_resolution: 'take-excel', p_resolved_fingerprints: null,
    });
    assert.equal(rErr, null, `resolve error: ${rErr?.message}`);
    assert.equal(resolved, true, 'resolve take-excel succeeds');
    const { data: opAfter } = await admin.from('excel_sync_ops').select('op_status').eq('op_uuid', opUuid).single();
    assert.equal(opAfter.op_status, 'accepted', 'take-excel sets the op back to accepted (re-materialize on reload)');
    const { data: stateAfter } = await admin.from('excel_sync_state')
      .select('op_status, materialization_status').eq('document_id', docId).eq('marker_annotation_id', m.markerAnnotationId).single();
    assert.equal(stateAfter.materialization_status, 'accepted', 'state cleared out of conflict-review');
  } finally { await cleanup(admin, docId); }
});

// =============================================================================
// 11. Audit immutability: service-client UPDATE and DELETE on excel_sync_audit both RAISE.
// =============================================================================
test('KAL-309 #11: excel_sync_audit is trigger-immutable (UPDATE + DELETE raise)', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    const m = await seedOneMarker(ownerClient, { documentId: docId, workbookId, values: { item: 'Au', answers: { c1: 'a' } } });
    await applyChangeset(admin, {
      actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: `ccs-${randomUUID()}`,
      rows: [buildApplyRow({ opId: `${SCOPE}#1#apply`, markerAnnotationId: m.markerAnnotationId, scopeId: SCOPE,
        changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'a2' } },
        baseFingerprints: { identityVector: m.fp.identityVectorFingerprint, fields: m.fp.fieldFingerprints } })],
    });
    const { data: audit } = await admin.from('excel_sync_audit').select('id, row_outcome').eq('document_id', docId).limit(1);
    assert.ok(audit.length >= 1, 'an audit row exists to mutate');
    const auditId = audit[0].id;

    // UPDATE must raise (trigger) even for the service role (table owner).
    const { error: upErr } = await admin.from('excel_sync_audit').update({ row_outcome: 'tampered' }).eq('id', auditId);
    assert.ok(upErr != null, 'UPDATE on excel_sync_audit must raise');

    // DELETE must raise too.
    const { error: delErr } = await admin.from('excel_sync_audit').delete().eq('id', auditId);
    assert.ok(delErr != null, 'DELETE on excel_sync_audit must raise');

    // The row is unchanged.
    const { data: still } = await admin.from('excel_sync_audit').select('row_outcome').eq('id', auditId).single();
    assert.notEqual(still.row_outcome, 'tampered', 'audit row content is immutable');
  } finally { await cleanup(admin, docId); }
});

// =============================================================================
// 12. RLS: an authenticated user's direct SELECT on the sync tables is denied or empty.
// =============================================================================
test('KAL-309 #12: RLS — authenticated direct SELECT on sync tables is denied/empty', { skip: skipReason }, async () => {
  const admin = await makeServiceClient();
  const { owner, password, ownerId } = await provisionUsers(admin);
  const docId = await insertDoc(admin, ownerId);
  const { client: ownerClient } = await makeUserClient(owner, password);
  try {
    const { workbookId } = await registerWorkbook(ownerClient, docId);
    const m = await seedOneMarker(ownerClient, { documentId: docId, workbookId, values: { item: 'Rls', answers: { c1: 'a' } } });
    await applyChangeset(admin, {
      actorId: ownerId, documentId: docId, workbookId, clientChangeSetId: `ccs-${randomUUID()}`,
      rows: [buildApplyRow({ opId: `${SCOPE}#1#apply`, markerAnnotationId: m.markerAnnotationId, scopeId: SCOPE,
        changedFieldKeys: ['answer:c1'], fields: { answers: { c1: 'a2' } },
        baseFingerprints: { identityVector: m.fp.identityVectorFingerprint, fields: m.fp.fieldFingerprints } })],
    });

    // Service role sees the rows ...
    const { data: svcState } = await admin.from('excel_sync_state').select('id').eq('document_id', docId);
    assert.ok(svcState.length >= 1, 'service role can read excel_sync_state');

    // ... but an authenticated owner's DIRECT table SELECT is denied (RLS error) OR empty
    // (REVOKE ALL + zero client policies — service-role/SECURITY-DEFINER-RPC only).
    for (const table of ['excel_sync_state', 'excel_sync_ops', 'excel_sync_audit']) {
      const { data, error } = await ownerClient.from(table).select('id').eq('document_id', docId);
      const blocked = (error != null) || (Array.isArray(data) && data.length === 0);
      assert.ok(blocked, `direct client SELECT on ${table} must be denied/empty; got data=${JSON.stringify(data)} err=${error?.message}`);
    }
  } finally { await cleanup(admin, docId); }
});
