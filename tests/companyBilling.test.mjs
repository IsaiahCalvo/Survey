// Enterprise seats on one bill (company workspace, beta 'company-admin'): the
// payments listener only changes a company from events our checkout tagged,
// only the Enterprise price buys seats, and only paid seats lift people to
// Enterprise on the server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { companyBillingStatus, companyIdOf } from '../supabase/functions/_shared/companyBilling.js';
import { activitySentence, minSeatsFor, seatsCost } from '../src/services/companyService.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const MIGRATION = read('supabase/migrations/20261028040000_company_billing.sql');
const WEBHOOK = read('supabase/functions/stripe-webhook/index.ts');
const CHECKOUT = read('supabase/functions/create-checkout-session/index.ts');
const ORG = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

test('only subscription and checkout events tagged with a company count', () => {
  assert.equal(companyIdOf({ data: { object: { object: 'subscription', metadata: { org_id: ORG } } } }), ORG);
  assert.equal(companyIdOf({ data: { object: { object: 'checkout.session', metadata: { org_id: ORG } } } }), ORG);
  assert.equal(companyIdOf({ data: { object: { object: 'invoice', metadata: { org_id: ORG } } } }), null);
  assert.equal(companyIdOf({ data: { object: { object: 'subscription', metadata: { user_id: ORG } } } }), null);
  assert.equal(companyIdOf({ data: { object: { object: 'subscription', metadata: { org_id: "x' or 1=1" } } } }), null);
  assert.equal(companyIdOf(null), null);
});

test("Stripe's status maps onto the company's billing status", () => {
  assert.equal(companyBillingStatus('active'), 'active');
  assert.equal(companyBillingStatus('trialing'), 'trialing');
  assert.equal(companyBillingStatus('past_due'), 'past_due');
  assert.equal(companyBillingStatus('unpaid'), 'past_due');
  assert.equal(companyBillingStatus('canceled'), 'canceled');
  assert.equal(companyBillingStatus('incomplete_expired'), 'canceled');
  assert.equal(companyBillingStatus('incomplete'), 'none');
});

test('the listener routes company events before the personal plan code and checks the price', () => {
  const branch = WEBHOOK.indexOf('const companyId = companyIdOf(event);');
  assert.ok(branch > 0 && branch < WEBHOOK.indexOf("case 'checkout.session.completed'"));
  assert.match(WEBHOOK, /getTierFromPriceId\(item\.price\?\.id \|\| ''\) !== 'enterprise'/);
  assert.ok(WEBHOOK.includes("failWrite('updating company billing'"));
  // A late event from an older plan cannot end the one bought since.
  assert.match(WEBHOOK, /current\.stripe_subscription_id !== subscription\.id/);
});

test('checkout sells seats only to a company owner, never fewer than are taken', () => {
  assert.match(CHECKOUT, /membership\?\.role !== 'owner'/);
  assert.match(CHECKOUT, /Math\.max\(3, wanted, \(members \|\| 0\) \+ \(invites \|\| 0\)\)/);
  assert.match(CHECKOUT, /quantity: company \? company\.quantity : 1/);
  assert.match(CHECKOUT, /metadata: \{ org_id: company\.id, payer_id: user\.id, tier: 'enterprise' \}/);
});

test('only paid seats lift people to Enterprise, and nobody can call the seat check', () => {
  assert.match(MIGRATION, /o\.billing_status in \('active', 'trialing'\)/);
  assert.match(MIGRATION, /revoke all on function public\._company_seated\(uuid\) from public, anon, authenticated;/);
  assert.match(MIGRATION, /grant execute on function public\._company_seated\(uuid\) to service_role;/);
  assert.match(MIGRATION, /grant execute on function public\.my_effective_tier\(\) to authenticated, service_role;/);
  // Every server limit reads get_user_tier, so it lifts too.
  assert.match(MIGRATION, /IF user_tier_text IN \('free', 'pro'\) AND public\._company_seated\(p_user_id\) THEN/);
  for (const fn of ['kal31_accept_document_invite', 'kal31_accept_project_invite', 'kal31_accept_template_invite']) {
    const at = MIGRATION.indexOf(`FUNCTION public.${fn}(`);
    assert.ok(at > 0, fn);
    assert.ok(MIGRATION.indexOf('public._company_seated(auth.uid())', at) > at, fn);
  }
  // Every function keeps a fixed search path (re-created ones keep their own).
  const defs = MIGRATION.match(/create or replace function/gi) || [];
  const paths = MIGRATION.match(/set search_path\s*(=|to)\s*'(public)?'/gi) || [];
  assert.ok(defs.length > 0 && paths.length >= defs.length, `${paths.length} of ${defs.length}`);
});

test('the owner sees the price and the log says what changed', () => {
  assert.equal(minSeatsFor({ seats_used: 1 }), 3);
  assert.equal(minSeatsFor({ seats_used: 12 }), 12);
  assert.equal(seatsCost(3), '$60 a month');
  assert.equal(seatsCost(60), '$1,200 a month');
  assert.equal(activitySentence({ actor_email: 'olive@acme.com', action: 'billing.updated', details: { status: 'active', seats: 5 } }),
    'olive@acme.com updated the company plan to 5 seats (paid)');
  assert.equal(activitySentence({ action: 'billing.updated', details: { status: 'canceled', seats: 3 } }),
    'Someone updated the company plan (ended)');
});
