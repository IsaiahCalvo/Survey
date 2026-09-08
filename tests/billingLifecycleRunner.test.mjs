import test from 'node:test';
import assert from 'node:assert/strict';
import { BILLING_API_VERSION, BillingPendingError, BillingClosedError, billingSpecDigest, resolveBillingProviderScope,
  executeBillingOperation, recoverBillingOperations, cleanupAccountBilling, rotateBillingCustomer, assertBillingClosureReady,
  recoveredBillingSession } from '../supabase/functions/_shared/billingLifecycle.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const scope = { mode: 'test', account: 'acct_fixture', api_version: '2026-02-25.clover' };
const copy = value => structuredClone(value);
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
const specs = {
  customer_create: { email: 'offline@example.invalid' },
  checkout_create: { customer: 'cus_known', mode: 'subscription', line_items: [{ price: 'price_fixture', quantity: 1 }] },
  portal_create: { customer: 'cus_known', return_url: 'https://survey.example.invalid/' },
};

// A functional remote-boundary model, not a simulation of PostgreSQL locks.
// Both production runners and their validation/recovery paths execute unchanged.
function fixture() {
  const f = { calls: [], operations: new Map(), resources: [], customers: new Set(), removed: new Set(), closing: false };
  const record = (name, data = {}) => f.calls.push({ name, ...copy(data) });
  const state = () => ({ closing: f.closing, has_pending_operations: [...f.operations.values()].some(op => op.state === 'pending'),
    has_pending_customers: [...f.customers].some(id => !f.removed.has(id)), current_customer_covered: true,
    complete: f.closing && ![...f.operations.values()].some(op => op.state === 'pending') && [...f.customers].every(id => f.removed.has(id)) });
  f.status = state;
  async function normalRpc(name, a) {
    if (name === 'begin_billing_operation') {
      if (f.closing) return { error: { code: '23514', message: 'ACCOUNT_CLOSING' } };
      // Mirrors 20260909020000's same-actor/kind admission fence. The separate
      // real PostgreSQL tests, not this transport model, prove lock atomicity.
      if ([...f.operations.values()].some(op => op.user_id === a.p_user_id && op.kind === a.p_kind && op.state === 'pending')) {
        return { error: { code: '40001', message: 'Billing operation is still pending' } };
      }
      const op = { operation_id: a.p_operation_id, user_id: a.p_user_id, kind: a.p_kind, provider_scope: copy(a.p_provider_scope),
        request_spec: copy(a.p_request_spec), expected_customer_id: a.p_expected_customer_id, state: 'pending',
        admitted_at: new Date().toISOString(), result: null, recovery_cursor: null };
      f.operations.set(op.operation_id, op);
      return { data: { outcome: 'admitted', operation_id: op.operation_id, state: 'pending', admitted_at: op.admitted_at, result: null } };
    }
    if (name === 'settle_billing_operation') {
      const op = f.operations.get(a.p_operation_id); assert.ok(op);
      if (op.state !== 'settled') {
        op.result = f.removed.has(op.expected_customer_id) && op.kind !== 'customer_create'
          ? { outcome: 'customer_removed', customer_id: op.expected_customer_id, data: {} } : copy(a.p_result);
        op.state = 'settled';
        if (op.result.customer_id) f.customers.add(op.result.customer_id);
      }
      return { data: { outcome: 'settled', operation_id: op.operation_id, admitted_at: op.admitted_at, result: copy(op.result) } };
    }
    if (name === 'read_billing_operation') return { data: copy(f.operations.get(a.p_operation_id)) };
    if (name === 'scan_pending_billing_operations') return { data: { operations: copy([...f.operations.values()].filter(op => op.state === 'pending').slice(0, a.p_limit)) } };
    if (name === 'advance_billing_operation_recovery_cursor') {
      const op = f.operations.get(a.p_operation_id); op.recovery_cursor = a.p_next_cursor;
      return { data: { outcome: 'advanced' } };
    }
    if (name === 'read_billing_account_closure') return { data: state() };
    if (name === 'begin_billing_account_closure') { f.closing = true; return { data: state() }; }
    if (name === 'claim_billing_customer_cleanup') return { data: { ...state(), customers: [...f.customers].filter(id => !f.removed.has(id))
      .slice(0, a.p_limit).map(customer_id => ({ customer_id, provider_scope: scope })), complete: state().complete } };
    if (name === 'ack_billing_customer_cleanup') {
      f.removed.add(a.p_customer_id);
      for (const op of f.operations.values()) if (op.expected_customer_id === a.p_customer_id && op.kind !== 'customer_create') {
        op.state = 'settled'; op.customer_removed = true; op.result = { outcome: 'customer_removed', customer_id: a.p_customer_id, data: {} };
      }
      return { data: { ...state(), has_pending_customer_operations: false } };
    }
    if (name === 'rotate_billing_customer') return { data: { outcome: f.closing ? 'closing' : 'applied', customer_id: a.p_expected_customer_id } };
    throw Error(`Unexpected RPC ${name}`);
  }
  f.db = { async rpc(name, args) {
    record(name, { args });
    return f.onRpc ? f.onRpc(name, args, () => normalRpc(name, args)) : normalRpc(name, args);
  } };
  async function create(kind, params, options) {
    record(`create:${kind}`, { params, options });
    const normal = () => {
      const resource = kind === 'customer_create'
        ? { id: `cus_created${f.resources.length}`, object: 'customer', livemode: false, metadata: params.metadata }
        : { id: `cs_session${f.resources.length}`, object: kind === 'checkout_create' ? 'checkout.session' : 'billing_portal.session',
          customer: params.customer, mode: params.mode, livemode: false, metadata: params.metadata,
          url: kind === 'checkout_create' ? 'https://checkout.stripe.com/c/pay/fixture' : 'https://billing.stripe.com/p/session/fixture' };
      f.resources.push(resource); return copy(resource);
    };
    return f.onCreate ? f.onCreate(kind, params, options, normal) : normal();
  }
  f.stripe = {
    accounts: { async retrieveCurrent() { record('account'); return f.account || { id: 'acct_fixture' }; } },
    customers: {
      create: (p, o) => create('customer_create', p, o),
      async search(params) { record('search', { params }); return f.onSearch ? f.onSearch(params) : { data: f.resources.filter(r => r.object === 'customer'), has_more: false }; },
      async del(id) { record('delete', { id }); return f.onDelete ? f.onDelete(id) : { object: 'customer', id, deleted: true }; },
      async retrieve(id) { record('retrieve', { id }); return f.onRetrieve ? f.onRetrieve(id) : { object: 'customer', id, deleted: false }; },
    },
    checkout: { sessions: { create: (p, o) => create('checkout_create', p, o),
      async list(params) { record('checkout:list', { params }); return f.onCheckoutList ? f.onCheckoutList(params)
        : { data: f.resources.filter(r => r.object === 'checkout.session'), has_more: false }; } } },
    billingPortal: { sessions: { create: (p, o) => create('portal_create', p, o) } },
    events: { async list(params) { record('events:list', { params }); return f.onEvents ? f.onEvents(params) : { data: [], has_more: false }; } },
  };
  f.execute = (kind = 'customer_create', extra = {}) => executeBillingOperation({ db: f.db, stripe: f.stripe, scope, userId, kind,
    customerId: kind === 'customer_create' ? null : 'cus_known', spec: copy(specs[kind]), ...extra });
  f.recover = extra => recoverBillingOperations({ db: f.db, stripe: f.stripe, scope, userId, ...extra });
  f.cleanup = extra => cleanupAccountBilling({ db: f.db, stripe: f.stripe, scope, userId, ...extra });
  f.count = name => f.calls.filter(c => c.name === name).length;
  return f;
}
async function unknown(f, kind = 'customer_create', created = true) {
  f.onCreate = (_k, _p, _o, normal) => { if (created) normal(); throw Error('provider reply lost'); };
  await assert.rejects(f.execute(kind), BillingPendingError);
  f.onCreate = null;
  return [...f.operations.values()][0];
}

