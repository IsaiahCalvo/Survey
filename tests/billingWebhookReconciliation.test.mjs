// These execute the actual handler + reconciliation module. The RPC doubles
// test their boundary protocol, NOT PostgreSQL locking, archival or atomicity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';

const endpointUrl = new URL('../supabase/functions/stripe-webhook/index.ts', import.meta.url);
const moduleUrl = new URL('../supabase/functions/_shared/billingReconciliation.ts', import.meta.url);
const clone = value => value === undefined ? undefined : structuredClone(value);
const actor = '11111111-1111-4111-8111-111111111111';
const row = extra => ({ user_id: actor, tier: 'pro', status: 'active', stripe_customer_id: 'cus_fixture',
  stripe_subscription_id: 'sub_fixture', metadata: {}, revision: 1, ...extra });
const subscription = (extra = {}) => ({ id: 'sub_fixture', customer: 'cus_fixture', livemode: false,
  status: 'active', metadata: { user_id: actor }, items: { data: [{ price: { id: 'price_pro', recurring: { interval: 'month' } },
    current_period_start: 1700000000, current_period_end: 1700100000 }] }, ...extra });
const event = (object = subscription(), type = 'customer.subscription.updated', extra = {}) => ({
  id: 'evt_fixture', object: 'event', type, created: 1700000000, livemode: false, api_version: '2026-02-25.clover',
  data: { object }, ...extra,
});

