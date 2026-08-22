import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-account-settings-start-trial-failclosed.spec.mjs
// Leftover-18 A-05 / UL-20 Account Settings Start trial fail-closed.
// Distinct from Settings General / Usage catalog and leftover18-unblock
// "trial not clicked". Does not invent a Stripe Checkout URL.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('StripeCheckout fail-closes without a session and does not invent a Checkout URL', () => {
  const stripe = read('src/components/StripeCheckout.jsx');
  const settings = read('src/components/AccountSettings.jsx');
  const edge = read('supabase/functions/create-checkout-session/index.ts');

  assert.match(stripe, /Must be signed in to start a trial/);
  assert.match(stripe, /supabase\.auth\.getSession\(\)/);
  assert.match(stripe, /session\?\.access_token/);
  assert.match(stripe, /supabase\.functions\.invoke\('create-checkout-session'/);
  assert.ok(
    stripe.indexOf('Must be signed in to start a trial')
      < stripe.indexOf("supabase.functions.invoke('create-checkout-session'"),
    'session gate must run before create-checkout-session',
  );
  assert.doesNotMatch(stripe, /checkout\.stripe\.com\/c\/pay\/cs_test_invented/);
  assert.doesNotMatch(stripe, /VITE_DEV_AUTO_LOGIN/);
  assert.match(stripe, /No checkout URL returned/);

  assert.match(settings, /authSupabaseAvailable === false/);
  assert.match(settings, /Start 7-day trial/);
  assert.match(settings, /<StripeCheckout/)

  assert.match(edge, /No authorization header/);
  assert.match(edge, /Invalid user token/);
  assert.match(edge, /Access-Control-Allow-Origin': '\*'/);
  assert.ok(
    edge.indexOf("req.headers.get('Authorization')")
      < edge.indexOf('stripe.checkout.sessions.create')
      || edge.indexOf('No authorization header') < edge.indexOf('sessions.create'),
    'edge function must auth-fail before minting Checkout',
  );
});

test('HubPreview / DevTestRoute do not invent a subscription row or checkout host', () => {
  const preview = read('src/home/HubPreview.jsx');
  const devTest = read('src/DevTestRoute.jsx');
  const settings = read('src/components/AccountSettings.jsx');

  assert.match(preview, /isSupabaseAvailable: false,/);
  assert.match(preview, /tier: 'developer'/);
  assert.match(preview, /session: null,/);
  assert.doesNotMatch(preview, /create-checkout-session/);
  assert.doesNotMatch(preview, /cs_test_|checkout\.stripe\.com\/c\/pay/);

  assert.match(devTest, /isSupabaseAvailable: false,/);
  assert.match(devTest, /tier: 'developer'/);
  assert.doesNotMatch(devTest, /create-checkout-session/);

  assert.match(settings, /Do not invent a/);
  assert.match(settings, /setSubscription\(null\)/);
});

test('Start trial live spec clicks the button and does not complete a purchase', () => {
  const live = read('debug/scenarios/e2e-account-settings-start-trial-failclosed.spec.mjs');
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  const usage = read('debug/scenarios/e2e-account-settings-usage.spec.mjs');

  assert.match(live, /ACCOUNT_SETTINGS_START_TRIAL_FAILCLOSED_PROOF/);
  assert.match(live, /Start 7-day trial/);
  assert.match(live, /Must be signed in to start a trial/);
  assert.match(live, /create-checkout-session/);
  assert.match(live, /empty=1/);
  assert.match(live, /guest=1/);
  assert.match(live, /testPdf=/);
  assert.match(live, /width: 390/);
  assert.doesNotMatch(live, /setInputFiles/);
  assert.doesNotMatch(live, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(live, /cs_test_invented/);
  assert.doesNotMatch(live, /fulfill\(\{[\s\S]*checkout\.stripe\.com/);

  assert.match(leftover, /A-05 \/ UL-20/);
  assert.match(usage, /stripeNotClicked/);
  assert.doesNotMatch(usage, /ACCOUNT_SETTINGS_START_TRIAL_FAILCLOSED_PROOF/);
});

test('96 unique inventory IDs still have proven receipts', () => {
  const inventory = read('.planning/logic-audit-2026-08-20/ISSUE-INVENTORY.md');
  const unique = inventory
    .split('## All unique IDs (96)')[1]
    .split('### P2-34 / P2-35 sub-defects')[0];
  const ids = [];
  for (const line of unique.split('\n')) {
    const cells = line.split('|').map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const head = cells[1];
    const singles = head.match(/^(KB-\d+|P1-\d+|P2-\d+)$/);
    if (singles) {
      ids.push(singles[1]);
      continue;
    }
    const pair = head.match(/^(P1-\d+) \/ (P1-\d+)$/);
    if (pair) {
      ids.push(pair[1], pair[2]);
    }
  }
  assert.equal(ids.length, 96, `expected 96 unique IDs, got ${ids.length}: ${ids.join(',')}`);
  assert.equal(new Set(ids).size, 96);
  const unproven = [];
  for (const line of unique.split('\n')) {
    if (!/^\| (KB-\d+|P1-\d+|P2-\d+)/.test(line)) continue;
    if (!line.includes('**proven**')) unproven.push(line.slice(0, 80));
  }
  assert.deepEqual(unproven, []);
});
