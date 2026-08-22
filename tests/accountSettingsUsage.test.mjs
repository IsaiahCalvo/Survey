import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-account-settings-usage.spec.mjs
// Unique leftover after General: Subscription Usage local empty/fail-closed
// chrome. UL-18 is not leftover-18. Live billing-API meter stays parked
// with U-04 / A-05 host paths.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('UsageIndicator is local empty chrome when host meter is unavailable', () => {
  const indicator = read('src/components/UsageIndicator.jsx');
  const limits = read('src/hooks/useSubscriptionLimits.js');
  const settings = read('src/components/AccountSettings.jsx');
  const client = read('src/supabaseClient.js');

  assert.match(indicator, /if \(!user \|\| loading\) return null;/);
  assert.match(indicator, /\{tier\}/);
  assert.match(indicator, /label="Projects"/);
  assert.match(indicator, /label="Documents"/);
  assert.match(indicator, /label="Storage"/);
  assert.match(indicator, /\{current\} \/ \{unlimited \? '∞' : limit\}/);
  assert.match(indicator, /Running low on space\?/);
  assert.match(indicator, /tier === 'free'/);
  assert.doesNotMatch(indicator, /Retry/);
  assert.doesNotMatch(indicator, /Start 7-day trial/);
  assert.doesNotMatch(indicator, /VITE_DEV_AUTO_LOGIN/);

  assert.match(limits, /if \(!userId \|\| !isSupabaseAvailable\(\)\) \{\s*setLoading\(false\);\s*return;/);
  assert.match(limits, /developer: \{\s*projects: 999999,\s*documents: 999999,\s*storage: 100 \* 1024 \* 1024 \* 1024,/);
  assert.match(limits, /if \(bytes === 0\) return '0 B';/);
  assert.match(limits, /projects: 0,\s*documents: 0,\s*storage: 0,/);

  assert.match(settings, /setSubscriptionViewTab\('usage'\)/);
  assert.match(settings, /<UsageIndicator \/>/);
  assert.match(settings, /display: subscriptionViewTab === 'usage' \? 'block' : 'none'/);
  assert.match(settings, /Start 7-day trial/);

  assert.match(client, /export const isSupabaseAvailable = \(\) => supabase !== null && !isDevTestPdfRoute\(\);/);
  assert.match(client, /new URLSearchParams\(window.location.search\).has\('testPdf'\)/);
});

test('HubPreview and DevTestRoute seed developer; do not invent a live meter', () => {
  const preview = read('src/home/HubPreview.jsx');
  const devTest = read('src/DevTestRoute.jsx');
  const hunt = read('debug/scenarios/e2e-after-general-independent-hunt.spec.mjs');
  const usage = read('debug/scenarios/e2e-account-settings-usage.spec.mjs');

  assert.match(preview, /tier: 'developer'/);
  assert.match(preview, /id: 'dev-hubpreview-user'/);
  assert.match(preview, /isSupabaseAvailable: false,/);
  assert.doesNotMatch(preview, /get_actual_storage_usage/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);

  assert.match(devTest, /tier: 'developer'/);
  assert.match(devTest, /email: 'dev-test-user@example.invalid'/);

  assert.match(hunt, /INDEPENDENT_HUNT_INVENTORY/);
  assert.match(usage, /ACCOUNT_SETTINGS_USAGE_PROOF/);
  assert.match(usage, /0 B \/ 100\.0 GB/);
  assert.match(usage, /stripeNotClicked/);
  assert.doesNotMatch(usage, /Start 7-day trial.*click/);
});

test('UL-18 is not leftover-18; U-04 cloud checklist usage stays parked', () => {
  const unlisted = read('.planning/logic-audit-2026-08-20/E2E-UNLISTED.md');
  const leftover = read('.planning/logic-audit-2026-08-20/fix-logs/leftover18-unblock-2026-08-21.md');
  const usage = read('debug/scenarios/e2e-account-settings-usage.spec.mjs');

  assert.match(unlisted, /UL-18/);
  assert.match(leftover, /U-04/);
  assert.match(leftover, /Dashboard \+ Supabase live usage meter/);
  assert.match(usage, /UL-18 is NOT leftover-18/);
  assert.doesNotMatch(usage, /invented-meter/);
});