test('scope derives exact account and key mode with pinned API version', async () => {
  const f = fixture(); assert.equal(BILLING_API_VERSION, '2026-02-25.clover');
  assert.deepEqual(await resolveBillingProviderScope(f.stripe, 'sk_test_offline'), scope);
  assert.deepEqual(await resolveBillingProviderScope(f.stripe, 'rk_live_offline'), { ...scope, mode: 'live' });
});
for (const key of ['', 'sk_test_', 'pk_test_wrong', 'sk_live_bad-key', 'sk_foo_wrong']) test(`invalid provider key mode rejects ${key}`, async () => {
  const f = fixture(); await assert.rejects(resolveBillingProviderScope(f.stripe, key), BillingPendingError); assert.equal(f.count('account'), 0);
});
test('provider account identity must be an actual acct identifier', async () => {
  const f = fixture(); f.account = { id: 'cus_wrong' }; await assert.rejects(resolveBillingProviderScope(f.stripe, 'sk_test_offline'), BillingPendingError);
});
test('spec digest is stable across key order and changes with request semantics', async () => {
  assert.equal(await billingSpecDigest({ a: 1, nested: { b: 2, a: 3 } }), await billingSpecDigest({ nested: { a: 3, b: 2 }, a: 1 }));
  assert.notEqual(await billingSpecDigest({ a: 1 }), await billingSpecDigest({ a: 2 }));
  await assert.rejects(billingSpecDigest({ text: 'x'.repeat(17000) }), BillingPendingError);
});
for (const kind of Object.keys(specs)) test(`${kind} admits ledger before its only provider POST and disables SDK network retries`, async () => {
  const f = fixture(); const result = await f.execute(kind);
  assert.equal(result.result.outcome, 'succeeded');
  assert.deepEqual(f.calls.map(c => c.name), ['begin_billing_operation', `create:${kind}`, 'settle_billing_operation']);
  const call = f.calls[1]; assert.equal(call.options.maxNetworkRetries, 0);
  assert.equal(call.options.idempotencyKey, `survey-billing:${result.operationId}`);
  if (kind !== 'portal_create') {
    assert.equal(call.params.metadata.supabase_user_id, userId);
    assert.equal(call.params.metadata.survey_billing_operation_id, result.operationId);
    assert.equal(call.params.metadata.survey_billing_spec, await billingSpecDigest(specs[kind]));
  }
});
for (const badScope of [null, { ...scope, mode: 'sandbox' }, { ...scope, account: 'cus_wrong' },
  { ...scope, api_version: 'old' }, { ...scope, injected: true }]) test(`forged scope blocks provider work: ${JSON.stringify(badScope)}`, async () => {
  const f = fixture(); await assert.rejects(f.execute('customer_create', { scope: badScope }), BillingPendingError); assert.deepEqual(f.calls, []);
});
for (const receipt of [null, {}, { outcome: 'admitted', operation_id: 'forged' }]) test(`invalid admission receipt never reaches provider: ${JSON.stringify(receipt)}`, async () => {
  const f = fixture(); f.onRpc = () => ({ data: receipt }); await assert.rejects(f.execute(), BillingPendingError); assert.equal(f.count('create:customer_create'), 0);
});
test('lost admission reply and repeated recovery never issue a provider POST', async () => {
  const f = fixture(); let lose = true;
  f.onRpc = async (name, _a, normal) => { const value = await normal(); if (name === 'begin_billing_operation' && lose) { lose = false; throw Error('admitted reply lost'); } return value; };
  await assert.rejects(f.execute(), BillingPendingError);
  assert.equal((await f.recover()).pending, true); assert.equal((await f.recover()).pending, true);
  assert.equal(f.operations.size, 1); assert.equal(f.count('create:customer_create'), 0);
});
test('lost settle reply reads committed receipt instead of replaying POST', async () => {
  const f = fixture(); let lose = true;
  f.onRpc = async (name, _a, normal) => { const value = await normal(); if (name === 'settle_billing_operation' && lose) { lose = false; throw Error('settled reply lost'); } return value; };
  assert.equal((await f.execute()).result.outcome, 'succeeded');
  assert.equal(f.count('create:customer_create'), 1); assert.equal(f.count('read_billing_operation'), 1); assert.equal(f.count('settle_billing_operation'), 1);
});
test('uncommitted settle failure retries only database settlement after exact pending lookup', async () => {
  const f = fixture(); let lose = true;
  f.onRpc = async (name, _a, normal) => { if (name === 'settle_billing_operation' && lose) { lose = false; throw Error('not committed'); } return normal(); };
  await f.execute(); assert.equal(f.count('create:customer_create'), 1); assert.equal(f.count('settle_billing_operation'), 2);
});
for (const kind of ['customer_create', 'checkout_create']) test(`${kind} positive recovery uses exact operation, actor and spec without replay`, async () => {
  const f = fixture(); const op = await unknown(f, kind);
  const result = await f.recover(); assert.equal(result.pending, false); assert.equal(f.count(`create:${kind}`), 1);
  assert.equal((await f.recover()).pending, false); assert.equal(f.count(`create:${kind}`), 1);
  assert.equal(f.operations.get(op.operation_id).state, 'settled');
  if (kind === 'customer_create') assert.equal(result.recoveredCustomers[0].customerId, f.resources[0].id);
});
for (const condition of ['empty', 'multiple', 'has_more', 'actor', 'spec', 'operation', 'mode']) test(`customer recovery rejects ${condition} as completion proof`, async () => {
  const f = fixture(); await unknown(f);
  if (condition === 'empty') f.resources = [];
  if (condition === 'multiple') f.resources.push(copy(f.resources[0]));
  if (condition === 'has_more') f.onSearch = () => ({ data: f.resources, has_more: true });
  if (['actor', 'spec', 'operation'].includes(condition)) f.resources[0].metadata[condition === 'actor' ? 'supabase_user_id' : condition === 'spec' ? 'survey_billing_spec' : 'survey_billing_operation_id'] = 'forged';
  if (condition === 'mode') f.resources[0].livemode = true;
  assert.equal((await f.recover()).pending, true); assert.equal(f.count('settle_billing_operation'), 0); assert.equal(f.count('create:customer_create'), 1);
});
test('portal recovers only an exact positive event/idempotency-key/customer proof', async () => {
  const f = fixture(); const op = await unknown(f, 'portal_create');
  f.onEvents = () => ({ data: [{ id: 'evt_fixture', type: 'billing_portal.session.created', livemode: false,
    request: { idempotency_key: `survey-billing:${op.operation_id}` }, data: { object: f.resources[0] } }], has_more: false });
  assert.equal((await f.recover()).pending, false); assert.equal(f.count('create:portal_create'), 1);
  assert.deepEqual(f.calls.find(c => c.name === 'events:list').params.types, ['billing_portal.session.created']);
});
for (const condition of ['empty', 'wrong_key', 'wrong_customer', 'multiple']) test(`portal recovery ${condition} remains pending`, async () => {
  const f = fixture(); const op = await unknown(f, 'portal_create');
  const event = { id: 'evt_fixture', type: 'billing_portal.session.created', livemode: false,
    request: { idempotency_key: `survey-billing:${op.operation_id}` }, data: { object: copy(f.resources[0]) } };
  if (condition === 'wrong_key') event.request.idempotency_key = 'survey-billing:forged';
  if (condition === 'wrong_customer') event.data.object.customer = 'cus_other';
  f.onEvents = () => ({ data: condition === 'empty' ? [] : condition === 'multiple' ? [event, event] : [event], has_more: false });
  assert.equal((await f.recover()).pending, true); assert.equal(f.count('settle_billing_operation'), 0);
});
test('checkout recovery advances one durable page cursor without creating another session', async () => {
  const f = fixture(); const op = await unknown(f, 'checkout_create', false);
  f.onCheckoutList = () => ({ data: [{ id: 'cs_other', metadata: {} }], has_more: true });
  assert.equal((await f.recover()).pending, true); assert.equal(op.recovery_cursor, 'cs_other'); assert.equal(f.count('checkout:list'), 1);
});
test('provider timeout remains pending and late response is recovered without a second POST', { timeout: 2000 }, async () => {
  const f = fixture(), late = defer(); let created;
  f.onCreate = (_k, _p, _o, normal) => { created = normal(); return late.promise; };
  await assert.rejects(f.execute('customer_create', { requestTimeoutMs: 5 }), BillingPendingError);
  late.resolve(created); await tick(); assert.equal(f.count('settle_billing_operation'), 0);
  assert.equal((await f.recover()).pending, false); assert.equal(f.count('create:customer_create'), 1);
});
test('closure committed before a late customer response remains pending until that customer is removed', async () => {
  const f = fixture(), late = defer(), started = defer(); let created;
  f.onCreate = (_k, _p, _o, normal) => { created = normal(); started.resolve(); return late.promise; };
  const execution = f.execute(); await started.promise;
  // Delayed search indexing is not evidence that no customer was created.
  f.onSearch = () => ({ data: [], has_more: false });
  assert.equal((await f.cleanup()).complete, false);
  late.resolve(created); await execution;
  assert.equal(f.closing, true); assert.equal(f.removed.has(created.id), false);
  assert.equal((await f.cleanup()).complete, true); assert.equal(f.removed.has(created.id), true);
  await assert.rejects(f.execute(), BillingClosedError); assert.equal(f.count('create:customer_create'), 1);
});
test('customer settlement before closure is claimed and deleted after closure commits', async () => {
  const f = fixture(); const created = await f.execute();
  assert.equal((await f.cleanup()).complete, true); assert.equal(f.removed.has(created.result.customer_id), true);
  assert.ok(f.calls.findIndex(c => c.name === 'begin_billing_account_closure') < f.calls.findIndex(c => c.name === 'delete'));
});
for (const response of [{ id: 'cus_wrong', object: 'customer', deleted: true }, { id: 'cus_known', deleted: true },
  { id: 'cus_known', object: 'customer', deleted: false }, null]) test(`inexact customer deletion receipt never acknowledges cleanup: ${JSON.stringify(response)}`, async () => {
  const f = fixture(); f.customers.add('cus_known'); f.onDelete = () => response;
  assert.equal((await f.cleanup()).complete, false); assert.equal(f.count('ack_billing_customer_cleanup'), 0);
});
test('404 alone never proves customer deletion', async () => {
  const f = fixture(); f.customers.add('cus_known');
  f.onDelete = f.onRetrieve = () => { throw Object.assign(Error('not found'), { statusCode: 404, code: 'resource_missing' }); };
  assert.equal((await f.cleanup()).complete, false); assert.equal(f.count('ack_billing_customer_cleanup'), 0);
});
test('lost delete reply accepts only exact subsequent deleted-customer receipt', async () => {
  const f = fixture(); f.customers.add('cus_known'); f.onDelete = () => { throw Error('lost'); };
  f.onRetrieve = id => ({ object: 'customer', id, deleted: true });
  assert.equal((await f.cleanup()).complete, true); assert.equal(f.count('ack_billing_customer_cleanup'), 1);
});
test('exact known legacy customer id is passed unchanged rather than reconstructed', async () => {
  const f = fixture(); const id = 'legacy-customer-key'; f.customers.add(id);
  assert.equal((await f.cleanup()).complete, true); assert.equal(f.calls.find(c => c.name === 'delete').id, id);
});
test('known customer deletion revokes an unresolved portal operation', async () => {
  const f = fixture(); await unknown(f, 'portal_create', false); f.customers.add('cus_known');
  assert.equal((await f.cleanup()).complete, true); assert.equal([...f.operations.values()][0].result.outcome, 'customer_removed');
  assert.equal(f.count('create:portal_create'), 1);
});
test('wrong provider cleanup scope never sends a customer delete', async () => {
  const f = fixture(); f.customers.add('cus_known');
  f.onRpc = (name, _a, normal) => name === 'claim_billing_customer_cleanup'
    ? { data: { ...f.status(), customers: [{ customer_id: 'cus_known', provider_scope: { ...scope, mode: 'live' } }], complete: false } } : normal();
  assert.equal((await f.cleanup()).complete, false); assert.equal(f.count('delete'), 0);
});
test('cleanup caps claims and recovery scans even when remote work remains', async () => {
  const f = fixture(); f.customers.add('cus_known'); f.onDelete = () => ({ object: 'customer', id: 'cus_known', deleted: false });
  assert.equal((await f.cleanup({ maxClaims: 2 })).complete, false);
  assert.equal(f.count('claim_billing_customer_cleanup'), 2); assert.equal(f.count('scan_pending_billing_operations'), 1);
});
test('rotation rejects closure and passes exact customer comparison identity', async () => {
  const f = fixture();
  assert.equal(await rotateBillingCustomer({ db: f.db, scope, userId, expectedCustomerId: 'cus_known' }), 'cus_known');
  assert.equal(f.calls[0].args.p_expected_customer_id, 'cus_known'); f.closing = true;
  await assert.rejects(rotateBillingCustomer({ db: f.db, scope, userId, expectedCustomerId: 'cus_known' }), BillingClosedError);
});

