import test from 'node:test';
import assert from 'node:assert/strict';

const { default: handler, redactAnalyticsString } = await import('../api/analytics/track.mjs');

const invoke = async ({ origin = 'https://surveytool.app', body = { event: 'survey_test' } } = {}) => {
  const result = { statusCode: null, body: null, headers: {} };
  const request = {
    method: 'POST',
    headers: { origin, 'content-length': String(Buffer.byteLength(JSON.stringify(body))), 'x-forwarded-for': '127.0.0.1' },
    body,
    socket: {},
  };
  const response = {
    setHeader(key, value) { result.headers[key] = value; },
    status(code) { result.statusCode = code; return this; },
    json(value) { result.body = value; return this; },
  };
  await handler(request, response);
  return result;
};

test('analytics proxy rejects arbitrary and missing origins before forwarding', async () => {
  assert.equal((await invoke({ origin: 'https://attacker.invalid' })).statusCode, 403);
  assert.equal((await invoke({ origin: '' })).statusCode, 403);
});

test('analytics proxy fails closed when server key is absent', async () => {
  const previous = process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  delete process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
  try {
    assert.equal((await invoke()).statusCode, 503);
  } finally {
    if (previous == null) delete process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY;
    else process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY = previous;
  }
});

test('analytics string redaction removes URLs, email addresses, and bearer/JWT-like secrets', () => {
  const input = 'Fetch https://example.test/a?token=secret for person@example.com Bearer abc.def.ghi eyJabcdefghijk.abcdefghijk.abcdefghijk';
  const output = redactAnalyticsString(input);
  assert.doesNotMatch(output, /example\.test|person@example|abc\.def\.ghi|eyJabcdefghijk/);
  assert.match(output, /\[URL\]|\[EMAIL\]|\[TOKEN\]/);
});
