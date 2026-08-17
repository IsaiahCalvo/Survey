/* KAL-404 residual — the customer.subscription.updated pro→free branch used to
 * only log "Actual archival will be handled by frontend when user logs in",
 * but no frontend/login-time call to handle_downgrade_to_free ever existed.
 * The webhook must now archive overage itself, mirroring the
 * customer.subscription.deleted path. Source-assertion style
 * (kal31LastOwnerCascadeMigration.test.mjs). */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const source = fs.readFileSync(
  path.join(repoRoot, 'supabase/functions/stripe-webhook/index.ts'),
  'utf8',
);

function functionBody(name) {
  const start = source.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const nextFn = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, nextFn === -1 ? source.length : nextFn);
}

test('subscription update pro→free calls handle_downgrade_to_free (no frontend hand-off)', () => {
  const body = functionBody('handleSubscriptionUpdate');

  assert.match(body, /isDowngradeToFree = oldTier === 'pro' && tier === 'free'/);
  assert.match(body, /rpc\('handle_downgrade_to_free',\s*\{\s*p_user_id: actualUserId\s*\}/);
  assert.doesNotMatch(
    body,
    /handled by frontend/i,
    'the stale "frontend will archive on login" note must be gone — that code path never existed',
  );
});

test('archival runs only after the tier update succeeds, gated on the downgrade flag', () => {
  const body = functionBody('handleSubscriptionUpdate');

  const update = body.indexOf(".from('user_subscriptions')");
  const successLog = body.indexOf('Subscription updated for user');
  const archiveCall = body.indexOf("rpc('handle_downgrade_to_free'");
  const gate = body.indexOf('if (isDowngradeToFree && actualUserId)');
  assert.ok(update >= 0 && successLog >= 0 && archiveCall >= 0 && gate >= 0);
  assert.ok(
    update < successLog && successLog < gate && gate < archiveCall,
    'archive call must sit inside the update-success branch behind the downgrade gate',
  );
});

test('the subscription.deleted path keeps its own archival call (mirrored behavior)', () => {
  const body = functionBody('handleSubscriptionDeleted');
  assert.match(body, /rpc\('handle_downgrade_to_free',\s*\{\s*p_user_id: userSubscription\.user_id\s*\}/);
});
