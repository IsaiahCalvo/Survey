import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  billingResultToast,
  consumeBillingReturn,
  parseBillingResult,
  resolveBillingReturnUrl,
  stripBillingResult,
  withBillingResult,
} from '../supabase/functions/_shared/billingReturn.ts';
import {
  proTrialPeriodDays,
  shouldGrantProTrial,
  trialUsedAtPatch,
} from '../supabase/functions/_shared/billingTrial.ts';
import { withStripeEventIdempotency } from '../supabase/functions/_shared/stripeEventIdempotency.ts';
import { BILLING_PORTAL_RETURN_URL } from '../supabase/functions/_shared/stripeWebhookPolicy.ts';
import { consumeBillingQueryOnBoot } from '../src/utils/billingReturn.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function memoryStripeEvents(existing = new Set()) {
  return {
    from(table) {
      assert.equal(table, 'processed_stripe_events');
      return {
        insert: async ({ event_id }) => {
          if (existing.has(event_id)) return { error: { code: '23505' } };
          existing.add(event_id);
          return { error: null };
        },
        delete: () => ({
          eq: async (_column, eventId) => {
            existing.delete(eventId);
            return { error: null };
          },
        }),
      };
    },
  };
}

test('P2-28: first Pro checkout gets a 7-day trial; used trial skips it', () => {
  assert.equal(shouldGrantProTrial('pro', null), true);
  assert.equal(shouldGrantProTrial('pro', undefined), true);
  assert.equal(shouldGrantProTrial('pro', ''), true);
  assert.equal(proTrialPeriodDays('pro', null), 7);

  assert.equal(shouldGrantProTrial('pro', '2026-01-01T00:00:00.000Z'), false);
  assert.equal(proTrialPeriodDays('pro', '2026-01-01T00:00:00.000Z'), undefined);

  assert.equal(shouldGrantProTrial('enterprise', null), false);
  assert.equal(shouldGrantProTrial('pro', null, [{ trial_end: 1_700_000_000 }]), false);
  assert.equal(shouldGrantProTrial('pro', null, [{ trial_end: null }]), true);

  assert.deepEqual(trialUsedAtPatch({ trial_end: null }), {});
  const stamped = trialUsedAtPatch({ trial_end: 1_700_000_100, trial_start: 1_700_000_000 });
  assert.equal(stamped.trial_used_at, new Date(1_700_000_000 * 1000).toISOString());

  const checkout = read('supabase/functions/create-checkout-session/index.ts');
  assert.match(checkout, /proTrialPeriodDays\(tier, subscription\?\.trial_used_at/);
  assert.match(checkout, /select\('stripe_customer_id, trial_used_at'\)/);
  assert.doesNotMatch(checkout, /if \(tier === 'pro'\) \{\s*sessionParams\.subscription_data = \{[\s\S]*trial_period_days: 7/);
  assert.match(read('supabase/functions/stripe-webhook/index.ts'), /trialUsedAtPatch\(subscription\)/);
  assert.match(
    read('supabase/migrations/20260820120000_billing_trial_used_and_event_idempotency.sql'),
    /ADD COLUMN IF NOT EXISTS trial_used_at/,
  );

  const webhook = read('supabase/functions/stripe-webhook/index.ts');
  assert.match(webhook, /withStripeEventIdempotency\(supabase, event\.id/);
  assert.doesNotMatch(webhook, /trial_used_at:\s*null/);
});

test('P2-29: intended webhook runs once; replay is a no-op; failed claim can retry', async () => {
  const supabase = memoryStripeEvents();
  const emails = [];

  const first = await withStripeEventIdempotency(supabase, 'evt_pay_1', async () => {
    emails.push('payment-succeeded');
    return 'sent';
  });
  const replay = await withStripeEventIdempotency(supabase, 'evt_pay_1', async () => {
    emails.push('payment-succeeded-again');
    return 'sent-again';
  });

  assert.deepEqual(first, { status: 'handled', value: 'sent' });
  assert.deepEqual(replay, { status: 'duplicate' });
  assert.deepEqual(emails, ['payment-succeeded']);

  await assert.rejects(
    withStripeEventIdempotency(supabase, 'evt_fail_1', async () => {
      throw new Error('send-email down');
    }),
    /send-email down/,
  );
  const retried = await withStripeEventIdempotency(supabase, 'evt_fail_1', async () => {
    emails.push('payment-failed');
    return 'ok';
  });
  assert.equal(retried.status, 'handled');
  assert.deepEqual(emails, ['payment-succeeded', 'payment-failed']);

  const other = await withStripeEventIdempotency(supabase, 'evt_other_1', async () => {
    emails.push('trial-ending');
    return 'other';
  });
  assert.deepEqual(other, { status: 'handled', value: 'other' });
  assert.deepEqual(emails, ['payment-succeeded', 'payment-failed', 'trial-ending']);
});

test('P2-29: webhook insert-claims event.id before sendEmail; migration persists processed_stripe_events', () => {
  const webhook = read('supabase/functions/stripe-webhook/index.ts');
  assert.match(webhook, /withStripeEventIdempotency\(supabase, event\.id/);
  assert.match(webhook, /from '\.\.\/_shared\/stripeEventIdempotency\.ts'/);
  assert.match(webhook, /sendEmail\(/);
  assert.doesNotMatch(webhook, /www\.google\.com/);
  assert.equal(BILLING_PORTAL_RETURN_URL, 'https://surveytool.app/');

  const claimIdx = webhook.indexOf('withStripeEventIdempotency(supabase, event.id');
  const firstEmailIdx = webhook.indexOf('await sendEmail(');
  assert.ok(claimIdx >= 0 && firstEmailIdx > claimIdx, 'event.id claim must precede sendEmail');

  const migration = read('supabase/migrations/20260820120000_billing_trial_used_and_event_idempotency.sql');
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.processed_stripe_events/);
  assert.match(migration, /event_id TEXT PRIMARY KEY/);
  assert.match(migration, /GRANT ALL ON TABLE public\.processed_stripe_events TO service_role/);
});

test('P2-29: empty event id is refused; unique-violation is duplicate; other insert errors throw', async () => {
  await assert.rejects(withStripeEventIdempotency(memoryStripeEvents(), '', async () => 'nope'), /event id is required/);

  const failing = {
    from() {
      return {
        insert: async () => ({ error: { code: '42501', message: 'permission denied' } }),
        delete: () => ({ eq: async () => ({ error: null }) }),
      };
    },
  };
  try {
    await withStripeEventIdempotency(failing, 'evt_x', async () => 'nope');
    assert.fail('expected insert error to throw');
  } catch (error) {
    assert.equal(error.code, '42501');
    assert.match(error.message, /permission denied/);
  }
});

test('P2-38: ?billing=success toasts and strips; cancelled strips; junk is ignored', () => {
  const toasts = [];
  const replaced = [];

  const success = consumeBillingReturn({
    href: 'https://surveytool.app/?billing=success',
    replaceHref: (next) => replaced.push(next),
    toast: (message, type) => toasts.push({ message, type }),
  });
  assert.equal(success.result, 'success');
  assert.equal(success.toasted, true);
  assert.equal(replaced[0], 'https://surveytool.app/');
  assert.deepEqual(toasts[0], billingResultToast('success'));

  const cancelled = consumeBillingReturn({
    href: 'https://surveytool.app/mobile?mobileNav=tabs&billing=cancelled&nativeShell=expo#hub',
    replaceHref: (next) => replaced.push(next),
    toast: (message, type) => toasts.push({ message, type }),
  });
  assert.equal(cancelled.result, 'cancelled');
  assert.match(cancelled.href, /mobileNav=tabs/);
  assert.match(cancelled.href, /nativeShell=expo/);
  assert.doesNotMatch(cancelled.href, /billing=/);
  assert.match(cancelled.href, /#hub/);

  const kept = consumeBillingReturn({
    href: 'https://surveytool.app/?docId=d1&billing=success',
    replaceHref: (next) => replaced.push(next),
    toast: (message, type) => toasts.push({ message, type }),
  });
  assert.equal(kept.result, 'success');
  assert.equal(new URL(kept.href).searchParams.get('docId'), 'd1');
  assert.equal(new URL(kept.href).searchParams.get('billing'), null);

  assert.equal(parseBillingResult('?billing=success'), 'success');
  assert.equal(parseBillingResult('?billing=cancelled'), 'cancelled');
  assert.equal(parseBillingResult('?billing=SUCCESS'), null);
  assert.equal(parseBillingResult('?billing=evil'), null);
  assert.equal(parseBillingResult('?foo=bar'), null);
  assert.equal(parseBillingResult('not a url %'), null);
  assert.equal(stripBillingResult('https://surveytool.app/?foo=1').result, null);
  assert.equal(stripBillingResult('https://surveytool.app/?foo=1').href, 'https://surveytool.app/?foo=1');

  const second = consumeBillingReturn({
    href: 'https://surveytool.app/',
    replaceHref: (next) => replaced.push(`again:${next}`),
    toast: (message) => toasts.push({ message, type: 'again' }),
  });
  assert.equal(second.result, null);
  assert.equal(second.toasted, false);
  assert.equal(replaced.some((href) => href.startsWith('again:')), false);

  const checkoutUrl = withBillingResult(resolveBillingReturnUrl(null, null), 'success');
  assert.equal(parseBillingResult(checkoutUrl), 'success');

  const host = read('src/components/ToastHost.jsx');
  assert.match(host, /consumeBillingQueryOnBoot\(\)/);
  assert.match(read('src/utils/billingReturn.js'), /searchParams\.get\('billing'\)/);
  assert.match(read('src/utils/billingReturn.js'), /consumeBillingReturn\(/);
});

test('P2-38 boot helper uses history.replaceState and showToast', () => {
  const toasts = [];
  const replaced = [];
  const windowObject = {
    location: { href: 'http://localhost:5173/?billing=success&keep=1' },
    history: {
      state: { page: 1 },
      replaceState: (_state, _title, url) => replaced.push(url),
    },
  };

  const originalWindow = globalThis.window;
  const fakeWindow = {
    dispatchEvent: (event) => {
      toasts.push(event.detail);
      return true;
    },
  };
  globalThis.window = fakeWindow;
  try {
    const outcome = consumeBillingQueryOnBoot(windowObject);
    assert.equal(outcome.result, 'success');
    assert.equal(new URL(replaced[0]).searchParams.get('keep'), '1');
    assert.equal(new URL(replaced[0]).searchParams.get('billing'), null);
    assert.equal(toasts[0]?.type, 'success');
  } finally {
    if (originalWindow) {
      globalThis.window = originalWindow;
    } else {
      delete globalThis.window;
    }
  }
});