function fixture(options = {}) {
  const state = { calls: [], reads: 0, retrieves: 0, applies: 0, row: row(), current: subscription(),
    user: { id: actor, email: 'billing@example.invalid', user_metadata: { firstName: 'Offline' } },
    receipts: new Map(), notifications: new Map(), claims: new Map(), emails: [], signatureError: false, ...options };
  const record = (kind, value = {}) => state.calls.push({ kind, ...clone(value) });
  const db = {
    from() { throw Error('Billing must read/write through the revision-aware RPC boundary'); },
    async rpc(name, args) {
      record(name, { args });
      if (name === 'reconcile_billing_subscription_event') state.applies++;
      const override = await state.onRpc?.(name, clone(args), state);
      if (override !== undefined) return override;
      if (name === 'read_billing_subscription_snapshot') {
        const index = ++state.reads; record('read', { args });
        const response = state.onRead ? await state.onRead(index, state) : { data: clone(state.row), error: state.readError || null };
        return { data: response.data ? { subscription: response.data, revision: String(index - 1) } : null, error: response.error };
      }
      if (name === 'lookup_billing_event') return { data: clone(state.receipts.get(args.p_event_id) || null), error: null };
      if (name === 'reconcile_billing_subscription_event') {
        const result = { outcome: args.p_patch ? 'applied' : 'ignored' };
        state.receipts.set(args.p_event_id, result);
        if (args.p_notification) state.notifications.set(args.p_event_id, args.p_notification.map(payload => ({ payload: clone(payload), sent: false })));
        return { data: result, error: null };
      }
      if (name === 'claim_billing_notification') {
        const saved = state.notifications.get(args.p_event_id);
        const notification = (Array.isArray(saved) ? saved : saved ? [saved] : []).find(item => !item.sent);
        if (!notification) return { data: { outcome: saved ? 'sent' : 'none' }, error: null };
        state.claims.set(args.p_claim_token, notification);
        notification.sendBy ||= new Date(Date.now() + 60_000).toISOString();
        return { data: { outcome: 'claimed', payload: clone(notification.payload),
          provider_key: `billing:${args.p_event_id}:${notification.payload.key || 'fixture'}`, send_by: notification.sendBy }, error: null };
      }
      if (name === 'complete_billing_notification') {
        state.claims.get(args.p_claim_token).sent = true;
        return { data: { outcome: 'sent' }, error: null };
      }
      throw Error(`Unexpected RPC: ${name}`);
    },
    auth: { admin: { async getUserById(id) { record('auth', { id }); return { data: { user: clone(state.user) }, error: state.authError || null }; } } },
  };
  class Stripe {
    static createFetchHttpClient() {} static createSubtleCryptoProvider() {}
    webhooks = { constructEventAsync: async body => {
      record('verify'); if (state.signatureError) throw Error('invalid fixture signature'); return JSON.parse(body);
    } };
    subscriptions = { retrieve: async id => {
      const index = ++state.retrieves; record('subscription', { id });
      if (state.providerError) throw Error('fixture provider unavailable');
      return clone(state.onRetrieve ? state.onRetrieve(index, state) : state.current);
    } };
    invoices = { retrieve: async id => { record('invoice', { id }); return clone(state.invoice); } };
  }
  const env = { STRIPE_SECRET_KEY: 'sk_test_offline_fixture', STRIPE_WEBHOOK_SECRET: 'whsec_offline_fixture',
    SUPABASE_URL: 'https://offline.invalid', SUPABASE_SERVICE_ROLE_KEY: 'offline-fixture',
    STRIPE_PRO_MONTHLY_PRICE_ID: 'price_pro', STRIPE_PRO_ANNUAL_PRICE_ID: 'price_annual', STRIPE_ENTERPRISE_PRICE_ID: 'price_enterprise' };
  let handler;
  const moduleSource = stripTypeScriptTypes(readFileSync(moduleUrl, 'utf8').replace(/^export /gm, ''), { mode: 'strip' });
  const endpointSource = stripTypeScriptTypes(readFileSync(endpointUrl, 'utf8').replace(/^import .*;\s*$/gm, ''), { mode: 'strip' });
  const context = { Stripe, createClient: () => { record('client'); return db; }, crypto: webcrypto, TextEncoder,
    Response, Request, URL, AbortController, AbortSignal, Date, Math, console: { log() {}, error() {}, warn() {} },
    setTimeout(callback, delay) { record('delay', { delay }); return setTimeout(callback, 0); }, clearTimeout,
    Deno: { env: { get: key => env[key] }, serve: callback => { handler = callback; } },
    fetch: async (url, init) => {
      record('send', { url, headers: Object.fromEntries(new Headers(init.headers)) });
      const payload = JSON.parse(init.body); state.emails.push(payload);
      if (state.sendError) throw Error('fixture email unavailable');
      return Response.json(state.sendBody || { id: 'msg_fixture', messageId: 'msg_fixture', success: true }, { status: state.sendStatus || 200 });
    },
  };
  vm.runInNewContext(`${moduleSource}\n${endpointSource}\nglobalThis.__billingTest = { billingEventDigest, currentSubscriptionPatch };`, context, { filename: endpointUrl.pathname });
  assert.equal(typeof handler, 'function');
  return { state, module: context.__billingTest,
    async deliver(value = event(), { method = 'POST', signature = 'fixture-signature' } = {}) {
      const headers = signature ? { 'Stripe-Signature': signature } : {};
      const response = await handler(new Request('https://offline.invalid/webhook', { method, headers,
        ...(!['GET', 'HEAD'].includes(method) ? { body: JSON.stringify(value) } : {}) }));
      return { status: response.status, headers: response.headers, text: await response.text() };
    } };
}
const calls = (f, kind) => f.state.calls.filter(call => call.kind === kind);
const commit = f => calls(f, 'reconcile_billing_subscription_event').at(-1)?.args;
const noCommit = f => assert.equal(f.state.applies, 0, 'no reconciliation write was requested');

test('old event never supplies entitlement patch: database read precedes fresh Stripe state', async () => {
  const f = fixture(); const stale = subscription({ status: 'canceled', items: { data: [{ price: { id: 'price_unknown' } }] } });
  assert.equal((await f.deliver(event(stale))).status, 200);
  assert.equal(commit(f).p_patch.tier, 'pro'); assert.equal(commit(f).p_patch.status, 'active');
  assert.deepEqual(commit(f).p_expected, f.state.row);
  assert.deepEqual(f.state.calls.filter(c => ['lookup_billing_event', 'read', 'subscription', 'reconcile_billing_subscription_event'].includes(c.kind)).map(c => c.kind),
    ['lookup_billing_event', 'read', 'subscription', 'reconcile_billing_subscription_event']);
  assert.deepEqual(calls(f, 'read')[0].args, { p_customer_id: 'cus_fixture' });
  assert.equal(commit(f).p_expected_revision, '0');
  assert.equal(calls(f, 'auth').length, 0); assert.equal(f.state.emails.length, 0, 'ordinary update needs no recipient lookup/email');
});