test('malformed cleanup acknowledgement does not count a customer as durably removed', async () => {
  const f = fixture(); f.customers.add('cus_known');
  f.onRpc = (name, _args, normal) => name === 'ack_billing_customer_cleanup' ? { data: null } : normal();
  const result = await f.cleanup({ maxClaims: 1 });
  assert.equal(result.complete, false); assert.equal(result.removed, 0);
});

test('closure deleting a known parent before late portal reply never returns a usable session', async () => {
  const f = fixture(), late = defer(), started = defer(); let created;
  f.customers.add('cus_known');
  f.onCreate = (_kind, _params, _options, normal) => { created = normal(); started.resolve(); return late.promise; };
  const execution = f.execute('portal_create'); await started.promise;
  assert.equal((await f.cleanup()).complete, true);
  const closed = assert.rejects(execution, BillingClosedError);
  late.resolve(created); await closed;
  assert.equal(f.count('create:portal_create'), 1);
});

for (const error of [
  { type: 'StripeInvalidRequestError', statusCode: 400, code: 'parameter_missing' },
  { type: 'StripeConnectionError', statusCode: 500, code: 'connection_failed' },
  { type: 'StripeIdempotencyError', statusCode: 400, code: 'idempotency_error' },
  { type: 'StripeRateLimitError', statusCode: 429, code: 'rate_limit' },
]) test(`only explicit parameter rejection settles provider failure: ${error.type}`, async () => {
  const f = fixture(); f.onCreate = () => { throw Object.assign(Error('provider failed'), error); };
  await assert.rejects(f.execute(), BillingPendingError);
  assert.equal([...f.operations.values()][0].state, error.type === 'StripeInvalidRequestError' ? 'settled' : 'pending');
  assert.equal(f.count('create:customer_create'), 1);
});

