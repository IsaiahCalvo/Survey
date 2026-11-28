// KAL-856: one Stripe account sells every Kal Voe plan. These tests pin which
// price unlocks which app, and that a checkout can only send buyers back to
// our own sites.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  appsForPlan, cleanEmail, LOOKUP_KEYS, planForPrice, planIncludesSurvey,
  sameSecret, SELLABLE_PLANS, suiteReturnUrl, DEFAULT_RETURN_URL,
} from '../supabase/functions/_shared/suitePlans.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('suite plans', () => {
  it('maps every lookup key back to its plan', () => {
    for (const [plan, keys] of Object.entries(LOOKUP_KEYS)) {
      assert.equal(planForPrice({ lookup_key: keys.monthly }), plan);
      assert.equal(planForPrice({ lookup_key: keys.yearly }), plan);
    }
    assert.equal(planForPrice({ lookup_key: 'something_else' }), null);
    assert.equal(planForPrice(null), null);
    assert.equal(planForPrice('price_123'), null);
  });

  it('gives the suite all three apps and each app only itself', () => {
    assert.deepEqual(appsForPlan('suite'), ['survey', 'walkthru', 'plot']);
    assert.deepEqual(appsForPlan('walkthru'), ['walkthru']);
    assert.deepEqual(appsForPlan('nope'), []);
    assert.equal(planIncludesSurvey('survey'), true);
    assert.equal(planIncludesSurvey('suite'), true);
    assert.equal(planIncludesSurvey('walkthru'), false);
  });

  it('does not sell Plot on its own while it has no paid features', () => {
    assert.deepEqual(SELLABLE_PLANS, ['survey', 'walkthru', 'suite']);
  });

  it('only returns buyers to our own sites', () => {
    assert.equal(suiteReturnUrl('https://survey.kalvoe.com/?x=1#h'), 'https://survey.kalvoe.com/?x=1');
    assert.equal(suiteReturnUrl('https://walkthru.tools/account'), 'https://walkthru.tools/account');
    assert.equal(suiteReturnUrl('http://localhost:5173/'), 'http://localhost:5173/');
    assert.equal(suiteReturnUrl('https://evil.example/'), DEFAULT_RETURN_URL);
    assert.equal(suiteReturnUrl('http://kalvoe.com/'), DEFAULT_RETURN_URL);
    assert.equal(suiteReturnUrl('https://kalvoe.com.evil.example/'), DEFAULT_RETURN_URL);
    assert.equal(suiteReturnUrl('javascript:alert(1)'), DEFAULT_RETURN_URL);
    assert.equal(suiteReturnUrl(undefined), DEFAULT_RETURN_URL);
  });

  it('cleans emails and compares the app key safely', () => {
    assert.equal(cleanEmail('  Someone@Example.COM '), 'someone@example.com');
    assert.equal(cleanEmail('not an email'), null);
    assert.equal(cleanEmail(42), null);
    assert.equal(sameSecret('abc', 'abc'), true);
    assert.equal(sameSecret('abc', 'abd'), false);
    assert.equal(sameSecret('abc', 'abcd'), false);
    assert.equal(sameSecret('', ''), false);
    assert.equal(sameSecret(undefined, 'abc'), false);
  });
});

describe('suite wiring', () => {
  it('keeps both new functions public at the gateway, each with its own check', () => {
    const config = read('supabase/config.toml');
    assert.match(config, /\[functions\.suite-checkout\]\s*verify_jwt = false/);
    assert.match(config, /\[functions\.suite-entitlement\]\s*verify_jwt = false/);
    assert.match(read('supabase/functions/suite-entitlement/index.ts'), /x-kalvoe-suite-key/);
    assert.match(read('supabase/functions/suite-entitlement/index.ts'), /sameSecret\(/);
  });

  it('refuses Plot at checkout and offers Link', () => {
    const checkout = read('supabase/functions/suite-checkout/index.ts');
    assert.match(checkout, /Plot is free while it is in early access/);
    assert.match(checkout, /payment_method_types: \['card', 'link'\]/);
    assert.match(read('supabase/functions/create-checkout-session/index.ts'), /payment_method_types: \['card', 'link'\]/);
    assert.match(read('supabase/functions/create-checkout-session/index.ts'), /LOOKUP_KEYS\.survey\[/);
  });

  it('syncs suite plans in the webhook before the Survey handlers run', () => {
    const src = read('supabase/functions/stripe-webhook/index.ts');
    assert.match(src, /syncSuiteEntitlement\(/);
    assert.match(src, /apply_suite_plan_for_email/);
    assert.match(src, /from ['"]\.\.\/_shared\/suitePlans\.js['"]/);
  });

  it('keeps suite rows private and lets confirmed sign-ups pick up a plan', () => {
    const sql = read('supabase/migrations/20261128030000_suite_entitlements.sql');
    assert.match(sql, /enable row level security/i);
    assert.match(sql, /revoke all on public\.suite_entitlements from anon/i);
    assert.match(sql, /after insert or update of email_confirmed_at on auth\.users/i);
  });

  it('shows the new Survey Pro price in the app', () => {
    const settings = read('src/components/AccountSettings.jsx');
    assert.match(settings, /\$12<\/span>/);
    assert.match(settings, /\$120<\/span>/);
    assert.doesNotMatch(settings, /\$9\.99/);
  });
});
