// Real pinned Stripe verification and actual endpoint, with synthetic events.
// Run with only env permission and a scrubbed child environment (see Node test).
// All external fetches fail locally. No keys/accounts.
import assert from 'node:assert/strict';
import Stripe from 'npm:stripe@20.4.1';

const secret = 'whsec_offline_signature_fixture_only';
const config: Record<string, string> = {
    STRIPE_SECRET_KEY: 'sk_test_offline_signature_fixture_only',
    STRIPE_WEBHOOK_SECRET: secret,
    SUPABASE_URL: 'https://billing-signature.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'offline_fixture_not_a_key',
    STRIPE_PRO_MONTHLY_PRICE_ID: 'price_fixture',
};
let handler: (req: Request) => Promise<Response>;
let fetches = 0;
// These substitutions never read the host environment or start a server.
Object.defineProperty(Deno.env, 'get', { value: (name: string) => config[name] });
Object.defineProperty(Deno, 'serve', { value: (value: typeof handler) => { handler = value; } });
globalThis.fetch = async () => { fetches++; throw new Error('External I/O forbidden by offline fixture'); };
await import('../supabase/functions/stripe-webhook/index.ts');
const stripe = new Stripe(config.STRIPE_SECRET_KEY, { apiVersion: '2026-02-25.clover' });
const event = { id: 'evt_signature_fixture', object: 'event', type: 'customer.created', livemode: false,
    created: Math.floor(Date.now() / 1000), data: { object: { id: 'cus_fixture' } } };
const raw = JSON.stringify(event, null, 2);
const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload: raw, secret });
const request = (body: string, header: string | null = signature) => new Request('https://billing-signature.invalid/webhook', {
    method: 'POST', headers: header ? { 'Stripe-Signature': header } : {}, body,
});
assert.equal((await handler!(request(raw))).status, 200);
assert.equal(fetches, 0);
assert.equal((await handler!(request(JSON.stringify(event)))).status, 400, 'Whitespace changes break the raw-body signature');
assert.equal((await handler!(request(raw.replace('cus_fixture', 'cus_changed')))).status, 400);
assert.equal((await handler!(request(raw, null))).status, 400);
const expired = await stripe.webhooks.generateTestHeaderStringAsync({ payload: raw, secret, timestamp: Math.floor(Date.now() / 1000) - 600 });
assert.equal((await handler!(request(raw, expired))).status, 400);
const wrong = await stripe.webhooks.generateTestHeaderStringAsync({ payload: raw, secret: 'whsec_wrong_fixture' });
assert.equal((await handler!(request(raw, wrong))).status, 400);
assert.equal(fetches, 0, 'Rejected signatures never access the database');
const handled = JSON.stringify({ ...event, type: 'customer.subscription.updated', data: { object: {
    id: 'sub_fixture', customer: 'cus_fixture', livemode: false,
} } });
const handledSignature = await stripe.webhooks.generateTestHeaderStringAsync({ payload: handled, secret });
assert.equal((await handler!(request(handled, handledSignature))).status, 503, 'Verified event with failed database read is not acknowledged');
assert.equal(fetches, 1);
console.log('PASS 7 actual endpoint / pinned Stripe signature checks; zero external network requests');
