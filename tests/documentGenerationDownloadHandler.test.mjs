import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { handleDocumentGenerationDownload } from '../supabase/functions/document-generation-download/handler.js';

const actor = '11111111-1111-4111-8111-111111111111';
const documentId = '22222222-2222-4222-8222-222222222222';
const generationId = '33333333-3333-4333-8333-333333333333';
const objectId = '44444444-4444-4444-8444-444444444444';
const versionId = '55555555-5555-4555-8555-555555555555';
const operationId = '66666666-6666-4666-8666-666666666666';
const differentId = '77777777-7777-4777-8777-777777777777';
const bytes = new TextEncoder().encode('%PDF-v1');
const sha = value => createHash('sha256').update(value).digest('hex');
const pdf = value => ({ bucket_id: 'documents', path: `${actor}/_generations/a # %.pdf`, id: objectId,
  version: versionId, byte_length: String(value.length), content_sha256: sha(value) });
const open = value => ({ version: 1, actor_user_id: actor, document_id: documentId, generation_id: generationId,
  document: { id: documentId, file_path: value.path, file_size: value.byte_length }, pdf: value,
  publication: { operation_id: operationId, generation_id: generationId, published_at: '2026-09-09T12:00:00+00:00', wal_head: '0' },
  annotations: { wal_head: '0', snapshot: null } });
const body = value => ({ document_id: documentId, generation_id: generationId, pdf: value });
const request = (value = body(pdf(bytes)), init = {}) => new Request('https://download.invalid', {
  method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: JSON.stringify(value), ...init,
});
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const nextTurn = () => new Promise(resolve => setTimeout(resolve, 0));

function harness({ chunks = [bytes], manifest = open(pdf(bytes)), ...overrides } = {}) {
  const calls = { auth: [], opens: [], streams: [], reads: 0, cancels: 0, releases: 0 };
  let cursor = 0;
  const deps = {
    enabled: true,
    getUser: async (...args) => { calls.auth.push(args); return { id: actor }; },
    readOpen: async (...args) => { calls.opens.push(args); return structuredClone(manifest); },
    openStream: async (...args) => {
      calls.streams.push(args);
      return { getReader: () => ({
        async read() { calls.reads++; return cursor < chunks.length ? { value: chunks[cursor++], done: false } : { done: true }; },
        cancel() { calls.cancels++; return Promise.resolve(); },
        releaseLock() { calls.releases++; },
      }) };
    },
    ...overrides,
  };
  return { deps, calls, run: (req = request()) => handleDocumentGenerationDownload(req, deps) };
}

test('every chunk partition verifies real SHA-256 and returns exact bytes', async () => {
  for (let mask = 0; mask < (1 << (bytes.length - 1)); mask++) {
    const chunks = []; let start = 0;
    for (let i = 1; i < bytes.length; i++) {
      if (mask & (1 << (i - 1))) { chunks.push(bytes.slice(start, i)); start = i; }
    }
    chunks.push(bytes.slice(start));
    const h = harness({ chunks });
    const response = await h.run();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Length'), null);
    assert.equal(response.headers.get('Content-Type'), 'application/pdf');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store, no-transform');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
    assert.equal(h.calls.opens.length, 2);
    for (const args of h.calls.opens) assert.deepEqual(args.slice(0, 3), ['test-token', documentId, generationId]);
    assert.deepEqual(h.calls.streams[0][0], pdf(bytes));
    assert.equal(Object.isFrozen(h.calls.streams[0][0]), true);
    assert.equal(h.calls.cancels, 1); assert.equal(h.calls.releases, 1);
  }
});

test('one-byte PDF releases no byte before final confirmation; empty chunks are allowed', async () => {
  const value = Uint8Array.of(65), final = deferred(); let reads = 0;
  const h = harness({ chunks: [new Uint8Array(), value, new Uint8Array()],
    readOpen: async () => ++reads === 1 ? open(pdf(value)) : final.promise });
  const response = await h.run(request(body(pdf(value))));
  let settled = false;
  const read = response.body.getReader().read().then(result => { settled = true; return result; });
  await nextTurn(); assert.equal(reads, 2); assert.equal(settled, false);
  final.resolve(open(pdf(value)));
  assert.deepEqual((await read).value, value);
});

