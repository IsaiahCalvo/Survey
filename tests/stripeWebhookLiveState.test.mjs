// KAL-369 (Stripe part): webhooks come late, twice or out of order, so the
// subscription inside an event can be older than what an earlier event wrote.
// Before: a replayed customer.subscription.updated put back an old plan, a late
// invoice.payment_failed marked a paid plan past due, a trial's $0 first
// invoice flipped trialing to active, and Stripe statuses outside our enum
// (unpaid, paused, incomplete_expired) failed every write for three days.
// Now plan state is read from Stripe when the event is handled.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { subscriptionDbStatus } from '../supabase/functions/_shared/stripeSubscriptionState.js';

const src = readFileSync(new URL('../supabase/functions/stripe-webhook/index.ts', import.meta.url), 'utf8');
const ENUM = ['active', 'trialing', 'past_due', 'canceled', 'incomplete'];

function body(name) {
  const start = src.indexOf(`async function ${name}(`);
  assert.ok(start > 0, `${name} exists`);
  const next = src.indexOf('\nasync function ', start + 1);
  return src.slice(start, next > 0 ? next : undefined);
}

describe('subscriptionDbStatus', () => {
  it('keeps the statuses our enum has', () => {
    for (const status of ENUM) assert.equal(subscriptionDbStatus(status), status);
  });

  it('maps the Stripe statuses our enum lacks onto ones it has', () => {
    assert.equal(subscriptionDbStatus('unpaid'), 'past_due');
    assert.equal(subscriptionDbStatus('paused'), 'past_due');
    assert.equal(subscriptionDbStatus('incomplete_expired'), 'canceled');
  });

  it('every mapped value is a real enum value; unknown ones are null', () => {
    for (const status of ['active', 'trialing', 'past_due', 'canceled', 'incomplete', 'unpaid', 'paused', 'incomplete_expired']) {
      assert.ok(ENUM.includes(subscriptionDbStatus(status)), status);
    }
    assert.equal(subscriptionDbStatus('something_new'), null);
    assert.equal(subscriptionDbStatus(undefined), null);
  });
});

describe('stripe-webhook reads plan state from Stripe, not the event', () => {
  it('liveSubscription retrieves by id and a failed read answers 500', () => {
    const fn = body('liveSubscription');
    assert.match(fn, /stripe\.subscriptions\.retrieve\(id\)/);
    assert.match(fn, /failWrite\('reading subscription from Stripe'/);
  });

  it('created/updated events hand the live subscription to the handler', () => {
    assert.match(src, /case 'customer\.subscription\.updated': \{\s*const subscription = await liveSubscription\(event\.data\.object/);
  });

  it('the plan update writes a mapped status, never the raw Stripe one', () => {
    const fn = body('handleSubscriptionUpdate');
    assert.match(fn, /const status = subscriptionDbStatus\(subscription\.status\)/);
    assert.doesNotMatch(fn, /status: subscription\.status/);
  });

  it('invoice events set the live status instead of assuming active or past due', () => {
    for (const name of ['handlePaymentSucceeded', 'handlePaymentFailed']) {
      const fn = body(name);
      assert.match(fn, /subscriptionDbStatus\(\(await liveSubscription\(subscriptionId\)\)\.status\)/, name);
      assert.doesNotMatch(fn, /status: 'active'|status: 'past_due'/, name);
    }
  });

  it('company seats come from the live subscription unless it was deleted', () => {
    const fn = body('handleCompanyEvent');
    assert.match(fn, /deleted\s*\? event\.data\.object as Stripe\.Subscription\s*: await liveSubscription\(event\.data\.object/);
  });

  it('the cancellation email still keys on the event\'s own previous_attributes', () => {
    assert.match(src, /handleSubscriptionUpdate\(supabase, subscription, event\.data\.previous_attributes\)/);
  });
});
