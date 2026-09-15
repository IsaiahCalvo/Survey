import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentReplacementApiHandler } from '../api/document-replacement.mjs';

function responseHarness() {
  const headers = new Map();
  return { statusCode: 0, body: '', headers,
    setHeader(name, value) { headers.set(name.toLowerCase(), String(value)); },
    status(value) { this.statusCode = value; return this; },
    end(value = '') { this.body = String(value); return this; } };
}

test('disabled API route does not inspect body or construct the server', async () => {
  let reads = 0, setups = 0;
  const request = { method: 'POST', headers: {}, on() {}, off() {} };
  Object.defineProperty(request, 'body', { get() { reads++; throw new Error('body'); } });
  const route = createDocumentReplacementApiHandler({ environment: {},
    createServer() { setups++; throw new Error('server'); } });
  const output = responseHarness();
  await route(request, output);
  assert.equal(output.statusCode, 503);
  assert.equal(reads, 0); assert.equal(setups, 0);
  assert.equal(JSON.parse(output.body).error.code, 'unavailable');
});

test('enabled API route stays lazy, passes abort, and copies a bounded Web response', async () => {
  const calls = [];
  const runtime = { async handle(input) { calls.push(input); return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*' } }); }, async close() {} };
  const environment = { SURVEY_DOCUMENT_REPLACEMENT: 'v5-definition-bound',
    SURVEY_GENERATION_SOURCE_CAPTURE: 'v1-metadata-only',
    SURVEY_GENERATION_SOURCE_ARCHIVES: 'v1-complete-source',
    SURVEY_GENERATION_STORAGE_CONTRACT: 'versioned-standard-v1',
    SUPABASE_URL: 'https://db.invalid', SUPABASE_ANON_KEY: 'anon',
    SUPABASE_SERVICE_ROLE_KEY: 'service' };
  const route = createDocumentReplacementApiHandler({ environment,
    createServer(options) { calls.push(options); return runtime; } });
  const listeners = new Map();
  const request = { method: 'POST', headers: { authorization: 'Bearer token' }, body: { exact: true },
    on(name, fn) { listeners.set(name, fn); }, off(name) { listeners.delete(name); } };
  const output = responseHarness(); await route(request, output);
  assert.equal(output.statusCode, 200); assert.deepEqual(JSON.parse(output.body), { ok: true });
  assert.equal(calls[0].enabled, true);
  assert.deepEqual(calls[1].body, { exact: true });
  assert.ok(calls[1].signal instanceof AbortSignal);
  assert.equal(listeners.size, 0);
});

test('API preflight keeps intentional wildcard CORS without constructing the server', async () => {
  let setups = 0;
  const route = createDocumentReplacementApiHandler({ environment: {},
    createServer() { setups++; throw new Error('server'); } });
  const output = responseHarness();
  await route({ method: 'OPTIONS', headers: {}, on() {}, off() {} }, output);
  assert.equal(output.statusCode, 204); assert.equal(output.body, ''); assert.equal(setups, 0);
  assert.equal(output.headers.get('access-control-allow-origin'), '*');
});

test('API route refuses an oversized runtime response', async () => {
  const environment = { SURVEY_DOCUMENT_REPLACEMENT: 'v5-definition-bound',
    SURVEY_GENERATION_SOURCE_CAPTURE: 'v1-metadata-only',
    SURVEY_GENERATION_SOURCE_ARCHIVES: 'v1-complete-source',
    SURVEY_GENERATION_STORAGE_CONTRACT: 'versioned-standard-v1', SUPABASE_URL: 'https://db.invalid',
    SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service' };
  const route = createDocumentReplacementApiHandler({ environment, createServer: () => ({
    handle: async () => new Response('x'.repeat(17 * 1024), { status: 200 }), async close() {} }) });
  const output = responseHarness();
  await route({ method: 'POST', headers: {}, body: {}, on() {}, off() {} }, output);
  assert.equal(output.statusCode, 502);
  assert.equal(JSON.parse(output.body).error.code, 'invalid_receipt');
});