test('last byte stays withheld until final SQL finishes, with bounded pulls/backpressure', async () => {
  const final = deferred(); let opens = 0;
  const h = harness({ chunks: [bytes.slice(0, 3), bytes.slice(3)],
    readOpen: async () => ++opens === 1 ? open(pdf(bytes)) : final.promise });
  const response = await h.run();
  await nextTurn(); assert.equal(h.calls.reads, 0, 'no body consumer means no provider reads');
  const reader = response.body.getReader();
  const first = await reader.read(); assert.deepEqual(first.value, bytes.slice(0, 3));
  await nextTurn(); assert.equal(h.calls.reads, 1);
  const second = await reader.read(); assert.deepEqual(second.value, bytes.slice(3, -1));
  let settled = false;
  const last = reader.read().then(value => { settled = true; return value; });
  await nextTurn(); assert.equal(opens, 2); assert.equal(settled, false);
  final.resolve(open(pdf(bytes)));
  assert.deepEqual((await last).value, bytes.slice(-1));
  assert.equal((await reader.read()).done, true);
  assert.equal(h.calls.cancels, 1); assert.equal(h.calls.releases, 1);
});

test('zero, short, excess, wrong hash, wrong type, and provider errors never complete a body', async () => {
  const cases = [
    { chunks: [] }, { chunks: [bytes.slice(0, -1)] },
    { chunks: [bytes, Uint8Array.of(0)] }, { chunks: [new Uint8Array(bytes.length)] },
    { chunks: ['not bytes'] },
    { openStream: async () => new ReadableStream({ pull() { throw new Error('SECRET/provider/path'); } }) },
  ];
  for (const options of cases) {
    const h = harness(options), response = await h.run();
    assert.equal(response.status, 200);
    await assert.rejects(response.arrayBuffer(), error => error.message === 'Document download did not complete verification.');
    assert.equal(h.calls.opens.length, 1, 'bad bytes never authorize final confirmation');
  }
});

test('final revocation, generation/actor/PDF/publication changes fail the body closed', async () => {
  const changes = [
    () => { throw Object.assign(new Error('SECRET membership'), { code: '42501' }); },
    result => { result.generation_id = differentId; },
    result => { result.actor_user_id = differentId; },
    result => { result.document_id = differentId; },
    result => { result.pdf.version = differentId; },
    result => { result.pdf.content_sha256 = '0'.repeat(64); },
    result => { result.publication.operation_id = differentId; },
    result => { result.publication.wal_head = '1'; },
    result => { result.publication.published_at = '2026-09-09T13:00:00Z'; },
  ];
  for (const change of changes) {
    let reads = 0;
    const h = harness({ readOpen: async () => { const result = open(pdf(bytes)); if (++reads === 2) change(result); return result; } });
    const response = await h.run();
    await assert.rejects(response.arrayBuffer(), /did not complete verification/);
    assert.equal(reads, 2); assert.equal(h.calls.cancels, 1); assert.equal(h.calls.releases, 1);
  }
});

test('ordinary WAL growth does not change the immutable PDF/publication binding', async () => {
  let reads = 0;
  const h = harness({ readOpen: async () => { const result = open(pdf(bytes)); result.annotations.wal_head = String(reads++); return result; } });
  assert.deepEqual(new Uint8Array(await (await h.run()).arrayBuffer()), bytes);
});

test('emitted bytes do not retain a mutable provider Buffer', async () => {
  const provider = Buffer.from(bytes);
  const h = harness({ chunks: [provider] });
  const reader = (await h.run()).body.getReader();
  const first = await reader.read();
  provider.fill(0);
  assert.deepEqual(first.value, bytes.slice(0, -1));
  assert.deepEqual((await reader.read()).value, bytes.slice(-1));
  assert.equal((await reader.read()).done, true);
});