for (const retry of ['stale', '55P03', '40001', '40P01']) test(`${retry} retries from lookup, DB snapshot and fresh provider state`, async () => {
  const f = fixture({ onRead: index => ({ data: row({ revision: index }), error: null }),
    onRetrieve: index => subscription({ status: index === 1 ? 'past_due' : 'active' }),
    onRpc: (name, _args, s) => name === 'reconcile_billing_subscription_event' && s.applies === 1
      ? retry === 'stale' ? { data: { outcome: 'stale' }, error: null } : { data: null, error: { code: retry } } : undefined });
  assert.equal((await f.deliver()).status, 200); assert.equal(f.state.reads, 2); assert.equal(f.state.retrieves, 2);
  assert.equal(commit(f).p_expected.revision, 2); assert.equal(commit(f).p_patch.status, 'active');
  assert.equal(commit(f).p_expected_revision, '1');
  assert.equal(calls(f, 'lookup_billing_event').length, 2);
  const sequence = f.state.calls.filter(c => ['read', 'subscription', 'reconcile_billing_subscription_event'].includes(c.kind)).map(c => c.kind);
  assert.deepEqual(sequence, ['read', 'subscription', 'reconcile_billing_subscription_event', 'read', 'subscription', 'reconcile_billing_subscription_event']);
});

test('CAS retry budget is three complete attempts, then retryable HTTP503', async () => {
  const f = fixture({ onRpc: name => name === 'reconcile_billing_subscription_event' ? { data: { outcome: 'stale' }, error: null } : undefined });
  assert.equal((await f.deliver()).status, 503); assert.equal(f.state.reads, 3); assert.equal(f.state.retrieves, 3); assert.equal(f.state.applies, 3);
  assert.equal(calls(f, 'delay').length, 2);
});

test('no-op reconciliation can invalidate a snapshot: unchanged full row must use new private revision', async () => {
  // SQL supplies stale for an obsolete private revision even if the full row
  // stayed identical. This verifies the caller refetches; real PG proves CAS.
  const f = fixture({ onRetrieve: index => subscription({ status: index === 1 ? 'past_due' : 'active' }),
    onRpc: (name, _args, s) => name === 'reconcile_billing_subscription_event' && s.applies === 1
      ? { data: { outcome: 'stale' }, error: null } : undefined });
  assert.equal((await f.deliver()).status, 200);
  const attempts = calls(f, 'reconcile_billing_subscription_event').map(call => call.args);
  assert.deepEqual(attempts[0].p_expected, attempts[1].p_expected);
  assert.deepEqual(attempts.map(args => args.p_expected_revision), ['0', '1']);
  assert.deepEqual(attempts.map(args => args.p_patch.status), ['past_due', 'active']);
});

test('missing binding is ignored without provider fetch/write; failed DB read is503', async () => {
  const missing = fixture({ row: null }); assert.equal((await missing.deliver()).status, 200); noCommit(missing); assert.equal(missing.state.retrieves, 0);
  const failed = fixture({ readError: { code: '08006' } }); assert.equal((await failed.deliver()).status, 503); noCommit(failed); assert.equal(failed.state.retrieves, 0);
});

for (const observation of [{}, { revision: '0' }]) test(`malformed snapshot observation ${JSON.stringify(observation)} is503, never ignored as missing customer`, async () => {
  const f = fixture({ onRpc: name => name === 'read_billing_subscription_snapshot' ? { data: observation, error: null } : undefined });
  assert.equal((await f.deliver()).status, 503); noCommit(f); assert.equal(f.state.retrieves, 0);
});

