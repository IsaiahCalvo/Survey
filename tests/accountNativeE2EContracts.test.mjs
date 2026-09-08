import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildAppDestination,
  requestAccountDeletion,
  resolveSubscriptionQuery,
  unlinkOAuthProvider,
} from '../src/utils/accountPlatform.js';
import {
  cleanMicrosoftReturnUrl,
  microsoftRedirectUriFor,
  microsoftReturnUrlFor,
} from '../src/utils/microsoftOAuthRouting.js';
import {
  resolveBillingReturnUrl,
  withBillingResult,
} from '../supabase/functions/_shared/billingReturn.ts';
import {
  deleteStripeCustomer,
  runAccountDeletionStages,
} from '../supabase/functions/_shared/accountDeletion.ts';
import { ensurePersistedStripeCustomer } from '../supabase/functions/_shared/stripeCustomerPersistence.ts';
import {
  parseNativeShellMessage,
  resolveSurveyDeepLink,
} from '../mobile-expo/src/nativeShellProtocol.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('account deletion sends the destructive confirmation and surfaces every safe failure', async () => {
  const calls = [];
  assert.deepEqual(await requestAccountDeletion({
    invoke: async (...args) => {
      calls.push(args);
      return { data: { deleted: true }, error: null };
    },
  }), { deleted: true });
  assert.deepEqual(calls, [['delete-account', { body: { confirmation: 'DELETE' } }]]);

  await assert.rejects(
    requestAccountDeletion({ invoke: async () => ({ data: null, error: new Error('offline') }) }),
    /offline/,
  );
  await assert.rejects(
    requestAccountDeletion({ invoke: async () => ({ data: { error: 'billing cancellation failed' }, error: null }) }),
    /billing cancellation failed/,
  );
  await assert.rejects(
    requestAccountDeletion({ invoke: async () => ({ data: {}, error: null }) }),
    /did not complete/,
  );
});

test('pending account cleanup never resolves as deletion or triggers client sign-out', async () => {
  const responses = [
    { deleted: false, pending: true, error: 'Account cleanup is not finished. Retry deletion to continue.' },
    { deleted: false, pending: true },
    { deleted: true },
  ];
  const client = { invoke: async () => ({ data: responses.shift(), error: null }) };
  let signOuts = 0;
  const requestThenSignOut = async () => { const result = await requestAccountDeletion(client); signOuts++; return result; };
  await assert.rejects(requestThenSignOut(), /Retry deletion/);
  await assert.rejects(requestThenSignOut(), /did not complete/);
  assert.equal(signOuts, 0);
  assert.deepEqual(await requestThenSignOut(), { deleted: true });
  assert.equal(signOuts, 1);
  assert.match(read('src/contexts/AuthContext.jsx'), /await requestAccountDeletion\(supabase\.functions\);[\s\S]*auth\.signOut/);
});

test('Google disconnect unlinks only Google and refuses the final provider before any request', async () => {
  const google = { identity_id: 'google-id', provider: 'google' };
  const email = { identity_id: 'email-id', provider: 'email' };
  const calls = [];
  const nextUser = { id: 'user', identities: [email] };
  assert.equal(await unlinkOAuthProvider({
    user: { id: 'user', identities: [google, email] },
    provider: 'google',
    auth: {
      unlinkIdentity: async (identity) => {
        calls.push(identity);
        return { data: { user: nextUser }, error: null };
      },
      getUser: async () => { throw new Error('unneeded refresh'); },
    },
  }), nextUser);
  assert.deepEqual(calls, [google]);

  let invoked = false;
  await assert.rejects(unlinkOAuthProvider({
    user: { identities: [google] },
    provider: 'google',
    auth: { unlinkIdentity: async () => { invoked = true; } },
  }), /another sign-in method/);
  assert.equal(invoked, false);
});

test('Microsoft callback routing preserves mobile/native flags and strips only OAuth fields', () => {
  const location = new URL('https://surveytool.app/mobile?mobileNav=tabs&nativeShell=expo&invite=abc#team');
  assert.equal(microsoftRedirectUriFor(location), 'https://surveytool.app/mobile');
  assert.equal(microsoftReturnUrlFor(location), '/mobile?mobileNav=tabs&nativeShell=expo&invite=abc#team');
  assert.equal(
    cleanMicrosoftReturnUrl(
      '/mobile?mobileNav=tabs&nativeShell=expo&invite=abc&code=secret&state=s#team',
      location.origin,
    ),
    '/mobile?mobileNav=tabs&nativeShell=expo&invite=abc#team',
  );
  assert.throws(() => cleanMicrosoftReturnUrl('https://evil.example/', location.origin), /cross-origin/);

  assert.equal(microsoftRedirectUriFor({ origin: 'null', protocol: 'file:', pathname: '/index.html' }), 'https://surveytool.app/');
  assert.equal(microsoftRedirectUriFor({ origin: 'capacitor://localhost', protocol: 'capacitor:', pathname: '/mobile' }), 'https://surveytool.app/mobile');
  assert.equal(microsoftRedirectUriFor({ origin: 'http://localhost:5174', protocol: 'http:', pathname: '/' }), 'https://surveytool.app/');
  assert.equal(microsoftRedirectUriFor({ origin: 'http://127.0.0.1:5173', protocol: 'http:', pathname: '/' }), 'https://surveytool.app/');
  assert.equal(microsoftRedirectUriFor({ origin: 'https://www.surveytool.app', protocol: 'https:', pathname: '/' }), 'https://surveytool.app/');
  assert.equal(microsoftRedirectUriFor({ origin: 'http://localhost:5173', protocol: 'http:', pathname: '/' }), 'http://localhost:5173/');
});

