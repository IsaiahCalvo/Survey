// Backend security and cost pass: the Stripe webhook logged a failed database
// write and still answered 200, so Stripe never resent the event and a paid
// upgrade could be lost. Write failures now answer 500 (Stripe resends with its
// own capped backoff), and emails get a few capped tries of their own.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../supabase/functions/stripe-webhook/index.ts', import.meta.url), 'utf8');

describe('stripe-webhook retries', () => {
  it('answers 500 when our own write failed', () => {
    assert.match(src, /status: error instanceof WebhookWriteError \? 500 : 400/);
  });

  it('every subscription write throws on failure', () => {
    for (const what of [
      'inserting new subscription',
      'updating subscription by customer id',
      'updating subscription',
      'handling subscription deletion',
      'marking subscription active',
      'marking subscription past due',
    ]) {
      assert.ok(src.includes(`failWrite('${what}'`), what);
    }
  });

  it('a failed plan update throws before the cancellation email goes out', () => {
    const write = src.indexOf("failWrite('updating subscription',");
    const email = src.indexOf("'subscription-cancel-scheduled'");
    assert.ok(write > 0 && write < email);
  });

  it('email retries are capped and back off', () => {
    assert.match(src, /const EMAIL_ATTEMPTS = 3;/);
    assert.match(src, /EMAIL_BACKOFF_MS \* 2 \*\* \(attempt - 1\)/);
    assert.match(src, /retryable = response\.status === 429 \|\| response\.status >= 500;/);
  });
});
