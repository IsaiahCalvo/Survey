import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import * as layout from '../supabase/functions/_shared/emailLayout.ts';
import * as policy from '../supabase/functions/send-email/policy.js';
import { resolveBrevoApiKey } from '../supabase/functions/send-email/config.ts';

const source = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/send-email/index.ts', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\n/gm, ''), { mode: 'strip' });
const key = '11111111-1111-4111-8111-111111111111';
const templates = ['trial-ending', 'payment-failed', 'payment-succeeded', 'subscription-canceled', 'subscription-cancel-scheduled'];
function fixture({ user = false, provider, shortDeadline = false } = {}) {
  const requests = [], timers = new Set(); let handler;
  const context = { ...layout, ...policy, resolveBrevoApiKey,
    P: layout.EMAIL_P_STYLE, MUTED: layout.EMAIL_MUTED_STYLE, FINE: layout.EMAIL_FINE_STYLE, LIST: layout.EMAIL_LIST_STYLE,
    Deno: { env: { get: name => ({ BREVO_API_KEY: 'fixture-brevo-key', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key',
      SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_URL: 'https://offline.invalid' })[name] }, serve: fn => { handler = fn; } },
    createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: 'fixture-user' } }, error: null }) } }),
    Response, AbortController, console: { log() {}, error() {}, warn() {} },
    setTimeout(fn, ms) { if (shortDeadline) assert.equal(ms, 30_000); const timer = setTimeout(fn, shortDeadline ? 5 : ms); timers.add(timer); return timer; },
    clearTimeout(timer) { clearTimeout(timer); timers.delete(timer); },
    fetch: async (url, init) => {
      requests.push({ url, init, payload: JSON.parse(init.body) });
      return provider ? provider(url, init) : Response.json({ messageId: '<provider-receipt>' }, { status: 201 });
    },
  };
  vm.runInNewContext(source, context);
  return { requests, timers, async send(extra = {}) {
    const response = await handler(new Request('https://offline.invalid/send-email', { method: 'POST',
      headers: { Authorization: user ? 'Bearer fixture-user-jwt' : 'Bearer fixture-service-key' },
      body: JSON.stringify({ to: 'billing@example.invalid', subject: 'Billing notification', template: 'payment-failed',
        data: { portalUrl: 'https://surveytool.app' },
        ...(extra.billingDeliveryKey !== undefined ? { billingSendBefore: new Date(Date.now() + 120_000).toISOString() } : {}),
        ...extra }) }));
    return { status: response.status, body: await response.json(), cors: response.headers.get('Access-Control-Allow-Origin') };
  } };
}

test('service billing delivery passes its stable UUID in Brevo JSON headers and returns the provider receipt', async () => {
  const f = fixture();
  const result = await f.send({ billingDeliveryKey: key });
  assert.equal(result.status, 200); assert.deepEqual(result.body, { success: true, id: '<provider-receipt>' });
  assert.equal(f.requests[0].url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(f.requests[0].payload.headers?.idempotencyKey, key);
  assert.equal(f.requests[0].init.headers.idempotencyKey, undefined, 'the documented key is in the JSON body');
  assert.equal(result.cors, '*'); assert.equal(f.timers.size, 0);
});

test('only an explicit idempotency-key duplicate acknowledges the already processed billing request', async () => {
  const f = fixture({ provider: async () => Response.json({ code: 'duplicate_parameter', message: 'Email for the idempotency key has already been processed' }, { status: 400 }) });
  const result = await f.send({ billingDeliveryKey: key });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { success: true, id: `duplicate:${key}` });
});

test('an empty successful provider response cannot become a delivery receipt', async () => {
  const f = fixture({ provider: async () => Response.json({}) });
  const result = await f.send({ billingDeliveryKey: key });
  assert.equal(result.status, 500);
  assert.equal(result.body.success, undefined);
});

test('all five billing templates accept service keys, while ordinary service mail stays unchanged without one', async () => {
  for (const template of templates) {
    const f = fixture(); assert.equal((await f.send({ template, billingDeliveryKey: key })).status, 200);
    assert.equal(f.requests[0].payload.headers.idempotencyKey, key);
  }
  const f = fixture(); assert.equal((await f.send()).status, 200);
  assert.equal(f.requests[0].payload.headers, undefined);
});