for (const status of ['incomplete', 'past_due']) test(`initial unlinked ${status} subscription cannot grant a paid tier`, async () => {
  const f = fixture({ row: row({ tier: 'free', stripe_subscription_id: null }), current: subscription({ status }) });
  assert.equal((await f.deliver()).status, 503); noCommit(f);
  assert.equal(f.state.reads, 1); assert.equal(f.state.retrieves, 1); assert.equal(f.state.emails.length, 0);
});

test('failed receipt lookup or malformed revision snapshot never fetches provider or writes', async () => {
  for (const response of [{ data: null, error: { code: '08006' } }, { data: { subscription: row(), revision: null }, error: null }]) {
    const boundary = response.error ? 'lookup_billing_event' : 'read_billing_subscription_snapshot';
    const f = fixture({ onRpc: name => name === boundary ? response : undefined });
    assert.equal((await f.deliver()).status, 503); noCommit(f); assert.equal(f.state.retrieves, 0);
  }
});

for (const [label, current] of [
  ['unknown price', subscription({ items: { data: [{ price: { id: 'price_unknown' } }] } })],
  ...['paused', 'unpaid', 'incomplete_expired', 'future_status'].map(status => [status, subscription({ status })]),
]) test(`${label} returns503, never silently downgrades or grants`, async () => {
  const f = fixture({ current }); assert.equal((await f.deliver()).status, 503); noCommit(f);
});

test('late checkout with currently canceled subscription cannot grant paid access', async () => {
  const f = fixture({ current: subscription({ status: 'canceled' }) });
  const checkout = { id: 'cs_fixture', mode: 'subscription', livemode: false, customer: 'cus_fixture', subscription: 'sub_fixture', metadata: { user_id: actor } };
  assert.equal((await f.deliver(event(checkout, 'checkout.session.completed'))).status, 200);
  assert.equal(commit(f).p_patch.tier, 'free'); assert.equal(commit(f).p_patch.status, 'canceled'); assert.equal(commit(f).p_patch.stripe_subscription_id, null);
});

test('different live subscription conflicts; old terminal link uses ignored RPC with no patch/notification', async () => {
  const live = fixture({ row: row({ stripe_subscription_id: 'sub_new' }) }); assert.equal((await live.deliver()).status, 503); noCommit(live);
  const old = fixture({ row: row({ stripe_subscription_id: 'sub_new' }), current: subscription({ status: 'canceled' }) });
  assert.equal((await old.deliver()).status, 200); assert.equal(commit(old).p_patch, null); assert.equal(commit(old).p_notification, null);
  assert.equal(calls(old, 'auth').length, 0); assert.equal(old.state.emails.length, 0);
  assert.equal(calls(old, 'handle_downgrade_to_free').length, 0, 'archival is never invoked outside SQL transaction');
});

for (const layer of ['event', 'provider']) test(`${layer} metadata actor mismatch is rejected before commit`, async () => {
  const wrong = subscription({ metadata: { supabase_user_id: '22222222-2222-4222-8222-222222222222' } });
  const f = fixture(layer === 'provider' ? { current: wrong } : {});
  assert.equal((await f.deliver(event(layer === 'event' ? wrong : subscription()))).status, 503); noCommit(f);
  if (layer === 'event') assert.equal(f.state.retrieves, 0);
});

test('expanded customer/subscription/price IDs and invoice parent binding resolve correctly', async () => {
  const invoice = { id: 'in_fixture', customer: { id: 'cus_fixture' }, livemode: false,
    parent: { subscription_details: { subscription: { id: 'sub_fixture' } } }, status: 'paid', currency: 'usd', amount_paid: 1200, period_end: 1700100000,
    customer_email: 'invoice-recipient@example.invalid' };
  const f = fixture({ invoice, current: subscription({ customer: { id: 'cus_fixture' } }) });
  assert.equal((await f.deliver(event(invoice, 'invoice.payment_succeeded'))).status, 200);
  assert.equal(calls(f, 'subscription')[0].id, 'sub_fixture'); assert.equal(calls(f, 'invoice')[0].id, 'in_fixture');
  assert.equal(commit(f).p_customer_id, 'cus_fixture'); assert.equal(commit(f).p_notification[0].data.amount, '12.00');
  assert.equal(commit(f).p_notification[0].to, 'invoice-recipient@example.invalid'); assert.equal(calls(f, 'auth').length, 0);
});

