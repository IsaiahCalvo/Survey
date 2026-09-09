import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { PDFDocument } from 'pdf-lib';
import { createLegacyDocumentDownload } from '../src/services/legacyDocumentDownload.js';

const id = n => `aa000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), documentId = id(2), scope = { actorUserId: actor, documentId };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const pdfDocument = await PDFDocument.create(); pdfDocument.addPage([612, 792]); const pdf = await pdfDocument.save();
const editedPdf = new Uint8Array([...pdf, 10, 20, 30]);
const descriptor = () => ({ path: `${id(99)}/old plan?#% 😀.pdf` });
const response = (bytes = pdf, headers = {}) => new Response(bytes, { headers: { 'Content-Type': 'application/pdf', ...headers } });
const code = expected => error => error.code === expected && !/secret|private\.example/.test(error.message);
function harness(config = {}) {
  const h = { calls: [], tokens: [], actor, onToken: null, onFetch: null };
  h.download = createLegacyDocumentDownload({ supabaseUrl: 'https://owned.example', publicKey: 'public-test-key',
    getActorUserId: () => h.actor,
    getAccessToken: (user, signal) => { h.tokens.push({ user, signal }); return h.onToken ? h.onToken() : 'bound-token'; },
    fetch: (url, options) => { h.calls.push({ url, options }); return h.onFetch ? h.onFetch(url, options) : response(); }, ...config });
  h.read = (d = descriptor(), s = scope) => h.download(d, s);
  return h;
}

test('GET pins exact actor token and safely encodes raw object path', async () => {
  const h = harness(), d = descriptor(), blob = await h.read(d);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), pdf); assert.equal(blob.type, 'application/pdf');
  const { url, options } = h.calls[0], parsed = new URL(url);
  assert.equal(parsed.origin, 'https://owned.example');
  assert.equal(decodeURIComponent(parsed.pathname.slice('/storage/v1/object/authenticated/documents/'.length)), d.path);
  assert.equal(parsed.hash, ''); assert.deepEqual([...parsed.searchParams.keys()], ['cacheNonce']);
  assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, 'Bearer bound-token');
  assert.equal(options.headers.apikey, 'public-test-key'); assert.equal(options.headers['Cache-Control'], 'no-cache');
  assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store');
  assert.equal(options.body, undefined); assert.ok(options.signal.aborted); assert.ok(h.tokens[0].signal.aborted);
  assert.equal(h.tokens[0].user, actor);
});

test('mutable edited legacy bytes need not match import metadata and generic Storage MIME remains compatible', async () => {
  const h = harness(); h.onFetch = () => response(editedPdf, { 'Content-Type': 'application/octet-stream' });
  const d = descriptor();
  assert.deepEqual(new Uint8Array(await (await h.read(d)).arrayBuffer()), editedPdf);
  const firstNonce = new URL(h.calls[0].url).searchParams.get('cacheNonce');
  await h.read(d); assert.equal(h.calls.length, 2);
  assert.notEqual(new URL(h.calls[1].url).searchParams.get('cacheNonce'), firstNonce);
});

test('untrusted origins and malformed bounds reject at construction', () => {
  for (const supabaseUrl of ['http://owned.example', 'https://u:p@owned.example', 'https://owned.example/a',
    'https://owned.example/a/..', 'https://owned.example?x=1', 'https://owned.example/#x', 'file:///tmp/a']) {
    assert.throws(() => harness({ supabaseUrl }), code('DOCUMENT_OPEN_INPUT'));
  }
  for (const config of [{ maxBytes: 0 }, { maxBytes: 1024 * 1024 * 1024 + 1 }, { timeoutMs: 120001 },
    { publicKey: 'bad\nkey' }, { fetch: null }]) assert.throws(() => harness(config), code('DOCUMENT_OPEN_INPUT'));
});

test('path normalization, stale receipt fields and invalid scopes fail before auth or bytes', async () => {
  const bad = [d => d.path = 'a/../b', d => d.path = 'a/./b', d => d.path = '\ud800', d => d.path = '',
    d => d.path = 'x'.repeat(2049), d => d.path = 'a\0b', d => d.byte_length = String(pdf.length),
    d => d.content_sha256 = 'a'.repeat(64),
    d => d.extra = 'secret'];
  for (const change of bad) {
    const h = harness(), d = descriptor(); change(d);
    await assert.rejects(h.read(d), code('DOCUMENT_OPEN_INPUT')); assert.equal(h.tokens.length + h.calls.length, 0);
  }
  const h = harness(); await assert.rejects(h.read(descriptor(), { ...scope, actorUserId: 'bad' }), code('DOCUMENT_OPEN_INPUT'));
  await assert.rejects(h.read(descriptor(), { ...scope, signal: {} }), code('DOCUMENT_OPEN_INPUT'));
  const small = harness({ maxBytes: 1 }); await assert.rejects(small.read(), code('DOCUMENT_OPEN_LIMIT'));
  assert.equal(small.calls.length, 1);
});

