import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  appReturnPath,
  buildAppDestination,
  buildBillingReturnUrl,
  canUnlinkProvider,
  openExternalDestination,
  withTimeout,
} from '../src/utils/accountPlatform.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('mobile app destinations preserve tabs/native-shell routing', () => {
  const expo = new URL('https://surveytool.app/invite/token?mobileNav=tabs&nativeShell=expo');
  assert.equal(appReturnPath(expo), '/mobile?mobileNav=tabs&nativeShell=expo');
  assert.equal(
    buildAppDestination({ location: expo, params: { signIn: 1, invite: 'abc' } }),
    '/mobile?mobileNav=tabs&nativeShell=expo&signIn=1&invite=abc',
  );
  assert.equal(buildBillingReturnUrl(expo), 'https://surveytool.app/mobile?mobileNav=tabs&nativeShell=expo');

  const web = new URL('https://surveytool.app/invite/token');
  assert.equal(appReturnPath(web), '/');
  assert.equal(buildAppDestination({ location: web, params: { docId: 'd 1' } }), '/?docId=d+1');
});

test('external navigation stays in native WebView but opens web and Electron safely', async () => {
  const nativeAssignments = [];
  const nativeWindow = {
    location: {
      search: '?nativeShell=expo', pathname: '/mobile', protocol: 'https:', origin: 'https://surveytool.app',
      assign: (url) => nativeAssignments.push(url),
    },
  };
  assert.equal(await openExternalDestination('https://checkout.stripe.com/a', nativeWindow), 'native-shell');
  assert.deepEqual(nativeAssignments, ['https://checkout.stripe.com/a']);

  const electronUrls = [];
  const electronWindow = {
    location: { search: '', pathname: '/', protocol: 'file:', origin: 'null' },
    electronAPI: { openExternal: async (url) => electronUrls.push(url) },
  };
  assert.equal(await openExternalDestination('https://checkout.stripe.com/b', electronWindow), 'electron');
  assert.deepEqual(electronUrls, ['https://checkout.stripe.com/b']);

  await assert.rejects(
    openExternalDestination('https://checkout.stripe.com/c', {
      location: { search: '', pathname: '/', protocol: 'https:', origin: 'https://surveytool.app' },
      open: () => null,
    }),
    /blocked the new window/,
  );
});

test('provider unlink refuses to remove the final sign-in method', () => {
  const google = { identity_id: 'g', provider: 'google' };
  assert.equal(canUnlinkProvider({ identities: [google] }, 'google').reason, 'last-sign-in-method');
  assert.equal(canUnlinkProvider({ identities: [google, { identity_id: 'e', provider: 'email' }] }, 'google').allowed, true);
  assert.equal(canUnlinkProvider({ identities: [] }, 'google').reason, 'not-connected');
});

test('subscription timeout settles stalled requests', async () => {
  await assert.rejects(withTimeout(new Promise(() => {}), 5, 'timed out'), /timed out/);
  assert.equal(await withTimeout(Promise.resolve('ok'), 100, 'timed out'), 'ok');
});

