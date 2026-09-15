import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import test from 'node:test';
import { documentReplacementVitePlugin } from '../scripts/documentReplacementVitePlugin.mjs';

const enabledEnvironment = {
  SURVEY_DOCUMENT_REPLACEMENT: 'v5-definition-bound',
  SURVEY_GENERATION_SOURCE_CAPTURE: 'v1-metadata-only',
  SURVEY_GENERATION_SOURCE_ARCHIVES: 'v1-complete-source',
  SURVEY_GENERATION_STORAGE_CONTRACT: 'versioned-standard-v1',
  SUPABASE_URL: 'https://db.invalid', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
};

async function route(plugin) {
  let middleware;
  plugin.configureServer({ middlewares: { use(path, handler) {
    assert.equal(path, '/api/document-replacement'); middleware = handler;
  } } });
  assert.equal(typeof middleware, 'function');
  const server = http.createServer((request, response) => {
    request.url = request.url.slice('/api/document-replacement'.length) || '/';
    middleware(request, response);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}/api/document-replacement`, async close() {
    await new Promise(resolve => server.close(resolve));
  } };
}

test('Vite replacement route stays disabled without parsing or authenticating a body', async () => {
  let apiCalls = 0;
  const app = await route(documentReplacementVitePlugin({ environment: {}, createApiHandler: () => {
    apiCalls++; return async (_request, response) => {
      response.statusCode = 503; response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: { code: 'unavailable' } }));
    };
  } }));
  try {
    const result = await fetch(app.url, { method: 'POST', headers: { Authorization: 'Bearer should-not-be-used' },
      body: 'x'.repeat(17 * 1024) });
    assert.equal(result.status, 503); assert.equal((await result.json()).error.code, 'unavailable');
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal(apiCalls, 0);
  } finally { await app.close(); }
});

test('Vite replacement route handles methods, bounded raw JSON, aborts, and the real API factory seam', async () => {
  const calls = [];
  const runtime = { async handle(input) {
    calls.push(input); return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } };
  const app = await route(documentReplacementVitePlugin({ environment: enabledEnvironment,
    createServer(options) { calls.push({ server: options }); return runtime; }, bodyTimeoutMs: 25 }));
  try {
    assert.equal((await fetch(app.url, { method: 'GET' })).status, 405);
    assert.equal((await fetch(`${app.url}/unexpected`, { method: 'POST' })).status, 404);
    const unsupported = await fetch(app.url, { method: 'POST', body: JSON.stringify({ exact: true }) });
    assert.equal(unsupported.status, 415);
    const oversize = await fetch(app.url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(17 * 1024) });
    assert.equal(oversize.status, 413); assert.equal((await oversize.json()).error.code, 'payload_too_large');
    const result = await fetch(app.url, { method: 'POST', headers: { Authorization: 'Bearer caller-token',
      'Content-Type': 'application/json' }, body: JSON.stringify({ exact: true }) });
    assert.equal(result.status, 200); assert.deepEqual(await result.json(), { ok: true });
    assert.equal(calls[0].server.enabled, true);
    assert.deepEqual(calls[1].body, { exact: true });
    assert.equal(calls[1].authorization, 'Bearer caller-token');
    const chunked = await new Promise((resolve, reject) => {
      const request = http.request(app.url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, resolve);
      request.on('error', reject); request.end('x'.repeat(17 * 1024));
    });
    assert.equal(chunked.statusCode, 413); chunked.resume();
    await new Promise(resolve => {
      const request = http.request(app.url, { method: 'POST', headers: { 'Content-Type': 'application/json' } });
      request.on('error', resolve); request.write('{"partial":');
      setTimeout(() => request.destroy(), 5);
    });
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(calls.length, 2, 'an aborted raw request never reaches the real API runtime');
    const incomplete = await new Promise((resolve, reject) => {
      const request = http.request(app.url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, resolve);
      request.on('error', reject); request.write('{"partial":');
    });
    assert.equal(incomplete.statusCode, 408); incomplete.resume();
    const malformedLength = await new Promise((resolve, reject) => {
      const { port } = new URL(app.url);
      const socket = net.connect(Number(port), '127.0.0.1'); let raw = '';
      socket.on('connect', () => socket.end('POST /api/document-replacement HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: nope\r\n\r\n'));
      socket.on('data', value => { raw += value; }); socket.on('end', () => resolve(raw)); socket.on('error', reject);
    });
    assert.match(malformedLength, /^HTTP\/1\.1 400 /, 'Node rejects malformed Content-Length before middleware parsing');
  } finally { await app.close(); }
});