test('first canceled paid-invoice event queues and drains both account and invoice notices', async () => {
  const invoice = { id: 'in_fixture', subscription: { id: 'sub_fixture' }, customer: 'cus_fixture', livemode: false,
    status: 'paid', currency: 'usd', amount_paid: 1200, period_end: 1700100000, customer_email: 'invoice@example.invalid' };
  const f = fixture({ invoice, current: subscription({ status: 'canceled' }) });
  assert.equal((await f.deliver(event(invoice, 'invoice.payment_succeeded'))).status, 200);
  assert.deepEqual(commit(f).p_notification.map(item => item.template), ['subscription-canceled', 'payment-succeeded']);
  assert.deepEqual(f.state.emails.map(item => item.to), ['billing@example.invalid', 'invoice@example.invalid']);
  assert.equal(calls(f, 'complete_billing_notification').length, 2);
  assert.equal(calls(f, 'claim_billing_notification').length, 3, 'drain both items then observe sent');
  assert.equal(new Set(calls(f, 'claim_billing_notification').map(call => call.args.p_claim_token)).size, 3);
  for (const message of f.state.emails) {
    assert.ok(message.billingDeliveryKey); assert.ok(Date.parse(message.billingSendBefore) > Date.now());
  }
  assert.equal(new Set(f.state.emails.map(message => message.billingDeliveryKey)).size, 2);
});

test('late failed-invoice event uses current paid invoice and cannot mark active subscription past_due', async () => {
  const invoice = { id: 'in_fixture', subscription: 'sub_fixture', customer: 'cus_fixture', livemode: false,
    status: 'paid', paid: true, amount_remaining: 0 };
  const f = fixture({ invoice });
  assert.equal((await f.deliver(event({ ...invoice, status: 'open', paid: false, amount_remaining: 1200 }, 'invoice.payment_failed'))).status, 200);
  assert.equal(commit(f).p_patch.status, 'active'); assert.equal(commit(f).p_notification, null); assert.equal(f.state.emails.length, 0);
});

test('canonical event digest ignores key ordering and pending_webhooks, but binds immutable event data', async () => {
  const f = fixture(); const first = event(); const second = { pending_webhooks: 8, ...Object.fromEntries(Object.entries(first).reverse()) };
  second.data = { object: Object.fromEntries(Object.entries(first.data.object).reverse()) };
  assert.equal(await f.module.billingEventDigest(first), await f.module.billingEventDigest(second));
  second.data.object.status = 'canceled'; assert.notEqual(await f.module.billingEventDigest(first), await f.module.billingEventDigest(second));
});

test('duplicate receipt skips DB/provider refetch and flushes frozen notification outbox', async () => {
  const f = fixture(); f.state.receipts.set('evt_fixture', { outcome: 'duplicate' });
  f.state.notifications.set('evt_fixture', { payload: { to: 'frozen@example.invalid', subject: 'Frozen', template: 'subscription-canceled', data: { firstName: 'Original' } } });
  assert.equal((await f.deliver()).status, 200); assert.equal(f.state.reads, 0); assert.equal(f.state.retrieves, 0); noCommit(f);
  assert.equal(f.state.emails.length, 1); assert.equal(f.state.emails[0].to, 'frozen@example.invalid'); assert.equal(calls(f, 'complete_billing_notification').length, 1);
});