test('account settings wires real deletion, unlink, truthful email status, retry, and billing return', () => {
  const auth = read('src/contexts/AuthContext.jsx');
  const settings = read('src/components/AccountSettings.jsx');
  const checkout = read('src/components/StripeCheckout.jsx');
  assert.match(auth, /unlinkOAuthProvider\(\{/);
  assert.match(auth, /requestAccountDeletion\(supabase\.functions\)/);
  assert.match(settings, /await deleteAccount\(\)/);
  assert.match(settings, /await unlinkProvider\('google'\)/);
  assert.doesNotMatch(settings, /\? signOut : signInWithGoogle/);
  assert.match(settings, /notificationSent[\s\S]*A confirmation email has been sent/);
  assert.match(settings, /subscriptionError[\s\S]*Retry/);
  assert.match(settings, /buildBillingReturnUrl\(\)/);
  assert.match(checkout, /returnUrl: buildBillingReturnUrl\(\)/);
  // 2026-08-20: checkout/portal now claim the tab at click time and steer it
  // when the session URL arrives (popup rules block a late window.open).
  // The invariant is unchanged: the Stripe URL must reach the deferred tab.
  assert.match(checkout, /openDeferredExternalDestination\(\)/);
  assert.match(checkout, /tab\.navigate\(data\.url\)/);
  assert.match(settings, /openDeferredExternalDestination\(\)/);
  assert.match(settings, /tab\.navigate\(data\.url\)/);
  assert.doesNotMatch(settings, /support@yourcompany\.com/);
});

test('delete-account function verifies caller and performs retry-safe ordered deletion', () => {
  const source = read('supabase/functions/delete-account/index.ts');
  assert.match(source, /body\?\.confirmation !== 'DELETE'/);
  assert.match(source, /caller\.auth\.getUser\(\)/);
  assert.match(source, /deleteStripeCustomer\(stripe, subscription\?\.stripe_customer_id\)/);
  assert.match(source, /cleanupAccountStorage\(admin, userId\)/);
  assert.match(source, /if \(!cleanup\.complete\)/);
  assert.doesNotMatch(source, /listOwnedStorage|\.list\(/);
  assert.doesNotMatch(source, /storage\.from\('documents'\)\.remove/);
  assert.match(source, /admin\.rpc\('delete_account_owned_rows'/);
  assert.match(source, /deleteDatabaseRows:[\s\S]*removeStorage:[\s\S]*deleteAuthUser:/);
  assert.match(source, /admin\.auth\.admin\.deleteUser\(user\.id\)/);
  assert.match(source, /'Access-Control-Allow-Origin': '\*'/);

  const migration = read('supabase/migrations/20260811120000_account_deletion_user_references.sql');
  assert.match(migration, /project_collaborators_invited_by_fkey[\s\S]*ON DELETE SET NULL/);
  assert.match(migration, /excel_workbook_registrations[\s\S]*registered_by DROP NOT NULL/);
  assert.match(migration, /FUNCTION public\.delete_account_owned_rows[\s\S]*auth\.role\(\)[\s\S]*service_role/);
});

test('Microsoft and invite returns preserve the active production/mobile route', () => {
  const microsoft = read('src/contexts/MSGraphContext.jsx');
  const legacyMicrosoft = read('src/authConfig.js');
  const invite = read('src/home/InviteAcceptPage.jsx');
  assert.doesNotMatch(microsoft, /const AZURE_REDIRECT_URI = 'http:\/\/localhost:5173'/);
  assert.doesNotMatch(legacyMicrosoft, /redirectUri: "http:\/\/localhost:5173"/);
  assert.match(microsoft, /microsoftRedirectUriFor/);
  assert.match(microsoft, /MS_OAUTH_RETURN_URL_KEY/);
  assert.match(microsoft, /restoreMicrosoftReturnUrl\(returnUrl\)/);
  assert.match(invite, /buildAppDestination\(\{ params: \{ docId: result\.documentId \} \}\)/);
  assert.match(invite, /buildAppDestination\(\{ params: \{ signIn: '1', invite: token \|\| '' \} \}\)/);
});

test('native shell accepts only trusted Survey links and remounts the WebView', () => {
  const source = read('mobile-expo/App.tsx');
  const protocol = read('mobile-expo/src/nativeShellProtocol.js');
  assert.match(source, /BackHandler, Linking, Platform/);
  assert.match(protocol, /incoming\.origin !== surveyOrigin/);
  assert.match(protocol, /incoming\.protocol !== 'com\.kalvoe\.survey:'/);
  assert.match(source, /Linking\.getInitialURL\(\)/);
  assert.match(source, /Linking\.addEventListener\('url'/);
  assert.match(source, /surveyLaunchUrlRef\.current = withLaunchCacheBust\(target, launchId\)/);
});