for (const patch of [{ customer: 'cus_other' }, { mode: 'payment' }, { customer_email: 'injected@example.invalid' }, { customer_creation: 'always' }]) {
  test(`checkout binds exact existing customer and rejects implicit creation: ${JSON.stringify(patch)}`, async () => {
    const f = fixture(); await assert.rejects(f.execute('checkout_create', { spec: { ...specs.checkout_create, ...patch } }), BillingPendingError);
    assert.deepEqual(f.calls, []);
  });
}

for (const invalid of [null, {}, { customers: [], complete: 'true' }, { customers: Array(21).fill({}), complete: false },
  { customers: [{ customer_id: 'cus_known', provider_scope: scope }], complete: true }]) {
  test(`invalid cleanup claim cannot authorize provider deletion: ${JSON.stringify(invalid)}`, async () => {
    const f = fixture(); f.onRpc = (name, _a, normal) => name === 'claim_billing_customer_cleanup'
      ? { data: invalid && Object.keys(invalid).length ? { ...f.status(), ...invalid } : invalid } : normal();
    await assert.rejects(f.cleanup(), BillingPendingError); assert.equal(f.count('delete'), 0);
  });
}

for (const patch of [{ user_id: '22222222-2222-4222-8222-222222222222' }, { provider_scope: { ...scope, mode: 'live' } },
  { operation_id: 'not-a-uuid' }, { expected_customer_id: 'cus_other' }]) {
  test(`invalid recovered operation binding cannot settle: ${JSON.stringify(patch)}`, async () => {
    const f = fixture(); const op = await unknown(f); Object.assign(op, patch);
    const result = await f.recover(); assert.equal(result.pending, true); assert.ok(result.errors > 0);
    assert.equal(f.count('settle_billing_operation'), 0);
  });
}