test('account deletion safely resumes after every completed stage', async () => {
  const stageNames = ['billing', 'database', 'storage', 'auth'];
  for (const failAfter of stageNames) {
    const completed = new Set();
    let injected = false;
    const operation = (name) => async () => {
      completed.add(name);
      if (name === failAfter && !injected) {
        injected = true;
        throw new Error(`lost response after ${name}`);
      }
    };
    const stages = {
      cancelBilling: operation('billing'),
      deleteDatabaseRows: operation('database'),
      removeStorage: operation('storage'),
      deleteAuthUser: operation('auth'),
    };

    await assert.rejects(runAccountDeletionStages(stages), new RegExp(failAfter));
    await runAccountDeletionStages(stages);
    assert.deepEqual([...completed], stageNames);
  }
});

test('account deletion treats an already-deleted Stripe customer as retry success', async () => {
  await deleteStripeCustomer({
    customers: { del: async () => { throw { code: 'resource_missing', statusCode: 404 }; } },
  }, 'cus_deleted');
  await assert.rejects(
    deleteStripeCustomer({ customers: { del: async () => { throw new Error('network'); } } }, 'cus_live'),
    /network/,
  );
});

test('checkout never creates a session customer until its Stripe id is authoritatively persisted', async () => {
  const calls = [];
  const customerId = await ensurePersistedStripeCustomer({
    existingCustomerId: null,
    createCustomer: async () => { calls.push('create'); return { id: 'cus_new' }; },
    persistCandidate: async (id) => { calls.push(`persist:${id}`); },
    readAuthoritative: async () => { calls.push('read'); return 'cus_new'; },
    removeCustomer: async (id) => { calls.push(`remove:${id}`); },
  });
  assert.equal(customerId, 'cus_new');
  assert.deepEqual(calls, ['create', 'persist:cus_new', 'read']);
});

test('checkout deletes a newly-created Stripe customer and aborts when persistence fails', async () => {
  const removed = [];
  await assert.rejects(ensurePersistedStripeCustomer({
    existingCustomerId: null,
    createCustomer: async () => ({ id: 'cus_unpersisted' }),
    persistCandidate: async () => { throw new Error('database unavailable'); },
    readAuthoritative: async () => null,
    removeCustomer: async (id) => { removed.push(id); },
  }), /database unavailable/);
  assert.deepEqual(removed, ['cus_unpersisted']);
});

test('checkout reconciles lost responses and concurrent customer creation before session creation', async () => {
  const removedAfterLostReply = [];
  assert.equal(await ensurePersistedStripeCustomer({
    existingCustomerId: null,
    createCustomer: async () => ({ id: 'cus_committed' }),
    persistCandidate: async () => { throw new Error('response lost'); },
    readAuthoritative: async () => 'cus_committed',
    removeCustomer: async (id) => { removedAfterLostReply.push(id); },
  }), 'cus_committed');
  assert.deepEqual(removedAfterLostReply, []);

  const removedRaceLoser = [];
  assert.equal(await ensurePersistedStripeCustomer({
    existingCustomerId: null,
    createCustomer: async () => ({ id: 'cus_loser' }),
    persistCandidate: async () => {},
    readAuthoritative: async () => 'cus_winner',
    removeCustomer: async (id) => { removedRaceLoser.push(id); },
  }), 'cus_winner');
  assert.deepEqual(removedRaceLoser, ['cus_loser']);
});

test('checkout does not delete a possibly persisted customer when authoritative reconciliation fails', async () => {
  const removed = [];
  await assert.rejects(ensurePersistedStripeCustomer({
    existingCustomerId: null,
    createCustomer: async () => ({ id: 'cus_ambiguous' }),
    persistCandidate: async () => { throw new Error('response lost'); },
    readAuthoritative: async () => { throw new Error('read unavailable'); },
    removeCustomer: async (id) => { removed.push(id); },
  }), /verify Stripe customer persistence/);
  assert.deepEqual(removed, []);
});

