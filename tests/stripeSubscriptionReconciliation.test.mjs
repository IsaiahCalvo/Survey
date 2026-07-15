import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import * as stripeReliability from '../supabase/functions/_shared/stripeReliability.js';

test('subscription reconciliation writes the current Stripe state', async () => {
  assert.equal(typeof stripeReliability.reconcileSubscriptionEntitlement, 'function');

  const writes = [];
  const result = await stripeReliability.reconcileSubscriptionEntitlement({
    subscriptionId: 'sub_current',
    retrieveCurrent: async () => ({
      id: 'sub_current',
      customer: 'cus_1',
      status: 'past_due',
      metadata: { user_id: 'user_1' },
      items: { data: [{ price: { id: 'price_pro' } }] },
      trial_end: null,
      current_period_start: 100,
      current_period_end: 200,
    }),
    findBySubscriptionId: async () => ({
      id: 'row_1',
      user_id: 'user_1',
      stripe_subscription_id: 'sub_current',
    }),
    findByUserId: async () => null,
    findByCustomerId: async () => null,
    updateExisting: async (row, state, expectedSubscriptionId) => {
      writes.push({ row, state, expectedSubscriptionId });
    },
    insertMissing: async () => assert.fail('existing row must be updated'),
    tierFromPriceId: (priceId) => priceId === 'price_pro' ? 'pro' : 'free',
  });

  assert.equal(result.applied, true);
  assert.equal(result.current.status, 'past_due');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].state.status, 'past_due');
  assert.equal(writes[0].state.tier, 'pro');
  assert.equal(writes[0].expectedSubscriptionId, 'sub_current');
});

test('subscription reconciliation attaches an unordered created event to an unassigned user row', async () => {
  const writes = [];
  const result = await stripeReliability.reconcileSubscriptionEntitlement({
    subscriptionId: 'sub_created_first',
    hintedUserId: 'user_1',
    retrieveCurrent: async () => ({
      id: 'sub_created_first',
      customer: 'cus_1',
      status: 'active',
      metadata: { user_id: 'user_1' },
      items: { data: [{ price: { id: 'price_pro' } }] },
    }),
    findBySubscriptionId: async () => null,
    findByUserId: async (userId) => ({
      id: 'row_1',
      user_id: userId,
      stripe_subscription_id: null,
    }),
    findByCustomerId: async () => null,
    updateExisting: async (row, state, expectedSubscriptionId) => {
      writes.push({ row, state, expectedSubscriptionId });
    },
    insertMissing: async () => assert.fail('default subscription row exists'),
    tierFromPriceId: () => 'pro',
  });

  assert.equal(result.applied, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].row.user_id, 'user_1');
  assert.equal(writes[0].expectedSubscriptionId, null);
  assert.equal(writes[0].state.stripe_subscription_id, 'sub_created_first');
});

test('stale subscription delivery cannot replace a newer subscription assignment', async () => {
  let writeCount = 0;
  const result = await stripeReliability.reconcileSubscriptionEntitlement({
    subscriptionId: 'sub_old',
    retrieveCurrent: async () => ({
      id: 'sub_old',
      customer: 'cus_1',
      status: 'active',
      metadata: { user_id: 'user_1' },
      items: { data: [{ price: { id: 'price_pro' } }] },
    }),
    findBySubscriptionId: async () => null,
    findByUserId: async () => ({
      id: 'row_1',
      user_id: 'user_1',
      stripe_subscription_id: 'sub_new',
    }),
    findByCustomerId: async () => null,
    updateExisting: async () => { writeCount += 1; },
    insertMissing: async () => { writeCount += 1; },
    tierFromPriceId: () => 'pro',
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'newer-subscription-assigned');
  assert.equal(writeCount, 0);
});

test('a newer subscription replaces an older terminal assignment', async () => {
  const writes = [];
  const subscriptions = {
    sub_new: {
      id: 'sub_new',
      created: 200,
      customer: 'cus_1',
      status: 'active',
      metadata: { user_id: 'user_1' },
      items: { data: [{ price: { id: 'price_pro' } }] },
    },
    sub_old: {
      id: 'sub_old',
      created: 100,
      customer: 'cus_1',
      status: 'canceled',
      metadata: { user_id: 'user_1' },
      items: { data: [{ price: { id: 'price_pro' } }] },
    },
  };
  const result = await stripeReliability.reconcileSubscriptionEntitlement({
    subscriptionId: 'sub_new',
    retrieveCurrent: async (id) => subscriptions[id],
    findBySubscriptionId: async () => null,
    findByUserId: async () => null,
    findByCustomerId: async () => ({
      id: 'row_1',
      user_id: 'user_1',
      stripe_subscription_id: 'sub_old',
    }),
    updateExisting: async (row, state, expectedSubscriptionId) => {
      writes.push({ row, state, expectedSubscriptionId });
    },
    insertMissing: async () => assert.fail('customer row exists'),
    tierFromPriceId: () => 'pro',
  });

  assert.equal(result.applied, true);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedSubscriptionId, 'sub_old');
  assert.equal(writes[0].state.stripe_subscription_id, 'sub_new');
});