test('signed-in users cannot supply any billing delivery key, including on sharing templates', async () => {
  for (const billingDeliveryKey of [key, null, '', 42]) {
    const f = fixture({ user: true });
    assert.equal((await f.send({ template: 'document-invite', billingDeliveryKey })).status, 403);
    assert.equal(f.requests.length, 0);
  }
});

test('service delivery keys reject malformed values and nonbilling templates before provider dispatch', async () => {
  for (const billingDeliveryKey of [null, '', 42, 'not-a-uuid', {}, `${key}\n`]) {
    const f = fixture(); assert.equal((await f.send({ billingDeliveryKey })).status, 400);
    assert.equal(f.requests.length, 0);
  }
  for (const template of ['document-invite', 'document-shared', 'unknown']) {
    const f = fixture(); assert.equal((await f.send({ template, billingDeliveryKey: key })).status, 400);
    assert.equal(f.requests.length, 0);
  }
});

test('unrelated, malformed and unkeyed provider errors never become duplicate receipts', async () => {
  const exact = { code: 'duplicate_parameter', message: 'Email for the idempotency key has already been processed' };
  for (const { body, status = 400, keyed = true } of [
    { body: { code: 'duplicate_parameter', message: 'Duplicate recipient' } },
    { body: { code: 'duplicate_parameter' } },
    { body: { ...exact, code: 'invalid_parameter' } },
    { body: exact, status: 500 },
    { body: exact, keyed: false },
    { body: null },
  ]) {
    const f = fixture({ provider: async () => Response.json(body, { status }) });
    const result = await f.send(keyed ? { billingDeliveryKey: key } : {});
    assert.equal(result.status, 500); assert.equal(result.body.success, undefined); assert.equal(f.timers.size, 0);
  }
  const f = fixture({ provider: async () => new Response('not json', { status: 400 }) });
  assert.equal((await f.send({ billingDeliveryKey: key })).status, 500);
});

test('malformed normal receipts fail closed without fabricating message IDs', async () => {
  for (const body of [null, { messageId: null }, { messageId: 1 }, { messageId: '' }, { messageId: '   ' }, { messageIds: ['batch-id'] }]) {
    const f = fixture({ provider: async () => Response.json(body, { status: 201 }) });
    assert.equal((await f.send({ billingDeliveryKey: key })).status, 500);
    assert.equal(f.timers.size, 0);
  }
});

for (const phase of ['fetch', 'body']) test(`30-second provider deadline bounds a hung ${phase} and ignores late completion`, { timeout: 1000 }, async () => {
  let finish; const held = new Promise(resolve => { finish = resolve; });
  const f = fixture({ shortDeadline: true, provider: async () => phase === 'fetch' ? held : { ok: true, json: () => held } });
  const result = await f.send({ billingDeliveryKey: key });
  assert.equal(result.status, 500); assert.match(result.body.error, /delivery is unknown/);
  assert.equal(f.requests[0].init.signal.aborted, true); assert.equal(f.timers.size, 0);
  finish(phase === 'fetch' ? Response.json({ messageId: '<late>' }) : { messageId: '<late>' });
  await new Promise(setImmediate);
  assert.equal(f.requests.length, 1, 'late completion starts no retry or follow-up send');
});

test('an exact retry reuses the same provider key and acknowledges its explicit duplicate response', async () => {
  let calls = 0;
  const f = fixture({ provider: async () => ++calls === 1 ? Response.json({ messageId: '<accepted>' }, { status: 201 })
    : Response.json({ code: 'duplicate_parameter', message: 'Email for the idempotency key has already been processed' }, { status: 400 }) });
  assert.equal((await f.send({ billingDeliveryKey: key })).body.id, '<accepted>');
  assert.equal((await f.send({ billingDeliveryKey: key })).body.id, `duplicate:${key}`);
  assert.deepEqual(f.requests[0].payload, f.requests[1].payload);
});

