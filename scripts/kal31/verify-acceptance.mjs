#!/usr/bin/env node
/* KAL-31 Phase F — two-account verification.
 *
 * Walks the locked-spec acceptance criteria using:
 *   - supabase-js admin client (service-role) to provision four disposable
 *     accounts (Owner, Editor-paid, Editor-free, Viewer).
 *   - Direct DB writes to seed a document + collaborator row so the Owner
 *     can create invites.
 *   - Pure Supabase calls to create invites in each role + each tier-mix.
 *   - Standalone Playwright (chromium) with separate browser contexts to
 *     drive the /invite/<token> landing page and screenshot each acceptance
 *     state.
 *   - Service-role queries to verify document_collaborators rows after
 *     acceptance.
 *
 * Cleanup runs in a finally{} block so disposable users + documents +
 * invites are removed at the end regardless of pass/fail.
 *
 * Usage:
 *   node scripts/kal31/verify-acceptance.mjs
 *
 * Optional env:
 *   KAL31_BASE_URL  — defaults to http://localhost:5251/
 *   KAL31_HEADFUL=1 — open a real window
 */
import { createClient } from '@supabase/supabase-js';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const SHOTS_DIR = path.join(REPO_ROOT, '.agent', 'kal31', 'screenshots');
const BASE_URL = process.env.KAL31_BASE_URL || 'http://localhost:5251/';
fs.mkdirSync(SHOTS_DIR, { recursive: true });

