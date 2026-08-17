import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { default: handler, redactAnalyticsString } = await import('../api/analytics/track.mjs');
const migration = readFileSync(new URL('../supabase/migrations/20260811130000_analytics_ingestion_daily_cap.sql', import.meta.url), 'utf8');
const USER_ID = '11111111-1111-4111-8111-111111111111';
const TOKEN = 'eyJheader.payload.signature';

const invoke = async ({
  method = 'POST',
  origin = 'https://surveytool.app',
  body = { event: 'survey_test' },
  ip = '127.0.0.1',
  token = TOKEN,
  contentLength,
} = {}) => {
  const result = { statusCode: null, body: null, headers: {} };
  const headers = {
    origin,
    authorization: token ? `Bearer ${token}` : '',
    'content-length': String(contentLength ?? Buffer.byteLength(JSON.stringify(body))),
    'x-forwarded-for': ip,
  };
  if (!origin) delete headers.origin;
  const request = { method, headers, body, socket: {} };
  const response = {
    setHeader(key, value) { result.headers[key] = value; },
    status(code) { result.statusCode = code; return this; },
    json(value) { result.body = value; return this; },
    end() { return this; },
  };
  await handler(request, response);
  return result;
};

const response = (ok, body, status = ok ? 200 : 401) => ({
  ok,
  status,
  async json() { return body; },
});

const withConfiguredProxy = async (fetchImplementation, run) => {
  const previous = {
    fetch: globalThis.fetch,
    publicKey: process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY,
    url: process.env.SUPABASE_URL,
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = 'anpk_server_only_test';
  process.env.SUPABASE_URL = 'https://survey-project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-secret';
  globalThis.fetch = fetchImplementation;
  try { return await run(); } finally {
    globalThis.fetch = previous.fetch;
    for (const [key, value] of [
      ['AGENT_NATIVE_ANALYTICS_PUBLIC_KEY', previous.publicKey],
      ['SUPABASE_URL', previous.url],
      ['SUPABASE_SERVICE_ROLE_KEY', previous.serviceKey],
    ]) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
};

const acceptingFetch = async (url) => {
  if (String(url).endsWith('/auth/v1/user')) return response(true, { id: USER_ID });
  if (String(url).includes('/rpc/reserve_analytics_ingestion_slot')) return response(true, true);
  return response(true, {});
};

test('analytics proxy rejects arbitrary and null browser origins before authorization', async () => {
  assert.equal((await invoke({ origin: 'https://attacker.invalid' })).statusCode, 403);
  assert.equal((await invoke({ origin: 'https://attacker.other-tailnet.ts.net' })).statusCode, 403);
  assert.equal((await invoke({ origin: 'null' })).statusCode, 403);
  assert.equal((await invoke({ origin: 'https://isaiahs-macbook-pro.taila0b324.ts.net.attacker.invalid' })).statusCode, 403);
  assert.equal((await invoke({ origin: 'capacitor://attacker.invalid' })).statusCode, 403);
});

test('analytics proxy permits trusted browser preflight with Authorization but no collector key', async () => {
  for (const origin of [
    'https://surveytool.app',
    'https://www.surveytool.app',
    'http://localhost:5177',
    'http://127.0.0.1:5173',
    'capacitor://localhost',
    'https://isaiahs-macbook-pro.taila0b324.ts.net',
  ]) {
    const result = await invoke({ method: 'OPTIONS', origin, token: '' });
    assert.equal(result.statusCode, 204);
    assert.equal(result.headers['Access-Control-Allow-Origin'], origin);
    assert.match(result.headers['Access-Control-Allow-Headers'], /Authorization/);
    assert.doesNotMatch(JSON.stringify(result), /AGENT_NATIVE_ANALYTICS_PUBLIC_KEY|anpk_/);
  }
});

test('spoofed Origin cannot ingest without a valid authenticated session', async () => {
  await withConfiguredProxy(async (url) => {
    if (String(url).endsWith('/auth/v1/user')) return response(false, {});
    throw new Error('quota or collector must not be called');
  }, async () => {
    assert.equal((await invoke({ token: '' })).statusCode, 401);
    assert.equal((await invoke({ token: 'forged-token' })).statusCode, 401);
    assert.equal((await invoke({ token: TOKEN })).statusCode, 401);
  });
});

test('authenticated Electron main-process requests need no Origin and null remains rejected', async () => {
  await withConfiguredProxy(acceptingFetch, async () => {
    assert.equal((await invoke({ origin: '' })).statusCode, 202);
    assert.equal((await invoke({ origin: 'null' })).statusCode, 403);
  });
});

test('analytics proxy enforces the defense-in-depth 60 events/minute/IP ceiling', async () => {
  await withConfiguredProxy(acceptingFetch, async () => {
    const ip = '198.51.100.77';
    for (let index = 0; index < 60; index += 1) {
      assert.equal((await invoke({ ip, body: { event: `survey_test_${index}` } })).statusCode, 202);
    }
    assert.equal((await invoke({ ip, body: { event: 'survey_test_over_limit' } })).statusCode, 429);
  });
});

test('analytics proxy fails closed when server configuration is absent', async () => {
  const previous = process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  delete process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  try {
    assert.equal((await invoke({ ip: '192.0.2.44' })).statusCode, 503);
  } finally {
    if (previous == null) delete process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
    else process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = previous;
  }
});

test('analytics proxy measures actual serialized bytes despite a forged Content-Length', async () => {
  const result = await invoke({
    ip: '192.0.2.47',
    contentLength: 1,
    body: { event: 'survey_test', properties: { message: 'x'.repeat(33 * 1024) } },
  });
  assert.equal(result.statusCode, 413);
});

test('atomic global quota denial never reaches the hosted collector', async () => {
  let collectorCalls = 0;
  await withConfiguredProxy(async (url) => {
    if (String(url).endsWith('/auth/v1/user')) return response(true, { id: USER_ID });
    if (String(url).includes('/rpc/reserve_analytics_ingestion_slot')) return response(true, false);
    collectorCalls += 1;
    return response(true, {});
  }, async () => {
    assert.equal((await invoke({ ip: '192.0.2.45' })).statusCode, 429);
    assert.equal(collectorCalls, 0);
  });
});

test('global/day counter is serialized and capped in Postgres, not Vercel memory', () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /global_count >= 10000/);
  assert.match(migration, /user_count >= 500/);
  assert.match(migration, /primary key \(usage_date, scope_key\)/);
  assert.match(
    migration,
    /delete from public\.analytics_ingestion_daily_counters[\s\S]*usage_date < current_day - 7/,
  );
  assert.match(migration, /revoke all[\s\S]*from public, anon, authenticated/i);
});