test('lost reconciliation reply returns503; delivery retry looks up receipt and never reapplies', async () => {
  const f = fixture({ onRpc: (name, args, s) => {
    if (name === 'reconcile_billing_subscription_event') { s.receipts.set(args.p_event_id, { outcome: 'applied' }); return { data: null, error: { code: '08006' } }; }
  } });
  assert.equal((await f.deliver()).status, 503); assert.equal((await f.deliver()).status, 200);
  assert.equal(f.state.applies, 1); assert.equal(f.state.reads, 1); assert.equal(f.state.retrieves, 1);
});

test('notification failure503 retries frozen recipient/payload/key without new provider read or apply', async () => {
  const f = fixture({ current: subscription({ cancel_at: 1800000000 }), sendStatus: 503 });
  assert.equal((await f.deliver()).status, 503); const frozen = clone(f.state.emails[0]);
  assert.equal(calls(f, 'complete_billing_notification').length, 0);
  f.state.sendStatus = 200; f.state.current = subscription(); f.state.user.email = 'changed@example.invalid';
  assert.equal((await f.deliver()).status, 200); assert.deepEqual(f.state.emails[1], frozen);
  assert.equal(f.state.applies, 1); assert.equal(f.state.retrieves, 1);
  const claims = calls(f, 'claim_billing_notification'); assert.notEqual(claims[0].args.p_claim_token, claims[1].args.p_claim_token);
  assert.equal(calls(f, 'complete_billing_notification')[0].args.p_claim_token, claims[1].args.p_claim_token);
});

for (const outcome of ['busy', 'needs_review']) test(`notification ${outcome} returns503 without sending`, async () => {
  const f = fixture({ onRpc: name => name === 'claim_billing_notification' ? { data: { outcome }, error: null } : undefined });
  f.state.receipts.set('evt_fixture', { outcome: 'applied' });
  assert.equal((await f.deliver()).status, 503); assert.equal(f.state.emails.length, 0); noCommit(f);
});

for (const sendBy of [new Date(0).toISOString(), 'invalid-date', null]) test(`notification deadline ${sendBy} blocks HTTP dispatch`, async () => {
  const f = fixture({ onRpc: name => name === 'claim_billing_notification' ? { data: { outcome: 'claimed',
    payload: { to: 'billing@example.invalid' }, provider_key: 'billing:fixture', send_by: sendBy }, error: null } : undefined });
  f.state.receipts.set('evt_fixture', { outcome: 'applied' });
  assert.equal((await f.deliver()).status, 503); assert.equal(f.state.emails.length, 0);
  assert.equal(calls(f, 'complete_billing_notification').length, 0);
});

for (const sendBody of [{ success: false, id: 'msg_fixture' }, { success: true }, { success: true, id: '' }]) test(`missing successful provider receipt ${JSON.stringify(sendBody)} never completes outbox`, async () => {
  const f = fixture({ sendBody, current: subscription({ cancel_at: 1800000000 }) });
  assert.equal((await f.deliver()).status, 503); assert.equal(calls(f, 'complete_billing_notification').length, 0);
});

test('missing required email fails before commit, rather than losing the notification', async () => {
  const f = fixture({ user: { id: actor }, current: subscription({ cancel_at: 1800000000 }) });
  assert.equal((await f.deliver()).status, 503); noCommit(f); assert.equal(f.state.emails.length, 0);
});

test('invalid/missing signature is400; provider processing failure is503', async () => {
  const invalid = fixture({ signatureError: true }); assert.equal((await invalid.deliver()).status, 400); noCommit(invalid); assert.equal(calls(invalid, 'client').length, 0);
  const missing = fixture(); assert.equal((await missing.deliver(event(), { signature: null })).status, 400); assert.equal(calls(missing, 'verify').length, 0);
  const failed = fixture({ providerError: true }); assert.equal((await failed.deliver()).status, 503); noCommit(failed);
});

for (const method of ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS']) test(`${method} is405 before signature verification or database work`, async () => {
  const f = fixture(); const response = await f.deliver(event(), { method }); assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST'); assert.equal(calls(f, 'verify').length, 0); assert.equal(calls(f, 'client').length, 0);
});