function loadEnv(file) {
  const p = path.join(REPO_ROOT, file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

loadEnv('.env.local');
loadEnv('.env');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. Aborting.');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const STAMP = Date.now();
const PASSWORD = 'Kal31-Verify-Pass!';
const ACCOUNTS = {
  owner:        { email: `survey-test-owner-${STAMP}@example.com`,        tier: 'pro' },
  editorPaid:   { email: `survey-test-editor-paid-${STAMP}@example.com`,  tier: 'pro' },
  editorFree:   { email: `survey-test-editor-free-${STAMP}@example.com`,  tier: 'free' },
  viewer:       { email: `survey-test-viewer-${STAMP}@example.com`,       tier: 'free' },
  unregistered: { email: `survey-test-unreg-${STAMP}@example.com`,        tier: null }, // do not create
};

const results = [];        // [{ name, status, notes }]
const cleanup = {
  userIds: [],
  documentIds: [],
  inviteIds: [],
};

function log(msg, extra) {
  const t = new Date().toISOString().slice(11, 19);
  if (extra !== undefined) console.log(`[${t}] ${msg}`, extra);
  else console.log(`[${t}] ${msg}`);
}

function record(name, ok, notes = '') {
  const status = ok ? 'PASS' : 'FAIL';
  results.push({ name, status, notes });
  log(`  ${status} — ${name}${notes ? ` (${notes})` : ''}`);
}

async function shot(page, file) {
  const fp = path.join(SHOTS_DIR, file);
  await page.screenshot({ path: fp, fullPage: true });
  log(`  📸 ${file}`);
  return fp;
}

async function createUser(email, tier) {
  if (!tier) return null;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  const userId = data.user.id;
  cleanup.userIds.push(userId);
  // Seed subscription row. Real table is `user_subscriptions`. Don't fail
  // the whole run if the table shape is slightly different — the kal31 RPC
  // tolerates missing rows (treats as free).
  const sub1 = await admin.from('user_subscriptions').upsert({
    user_id: userId, tier, status: 'active',
  }, { onConflict: 'user_id' });
  if (sub1.error) log(`  warn: user_subscriptions upsert ${email}: ${sub1.error.message}`);
  // Also try `subscriptions` (legacy) because the kal31 RPC reads from this table.
  const sub2 = await admin.from('subscriptions').upsert({
    user_id: userId, tier, status: 'active',
  }, { onConflict: 'user_id' });
  if (sub2.error && !/Could not find the table/i.test(sub2.error.message)) {
    log(`  warn: subscriptions upsert ${email}: ${sub2.error.message}`);
  }
  return userId;
}

async function ensureDocument(ownerId) {
  // Try the most common shape: documents(id, name, user_id, ...).
  // We do a minimal insert + tolerate missing columns by retrying without.
  const baseRow = {
    name: `KAL-31 verify ${STAMP}`,
    user_id: ownerId,
    file_path: `kal31-verify/${STAMP}.pdf`,
    file_size: 0,
    page_count: 1,
  };
  const attempts = [
    baseRow,
    { ...baseRow, project_id: null },
  ];
  let lastErr;
  for (const row of attempts) {
    const { data, error } = await admin.from('documents').insert(row).select('id').single();
    if (!error && data?.id) {
      cleanup.documentIds.push(data.id);
      return data.id;
    }
    lastErr = error;
  }
  throw new Error(`could not create document: ${lastErr?.message}`);
}

async function ensureOwnerCollaborator(documentId, ownerId, ownerEmail) {
  // Make the owner a row in document_collaborators so the kal31 RLS sees them
  // as an owner. The existing app may already do this via trigger; we do it
  // explicitly for the verify script so we don't depend on app code paths.
  const { error } = await admin.from('document_collaborators').upsert({
    document_id: documentId,
    user_id: ownerId,
    email: ownerEmail,
    role: 'owner',
    status: 'active',
  }, { onConflict: 'document_id,user_id' });
  if (error) throw new Error(`owner collaborator upsert: ${error.message}`);
}

async function createInvite({ documentId, role, targetEmail, createdBy }) {
  const token = `kal31-${STAMP}-${Math.random().toString(36).slice(2, 10)}`;
  const row = {
    document_id: documentId,
    token,
    role,
    intended_role: role,
    target_email: targetEmail ? targetEmail.toLowerCase() : null,
    created_by: createdBy,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const { data, error } = await admin.from('document_invites').insert(row).select().single();
  if (error) throw new Error(`create invite: ${error.message}`);
  cleanup.inviteIds.push(data.id);
  return data;
}

async function signInUser(context, email) {
  // Use anon client to get session, then inject the access token into the
  // browser's localStorage so the InviteAcceptPage sees the signed-in user.
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign in ${email}: ${error.message}`);
  // Supabase JS v2 storage key shape: sb-<projectRef>-auth-token. The session
  // blob is the whole `data.session` object (the lib stores it verbatim).
  const projectRef = SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  const sessionBlob = JSON.stringify(data.session);
  // Set BOTH `addInitScript` (runs before app code) AND a route-level cookie
  // backup in case the project ref happens to be different from the URL host.
  await context.addInitScript(({ key, value }) => {
    try { window.localStorage.setItem(key, value); } catch (_e) { /* ignore */ }
  }, { key: storageKey, value: sessionBlob });
  return { user: data.user, session: data.session, storageKey };
}

async function pageSignIn(page, email) {
  // After page.goto, call this to force-set localStorage and reload. Some
  // browsers strip addInitScript localStorage on first run; reload ensures
  // the AuthProvider sees it on a clean second run.
  const projectRef = SUPABASE_URL.replace(/^https?:\/\//, '').split('.')[0];
  const storageKey = `sb-${projectRef}-auth-token`;
  await page.evaluate(async ({ url, anon, email, password, storageKey }) => {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ email, password }),
    });
    const session = await res.json();
    window.localStorage.setItem(storageKey, JSON.stringify(session));
  }, { url: SUPABASE_URL, anon: SUPABASE_ANON_KEY, email, password: PASSWORD, storageKey });
}

async function visitInvitePage(browser, token, asUser) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  if (asUser) await signInUser(context, asUser);
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') log(`  [browser err] ${msg.text()}`);
  });
  page.on('pageerror', (err) => log(`  [page err] ${err.message}`));
  // First load the origin (so localStorage is set under the right origin),
  // then in-page sign-in via fetch + localStorage, then navigate to the
  // invite path so the AuthProvider sees a session at boot.
  if (asUser) {
    await page.goto(`${BASE_URL}`);
    await pageSignIn(page, asUser);
  }
  await page.goto(`${BASE_URL.replace(/\/$/, '')}/invite/${token}`);
  // Wait for the invite card to settle. Status is set on the data attribute.
  // Anything other than loading/needs-auth is a final outcome.
  try {
    await page.waitForFunction(() => {
      const el = document.querySelector('[data-kal31-status]');
      const s = el && el.getAttribute('data-kal31-status');
      return s && s !== 'loading' && s !== 'needs-auth';
    }, { timeout: 15000 });
  } catch (_e) { /* fall through, screenshot whatever state is on screen */ }
  const status = await page.evaluate(() => {
    const el = document.querySelector('[data-kal31-status]');
    return el ? el.getAttribute('data-kal31-status') : null;
  });
  return { page, context, status };
}

async function getCollaborator(documentId, userId) {
  const { data } = await admin.from('document_collaborators').select('*').eq('document_id', documentId).eq('user_id', userId).maybeSingle();
  return data;
}

async function run() {
  log('=== KAL-31 Phase F verification ===');
  log(`Base URL: ${BASE_URL}`);

  // -----------------------------------------------------------------------
  // Provision users + document.
  // -----------------------------------------------------------------------
  log('Step 1: provisioning disposable users');
  const ownerId      = await createUser(ACCOUNTS.owner.email,      ACCOUNTS.owner.tier);
  const editorPaidId = await createUser(ACCOUNTS.editorPaid.email, ACCOUNTS.editorPaid.tier);
  const editorFreeId = await createUser(ACCOUNTS.editorFree.email, ACCOUNTS.editorFree.tier);
  const viewerId     = await createUser(ACCOUNTS.viewer.email,     ACCOUNTS.viewer.tier);
  log(`  owner=${ownerId} editorPaid=${editorPaidId} editorFree=${editorFreeId} viewer=${viewerId}`);

  log('Step 2: creating disposable document + owner row');
  const documentId = await ensureDocument(ownerId);
  await ensureOwnerCollaborator(documentId, ownerId, ACCOUNTS.owner.email);
  log(`  documentId=${documentId}`);
  record('Phase F · provision · service-role create users + document', true);

  // -----------------------------------------------------------------------
  // Launch playwright.
  // -----------------------------------------------------------------------
  log('Step 3: launching chromium for invite-page screenshots');
  const browser = await chromium.launch({ headless: !process.env.KAL31_HEADFUL });

  try {
    // ===== AC: viewer invite accepted by paid user → viewer access =====
    {
      const invite = await createInvite({ documentId, role: 'viewer', targetEmail: ACCOUNTS.editorPaid.email, createdBy: ownerId });
      const { page, context, status } = await visitInvitePage(browser, invite.token, ACCOUNTS.editorPaid.email);
      await shot(page, `01-accepted-viewer-by-paid-${invite.token}.png`);
      const collab = await getCollaborator(documentId, editorPaidId);
      record('AC: paid invitee accepts Viewer invite — UI shows accepted', status === 'accepted');
      record('AC: paid invitee accepts Viewer invite — DB row has role=viewer', collab?.role === 'viewer', `db role=${collab?.role}`);
      await context.close();
    }

    // ===== AC: editor invite to paid user → editor =====
    {
      // Reset the previous viewer row by deleting it so the new editor invite produces editor.
      await admin.from('document_collaborators').delete().eq('document_id', documentId).eq('user_id', editorPaidId);
      const invite = await createInvite({ documentId, role: 'editor', targetEmail: ACCOUNTS.editorPaid.email, createdBy: ownerId });
      const { page, context, status } = await visitInvitePage(browser, invite.token, ACCOUNTS.editorPaid.email);
      await shot(page, `02-accepted-editor-paid-${invite.token}.png`);
      const collab = await getCollaborator(documentId, editorPaidId);
      record('AC: paid invitee accepts Editor invite — UI shows accepted', status === 'accepted');
      record('AC: paid invitee accepts Editor invite — DB row has role=editor', collab?.role === 'editor', `db role=${collab?.role}`);
      await context.close();
    }

    // ===== AC: editor invite to free user → viewer + upgrade banner =====
    {
      const invite = await createInvite({ documentId, role: 'editor', targetEmail: ACCOUNTS.editorFree.email, createdBy: ownerId });
      const { page, context, status } = await visitInvitePage(browser, invite.token, ACCOUNTS.editorFree.email);
      const upgradeText = await page.evaluate(() => document.body.innerText);
      await shot(page, `03-free-editor-upgrade-${invite.token}.png`);
      const collab = await getCollaborator(documentId, editorFreeId);
      record('AC: free invitee accepts Editor invite — DB downgrades to viewer', collab?.role === 'viewer', `db role=${collab?.role}`);
      record('AC: free invitee accepts Editor invite — UI shows upgrade banner', /Upgrade/i.test(upgradeText) && status === 'accepted', `status=${status}`);
      await context.close();
    }

    // ===== AC: owner invite to free user → viewer + upgrade banner =====
    {
      await admin.from('document_collaborators').delete().eq('document_id', documentId).eq('user_id', editorFreeId);
      const invite = await createInvite({ documentId, role: 'owner', targetEmail: ACCOUNTS.editorFree.email, createdBy: ownerId });
      const { page, context, status } = await visitInvitePage(browser, invite.token, ACCOUNTS.editorFree.email);
      const txt = await page.evaluate(() => document.body.innerText);
      await shot(page, `04-free-owner-upgrade-${invite.token}.png`);
      const collab = await getCollaborator(documentId, editorFreeId);
      record('AC: free invitee accepts Owner invite — DB downgrades to viewer', collab?.role === 'viewer');
      record('AC: free invitee accepts Owner invite — UI shows upgrade-to-Owner banner', /Upgrade/i.test(txt) && status === 'accepted');
      await context.close();
    }

    // ===== AC: wrong account =====
    {
      const invite = await createInvite({ documentId, role: 'viewer', targetEmail: ACCOUNTS.viewer.email, createdBy: ownerId });
      const { page, context, status } = await visitInvitePage(browser, invite.token, ACCOUNTS.editorPaid.email);
      await shot(page, `05-wrong-account-${invite.token}.png`);
      record('AC: wrong-account state — UI shows wrong_account', status === 'wrong_account', `status=${status}`);
      await context.close();
    }

    // ===== AC: invalid token =====
    {
      const { page, context, status } = await visitInvitePage(browser, 'totally-bogus-token-123', ACCOUNTS.editorPaid.email);
      await shot(page, `06-invalid-token.png`);
      record('AC: invalid-token state — UI shows invalid', status === 'invalid');
      await context.close();
    }

    // ===== AC: expired token =====
    {
      const invite = await createInvite({ documentId, role: 'viewer', targetEmail: ACCOUNTS.viewer.email, createdBy: ownerId });
      await admin.from('document_invites').update({ expires_at: new Date(Date.now() - 60_000).toISOString() }).eq('id', invite.id);
      const { page, context, status } = await visitInvitePage(browser, invite.token, ACCOUNTS.viewer.email);
      await shot(page, `07-expired-${invite.token}.png`);
      record('AC: expired-token state — UI shows expired', status === 'expired');
      await context.close();
    }

    // ===== AC: revoked token =====
    {
      const invite = await createInvite({ documentId, role: 'viewer', targetEmail: ACCOUNTS.viewer.email, createdBy: ownerId });
      await admin.from('document_invites').update({ revoked_at: new Date().toISOString() }).eq('id', invite.id);
      const { page, context, status } = await visitInvitePage(browser, invite.token, ACCOUNTS.viewer.email);
      await shot(page, `08-revoked-${invite.token}.png`);
      record('AC: revoked-token state — UI shows revoked', status === 'revoked');
      await context.close();
    }

    // ===== AC: already-accepted token =====
    {
      // Already-accept the editorPaid invite above; re-accept should report 'already_accepted'.
      const invite = await createInvite({ documentId, role: 'viewer', targetEmail: ACCOUNTS.viewer.email, createdBy: ownerId });
      // First-accept.
      const v1 = await visitInvitePage(browser, invite.token, ACCOUNTS.viewer.email);
      record('AC: already-accepted setup — first acceptance is accepted', v1.status === 'accepted');
      await v1.context.close();
      // Second-accept.
      const v2 = await visitInvitePage(browser, invite.token, ACCOUNTS.viewer.email);
      await shot(v2.page, `09-already-accepted-${invite.token}.png`);
      record('AC: already-accepted state — UI shows already_accepted', v2.status === 'already_accepted');
      await v2.context.close();
    }

    // ===== AC: last-owner protection at the DB layer =====
    {
      // Try to delete the only owner row via service-role; the kal31 trigger
      // should raise check_violation. We use a raw query because the row was
      // upserted earlier.
      const { error: delErr } = await admin
        .from('document_collaborators')
        .delete()
        .eq('document_id', documentId)
        .eq('user_id', ownerId);
      const blocked = !!delErr && /last owner|kal31_guard_last_owner|check_violation/i.test(delErr.message || '');
      record('AC: last-owner cannot be removed at DB layer', blocked, delErr ? delErr.message : 'no error raised');
    }

    // ===== AC: needs-auth state (unauthenticated visit) =====
    {
      const invite = await createInvite({ documentId, role: 'viewer', targetEmail: ACCOUNTS.viewer.email, createdBy: ownerId });
      const context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
      const page = await context.newPage();
      await page.goto(`${BASE_URL.replace(/\/$/, '')}/invite/${invite.token}`);
      try {
        await page.waitForFunction(() => {
          const el = document.querySelector('[data-kal31-status]');
          const s = el && el.getAttribute('data-kal31-status');
          // unauthenticated visit settles on needs-auth.
          return s && s !== 'loading';
        }, { timeout: 8000 });
      } catch (_e) { /* may stay on loading */ }
      const status = await page.evaluate(() => document.querySelector('[data-kal31-status]')?.getAttribute('data-kal31-status'));
      await shot(page, `10-needs-auth-${invite.token}.png`);
      record('AC: unauthenticated invite open shows needs-auth state', status === 'needs-auth');
      await context.close();
    }

  } finally {
    await browser.close();
  }

  log('=== SUMMARY ===');
  const passes = results.filter((r) => r.status === 'PASS').length;
  const fails = results.filter((r) => r.status === 'FAIL').length;
  log(`PASS=${passes}  FAIL=${fails}`);
  for (const r of results) log(`  ${r.status}  ${r.name}${r.notes ? ` (${r.notes})` : ''}`);

  fs.writeFileSync(path.join(SHOTS_DIR, 'results.json'), JSON.stringify({
    base_url: BASE_URL,
    stamp: STAMP,
    accounts: ACCOUNTS,
    documentId,
    results,
  }, null, 2));
  log(`Results written: ${path.join(SHOTS_DIR, 'results.json')}`);

  return { passes, fails };
}

async function cleanupAll() {
  log('cleanup: deleting disposable invites/collaborators/documents/users');
  for (const id of cleanup.inviteIds) {
    await admin.from('document_invites').delete().eq('id', id);
  }
  for (const id of cleanup.documentIds) {
    // First delete collaborator rows so the kal31 last-owner trigger doesn't
    // block document deletion. The trigger lives on document_collaborators;
    // delete in a single statement with truncate-style cascading via CASCADE
    // on the FK.
    await admin.from('document_collaborators').delete().eq('document_id', id);
    await admin.from('document_invites').delete().eq('document_id', id);
    await admin.from('documents').delete().eq('id', id);
  }
  for (const id of cleanup.userIds) {
    await admin.from('subscriptions').delete().eq('user_id', id);
    await admin.auth.admin.deleteUser(id);
  }
  log('cleanup: done');
}

(async () => {
  let exitCode = 0;
  try {
    const { fails } = await run();
    if (fails > 0) exitCode = 2;
  } catch (err) {
    console.error('VERIFY FAILED:', err?.stack || err);
    exitCode = 1;
  } finally {
    try { await cleanupAll(); } catch (err) { console.warn('cleanup error:', err?.message || err); }
  }
  process.exit(exitCode);
})();
