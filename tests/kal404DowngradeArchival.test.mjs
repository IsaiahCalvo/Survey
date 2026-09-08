// Boundary contracts only. Runtime handler cases live in
// billingWebhookReconciliation.test.mjs; real PostgreSQL tests prove atomicity.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const endpoint = source('supabase/functions/stripe-webhook/index.ts');
const reconciliation = source('supabase/functions/_shared/billingReconciliation.ts');

test('KAL404 webhook awaits one reconciliation boundary, never a separate archival side effect', () => {
  assert.match(endpoint, /await reconcileBillingEvent\(event,/);
  assert.doesNotMatch(endpoint, /handleSubscription(Update|Deleted)|handle_downgrade_to_free|\.from\(|\.rpc\(/);
  assert.doesNotMatch(endpoint, /handled by frontend/i);
});

test('KAL404 reconciliation submits snapshot, patch and notification in one RPC', () => {
  assert.match(reconciliation, /checkedRpc\(deps\.db, 'reconcile_billing_subscription_event',\s*\{/);
  for (const field of ['p_expected', 'p_patch', 'p_notification', 'p_expected_revision']) {
    assert.match(reconciliation, new RegExp(`${field}:`));
  }
  assert.doesNotMatch(reconciliation, /handle_downgrade_to_free|\.update\(|\.insert\(|\.upsert\(/);
});

test('KAL404 failed reconciliation is retryable, not falsely acknowledged as a completed downgrade', () => {
  assert.match(endpoint, /Billing reconciliation requires retry'\s*\},\s*503/);
  assert.match(reconciliation, /result\?\.outcome === 'stale'/);
  assert.match(reconciliation, /RETRY_CODES = new Set\(\['55P03', '40P01', '40001'\]\)/);
  assert.match(reconciliation, /if \(error\) throw new BillingReconciliationError/);
});
