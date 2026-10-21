// Backend security pass (migration 20261021160000_lock_down_definer_rpcs):
// SECURITY DEFINER RPCs that skipped their owner check for signed-out callers,
// or that were meant for the service role only, stay shut.
import { createClient } from '@supabase/supabase-js';
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { adminClient, clientFromPageSession, expect, signIn, test } from './helpers.mjs';

const anonClient = () => createClient(process.env.E2E_SUPABASE_URL, process.env.E2E_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Signs in through the real sign-in dialog, then probes with that session.
async function signedIn(page, account) {
  await signIn(page, account);
  return clientFromPageSession(page);
}

async function userId(account) {
  const { data } = await adminClient().auth.admin.listUsers();
  return data.users.find((u) => u.email === account.email).id;
}

const isPermissionDenied = (error) => error?.code === '42501' || /permission denied/i.test(error?.message || '');

test('a signed-out caller cannot archive, restore or purge a document', async () => {
  const anon = anonClient();
  for (const fn of ['archive_document', 'restore_document', 'purge_archived_document']) {
    const { error } = await anon.rpc(fn, { p_document_id: E2E_DOCUMENT.id });
    expect(isPermissionDenied(error), `${fn}: ${JSON.stringify(error)}`).toBe(true);
  }
  const { data } = await adminClient().from('documents').select('id, user_archived_at').eq('id', E2E_DOCUMENT.id).single();
  expect(data.user_archived_at).toBeNull();
});

test('a signed-in non-owner is still told not_owner', async ({ page }) => {
  const free = await signedIn(page, E2E_ACCOUNTS.free);
  const { data, error } = await free.rpc('archive_document', { p_document_id: E2E_DOCUMENT.id });
  expect(error).toBeNull();
  expect(data).toMatchObject({ ok: false, reason: 'not_owner' });
});

test('a signed-in user cannot call the service-only Excel sync RPCs', async ({ page }) => {
  const owner = await signedIn(page, E2E_ACCOUNTS.owner);
  const ownerId = await userId(E2E_ACCOUNTS.owner);
  const apply = await owner.rpc('kal308_apply_changeset', {
    p_actor_id: ownerId, p_document_id: E2E_DOCUMENT.id, p_template_id: 't', p_workbook_id: 'w',
    p_capability_tier: 'business', p_client_change_set_id: 'c', p_request_hash: 'h',
    p_device_hint: 'd', p_template_config: null, p_rows: [],
  });
  expect(isPermissionDenied(apply.error), JSON.stringify(apply.error)).toBe(true);
  const persist = await owner.rpc('kal309_persist_created_token', {
    p_document_id: E2E_DOCUMENT.id, p_template_id: 't', p_scope_id: 's',
    p_marker_annotation_id: 'm', p_client_change_set_id: 'c', p_assigned_token: 'x',
  });
  expect(isPermissionDenied(persist.error), JSON.stringify(persist.error)).toBe(true);
});

test('a signed-in user cannot look up other people by id or email', async ({ page }) => {
  const free = await signedIn(page, E2E_ACCOUNTS.free);
  const ownerId = await userId(E2E_ACCOUNTS.owner);
  const checks = [
    ['check_user_collaborator_eligibility', { target_user_id: ownerId }],
    ['get_user_id_by_email', { email_address: E2E_ACCOUNTS.owner.email }],
    ['get_active_projects', { p_user_id: ownerId }],
  ];
  for (const [fn, args] of checks) {
    const { error } = await free.rpc(fn, args);
    expect(isPermissionDenied(error), `${fn}: ${JSON.stringify(error)}`).toBe(true);
  }
});

test('the owner can still archive and restore their own document', async ({ page }) => {
  const owner = await signedIn(page, E2E_ACCOUNTS.owner);
  const archived = await owner.rpc('archive_document', { p_document_id: E2E_DOCUMENT.id });
  expect(archived.error).toBeNull();
  expect(archived.data.ok).toBe(true);
  const restored = await owner.rpc('restore_document', { p_document_id: E2E_DOCUMENT.id });
  expect(restored.error).toBeNull();
  expect(restored.data.ok).toBe(true);
});

// Migration 20261021190000_plan_rpcs_own_user_only: plan and usage RPCs answer
// for the caller, whatever id is passed.
test('a signed-in user only ever gets their own plan and counts', async ({ page }) => {
  const free = await signedIn(page, E2E_ACCOUNTS.free);
  const ownerId = await userId(E2E_ACCOUNTS.owner);
  const tier = await free.rpc('get_user_tier', { p_user_id: ownerId });
  expect(tier.error).toBeNull();
  expect(tier.data).toBe('free');
  const feature = await free.rpc('has_feature_access', { p_user_id: ownerId, p_feature: 'templates' });
  expect(feature.data).toBe(false);
  const ownCount = await free.rpc('get_current_usage', { p_user_id: await userId(E2E_ACCOUNTS.free), p_metric_name: 'documents_count' });
  const ownerCount = await free.rpc('get_current_usage', { p_user_id: ownerId, p_metric_name: 'documents_count' });
  expect(ownerCount.data).toBe(ownCount.data);
});

test('a signed-out caller cannot read anyone\'s plan', async () => {
  const ownerId = await userId(E2E_ACCOUNTS.owner);
  const { error } = await anonClient().rpc('get_user_tier', { p_user_id: ownerId });
  expect(isPermissionDenied(error), JSON.stringify(error)).toBe(true);
});