test('cleanup deadline bounds a hanging provider and keeps account pending', { timeout: 2000 }, async () => {
  const f = fixture(); f.customers.add('cus_known'); f.onDelete = () => new Promise(() => {});
  const start = performance.now();
  await assert.rejects(f.cleanup({ requestTimeoutMs: 5, maxDurationMs: 5 }), BillingPendingError);
  assert.ok(performance.now() - start < 1000); assert.equal(f.count('ack_billing_customer_cleanup'), 0);
});

for (const kind of Object.keys(specs)) test(`${kind} pending admission prevents repeated POST after unknown reply`, async () => {
  const f = fixture(); await unknown(f, kind);
  await assert.rejects(f.execute(kind), BillingPendingError);
  await assert.rejects(f.execute(kind), BillingPendingError);
  assert.equal(f.count(`create:${kind}`), 1); assert.equal(f.operations.size, 1);
});

for (const kind of Object.keys(specs)) test(`${kind} concurrent requests honor only the admitted RPC winner`, async () => {
  const f = fixture(), late = defer(), started = defer(); let resource;
  f.onCreate = (_k, _p, _o, normal) => { resource = normal(); started.resolve(); return late.promise; };
  const first = f.execute(kind); await started.promise;
  await assert.rejects(f.execute(kind), BillingPendingError);
  late.resolve(resource); await first;
  assert.equal(f.count(`create:${kind}`), 1); assert.equal(f.operations.size, 1);
});

