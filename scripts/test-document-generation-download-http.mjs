// Actual cached Deno index + Supabase SDK; owned loopback provider only.
// This proves HTTP transport/EOF behavior, not deployed Storage versioning.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

assert.equal(process.argv.length, 2, 'No target or connection arguments accepted');
if (process.env.SURVEY_HTTP_INTEGRATION !== '1') {
  console.log('Skipped: set SURVEY_HTTP_INTEGRATION=1 for local Deno/SDK HTTP tests.');
  process.exit(0);
}
const directory = fileURLToPath(new URL('../supabase/functions/document-generation-download/', import.meta.url));
const index = new URL('../supabase/functions/document-generation-download/index.ts', import.meta.url).href;
const config = fileURLToPath(new URL('../supabase/functions/document-generation-download/deno.json', import.meta.url));
const id = n => `99000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), owner = id(2), documentId = id(3), generationId = id(4), operationId = id(5);
const token = 'fixture-download-viewer', anon = 'fixture-download-anon', service = 'fixture-download-service';
const pdfBytes = readFileSync(new URL('../debug/fixtures/clickable-link-test.pdf', import.meta.url));
assert.ok(pdfBytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pdf = () => ({ bucket_id: 'documents', path: `${owner}/_generations/${documentId}/${generationId}/${operationId}.pdf`,
  id: id(6), version: id(7), byte_length: String(pdfBytes.length), content_sha256: sha(pdfBytes) });
const open = () => ({ version: 1, actor_user_id: actor, document_id: documentId, generation_id: generationId,
  document: { id: documentId, user_id: owner, file_path: descriptor.path, file_size: descriptor.byte_length },
  publication: { operation_id: operationId, generation_id: generationId, published_at: '2026-09-09T12:00:00.000Z', wal_head: '12' },
  pdf: { ...descriptor }, annotations: { version: 2, document_id: documentId, generation_id: generationId,
    wal_head: '15', snapshot: null, snapshot_sha256: null } });
const rpcPath = '/rest/v1/rpc/read_document_generation_open';
const storagePrefix = '/storage/v1/object/documents/';
let descriptor = pdf(), mode = 'normal', calls = [], failures = [], rpcReads = 0;
const json = (response, body, status = 200) => {
  response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body));
};
const fake = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    let raw = ''; for await (const chunk of request) { raw += chunk; assert.ok(raw.length < 32768); }
    const body = raw ? JSON.parse(raw) : null, headers = request.headers;
    calls.push({ path: url.pathname, url: request.url, body, headers, method: request.method });
    if (url.pathname === '/redirect-target') { json(response, { forbidden: true }, 500); return; }
    if (url.pathname === '/auth/v1/user') {
      assert.equal(request.method, 'GET'); assert.equal(headers.apikey, anon);
      if (headers.authorization !== `Bearer ${token}`) {
        json(response, { code: 'bad_jwt', msg: `bad token ${service}` }, 401); return;
      }
      json(response, { id: actor, aud: 'authenticated', role: 'authenticated' }); return;
    }
    if (url.pathname === rpcPath) {
      assert.equal(request.method, 'POST'); assert.equal(headers.apikey, anon);
      assert.equal(headers.authorization, `Bearer ${token}`, 'RPC must never use the service key');
      assert.equal(body.p_document_id, documentId); assert.equal(body.p_include_snapshot, false);
      rpcReads++;
      if (body.p_generation_id !== generationId || mode === 'stale-generation') {
        json(response, { code: 'SG002', message: `private SQL ${service}` }, 400); return;
      }
      if (mode === 'denied' || (mode === 'revoke-final' && rpcReads === 2)) {
        json(response, { code: '42501', message: `private SQL ${service}`, details: token }, 403); return;
      }
      const result = open();
      if (mode === 'wrong-actor') result.actor_user_id = id(90);
      if (mode === 'changed-final' && rpcReads === 2) result.pdf.version = id(91);
      // Sensitive synthetic DB fields must never escape the PDF endpoint.
      result.private_field = service; result.document.private_field = service;
      json(response, result); return;
    }
    assert.equal(request.method, 'GET', 'No upload/copy/sign/delete request is allowed');
    assert.ok(url.pathname.startsWith(storagePrefix), `Unexpected provider route: ${url.pathname}`);
    assert.equal(headers.apikey, service); assert.equal(headers.authorization, `Bearer ${service}`);
    assert.equal(url.pathname.slice(storagePrefix.length), descriptor.path.split('/').map(encodeURIComponent).join('/'));
    assert.equal(decodeURIComponent(url.pathname.slice(storagePrefix.length)), descriptor.path);
    assert.equal(headers['cache-control'], 'no-cache');
    assert.deepEqual([...url.searchParams.keys()], ['cacheNonce']);
    assert.match(url.searchParams.get('cacheNonce'), /^[0-9a-f-]{36}$/);
    if (mode === 'redirect') {
      response.writeHead(302, { Location: `http://127.0.0.1:${fake.address().port}/redirect-target` }); response.end(); return;
    }
    if (mode === 'missing-object') { json(response, { error: `private ${service}` }, 404); return; }
    let bytes = pdfBytes;
    if (mode === 'wrong-hash') { bytes = Buffer.from(bytes); bytes[20] ^= 1; }
    if (mode === 'short-stream') bytes = bytes.subarray(0, bytes.length - 1);
    if (mode === 'extra-stream') bytes = Buffer.concat([bytes, Buffer.from('x')]);
    response.writeHead(200, { 'Content-Type': 'application/pdf', 'X-Fixture-Secret': service });
    // Small chunks exercise streaming; the endpoint must withhold its final byte.
    for (let offset = 0; offset < bytes.length; offset += 257) response.write(bytes.subarray(offset, offset + 257));
    response.end();
  } catch (error) {
    failures.push(error); if (!response.headersSent) json(response, { message: 'Fixture assertion failed' }, 500);
    else response.destroy();
  }
});
const children = new Set();
async function start(download, storage) {
  const origin = `http://127.0.0.1:${fake.address().port}`;
  const code = `
    const originalFetch=globalThis.fetch;
    globalThis.fetch=(input,init)=>{
      const target=new URL(input instanceof Request?input.url:String(input));
      if(target.origin!==${JSON.stringify(origin)})throw new Error('Non-local fixture fetch denied');
      return originalFetch(input,init);
    };
    const originalServe=Deno.serve;let server;
    Deno.serve=(handler)=>server=originalServe({hostname:'127.0.0.1',port:0,
      onListen:({port})=>console.log('FIXTURE_READY:'+port)},handler);
    Deno.addSignalListener('SIGTERM',async()=>{if(server)await server.shutdown();Deno.exit(0);});
    await import(${JSON.stringify(index)});
  `;
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, SUPABASE_URL: origin,
    SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service };
  if (download) env.SURVEY_GENERATION_DOWNLOAD = 'checked-stream-v1';
  if (storage) env.SURVEY_GENERATION_STORAGE_CONTRACT = 'versioned-standard-v1';
  const child = spawn('deno', ['eval', '--config', config, '--node-modules-dir=none', '--cached-only', '--no-lock', code],
    { cwd: directory, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { child, output: '', closed: false, spawnError: null }; children.add(state);
  state.closedPromise = new Promise(resolve => child.once('close', () => { state.closed = true; resolve(); }));
  child.on('error', error => { state.spawnError = error; });
  return await new Promise((resolve, reject) => {
    let finished = false;
    const finish = (error, port) => {
      if (finished) return; finished = true; clearTimeout(timer); child.stdout.off('data', inspect);
      error ? reject(error) : resolve({ url: `http://127.0.0.1:${port}`, state });
    };
    const inspect = () => { const match = state.output.match(/FIXTURE_READY:(\d+)/); if (match) finish(null, match[1]); };
    const timer = setTimeout(() => finish(new Error(`Deno fixture start timed out: ${state.output}`)), 15000);
    for (const pipe of [child.stdout, child.stderr]) pipe.on('data', chunk => { state.output = (state.output + chunk).slice(-32768); });
    child.stdout.on('data', inspect); child.once('error', error => finish(error));
    child.once('close', () => finish(new Error(`Deno fixture exited before ready: ${state.output}`)));
  });
}
async function stop(state) {
  if (!state.closed) {
    state.child.kill('SIGTERM'); const timer = setTimeout(() => state.child.kill('SIGKILL'), 2000);
    try { await state.closedPromise; } finally { clearTimeout(timer); }
  }
  children.delete(state); if (state.spawnError) throw state.spawnError;
}
async function request(server, { method = 'POST', authorization = `Bearer ${token}`, body = {} } = {}) {
  const response = await fetch(server.url, { method, headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: JSON.stringify({ document_id: documentId, generation_id: generationId, pdf: descriptor, ...body }) } : {}),
    signal: AbortSignal.timeout(10000) });
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  for (const [, value] of response.headers) for (const secret of [service, token, anon]) assert.ok(!value.includes(secret));
  assert.equal(response.headers.get('x-fixture-secret'), null);
  const chunks = []; let streamFailed = false;
  try { for await (const chunk of response.body) chunks.push(Buffer.from(chunk)); } catch { streamFailed = true; }
  assert.deepEqual(failures, []);
  return { status: response.status, headers: response.headers, bytes: Buffer.concat(chunks), streamFailed };
}
const routes = () => calls.map(call => call.path);
const downloads = () => calls.filter(call => call.path.startsWith(storagePrefix));
function reset(next = 'normal') { mode = next; calls = []; rpcReads = 0; descriptor = pdf(); }
function error(result, status) {
  assert.equal(result.status, status, result.bytes.toString()); assert.equal(result.streamFailed, false);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  for (const secret of [service, token, anon, 'private SQL']) assert.ok(!result.bytes.includes(Buffer.from(secret)));
  assert.ok(JSON.parse(result.bytes).error);
}
let cleanupPromise;
function cleanup() {
  return cleanupPromise ??= (async () => {
    const results = await Promise.allSettled([...children].map(stop));
    fake.closeAllConnections(); await new Promise(resolve => fake.close(resolve));
    assert.ok(results.every(result => result.status === 'fulfilled'), 'Deno cleanup failed');
    console.log('All local Deno children exited and fake HTTP server closed.');
  })();
}
const terminated = () => { void cleanup().then(() => process.exit(143), () => process.exit(1)); };
const interrupted = () => { void cleanup().then(() => process.exit(130), () => process.exit(1)); };
process.once('SIGTERM', terminated); process.once('SIGINT', interrupted);
let passed = 0;
try {
  await new Promise((resolve, reject) => { fake.once('error', reject); fake.listen(0, '127.0.0.1', resolve); });
  for (const flags of [[false, false], [true, false], [false, true]]) {
    reset(); const disabled = await start(...flags); error(await request(disabled), 503); assert.deepEqual(calls, []);
    await stop(disabled.state); passed++;
  }
  const enabled = await start(true, true);
  console.log(`LIVE_HANDLE endpoint=${enabled.url} provider=http://127.0.0.1:${fake.address().port}`);
  reset(); const options = await request(enabled, { method: 'OPTIONS' });
  assert.equal(options.status, 204); assert.deepEqual(calls, []); passed++;
  reset(); error(await request(enabled, { authorization: 'Bearer invalid-fixture' }), 401);
  assert.deepEqual(routes(), ['/auth/v1/user']); passed++;
  for (const [scenario, status] of [['denied', 403], ['stale-generation', 409], ['wrong-actor', 502]]) {
    reset(scenario); error(await request(enabled), status); assert.deepEqual(routes(), ['/auth/v1/user', rpcPath]); passed++;
  }
  reset(); error(await request(enabled, { body: { generation_id: id(99) } }), 409);
  assert.deepEqual(routes(), ['/auth/v1/user', rpcPath]); passed++;
  reset(); error(await request(enabled, { body: { pdf: { ...descriptor, content_sha256: '0'.repeat(64) } } }), 409);
  assert.equal(downloads().length, 0); passed++;
  for (const complex of [false, true]) {
    reset(); if (complex) descriptor.path = `${owner}/_generations/${documentId}/${generationId}/literal%2F space-雪?#.pdf`;
    const result = await request(enabled); assert.equal(result.status, 200); assert.equal(result.streamFailed, false);
    assert.deepEqual(result.bytes, pdfBytes); assert.equal(sha(result.bytes), descriptor.content_sha256);
    assert.equal(result.headers.get('content-type'), 'application/pdf');
    assert.equal(result.headers.get('cache-control'), 'private, no-store, no-transform');
    assert.equal(result.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(routes(), ['/auth/v1/user', rpcPath, downloads()[0].path, rpcPath]);
    assert.equal(rpcReads, 2); assert.equal(downloads().length, 1); passed++;
  }
  reset(); await request(enabled); const nonce = new URL(downloads()[0].url, 'http://127.0.0.1').searchParams.get('cacheNonce');
  reset(); await request(enabled); assert.notEqual(new URL(downloads()[0].url, 'http://127.0.0.1').searchParams.get('cacheNonce'), nonce); passed++;
  for (const scenario of ['revoke-final', 'changed-final', 'wrong-hash', 'short-stream', 'extra-stream']) {
    reset(scenario); const result = await request(enabled);
    assert.equal(result.status, 200); assert.equal(result.streamFailed, true, `${scenario}: EOF must fail`);
    assert.ok(result.bytes.length < pdfBytes.length, `${scenario}: full body must not escape`);
    assert.equal(downloads().length, 1);
    assert.equal(rpcReads, ['revoke-final', 'changed-final'].includes(scenario) ? 2 : 1); passed++;
  }
  reset('redirect'); error(await request(enabled), 502); assert.equal(downloads().length, 1);
  assert.ok(!routes().includes('/redirect-target')); assert.equal(rpcReads, 1); passed++;
  reset('missing-object'); error(await request(enabled), 502); assert.equal(downloads().length, 1); passed++;
  assert.deepEqual(failures, []); await stop(enabled.state);
  console.log(`Document generation download local HTTP checks passed: ${passed}`);
} finally {
  await cleanup(); process.off('SIGTERM', terminated); process.off('SIGINT', interrupted);
}