test('concurrent requests each reserve through the shared database boundary', async () => {
  let reservations = 0;
  let collectorCalls = 0;
  await withConfiguredProxy(async (url) => {
    if (String(url).endsWith('/auth/v1/user')) return response(true, { id: USER_ID });
    if (String(url).includes('/rpc/reserve_analytics_ingestion_slot')) {
      reservations += 1;
      await Promise.resolve();
      return response(true, true);
    }
    collectorCalls += 1;
    return response(true, {});
  }, async () => {
    const results = await Promise.all(Array.from({ length: 12 }, (_, index) => invoke({
      ip: `203.0.113.${index + 1}`,
      body: { event: `concurrent_${index}` },
    })));
    assert.deepEqual(new Set(results.map(({ statusCode }) => statusCode)), new Set([202]));
    assert.equal(reservations, 12);
    assert.equal(collectorCalls, 12);
  });
});

test('collector response and forwarded payload do not leak server or user secrets', async () => {
  let forwardedBody = null;
  let forwardedHeaders = null;
  await withConfiguredProxy(async (url, options = {}) => {
    if (String(url).endsWith('/auth/v1/user')) return response(true, { id: USER_ID });
    if (String(url).includes('/rpc/reserve_analytics_ingestion_slot')) return response(true, true);
    forwardedBody = JSON.parse(options.body);
    forwardedHeaders = options.headers;
    return response(true, {});
  }, async () => {
    const accepted = await invoke({
      ip: '192.0.2.46',
      body: {
        event: 'survey_test',
        properties: { email: 'private@example.com', message: 'failed https://private.example/customer.pdf' },
      },
    });
    assert.deepEqual(accepted.body, { accepted: true });
    assert.doesNotMatch(JSON.stringify(accepted), /anpk_|service-role|private@example/);
    assert.doesNotMatch(JSON.stringify(forwardedBody), /private@example\.com|private\.example|customer\.pdf|11111111/);
    assert.equal(forwardedHeaders.Authorization, undefined);
  });
});

test('analytics string redaction removes URLs, email addresses, and bearer/JWT-like secrets', () => {
  const input = 'Fetch https://example.test/a?token=secret for person@example.com Bearer abc.def.ghi eyJabcdefghijk.abcdefghijk.abcdefghijk';
  const output = redactAnalyticsString(input);
  assert.doesNotMatch(output, /example\.test|person@example|abc\.def\.ghi|eyJabcdefghijk/);
  assert.match(output, /\[URL\]|\[EMAIL\]|\[TOKEN\]/);
});