test('lost committed admission followed by new execute is refused before provider I/O', async () => {
  const f = fixture(); let first = true;
  f.onRpc = async (name, _a, normal) => {
    const receipt = await normal();
    if (name === 'begin_billing_operation' && first) { first = false; throw Error('lost admission'); }
    return receipt;
  };
  await assert.rejects(f.execute(), BillingPendingError); await assert.rejects(f.execute(), BillingPendingError);
  assert.equal(f.count('create:customer_create'), 0); assert.equal(f.operations.size, 1);
});

for (const receipt of [null, {}, { complete: true },
  { closing: false, has_pending_operations: false, has_pending_customers: false, current_customer_covered: true, complete: true },
  { closing: true, has_pending_operations: true, has_pending_customers: false, current_customer_covered: true, complete: true },
  { closing: true, has_pending_operations: false, has_pending_customers: true, current_customer_covered: true, complete: true },
  { closing: true, has_pending_operations: false, has_pending_customers: false, current_customer_covered: false, complete: true },
]) test(`closure-ready gate rejects missing or contradictory proof: ${JSON.stringify(receipt)}`, async () => {
  const f = fixture(); f.onRpc = () => ({ data: receipt });
  await assert.rejects(assertBillingClosureReady(f.db, userId), BillingPendingError);
});
test('closure-ready gate permits only complete full status', async () => {
  const f = fixture(); f.closing = true; await assertBillingClosureReady(f.db, userId);
  f.customers.add('cus_pending'); await assert.rejects(assertBillingClosureReady(f.db, userId), BillingPendingError);
});