test('existing Stripe customer mapping wins over subscription metadata', async () => {
  const writes = [];
  const result = await stripeReliability.reconcileSubscriptionEntitlement({
    subscriptionId: 'sub_1',
    retrieveCurrent: async () => ({
      id: 'sub_1',
      customer: 'cus_1',
      status: 'active',
      metadata: { user_id: 'stale_user' },
      items: { data: [{ price: { id: 'price_pro' } }] },
    }),
    findBySubscriptionId: async () => null,
    findByUserId: async () => ({
      id: 'wrong_row',
      user_id: 'stale_user',
      stripe_subscription_id: null,
    }),
    findByCustomerId: async () => ({
      id: 'customer_row',
      user_id: 'real_user',
      stripe_subscription_id: null,
    }),
    updateExisting: async (row) => { writes.push(row); },
    insertMissing: async () => assert.fail('customer row exists'),
    tierFromPriceId: () => 'pro',
  });

  assert.equal(result.applied, true);
  assert.equal(writes[0].id, 'customer_row');
});

test('terminal subscription delivery after deletion is idempotent', async () => {
  let writeCount = 0;
  const result = await stripeReliability.reconcileSubscriptionEntitlement({
    subscriptionId: 'sub_deleted',
    retrieveCurrent: async () => ({
      id: 'sub_deleted',
      customer: 'cus_1',
      status: 'canceled',
      metadata: { user_id: 'user_1' },
      items: { data: [{ price: { id: 'price_pro' } }] },
    }),
    findBySubscriptionId: async () => null,
    findByUserId: async () => null,
    findByCustomerId: async () => null,
    updateExisting: async () => { writeCount += 1; },
    insertMissing: async () => { writeCount += 1; },
    tierFromPriceId: () => 'pro',
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'terminal-subscription-already-removed');
  assert.equal(writeCount, 0);
});

test('missing Stripe subscription after deletion is idempotent', async () => {
  let databaseReadCount = 0;
  const result = await stripeReliability.reconcileSubscriptionEntitlement({
    subscriptionId: 'sub_gone',
    retrieveCurrent: async () => {
      const error = new Error('No such subscription');
      error.code = 'resource_missing';
      throw error;
    },
    findBySubscriptionId: async () => { databaseReadCount += 1; },
    findByUserId: async () => null,
    findByCustomerId: async () => null,
    updateExisting: async () => assert.fail('must not write'),
    insertMissing: async () => assert.fail('must not write'),
    tierFromPriceId: () => 'free',
  });

  assert.equal(result.applied, false);
  assert.equal(result.reason, 'subscription-not-found');
  assert.equal(databaseReadCount, 0);
});

test('every entitlement-changing webhook reconciles current Stripe state before writing', () => {
  const source = readFileSync(
    new URL('../supabase/functions/stripe-webhook/index.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /reconcileSubscriptionEntitlement/);
  assert.match(source, /stripe\.subscriptions\.retrieve/);
  assert.equal(
    [...source.matchAll(/await reconcileCurrentSubscriptionState\(/g)].length,
    5,
  );

  const paymentSucceeded = source.slice(
    source.indexOf('async function handlePaymentSucceeded'),
    source.indexOf('async function handlePaymentFailed'),
  );
  const paymentFailed = source.slice(source.indexOf('async function handlePaymentFailed'));
  assert.doesNotMatch(paymentSucceeded, /status:\s*['"]active['"]/);
  assert.doesNotMatch(paymentFailed, /status:\s*['"]past_due['"]/);
});
