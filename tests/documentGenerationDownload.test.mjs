import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentGenerationDownload } from '../src/services/documentGenerationDownload.js';

const id = n => `99100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), doc = id(2), generation = id(3);
const bytes = new TextEncoder().encode('%PDF-owned');
const pdf = { bucket_id: 'documents', path: `${actor}/_generations/a.pdf`, id: id(4), version: id(5),
  byte_length: String(bytes.length), content_sha256: 'a'.repeat(64) };
const scope = { actorUserId: actor, documentId: doc, pdfGenerationId: generation };
const pending = () => { let resolve; return { promise: new Promise(r => { resolve = r; }), resolve: v => resolve(v) }; };
function harness(options = {}) {
  let currentActor = actor;
  const calls = [], signals = [], h = { calls, signals, setActor: a => { currentActor = a; },
    token: () => 'owned-token', fetch: () => new Response(bytes, { headers: { 'Content-Type': 'application/pdf' } }) };
  h.get = createDocumentGenerationDownload({ supabaseUrl: 'https://owned.example.test', publicKey: 'owned-public',
    getActorUserId: () => currentActor, getAccessToken: async (a, s) => { calls.push(['token', a]); signals.push(s); return h.token(); },
    fetch: async (url, init) => { calls.push(['fetch', url, init]); signals.push(init.signal); return h.fetch(url, init); }, ...options });
  return h;
}
test('adapter posts the exact tuple only to configured endpoint and returns the complete Blob', async () => {
  const h = harness(), blob = await h.get(pdf, scope);
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
  const [, url, init] = h.calls[1];
  assert.equal(url, 'https://owned.example.test/functions/v1/document-generation-download');
  assert.deepEqual(JSON.parse(init.body), { document_id: doc, generation_id: generation, pdf });
  assert.equal(init.headers.Authorization, 'Bearer owned-token'); assert.equal(init.headers.apikey, 'owned-public');
  assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit'); assert.equal(init.cache, 'no-store');
  assert.ok(h.signals.every(s => s.aborted));
});

test('origin configuration rejects credentials, paths, query strings and insecure non-loopback URLs', () => {
  for (const supabaseUrl of ['https://u:p@example.test', 'https://example.test/x', 'https://example.test/?token=x',
    'https://example.test/#x', 'http://example.test', 'http://127.0.0.1:9000', 'file:///x']) {
    assert.throws(() => harness({ supabaseUrl }), { code: 'DOCUMENT_DOWNLOAD_INPUT' });
  }
  assert.doesNotThrow(() => harness({ supabaseUrl: 'http://127.0.0.1:9000', allowLoopback: true }));
  assert.throws(() => harness({ supabaseUrl: 'http://example.test', allowLoopback: true }), { code: 'DOCUMENT_DOWNLOAD_INPUT' });
});

test('invalid tuple, declared size and actor mismatch never request a token or bytes', async () => {
  for (const value of [{ ...pdf, path: '' }, { ...pdf, arbitrary_url: 'https://evil.test' }, { ...pdf, byte_length: 9 },
    { ...pdf, version: null }, { ...pdf, byte_length: '9999999999999999999' }]) {
    const h = harness(); await assert.rejects(h.get(value, scope), { code: 'DOCUMENT_DOWNLOAD_INPUT' }); assert.equal(h.calls.length, 0);
  }
  const h = harness({ maxBytes: 2 }); await assert.rejects(h.get(pdf, scope), { code: 'DOCUMENT_DOWNLOAD_LIMIT' }); assert.equal(h.calls.length, 0);
  const wrong = harness(); wrong.setActor(id(91));
  await assert.rejects(wrong.get(pdf, scope), { code: 'DOCUMENT_DOWNLOAD_ACTOR_CHANGED' }); assert.equal(wrong.calls.length, 0);
});

test('account change during token read prevents a request using the old token', async () => {
  const h = harness(), gate = pending(), entered = pending();
  h.token = () => { entered.resolve(); return gate.promise; };
  const result = h.get(pdf, scope); await entered.promise; h.setActor(id(91)); gate.resolve('old-token');
  await assert.rejects(result, { code: 'DOCUMENT_DOWNLOAD_ACTOR_CHANGED' }); assert.equal(h.calls.length, 1);
});

test('200 does not mean complete: short, excess and failed bodies never return a Blob', async () => {
  const responses = [() => new Response(bytes.slice(1), { headers: { 'Content-Type': 'application/pdf' } }),
    () => new Response(new Uint8Array(bytes.length + 1), { headers: { 'Content-Type': 'application/pdf' } }),
    () => new Response(new ReadableStream({ start(c) { c.enqueue(bytes); c.error(new Error('private-provider-token')); } }), { headers: { 'Content-Type': 'application/pdf' } })];
  for (const response of responses) {
    const h = harness(); h.fetch = response;
    await assert.rejects(h.get(pdf, scope), e => /^DOCUMENT_DOWNLOAD_/.test(e.code) && !e.message.includes('private-provider'));
  }
});

test('last byte and EOF are required even after every earlier chunk arrived', async () => {
  const h = harness(); let writer;
  h.fetch = () => new Response(new ReadableStream({ start(c) { writer = c; c.enqueue(bytes.slice(0, -1)); } }), { headers: { 'Content-Type': 'application/pdf' } });
  let settled = false; const result = h.get(pdf, scope).finally(() => { settled = true; });
  await new Promise(r => setTimeout(r, 5)); assert.equal(settled, false);
  writer.enqueue(bytes.slice(-1)); await new Promise(r => setTimeout(r, 5)); assert.equal(settled, false);
  writer.close(); assert.equal((await result).size, bytes.length);
});

test('wrong MIME or Content-Length fails before trusting body data', async () => {
  for (const headers of [{ 'Content-Type': 'application/json' }, { 'Content-Type': 'application/pdf', 'Content-Length': '1' }]) {
    const h = harness(); h.fetch = () => new Response(bytes, { headers }); await assert.rejects(h.get(pdf, scope));
  }
});

test('HTTP diagnostics stay private; known permission code is preserved', async () => {
  const h = harness(); h.fetch = () => new Response(JSON.stringify({ error: { code: '42501', message: 'secret SQL path' } }), { status: 403 });
  await assert.rejects(h.get(pdf, scope), e => e.code === '42501' && !e.message.includes('secret'));
  h.fetch = () => new Response('x'.repeat(8193), { status: 502 }); await assert.rejects(h.get(pdf, scope), { code: 'DOCUMENT_DOWNLOAD_PROTOCOL' });
});

test('caller cancellation closes an in-flight body that ignores the passed signal', async () => {
  const h = harness(), entered = pending(), a = new AbortController(); let canceled = false;
  h.fetch = () => new Response(new ReadableStream({ start() { entered.resolve(); }, cancel() { canceled = true; } }), { headers: { 'Content-Type': 'application/pdf' } });
  const result = h.get(pdf, { ...scope, signal: a.signal }); await entered.promise;
  await new Promise(r => setTimeout(r, 1)); a.abort();
  await assert.rejects(result, { code: 'DOCUMENT_DOWNLOAD_ABORTED' }); assert.equal(canceled, true);
});

test('late fetch responses after deadline are canceled rather than leaked', async () => {
  const h = harness({ timeoutMs: 20 }), gate = pending(); let canceled = false;
  h.fetch = () => gate.promise;
  const result = h.get(pdf, scope); await assert.rejects(result, { code: 'DOCUMENT_DOWNLOAD_ABORTED' });
  gate.resolve(new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'Content-Type': 'application/pdf' } }));
  await new Promise(r => setTimeout(r, 1)); assert.equal(canceled, true);
});

test('actor change during body read cancels bytes without returning them', async () => {
  const h = harness(), entered = pending(); let writer, canceled = false;
  h.fetch = () => new Response(new ReadableStream({ start(c) { writer = c; entered.resolve(); }, cancel() { canceled = true; } }), { headers: { 'Content-Type': 'application/pdf' } });
  const result = h.get(pdf, scope); await entered.promise; h.setActor(id(91)); writer.enqueue(bytes);
  await assert.rejects(result, { code: 'DOCUMENT_DOWNLOAD_ACTOR_CHANGED' }); assert.equal(canceled, true);
});

test('received chunks are immutable snapshots even if the transport reuses a backing view', async () => {
  const h = harness(), view = bytes.slice(); let sent = false;
  h.fetch = () => new Response(new ReadableStream({ pull(c) {
    if (!sent) { sent = true; c.enqueue(view); } else { view.fill(0); c.close(); }
  } }, { highWaterMark: 0 }), { headers: { 'Content-Type': 'application/pdf' } });
  const blob = await h.get(pdf, scope); assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes);
});

test('empty and tiny chunks do not amplify retained Blob allocations', async () => {
  const original = globalThis.Blob; let blobs = 0;
  globalThis.Blob = class extends original { constructor(...args) { super(...args); blobs++; } };
  try {
    const h = harness(); let index = 0;
    h.fetch = () => new Response(new ReadableStream({ pull(c) {
      if (index < 20000) { index++; c.enqueue(new Uint8Array()); }
      else if (index < 20000 + bytes.length) { c.enqueue(bytes.slice(index - 20000, ++index - 20000)); }
      else c.close();
    } }), { headers: { 'Content-Type': 'application/pdf' } });
    const blob = await h.get(pdf, scope);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), bytes); assert.equal(blobs, 2);
    blobs = 0; const error = new TextEncoder().encode('{"error":{"code":"42501"}}'); index = 0;
    h.fetch = () => new Response(new ReadableStream({ pull(c) {
      if (index < 20000) { index++; c.enqueue(new Uint8Array()); }
      else if (index < 20000 + error.length) { c.enqueue(error.slice(index - 20000, ++index - 20000)); }
      else c.close();
    } }), { status: 403 });
    await assert.rejects(h.get(pdf, scope), { code: '42501' }); assert.equal(blobs, 0);
  } finally { globalThis.Blob = original; }
});

test('final synchronous Blob work cannot bypass the deadline', async () => {
  const original = globalThis.Blob;
  globalThis.Blob = class extends original { constructor(...args) {
    super(...args);
    if (args[1]?.type === 'application/pdf') {
      const until = performance.now() + 40; while (performance.now() < until) { /* synchronous copy */ }
    }
  } };
  try {
    const h = harness({ timeoutMs: 30 });
    await assert.rejects(h.get(pdf, scope), { code: 'DOCUMENT_DOWNLOAD_ABORTED' });
  } finally { globalThis.Blob = original; }
});

test('one-byte chunks across a block boundary retain exact bytes with bounded Blob count', async () => {
  const original = globalThis.Blob; let blobs = 0;
  globalThis.Blob = class extends original { constructor(...args) { super(...args); blobs++; } };
  try {
    const payload = Uint8Array.from({ length: 65537 }, (_, i) => i % 251), h = harness(); let index = 0;
    h.fetch = () => new Response(new ReadableStream({ pull(c) {
      if (index < payload.length) c.enqueue(payload.subarray(index, ++index)); else c.close();
    } }), { headers: { 'Content-Type': 'application/pdf' } });
    const blob = await h.get({ ...pdf, byte_length: String(payload.length) }, scope);
    assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), payload); assert.equal(blobs, 3);
  } finally { globalThis.Blob = original; }
});
