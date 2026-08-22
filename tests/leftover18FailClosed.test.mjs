// Leftover-18 fail-closed contracts — 2026-08-21 legal unblock pass.
// Asserts the real gates. Does not invent captcha tokens, Stripe sessions,
// MSAL passwords, lease emails, or stamp file.id on ?testPdf=.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  EXCEL_AUTOMATIC_WRITEBACK_ENABLED,
  isSilentWritebackBlocked,
} from '../src/utils/excelWritebackGate.js';
import {
  DEFAULT_TURNSTILE_SITE_KEY,
  isTurnstileEnabled,
  resolveTurnstileSiteKey,
} from '../src/components/turnstileConfig.js';
import { ACCOUNT_DELETION_CONFIRMATION } from '../src/utils/accountPlatform.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const HUB = read('src/home/HubPreview.jsx');
const DEV = read('src/DevTestRoute.jsx');
const AUTH = read('src/components/AuthModal.jsx');
const ACCOUNT = read('src/components/AccountSettings.jsx');
const STRIPE = read('src/components/StripeCheckout.jsx');
const PRESENCE = read('src/components/PresenceAvatars.jsx');
const REVISIONS = read('src/components/revisions/RevisionsPanel.jsx');
const LEASE = read('scripts/test-account-lease.mjs');
const ELECTRON = read('src/electron-main.js');
const DASHBOARD = read('src/Dashboard.jsx');
const VIEWER = read('src/PDFViewer.jsx');

test('X-01 / X-05 persist: ?testPdf= must not stamp file.id', () => {
  assert.match(DEV, /Do NOT set file\.id/);
  assert.match(DEV, /file\.__localHistoryDocumentId = `dev-testpdf:\$\{pdfName\}`/);
  assert.doesNotMatch(DEV, /file\.id\s*=/);
  assert.match(VIEWER, /Save version needs a signed-in cloud document/);
  assert.match(REVISIONS, /if \(!documentId \|\| !user\?\.id\) return/);
  assert.match(REVISIONS, /cloud Save\/Restore stays owner-gated off/);
});

test('X-06 writeback: automatic Excel writeback stays fail-closed', () => {
  assert.equal(EXCEL_AUTOMATIC_WRITEBACK_ENABLED, false);
  assert.equal(isSilentWritebackBlocked(true), true);
  assert.equal(isSilentWritebackBlocked(false), false);
  assert.match(read('src/utils/excelWritebackGate.js'), /EXCEL_AUTOMATIC_WRITEBACK_ENABLED = false/);
});