test('literal percent escapes and leading slashes retain exact raw-name identity', async () => {
  for (const path of ['a/%2e%2e/b.pdf', '//a/file.pdf', 'a/back\\slash.pdf', 'https://foreign.example/a.pdf']) {
    const h = harness(); await h.read({ ...descriptor(), path });
    const url = new URL(h.calls[0].url); assert.equal(url.origin, 'https://owned.example');
    assert.equal(decodeURIComponent(url.pathname.slice('/storage/v1/object/authenticated/documents/'.length)), path);
  }
});

test('empty, oversized, failed bodies and lying length never return a Blob', async () => {
  const empty = harness(); empty.onFetch = () => response(new Uint8Array());
  await assert.rejects(empty.read(), code('DOCUMENT_OPEN_BYTES'));
  const oversized = harness({ maxBytes: pdf.length - 1 }); oversized.onFetch = () => response(pdf);
  await assert.rejects(oversized.read(), code('DOCUMENT_OPEN_LIMIT'));
  for (const declared of [String(pdf.length - 1), String(pdf.length + 1)]) {
    const h = harness(); h.onFetch = () => response(pdf, { 'Content-Length': declared });
    await assert.rejects(h.read(), code('DOCUMENT_OPEN_BYTES'));
  }
  const h = harness(); h.onFetch = () => response(new ReadableStream({ start(controller) { controller.error(new Error('secret stream')); } }));
  await assert.rejects(h.read(), code('DOCUMENT_OPEN_PROTOCOL'));
});

test('status, redirect, MIME and declared-length failures cancel without reading diagnostics', async () => {
  for (const kind of ['status', 'redirect', 'mime', 'length']) {
    const h = harness(); let canceled = 0, pulls = 0;
    h.onFetch = () => {
      const stream = new ReadableStream({ pull() { pulls++; }, cancel() { canceled++; } }, { highWaterMark: 0 });
      const r = new Response(stream, { status: kind === 'status' ? 403 : 200,
        headers: { 'Content-Type': kind === 'mime' ? 'text/html' : 'application/pdf',
          ...(kind === 'length' ? { 'Content-Length': '0' } : {}) } });
      if (kind === 'redirect') Object.defineProperty(r, 'redirected', { value: true });
      return r;
    };
    await assert.rejects(h.read(), code(kind === 'length' ? 'DOCUMENT_OPEN_BYTES' : 'DOCUMENT_OPEN_PROTOCOL'));
    assert.equal(canceled, 1); assert.equal(pulls, 0);
  }
});

test('every byte and EOF are required; an earlier status200 cannot complete', async () => {
  const h = harness(), ready = deferred(); let streamController;
  h.onFetch = () => response(new ReadableStream({ start(controller) { streamController = controller; controller.enqueue(pdf.slice(0, -1)); ready.resolve(); } }));
  let done = false; const reading = h.read().then(value => { done = true; return value; }); await ready.promise;
  await new Promise(resolve => setImmediate(resolve)); assert.equal(done, false);
  streamController.enqueue(pdf.slice(-1)); await new Promise(resolve => setImmediate(resolve)); assert.equal(done, false);
  streamController.close(); assert.equal((await reading).size, pdf.length);
});

test('actor switches before/during token or body reading fail without leaking bytes', async () => {
  for (const stage of ['before', 'token', 'body']) {
    const h = harness();
    if (stage === 'before') h.actor = id(99);
    if (stage === 'token') h.onToken = () => { h.actor = id(99); return 'bound-token'; };
    if (stage === 'body') h.onFetch = () => response(new ReadableStream({ pull(controller) { h.actor = id(99); controller.enqueue(pdf); controller.close(); } }));
    await assert.rejects(h.read(), code('DOCUMENT_OPEN_ACTOR_CHANGED'));
    if (stage !== 'body') assert.equal(h.calls.length, 0);
  }
});

test('hung token and body obey deadline and detach caller listener', async () => {
  for (const stage of ['token', 'body']) {
    const controller = new AbortController(), signal = controller.signal; let listeners = 0, canceled = 0;
    const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (...args) => { listeners++; return add(...args); };
    signal.removeEventListener = (...args) => { listeners--; return remove(...args); };
    const h = harness({ timeoutMs: 25 });
    if (stage === 'token') h.onToken = () => new Promise(() => {});
    else h.onFetch = () => response(new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { canceled++; return new Promise(() => {}); } }));
    await assert.rejects(h.read(descriptor(), { ...scope, signal }), code('DOCUMENT_OPEN_ABORTED'));
    assert.equal(listeners, 0); if (stage === 'body') assert.equal(canceled, 1);
  }
});