for (const args of [{ maxPages: 0 }, { maxPages: 4 }, { requestTimeoutMs: 0 }, { requestTimeoutMs: 15001 }, { maxDurationMs: 45001 }]) {
  test(`recovery refuses invalid finite budget: ${JSON.stringify(args)}`, async () => {
    const f = fixture(); await assert.rejects(f.recover(args), BillingPendingError); assert.deepEqual(f.calls, []);
  });
}

test('recovered open checkout reuses exact URL for canonical-equivalent spec without another create', async () => {
  const f = fixture(); await unknown(f, 'checkout_create'); f.resources[0].status = 'open';
  f.resources[0].expires_at = Math.floor(Date.now() / 1000) + 3600;
  const recovery = await f.recover();
  const same = { line_items: [{ quantity: 1, price: 'price_fixture' }], mode: 'subscription', customer: 'cus_known' };
  const result = recoveredBillingSession(recovery, 'checkout_create', same);
  assert.deepEqual(result, { outcome: 'succeeded', customer_id: 'cus_known',
    data: { id: f.resources[0].id, url: f.resources[0].url } });
  assert.equal(recovery.recoveredSessions.length, 1); assert.equal(recovery.recoveredCustomers.length, 0);
  assert.equal(f.count('create:checkout_create'), 1); assert.equal(recovery.pending, false);
});

for (const change of [{ customer: 'cus_other' }, { line_items: [{ price: 'price_other', quantity: 1 }] },
  { success_url: 'https://survey.example.invalid/different' }]) {
  test(`recovered checkout cannot satisfy a different exact request: ${JSON.stringify(change)}`, async () => {
    const f = fixture(); await unknown(f, 'checkout_create'); f.resources[0].status = 'open';
    f.resources[0].expires_at = Math.floor(Date.now() / 1000) + 3600;
    const recovery = await f.recover();
    assert.equal(recoveredBillingSession(recovery, 'checkout_create', { ...specs.checkout_create, ...change }), null);
    assert.equal(recoveredBillingSession(recovery, 'portal_create', specs.checkout_create), null);
  });
}

for (const status of ['complete', 'expired', undefined]) test(`recovered checkout ${status} settles but is not reusable`, async () => {
  const f = fixture(); await unknown(f, 'checkout_create'); f.resources[0].status = status;
  f.resources[0].expires_at = Math.floor(Date.now() / 1000) + 3600;
  const recovery = await f.recover();
  assert.equal(recovery.pending, false); assert.deepEqual(recovery.recoveredSessions, []);
  assert.equal(recoveredBillingSession(recovery, 'checkout_create', specs.checkout_create), null);
  assert.equal(f.count('create:checkout_create'), 1);
});