test('invite destinations retain Expo flags through sign-in and document-open returns', () => {
  const invite = new URL('https://surveytool.app/invite/abc?mobileNav=tabs&nativeShell=expo');
  assert.equal(
    buildAppDestination({ location: invite, params: { signIn: 1, invite: 'abc' } }),
    '/mobile?mobileNav=tabs&nativeShell=expo&signIn=1&invite=abc',
  );
  assert.equal(
    buildAppDestination({ location: invite, params: { docId: 'document 1' } }),
    '/mobile?mobileNav=tabs&nativeShell=expo&docId=document+1',
  );
});

test('subscription timeout settles and a deterministic retry can recover', async () => {
  await assert.rejects(resolveSubscriptionQuery(new Promise(() => {}), 5), /too long/);
  assert.deepEqual(
    await resolveSubscriptionQuery(Promise.resolve({ data: { tier: 'pro', status: 'active' }, error: null }), 100),
    { tier: 'pro', status: 'active' },
  );
  await assert.rejects(
    resolveSubscriptionQuery(Promise.resolve({ data: null, error: new Error('offline') }), 100),
    /offline/,
  );
});

test('Stripe success/cancel returns preserve the Expo route and reject open redirects', () => {
  const requested = 'https://surveytool.app/mobile?mobileNav=tabs&nativeShell=expo';
  const resolved = resolveBillingReturnUrl(requested, 'https://surveytool.app');
  assert.equal(resolved, requested);
  assert.equal(withBillingResult(resolved, 'success'), `${requested}&billing=success`);
  assert.equal(withBillingResult(resolved, 'cancelled'), `${requested}&billing=cancelled`);
  assert.equal(
    resolveBillingReturnUrl('https://evil.example/steal', 'https://surveytool.app'),
    'https://surveytool.app/',
  );
  assert.equal(
    resolveBillingReturnUrl('http://localhost:5173/mobile?nativeShell=expo', 'http://localhost:5173'),
    'http://localhost:5173/mobile?nativeShell=expo',
  );
});

test('native shell deep links and Android bridge messages are strict and platform-neutral', () => {
  const expoConfig = JSON.parse(read('mobile-expo/app.json'));
  assert.equal(expoConfig.expo.android.package, 'com.kalvoe.survey');

  assert.equal(
    resolveSurveyDeepLink('https://surveytool.app/mobile?docId=abc'),
    'https://surveytool.app/mobile?docId=abc&mobileNav=tabs&nativeShell=expo',
  );
  assert.equal(
    resolveSurveyDeepLink('com.kalvoe.survey:?path=%2Fmobile%3FdocId%3Dabc'),
    'https://surveytool.app/mobile?docId=abc&mobileNav=tabs&nativeShell=expo',
  );
  assert.equal(resolveSurveyDeepLink('https://evil.example/mobile'), null);
  assert.equal(resolveSurveyDeepLink('com.kalvoe.survey:?path=//evil.example'), null);
  assert.deepEqual(parseNativeShellMessage('{"type":"survey:shell-ready"}'), { type: 'survey:shell-ready' });
  assert.deepEqual(parseNativeShellMessage('{"type":"survey:diagnostic","area":"pdf-zoom"}'), {
    type: 'survey:diagnostic', area: 'pdf-zoom',
  });
  assert.equal(parseNativeShellMessage('not-json'), null);

  const app = read('mobile-expo/App.tsx');
  assert.match(app, /onMessage=\{handleWebMessage\}/);
  assert.doesNotMatch(app, /onMessage=\{Platform\.OS === 'ios'/);
  assert.match(app, /message\?\.type === 'survey:shell-ready'[\s\S]*finishShellLoad\(\)/);
  assert.match(app, /parseNativeShellMessage\(event\.nativeEvent\.data\)/);
});

test('owned UI and Edge code route through the tested account and billing seams', () => {
  assert.match(read('src/contexts/AuthContext.jsx'), /requestAccountDeletion\(supabase\.functions\)/);
  assert.match(read('src/contexts/AuthContext.jsx'), /unlinkOAuthProvider\(\{/);
  assert.match(read('src/components/AccountSettings.jsx'), /resolveSubscriptionQuery\(/);
  assert.match(read('src/components/AccountSettings.jsx'), /create-portal-session[\s\S]*buildBillingReturnUrl\(\)/);
  assert.match(read('src/components/StripeCheckout.jsx'), /create-checkout-session[\s\S]*buildBillingReturnUrl\(\)/);
  assert.match(read('supabase/functions/create-checkout-session/index.ts'), /withBillingResult\(billingReturnUrl, 'cancelled'\)/);
  const checkoutEndpoint = read('supabase/functions/create-checkout-session/index.ts');
  assert.match(checkoutEndpoint, /recoverBillingOperations\(\{/);
  assert.match(checkoutEndpoint, /executeBillingOperation\(\{/);
  assert.match(checkoutEndpoint, /rotateBillingCustomer\(\{/);
  assert.match(read('supabase/functions/create-portal-session/index.ts'), /resolveBillingReturnUrl\(body\?\.returnUrl/);
});