test('caller abort settles immediately and cancels a late fetch response', async () => {
  const controller = new AbortController(), entered = deferred(), pending = deferred(), canceled = deferred(), h = harness();
  h.onFetch = () => { entered.resolve(); return pending.promise; };
  const reading = h.read(descriptor(), { ...scope, signal: controller.signal }); await entered.promise; controller.abort();
  await assert.rejects(reading, code('DOCUMENT_OPEN_ABORTED'));
  pending.resolve(response(new ReadableStream({ cancel() { canceled.resolve(); } })));
  await canceled.promise; assert.equal(h.calls[0].options.signal.aborted, true);
});

test('tiny/empty chunks and reused transport views retain exact independent bytes', async () => {
  const bytes = new Uint8Array(65538); for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
  const h = harness(); let offset = 0, empty = true; const backing = new Uint8Array(1);
  h.onFetch = () => response(new ReadableStream({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    if (empty) { empty = false; controller.enqueue(new Uint8Array()); return; }
    backing[0] = bytes[offset++]; empty = true; controller.enqueue(backing);
  } }, { highWaterMark: 0 }));
  const result = await h.read(descriptor());
  assert.deepEqual(new Uint8Array(await result.arrayBuffer()), bytes);
});
test('successful and timed-out reads detach the caller listener', async () => {
  const controller = new AbortController();
  const signal = controller.signal; let listeners = 0;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  signal.addEventListener = (...args) => { listeners++; return add(...args); };
  signal.removeEventListener = (...args) => { listeners--; return remove(...args); };
  const h = harness({ timeoutMs: 25 });
  await h.read(descriptor(), { ...scope, signal }); assert.equal(listeners, 0);
  h.onFetch = () => response(new ReadableStream({ pull() { return new Promise(() => {}); } }));
  await assert.rejects(h.read(descriptor(), { ...scope, signal }), code('DOCUMENT_OPEN_ABORTED'));
  assert.equal(listeners, 0);
});

test('owned loopback HTTP verifies exact Storage URL, JWT, redirect refusal and socket abort', { timeout: 5000 }, async () => {
  let mode = 'ok', redirected = 0; const requests = [], entered = deferred(), closed = deferred();
  const server = createServer((req, res) => {
    if (req.url === '/redirect-target') { redirected++; res.end(pdf); return; }
    requests.push({ url: req.url, token: req.headers.authorization, key: req.headers.apikey });
    if (mode === 'redirect') { res.writeHead(302, { Location: '/redirect-target' }); res.end(); return; }
    const body = mode === 'edited' ? editedPdf : pdf;
    res.writeHead(200, {
      'Content-Type': mode === 'non-pdf' ? 'text/plain' : 'application/pdf',
      'Content-Length': String(body.length),
    });
    if (mode === 'hang') { res.write(pdf.slice(0, 16)); res.on('close', () => closed.resolve()); entered.resolve(); return; }
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const h = harness({ supabaseUrl: `http://127.0.0.1:${server.address().port}`, allowLoopback: true, fetch: globalThis.fetch });
  try {
    const result = await h.read(); assert.deepEqual(new Uint8Array(await result.arrayBuffer()), pdf);
    assert.equal(requests[0].token, 'Bearer bound-token'); assert.equal(requests[0].key, 'public-test-key');
    const url = new URL(requests[0].url, 'http://localhost');
    assert.equal(decodeURIComponent(url.pathname.slice('/storage/v1/object/authenticated/documents/'.length)), descriptor().path);
    mode = 'edited'; assert.deepEqual(new Uint8Array(await (await h.read()).arrayBuffer()), editedPdf);
    const bounded = harness({ supabaseUrl: `http://127.0.0.1:${server.address().port}`, allowLoopback: true,
      fetch: globalThis.fetch, maxBytes: pdf.length });
    await assert.rejects(bounded.read(), code('DOCUMENT_OPEN_LIMIT'));
    mode = 'non-pdf'; await assert.rejects(h.read(), code('DOCUMENT_OPEN_PROTOCOL'));
    mode = 'redirect'; await assert.rejects(h.read(), code('DOCUMENT_OPEN_PROTOCOL')); assert.equal(redirected, 0);
    mode = 'hang'; const controller = new AbortController(), reading = h.read(descriptor(), { ...scope, signal: controller.signal });
    await entered.promise; controller.abort(); await assert.rejects(reading, code('DOCUMENT_OPEN_ABORTED')); await closed.promise;
  } finally { const closing = once(server, 'close'); server.close(); server.closeAllConnections(); await closing; }
});