test('billing templates do not invent plan prices, paid access, payment retries or current subscription status', async () => {
  for (const template of templates) {
    const f = fixture();
    assert.equal((await f.send({ template, billingDeliveryKey: key, data: {
      portalUrl: 'https://surveytool.app', endDate: 'October 1, 2026', trialEndDate: 'October 1, 2026',
      daysLeft: 3, amount: '12.34', periodEnd: 'September 30, 2026',
    } })).status, 200);
    const html = f.requests[0].payload.htmlContent;
    assert.doesNotMatch(html, /\$9\.99|Pro subscription|Pro plan|Pro trial|Survey Pro|no further charges|you already paid|as requested|retry the payment in a few days|currently <strong>past due|subscription is active|subscription is currently active/i, template);
    assert.match(html, /surveytool\.app/);
    if (template === 'payment-succeeded') {
      assert.match(html, /Invoice period end/); assert.match(html, /September 30, 2026/); assert.match(html, /\$12\.34/);
      assert.doesNotMatch(html, /Next billing date/);
    }
    if (template === 'subscription-cancel-scheduled') assert.match(html, /archive/i);
  }
});

test('a billing key requires a valid service-only ISO dispatch deadline', async () => {
  for (const billingSendBefore of [undefined, null, 42, '', 'tomorrow', '2026-09-08']) {
    const f = fixture();
    assert.equal((await f.send({ billingDeliveryKey: key, billingSendBefore })).status, 400);
    assert.equal(f.requests.length, 0);
  }
  const f = fixture();
  assert.equal((await f.send({ billingSendBefore: new Date(Date.now() + 120_000).toISOString() })).status, 400);
  assert.equal(f.requests.length, 0);
  const user = fixture({ user: true });
  assert.equal((await user.send({ billingSendBefore: new Date(Date.now() + 120_000).toISOString() })).status, 403);
  assert.equal(user.requests.length, 0);
});

test('expired claims and claims without the full provider timeout budget return503 without a provider POST', async () => {
  for (const offset of [-60_000, 0, 29_000]) {
    const f = fixture();
    const response = await f.send({ billingDeliveryKey: key, billingSendBefore: new Date(Date.now() + offset).toISOString() });
    assert.equal(response.status, 503); assert.equal(f.requests.length, 0); assert.equal(f.timers.size, 0);
  }
});

test('PostgreSQL UTC-offset deadlines with microseconds allow dispatch without entering the provider payload', async () => {
  const f = fixture();
  const billingSendBefore = new Date(Date.now() + 120_000).toISOString().replace('Z', '000+00:00');
  assert.equal((await f.send({ billingDeliveryKey: key, billingSendBefore })).status, 200);
  assert.equal(f.requests[0].payload.billingSendBefore, undefined);
  assert.equal(f.requests[0].payload.headers.idempotencyKey, key);
});

test('all five billing emails show escaped record time without claiming their queued content is current', async () => {
  for (const template of templates) {
    const f = fixture();
    assert.equal((await f.send({ template, billingDeliveryKey: key, data: {
      recordedAt: 'September 8, 2026 14:00 UTC <img src=x onerror=alert(1)>',
      portalUrl: 'https://surveytool.app', endDate: 'October 1, 2026', trialEndDate: 'October 1, 2026', daysLeft: 3,
    } })).status, 200);
    const html = f.requests[0].payload.htmlContent;
    assert.match(html, /Billing record from September 8, 2026 14:00 UTC &lt;img src=x onerror=alert\(1\)&gt;\. Your current plan and payment status are in Survey\./, template);
    assert.doesNotMatch(html, /<img src=x/, template);
    if (template === 'subscription-cancel-scheduled') assert.match(html, /was scheduled to end/);
    if (template === 'trial-ending') assert.match(html, /was due to end/);
    if (template === 'subscription-canceled') assert.match(html, /moved to the Free plan at the time of this record/);
  }
  const legacy = fixture(); assert.equal((await legacy.send({ template: 'trial-ending' })).status, 200);
  assert.doesNotMatch(legacy.requests[0].payload.htmlContent, /Billing record from/);
  assert.match(legacy.requests[0].payload.htmlContent, /Your trial will end/);
});