test('request and every descriptor field must match; no client path reaches Storage', async () => {
  for (const [key, value] of Object.entries({ bucket_id: 'other', path: 'https://evil.invalid/file', id: differentId,
    version: differentId, byte_length: '8', content_sha256: '0'.repeat(64) })) {
    const h = harness(); const wrong = body({ ...pdf(bytes), [key]: value });
    const response = await h.run(request(wrong));
    assert.ok([400, 409].includes(response.status), `${key}: ${response.status}`);
    assert.equal(h.calls.streams.length, 0);
  }
  for (const wrong of [null, [], {}, { ...body(pdf(bytes)), url: 'https://evil.invalid' },
    body({ ...pdf(bytes), extra: true }), body({ ...pdf(bytes), path: '../escape' }),
    body({ ...pdf(bytes), path: 'owner/line\nbreak.pdf' }), body({ ...pdf(bytes), path: 'x'.repeat(2049) }),
    body({ ...pdf(bytes), byte_length: 7 }), body({ ...pdf(bytes), byte_length: '0' }),
    { ...body(pdf(bytes)), generation_id: null }]) {
    const h = harness(); assert.equal((await h.run(request(wrong))).status, 400); assert.equal(h.calls.streams.length, 0);
  }
});

test('malformed manifest, size bound, and safe SQL errors fail before Storage opens', async () => {
  for (const modify of [value => { value.actor_user_id = differentId; }, value => { value.document.file_size = '1'; },
    value => { value.publication = null; }, value => { value.pdf.version = null; }]) {
    const value = open(pdf(bytes)); modify(value); const h = harness({ manifest: value });
    assert.equal((await h.run()).status, 502); assert.equal(h.calls.streams.length, 0);
  }
  const large = harness({ maxBytes: 6 }); assert.equal((await large.run()).status, 413); assert.equal(large.calls.streams.length, 0);
  for (const [code, status] of [['42501', 403], ['SG001', 409], ['23514', 409], ['unknown', 502]]) {
    const h = harness({ readOpen: async () => { throw Object.assign(new Error('SECRET/token/path'), { code, details: 'SECRET' }); } });
    const response = await h.run(); assert.equal(response.status, status); assert.doesNotMatch(await response.text(), /SECRET|token\/path/);
  }
});

test('method, disabled, auth, and 16KiB body bounds are enforced', async () => {
  const h = harness();
  assert.equal((await h.run(new Request('https://download.invalid', { method: 'OPTIONS' }))).status, 204);
  assert.equal((await h.run(new Request('https://download.invalid'))).status, 405);
  assert.equal((await harness({ enabled: false }).run()).status, 503);
  assert.equal((await harness().run(request(undefined, { headers: {} }))).status, 401);
  assert.equal((await harness({ getUser: async () => null }).run()).status, 401);
  for (const raw of ['{', 'x'.repeat(16385), JSON.stringify({ ...body(pdf(bytes)), extra: 'x'.repeat(16384) })]) {
    const response = await harness().run(request(undefined, { body: raw })); assert.equal(response.status, 400);
  }
});

test('pending provider read times out even if read and cancel ignore AbortSignal', { timeout: 1500 }, async () => {
  let cancels = 0, releases = 0;
  const h = harness({ timeoutMs: 40, openStream: async () => ({ getReader: () => ({
    read: () => new Promise(() => {}), cancel: () => { cancels++; return new Promise(() => {}); }, releaseLock: () => { releases++; },
  }) }) });
  const response = await h.run(); await assert.rejects(response.arrayBuffer(), /did not complete verification/);
  assert.equal(cancels, 1); assert.equal(releases, 1);
});

test('consumer cancel settles promptly during a hung read and cancels/releases once', { timeout: 1500 }, async () => {
  let cancels = 0, releases = 0;
  const h = harness({ openStream: async () => ({ getReader: () => ({
    read: () => new Promise(() => {}), cancel: () => { cancels++; return new Promise(() => {}); }, releaseLock: () => { releases++; },
  }) }) });
  const reader = (await h.run()).body.getReader(); const pending = reader.read();
  await nextTurn(); await reader.cancel(); await pending;
  assert.equal(cancels, 1); assert.equal(releases, 1);
});

test('request abort errors a pending output and removes the request listener', { timeout: 1500 }, async () => {
  const controller = new AbortController();
  const req = request(undefined, { signal: controller.signal });
  let added = 0, removed = 0;
  const add = req.signal.addEventListener.bind(req.signal), remove = req.signal.removeEventListener.bind(req.signal);
  req.signal.addEventListener = (...args) => { added++; return add(...args); };
  req.signal.removeEventListener = (...args) => { removed++; return remove(...args); };
  const h = harness({ openStream: async () => new ReadableStream({ pull: () => new Promise(() => {}) }) });
  const response = await h.run(req); const result = response.arrayBuffer();
  controller.abort(); await assert.rejects(result, /did not complete verification/);
  assert.equal(added, 1); assert.equal(removed, 1);
});