test('recovered open checkout without a URL is never offered as reusable', async () => {
  const f = fixture(); await unknown(f, 'checkout_create'); f.resources[0].status = 'open'; f.resources[0].url = null;
  f.resources[0].expires_at = Math.floor(Date.now() / 1000) + 3600;
  const recovery = await f.recover();
  assert.equal(recovery.pending, false); assert.deepEqual(recovery.recoveredSessions, []);
  assert.equal(recoveredBillingSession(recovery, 'checkout_create', specs.checkout_create), null);
});

async function recoverPortal(f, ageSeconds, url = undefined) {
  const op = await unknown(f, 'portal_create');
  if (url !== undefined) f.resources[0].url = url;
  f.onEvents = () => ({ data: [{ id: 'evt_portalRecovery', type: 'billing_portal.session.created', livemode: false,
    created: Math.floor(Date.now() / 1000) - ageSeconds,
    request: { idempotency_key: `survey-billing:${op.operation_id}` }, data: { object: f.resources[0] } }], has_more: false });
  return f.recover();
}

test('fresh portal recovery reuses the exact event session for the same request', async () => {
  const f = fixture(); const recovery = await recoverPortal(f, 10);
  const result = recoveredBillingSession(recovery, 'portal_create', { return_url: specs.portal_create.return_url, customer: 'cus_known' });
  assert.deepEqual(result, { outcome: 'succeeded', customer_id: 'cus_known', data: { id: f.resources[0].id, url: f.resources[0].url } });
  assert.equal(recoveredBillingSession(recovery, 'portal_create', { ...specs.portal_create, return_url: 'https://survey.example.invalid/changed' }), null);
  assert.equal(recoveredBillingSession(recovery, 'portal_create', { ...specs.portal_create, customer: 'cus_other' }), null);
  assert.equal(f.count('create:portal_create'), 1); assert.equal(recovery.pending, false);
});

for (const age of [61, 3600, -6]) test(`portal event age ${age}s is settled but not reused`, async () => {
  const f = fixture(); const recovery = await recoverPortal(f, age);
  assert.equal(recovery.pending, false); assert.deepEqual(recovery.recoveredSessions, []);
  assert.equal(recoveredBillingSession(recovery, 'portal_create', specs.portal_create), null);
});

test('fresh portal event without URL is not reused', async () => {
  const f = fixture(); const recovery = await recoverPortal(f, 0, null);
  assert.equal(recovery.pending, false); assert.deepEqual(recovery.recoveredSessions, []);
  assert.equal(recoveredBillingSession(recovery, 'portal_create', specs.portal_create), null);
});

test('checkout expiry is rechecked between recovery and URL selection', async t => {
  let now = 1800000000000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture(); await unknown(f, 'checkout_create');
  f.resources[0].status = 'open'; f.resources[0].expires_at = now / 1000 + 2;
  const recovery = await f.recover();
  assert.equal(recovery.recoveredSessions.length, 1);
  assert.equal(recovery.recoveredSessions[0].validUntil, now + 2000);
  assert.ok(recoveredBillingSession(recovery, 'checkout_create', specs.checkout_create));
  now += 2000;
  assert.equal(recoveredBillingSession(recovery, 'checkout_create', specs.checkout_create), null);
  assert.equal(f.count('create:checkout_create'), 1);
});

test('portal event freshness is rechecked between recovery and URL selection', async t => {
  let now = 1800000000000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture(); const recovery = await recoverPortal(f, 10);
  assert.equal(recovery.recoveredSessions.length, 1);
  assert.equal(recovery.recoveredSessions[0].validUntil, now + 50000);
  assert.ok(recoveredBillingSession(recovery, 'portal_create', specs.portal_create));
  now += 50000;
  assert.equal(recoveredBillingSession(recovery, 'portal_create', specs.portal_create), null);
  assert.equal(f.count('create:portal_create'), 1);
});

for (const expiry of [undefined, null, '1800000001', 1799999999, 1800000000, 1800000001.5]) {
  test(`open checkout with missing, invalid, or elapsed expiry is not reused: ${expiry}`, async t => {
    t.mock.method(Date, 'now', () => 1800000000000);
    const f = fixture(); await unknown(f, 'checkout_create');
    f.resources[0].status = 'open'; f.resources[0].expires_at = expiry;
    const recovery = await f.recover();
    assert.equal(recovery.pending, false); assert.deepEqual(recovery.recoveredSessions, []);
    assert.equal(recoveredBillingSession(recovery, 'checkout_create', specs.checkout_create), null);
  });
}