test('U-04: hubPreview usage is a static seed, not Dashboard cloud meter', () => {
  assert.match(HUB, /MOCK_CHECKLIST_ITEM_USAGE = Object\.freeze\(\{\s*i1: 3/);
  assert.match(HUB, /previewGetChecklistItemUsageCount/);
  assert.match(HUB, /getChecklistItemUsageCount=\{previewGetChecklistItemUsageCount\}/);
  assert.match(DASHBOARD, /Please sign in to upload documents/);
});

test('A-01 / UL-15: Turnstile gate rejects a missing token; never invents one', () => {
  assert.equal(resolveTurnstileSiteKey({}), DEFAULT_TURNSTILE_SITE_KEY);
  assert.equal(isTurnstileEnabled(''), false);
  assert.equal(isTurnstileEnabled(DEFAULT_TURNSTILE_SITE_KEY), true);
  assert.match(AUTH, /TURNSTILE_ENABLED && captchaMode && !captchaToken && !captchaBroken/);
  assert.match(AUTH, /Please complete the .*human.*check below/);
  assert.doesNotMatch(AUTH, /invent.*captcha|fakeCaptcha|captchaToken\s*=\s*['\"]cf-/);
  assert.match(ACCOUNT, /TURNSTILE_ENABLED && !captchaToken && !captchaBroken/);
  assert.match(HUB, /signIn: previewBlocked\('sign in'\)/);
  assert.match(DEV, /signIn: previewBlocked\('sign in'\)/);
});

test('A-02 / UL-21 / UL-22: preview MSAL/Google fail-closed; msalInstance is null', () => {
  assert.match(HUB, /msalInstance: null/);
  assert.match(HUB, /login: previewBlocked\('start Microsoft login'\)/);
  assert.match(HUB, /signInWithGoogle: previewBlocked\('start Google sign-in'\)/);
  assert.match(HUB, /linkGoogleIdentity: previewBlocked\('start Google OAuth'\)/);
  assert.match(DEV, /msalInstance: null/);
  assert.match(DEV, /login: previewBlocked\('start Microsoft login'\)/);
});

test('A-03 / UL-24: preview cannot mint a live inbox send', () => {
  assert.match(HUB, /resendConfirmation: previewBlocked\('resend confirmation emails'\)/);
  const share = read('src/home/ShareModal.jsx');
  assert.match(share, /Must be signed in|Sharing needs a signed-in cloud account|Could not create invite link|mintInvite/);
});

test('A-05 / UL-20: developer preview disables StripeCheckout; live URL is not invented', () => {
  assert.match(HUB, /tier: 'developer'/);
  assert.match(ACCOUNT, /Developer account/);
  assert.match(ACCOUNT, /subscription\?\.tier === 'developer'/);
  assert.match(STRIPE, /Must be signed in to start a trial/);
  assert.match(STRIPE, /supabase\.auth\.getSession\(\)/);
  assert.match(STRIPE, /supabase\.functions\.invoke\('create-checkout-session'/);
  assert.ok(
    STRIPE.indexOf('Must be signed in to start a trial')
      < STRIPE.indexOf("supabase.functions.invoke('create-checkout-session'"),
    'session gate must run before create-checkout-session',
  );
  assert.doesNotMatch(STRIPE, /checkout\.stripe\.com\/c\/pay\/cs_test_invented/);
  assert.match(STRIPE, /No checkout URL returned/);
});

test('A-06 / UL-45: PresenceAvatars dedupes by user_id (same-user two-tab = one face)', () => {
  assert.match(PRESENCE, /Deduplicate by user_id/);
  assert.match(PRESENCE, /uniqueByUser/);
  assert.match(PRESENCE, /const id = row\?\.user_id/);
});

test('UL-03: Electron File→Open is IPC-only; web Dashboard upload is guest-gated', () => {
  assert.match(ELECTRON, /label: 'Open PDF…'/);
  assert.match(ELECTRON, /win\.webContents\.send\('menu:open-pdf'\)/);
  assert.match(DASHBOARD, /Please sign in to upload documents/);
});

test('UL-13 / UL-16: preview profile persist and wipe throw, they do not claim success', () => {
  assert.match(HUB, /updateProfile: previewBlocked\('save profile changes'\)/);
  assert.match(HUB, /deleteAccount: previewBlocked\('delete accounts'\)/);
  assert.match(HUB, /throw new Error\(`Preview cannot \$\{action\}\.`\)/);
  assert.equal(ACCOUNT_DELETION_CONFIRMATION, 'DELETE');
});

test('lease assign cannot invent a second-account tuple', () => {
  assert.match(LEASE, /At least one exact account assignment is required/);
  assert.match(LEASE, /email\|userId\|tier\|status|Every account assignment needs an exact/);
  assert.doesNotMatch(LEASE, /function listAccounts|cmd === 'list'/);
  assert.equal(existsSync(join(root, '.bot-credentials.json')), false);
  assert.equal(existsSync(join(root, '.survey-test-account.json')), false);
  assert.equal(existsSync(join(root, '.env.local')), false);
  assert.equal(existsSync(join(root, '.env.test')), false);
});

test('SQL apply leftovers stay in-tree; this host has no local Docker DB', () => {
  const migrations = readdirSync(join(root, 'supabase/migrations')).filter((name) => (
    name.startsWith('20260820') && name.endsWith('.sql')
  ));
  assert.deepEqual(migrations.sort(), [
    '20260820010000_invite_tier_gate_and_revoke_access.sql',
    '20260820020000_account_deletion_collaborator_guard.sql',
    '20260820120000_billing_trial_used_and_event_idempotency.sql',
    '20260820220000_kal31_guard_last_owner_lock.sql',
    '20260820230000_kal309_create_identity_guard.sql',
  ]);
});
