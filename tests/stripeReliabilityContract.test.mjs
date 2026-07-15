import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANONICAL_APP_ORIGIN,
  assertRowsAffected,
  assertSupabaseSuccess,
  normalizeSubscriptionStatus,
  runBestEffort,
} from '../supabase/functions/_shared/stripeReliability.js';

const WEBHOOK_SOURCE = readFileSync(
  new URL('../supabase/functions/stripe-webhook/index.ts', import.meta.url),
  'utf8',
);
const CHECKOUT_SOURCE = readFileSync(
  new URL('../supabase/functions/create-checkout-session/index.ts', import.meta.url),
  'utf8',
);
const PORTAL_SOURCE = readFileSync(
  new URL('../supabase/functions/create-portal-session/index.ts', import.meta.url),
  'utf8',
);
const ENTITLEMENT_MIGRATION = readFileSync(
  new URL('../supabase/migrations/20260712020000_status_aware_get_user_tier.sql', import.meta.url),
  'utf8',
);

test('Stripe critical-operation guard rejects database errors and missing writes', () => {
  assert.throws(
    () => assertSupabaseSuccess({ message: 'database unavailable', code: 'XX000' }, 'update subscription'),
    /update subscription.*database unavailable/i,
  );
  assert.throws(
    () => assertRowsAffected([], 'update subscription'),
    /update subscription.*no rows/i,
  );
  assert.doesNotThrow(() => assertSupabaseSuccess(null, 'update subscription'));
  assert.doesNotThrow(() => assertRowsAffected([{ user_id: 'user-1' }], 'update subscription'));
});

test('Stripe email work is explicitly best-effort', async () => {
  const logs = [];
  const result = await runBestEffort(
    'payment email',
    async () => { throw new Error('mailer unavailable'); },
    { error: (...args) => logs.push(args.join(' ')) },
  );

  assert.equal(result, undefined);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /payment email.*mailer unavailable/i);
});

test('Stripe statuses never promote an incomplete or unknown subscription to active', () => {
  assert.equal(normalizeSubscriptionStatus('active'), 'active');
  assert.equal(normalizeSubscriptionStatus('trialing'), 'trialing');
  assert.equal(normalizeSubscriptionStatus('past_due'), 'past_due');
  assert.equal(normalizeSubscriptionStatus('canceled'), 'canceled');
  assert.equal(normalizeSubscriptionStatus('incomplete'), 'incomplete');
  assert.equal(normalizeSubscriptionStatus('unpaid'), 'incomplete');
  assert.equal(normalizeSubscriptionStatus('paused'), 'incomplete');
  assert.equal(normalizeSubscriptionStatus('unexpected_future_status'), 'incomplete');

  assert.match(WEBHOOK_SOURCE, /reconcileSubscriptionEntitlement/);
});

test('Stripe functions use only the canonical production return origin', () => {
  assert.equal(CANONICAL_APP_ORIGIN, 'https://surveytool.app');

  assert.match(CHECKOUT_SOURCE, /success_url:\s*`\$\{CANONICAL_APP_ORIGIN\}\/success\?session_id=\{CHECKOUT_SESSION_ID\}`/);
  assert.match(CHECKOUT_SOURCE, /cancel_url:\s*`\$\{CANONICAL_APP_ORIGIN\}\/pricing`/);
  assert.match(PORTAL_SOURCE, /return_url:\s*CANONICAL_APP_ORIGIN/);
  assert.match(WEBHOOK_SOURCE, /return_url:\s*CANONICAL_APP_ORIGIN/g);

  for (const source of [CHECKOUT_SOURCE, PORTAL_SOURCE, WEBHOOK_SOURCE]) {
    assert.doesNotMatch(source, /return_url:\s*['"]https:\/\/www\.google\.com/);
  }
  assert.doesNotMatch(CHECKOUT_SOURCE, /const origin = req\.headers\.get\('origin'\)/);
  assert.doesNotMatch(PORTAL_SOURCE, /const origin = req\.headers\.get\('origin'\)/);
});

test('verified Stripe event processing failures return 500 so Stripe retries', () => {
  assert.match(WEBHOOK_SOURCE, /WEBHOOK PROCESSING ERROR/);
  assert.match(WEBHOOK_SOURCE, /status:\s*500/);

  // Reconciliation promotes every lookup/write error (and zero-row race) to a
  // thrown failure; the outer request handler turns those into HTTP 500.
  assert.match(WEBHOOK_SOURCE, /assertSupabaseSuccess\(error, `look up \$\{operation\} by subscription`\)/);
  assert.match(WEBHOOK_SOURCE, /assertSupabaseSuccess\(error, `look up \$\{operation\} by user`\)/);
  assert.match(WEBHOOK_SOURCE, /assertSupabaseSuccess\(error, `look up \$\{operation\} by customer`\)/);
  assert.match(WEBHOOK_SOURCE, /assertSupabaseSuccess\(error, `update \$\{operation\}`\)/);
  assert.match(WEBHOOK_SOURCE, /assertRowsAffected\(data, `update \$\{operation\}`\)/);
  assert.match(WEBHOOK_SOURCE, /assertSupabaseSuccess\(error, `insert \$\{operation\}`\)/);
  assert.match(WEBHOOK_SOURCE, /assertRowsAffected\(data, `insert \$\{operation\}`\)/);

  for (const operation of [
    'look up deleted subscription',
    'archive downgraded account',
    'downgrade deleted subscription',
  ]) {
    assert.match(WEBHOOK_SOURCE, new RegExp(`assertSupabaseSuccess\\([^;]+${operation}`, 's'));
  }
});

test('server entitlement helper is caller-scoped and grants paid tiers only for active or trialing status', () => {
  assert.match(ENTITLEMENT_MIGRATION, /CREATE OR REPLACE FUNCTION public\.get_user_tier\(p_user_id uuid\)/i);
  assert.match(ENTITLEMENT_MIGRATION, /p_user_id\s+IS\s+DISTINCT\s+FROM\s+caller_user_id/i);
  assert.match(ENTITLEMENT_MIGRATION, /caller_role\s+NOT\s+IN\s*\(\s*'service_role'\s*,\s*'supabase_admin'\s*\)/i);
  assert.match(ENTITLEMENT_MIGRATION, /RETURN\s+'free'::public\.subscription_tier/i);
  assert.match(ENTITLEMENT_MIGRATION, /status::text\s+IN\s*\('active',\s*'trialing'\)/i);
  assert.match(ENTITLEMENT_MIGRATION, /ELSE\s+'free'/i);
  assert.match(ENTITLEMENT_MIGRATION, /SET search_path\s*=\s*''/i);
});

test('usage and project-access helpers cannot be pointed at another account', () => {
  assert.match(ENTITLEMENT_MIGRATION, /CREATE OR REPLACE FUNCTION public\.get_current_usage\(/i);
  assert.match(ENTITLEMENT_MIGRATION, /effective_user_id\s*:=\s*caller_user_id/i);
  assert.match(ENTITLEMENT_MIGRATION, /CREATE OR REPLACE FUNCTION public\.is_project_accessible\(/i);
  assert.match(ENTITLEMENT_MIGRATION, /effective_user_id\s+IS\s+NULL/i);
  assert.match(ENTITLEMENT_MIGRATION, /project_user_id\s+IS\s+DISTINCT\s+FROM\s+effective_user_id/i);
});