test('late provider stream after timeout is canceled without waiting for cancel', { timeout: 1500 }, async () => {
  const pending = deferred(); let cancels = 0;
  const h = harness({ timeoutMs: 30, openStream: () => pending.promise });
  const response = await h.run(); assert.equal(response.status, 503);
  pending.resolve(new ReadableStream({ cancel() { cancels++; return new Promise(() => {}); } }));
  await nextTurn(); assert.equal(cancels, 1);
});

test('late provider stream after request abort is also canceled once', { timeout: 1500 }, async () => {
  const pending = deferred(), started = deferred(), controller = new AbortController(); let cancels = 0;
  const h = harness({ openStream: () => { started.resolve(); return pending.promise; } });
  const result = h.run(request(undefined, { signal: controller.signal }));
  await started.promise; controller.abort(); assert.equal((await result).status, 503);
  pending.resolve(new ReadableStream({ cancel() { cancels++; return new Promise(() => {}); } }));
  await nextTurn(); assert.equal(cancels, 1);
});

test('fragmented and empty request chunks use one bounded body buffer', async () => {
  const raw = new TextEncoder().encode(JSON.stringify(body(pdf(bytes))));
  let offset = 0, empty = false;
  const stream = new ReadableStream({ pull(controller) {
    if (offset === raw.length) return controller.close();
    empty = !empty;
    controller.enqueue(empty ? new Uint8Array() : raw.slice(offset, ++offset));
  } });
  const response = await harness().run(request(undefined, { body: stream, duplex: 'half' }));
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test('hung auth, request body, and final SQL waits are bounded', { timeout: 2000 }, async () => {
  const auth = harness({ timeoutMs: 20, getUser: () => new Promise(() => {}) });
  assert.equal((await auth.run()).status, 503);
  const bodyWait = harness({ timeoutMs: 20 });
  const req = request(undefined, { body: new ReadableStream({ pull: () => new Promise(() => {}) }), duplex: 'half' });
  assert.equal((await bodyWait.run(req)).status, 503);
  let reads = 0;
  const finalWait = harness({ timeoutMs: 30, readOpen: async () => ++reads === 1 ? open(pdf(bytes)) : new Promise(() => {}) });
  await assert.rejects((await finalWait.run()).arrayBuffer(), /did not complete verification/);
  assert.equal(reads, 2); assert.equal(finalWait.calls.releases, 1);
});

test('monotonic deadline stops work even when timer callback has not run', async t => {
  let now = 10;
  t.mock.method(performance, 'now', () => now);
  const h = harness({ timeoutMs: 1000, getUser: async () => { now = 1011; return { id: actor }; } });
  const response = await h.run(); assert.equal(response.status, 503); assert.equal(h.calls.opens.length, 0);
});

test('entrypoint stays disabled by two flags and uses authenticated SQL plus encoded uncached Storage streams', async () => {
  const source = await readFile(new URL('../supabase/functions/document-generation-download/index.ts', import.meta.url), 'utf8');
  assert.match(source, /SURVEY_GENERATION_DOWNLOAD'\) === 'checked-stream-v1'/);
  assert.match(source, /SURVEY_GENERATION_STORAGE_CONTRACT'\) === 'versioned-standard-v1'/);
  assert.match(source, /enabled: enabled && !!url && !!anonKey && !!serviceKey/);
  assert.match(source, /client\(anonKey, signal, token\)\.rpc\('read_document_generation_open'/);
  assert.match(source, /p_include_snapshot: false/);
  assert.match(source, /download\(encodeSourceObjectPath\(pdf\.path\), \{ cacheNonce: crypto\.randomUUID\(\) \}/);
  assert.match(source, /cache: 'no-store', signal/); assert.match(source, /\.asStream\(\)/);
  assert.match(source, /redirect: 'error'/);
  assert.doesNotMatch(source, /createSignedUrl|getPublicUrl|client\(serviceKey, signal\)\.rpc/);
});
