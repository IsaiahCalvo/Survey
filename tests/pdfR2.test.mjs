// Cloudflare R2 copies of stored PDFs (docs/PDF-R2.md): the access-checked
// link function, the copy, the delete sweep and the app's fallback. The same
// code runs against a real S3 server (MinIO) in tests/e2e-signed-in/pdf-r2.spec.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { handlePdfFileUrl, mirrorPdf, validPdfPath, normalizeEtag, PDF_LINK_SECONDS } from '../supabase/functions/_shared/pdfFileUrl.js';
import { r2ConfigFromEnv, presignGet, putObjectStream, PART_SIZE } from '../supabase/functions/_shared/r2.js';
import { sweepR2Copies } from '../supabase/functions/archive-purge-sweep/r2CopySweep.js';
import { requestR2PdfLink, downloadPdfFromR2 } from '../src/services/pdfR2Source.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const ENV = {
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com/',
  R2_BUCKET: 'survey-pdfs',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'secret',
};
const config = r2ConfigFromEnv((n) => ENV[n]);

// A tiny in-memory S3: enough of HEAD / PUT / multipart for the copy code.
function fakeS3() {
  const objects = new Map();
  const uploads = new Map();
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    const key = decodeURIComponent(u.pathname.split('/').slice(2).join('/'));
    calls.push({ method, key, query: Object.fromEntries(u.searchParams), headers: init.headers });
    assert.match(init.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]+, Signature=[0-9a-f]{64}$/);
    const bytes = async () => new Uint8Array(init.body instanceof Uint8Array ? init.body : new TextEncoder().encode(init.body ?? ''));
    if (method === 'HEAD') {
      const o = objects.get(key);
      if (!o) return new Response(null, { status: 404 });
      return new Response(null, { status: 200, headers: { 'content-length': String(o.bytes.byteLength), ...Object.fromEntries(Object.entries(o.meta).map(([k, v]) => [`x-amz-meta-${k}`, v])) } });
    }
    if (method === 'POST' && u.searchParams.has('uploads')) {
      const id = `up${uploads.size + 1}`;
      uploads.set(id, { key, parts: [], meta: metaOf(init.headers) });
      return new Response(`<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`);
    }
    if (method === 'PUT' && u.searchParams.has('uploadId')) {
      uploads.get(u.searchParams.get('uploadId')).parts.push(await bytes());
      return new Response(null, { status: 200, headers: { etag: `"p${u.searchParams.get('partNumber')}"` } });
    }
    if (method === 'POST' && u.searchParams.has('uploadId')) {
      const up = uploads.get(u.searchParams.get('uploadId'));
      const all = new Uint8Array(up.parts.reduce((n, p) => n + p.byteLength, 0));
      let off = 0;
      for (const p of up.parts) { all.set(p, off); off += p.byteLength; }
      objects.set(up.key, { bytes: all, meta: up.meta });
      return new Response('<CompleteMultipartUploadResult/>');
    }
    if (method === 'PUT') {
      objects.set(key, { bytes: await bytes(), meta: metaOf(init.headers) });
      return new Response(null, { status: 200 });
    }
    return new Response('nope', { status: 400 });
  };
  return { objects, calls, fetchImpl };
}
const metaOf = (headers) => Object.fromEntries(Object.entries(headers)
  .filter(([k]) => k.startsWith('x-amz-meta-')).map(([k, v]) => [k.slice(11), v]));

const streamOf = (bytes, chunk = 64 * 1024) => new ReadableStream({
  start(controller) {
    for (let i = 0; i < bytes.byteLength; i += chunk) controller.enqueue(bytes.slice(i, i + chunk));
    controller.close();
  },
});

const pdfBytes = (n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i += 1) b[i] = (i * 31) & 255; return b; };

test('R2 is off unless all four settings are there', () => {
  assert.equal(r2ConfigFromEnv(() => ''), null);
  assert.equal(r2ConfigFromEnv((n) => (n === 'R2_BUCKET' ? '' : ENV[n])), null);
  assert.equal(r2ConfigFromEnv((n) => (n === 'R2_ENDPOINT' ? 'acct.r2.cloudflarestorage.com' : ENV[n])), null);
  assert.deepEqual(config, {
    endpoint: 'https://acct.r2.cloudflarestorage.com', serverEndpoint: 'https://acct.r2.cloudflarestorage.com',
    bucket: 'survey-pdfs', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', region: 'auto',
  });
});

test('paths: only plain relative object paths are accepted', () => {
  for (const p of ['u/d.pdf', 'u/p/1712.pdf', 'a b/c (1).pdf']) assert.equal(validPdfPath(p), true, p);
  for (const p of ['', '/u/d.pdf', 'u/../x.pdf', 'u//d.pdf', 'u/./d.pdf', 'u\\d.pdf', 'u/d\n.pdf', 'x'.repeat(1025), null, 5]) {
    assert.equal(validPdfPath(p), false, String(p));
  }
  assert.equal(normalizeEtag('W/"abc"'), 'abc');
  assert.equal(normalizeEtag('"abc"'), 'abc');
  assert.equal(normalizeEtag(''), null);
});

test('presigned link: path-style, host-only signature, expiry and encoded key', async () => {
  const url = new URL(await presignGet(config, 'documents/u 1/d.pdf', { expiresIn: 600, now: new Date('2026-10-28T00:00:00Z') }));
  assert.equal(url.origin, 'https://acct.r2.cloudflarestorage.com');
  assert.equal(url.pathname, '/survey-pdfs/documents/u%201/d.pdf');
  assert.equal(url.searchParams.get('X-Amz-Expires'), '600');
  assert.equal(url.searchParams.get('X-Amz-SignedHeaders'), 'host');
  assert.equal(url.searchParams.get('X-Amz-Credential'), 'AKIDEXAMPLE/20261028/auto/s3/aws4_request');
  assert.match(url.searchParams.get('X-Amz-Signature'), /^[0-9a-f]{64}$/);
  // Deterministic for the same inputs, different for another key.
  const again = await presignGet(config, 'documents/u 1/d.pdf', { expiresIn: 600, now: new Date('2026-10-28T00:00:00Z') });
  const other = await presignGet(config, 'documents/u 1/e.pdf', { expiresIn: 600, now: new Date('2026-10-28T00:00:00Z') });
  assert.equal(again, url.href);
  assert.notEqual(new URL(other).searchParams.get('X-Amz-Signature'), url.searchParams.get('X-Amz-Signature'));
});

const okInfo = (etag = '"v1"', size = 10) => async () => ({ ok: true, status: 200, data: { etag, size } });
const noBackground = () => { throw new Error('no copy expected'); };
const noR2 = async () => { throw new Error('R2 must not be touched'); };

test('the access check comes first: refused or missing paths never reach R2', async () => {
  for (const status of [400, 403, 404]) {
    const r = await handlePdfFileUrl({ path: 'u/d.pdf' }, {
      config, storageInfo: async () => ({ ok: false, status }), download: noR2, background: noBackground, fetchImpl: noR2,
    });
    assert.deepEqual(r, { status: 404, body: { error: 'not_found' } });
  }
  const down = await handlePdfFileUrl({ path: 'u/d.pdf' }, {
    config, storageInfo: async () => ({ ok: false, status: 503 }), download: noR2, background: noBackground, fetchImpl: noR2,
  });
  assert.equal(down.status, 502);
});

test('R2 not set up, or a bad path: refused before Storage is asked', async () => {
  const neverAsked = async () => { throw new Error('Storage must not be asked'); };
  assert.equal((await handlePdfFileUrl({ path: 'u/d.pdf' }, { config: null, storageInfo: neverAsked })).status, 503);
  assert.equal((await handlePdfFileUrl({ path: '../d.pdf' }, { config, storageInfo: neverAsked })).status, 400);
  assert.equal((await handlePdfFileUrl(null, { config, storageInfo: neverAsked })).status, 400);
});

test('a current copy gets a signed link; a missing or old copy is made in the background', async () => {
  const s3 = fakeS3();
  const background = [];
  const download = async () => new Response(streamOf(pdfBytes(10)), { headers: { etag: '"v1"', 'content-length': '10' } });
  const deps = { config, storageInfo: okInfo(), download, background: (p) => background.push(p), fetchImpl: s3.fetchImpl };

  const first = await handlePdfFileUrl({ path: 'u/d.pdf' }, deps);
  assert.deepEqual(first, { status: 202, body: { copying: true } });
  assert.equal(background.length, 1);
  await background[0];
  assert.deepEqual(s3.objects.get('documents/u/d.pdf').meta, { 'src-etag': 'v1' });

  const second = await handlePdfFileUrl({ path: 'u/d.pdf' }, deps);
  assert.equal(second.status, 200);
  assert.equal(second.body.expiresIn, PDF_LINK_SECONDS);
  assert.match(second.body.url, /^https:\/\/acct\.r2\.cloudflarestorage\.com\/survey-pdfs\/documents\/u\/d\.pdf\?.*X-Amz-Signature=/);

  // A page edit rewrote the PDF in place: new ETag, so no link to the old copy.
  const edited = await handlePdfFileUrl({ path: 'u/d.pdf' }, { ...deps, storageInfo: okInfo('"v2"', 10) });
  assert.equal(edited.status, 202);
  // Same ETag but another size is not trusted either.
  const resized = await handlePdfFileUrl({ path: 'u/d.pdf' }, { ...deps, storageInfo: okInfo('"v1"', 11) });
  assert.equal(resized.status, 202);
});

test('R2 down: the app is told to use Supabase', async () => {
  const r = await handlePdfFileUrl({ path: 'u/d.pdf' }, {
    config, storageInfo: okInfo(), download: noR2, background: noBackground,
    fetchImpl: async () => new Response(null, { status: 500 }),
  });
  assert.deepEqual(r, { status: 503, body: { error: 'r2_unavailable' } });
});

test('copy: tagged with the ETag Storage sent with the bytes; a failed download copies nothing', async () => {
  const s3 = fakeS3();
  const expected = { etag: 'v1', size: 10 };
  const newer = async () => new Response(streamOf(pdfBytes(12)), { headers: { etag: '"v2"', 'content-length': '12' } });
  assert.equal(await mirrorPdf({ config, path: 'u/d.pdf', expected, download: newer, fetchImpl: s3.fetchImpl }), 'copied');
  assert.equal(s3.objects.get('documents/u/d.pdf').meta['src-etag'], 'v2');

  const gone = async () => new Response('missing', { status: 404 });
  assert.equal(await mirrorPdf({ config, path: 'u/x.pdf', expected, download: gone, fetchImpl: s3.fetchImpl }), 'download_404');
  assert.equal(s3.objects.has('documents/u/x.pdf'), false);
});

test('big files go up in parts and arrive whole', async () => {
  const s3 = fakeS3();
  const bytes = pdfBytes(PART_SIZE * 2 + 12345);
  const { size } = await putObjectStream(config, 'documents/u/big.pdf', streamOf(bytes, 1024 * 1024), { meta: { 'src-etag': 'big' }, fetchImpl: s3.fetchImpl });
  assert.equal(size, bytes.byteLength);
  const stored = s3.objects.get('documents/u/big.pdf');
  assert.equal(stored.bytes.byteLength, bytes.byteLength);
  assert.deepEqual(stored.bytes, bytes);
  assert.equal(stored.meta['src-etag'], 'big');
  assert.equal(s3.calls.filter((c) => c.query.partNumber).length, 3);
});

function stubQueue(rows, { failClear = false } = {}) {
  const cleared = [];
  return {
    cleared,
    from(table) {
      assert.equal(table, 'pdf_r2_deletes');
      const q = {
        select: () => q, order: () => q, limit: async () => ({ data: rows, error: null }),
        delete: () => ({ eq: (c1, v1) => ({ eq: async (c2, v2) => { cleared.push([v1, v2]); return { error: failClear ? { message: 'x' } : null }; } }) }),
      };
      return q;
    },
  };
}

test('delete sweep: off without R2; deletes each copy, then its queue row', async () => {
  const off = await sweepR2Copies(stubQueue([{ path: 'u/a.pdf', queued_at: 't1' }]), null);
  assert.deepEqual(off, { enabled: false, found: 0, removed: 0, failed: 0, errors: [] });

  const removedKeys = [];
  const queue = stubQueue([{ path: 'u/a.pdf', queued_at: 't1' }, { path: 'u/b.pdf', queued_at: 't2' }]);
  const r = await sweepR2Copies(queue, config, {
    remove: async (_c, key) => { if (key.endsWith('b.pdf')) throw new Error('R2 DELETE 500'); removedKeys.push(key); },
  });
  assert.deepEqual(removedKeys, ['documents/u/a.pdf']);
  assert.deepEqual(queue.cleared, [['u/a.pdf', 't1']]);
  assert.equal(r.removed, 1);
  assert.equal(r.failed, 1);

  const dry = stubQueue([{ path: 'u/a.pdf', queued_at: 't1' }]);
  const d = await sweepR2Copies(dry, config, { dryRun: true, remove: noR2 });
  assert.equal(d.found, 1);
  assert.deepEqual(dry.cleared, []);
});

const client = (answer) => {
  const calls = [];
  return { calls, functions: { invoke: async (name, opts) => { calls.push([name, opts]); return typeof answer === 'function' ? answer() : answer; } } };
};

test('app: flag off asks nothing; anything but a link means Supabase', async () => {
  const off = client({ data: { url: 'https://r2/x' }, error: null });
  assert.equal(await requestR2PdfLink(off, 'u/d.pdf', { flagOn: () => false }), null);
  assert.deepEqual(off.calls, []);

  const on = { flagOn: () => true };
  const ok = client({ data: { url: 'https://acct.r2.cloudflarestorage.com/b/k?sig' }, error: null });
  assert.equal(await requestR2PdfLink(ok, 'u/d.pdf', on), 'https://acct.r2.cloudflarestorage.com/b/k?sig');
  assert.deepEqual(ok.calls, [['pdf-file-url', { body: { path: 'u/d.pdf' } }]]);

  for (const answer of [
    { data: { copying: true }, error: null },
    { data: null, error: new Error('FunctionsHttpError') },
    { data: { url: 'javascript:alert(1)' }, error: null },
    () => { throw new Error('offline'); },
  ]) {
    assert.equal(await requestR2PdfLink(client(answer), 'u/d.pdf', on), null);
  }
  const slow = client(() => new Promise(() => {}));
  assert.equal(await requestR2PdfLink(slow, 'u/d.pdf', { ...on, timeoutMs: 20 }), null);
});

test('app download: R2 bytes when the link works, null (Supabase) when the fetch fails', async () => {
  const on = { flagOn: () => true };
  const ok = client({ data: { url: 'https://r2.example/k' }, error: null });
  const blob = await downloadPdfFromR2(ok, 'u/d.pdf', { ...on, fetchImpl: async (url, init) => {
    assert.equal(init.cache, 'no-store');
    return new Response(pdfBytes(5));
  } });
  assert.equal(blob.type, 'application/pdf');
  assert.equal(blob.size, 5);
  assert.equal(await downloadPdfFromR2(ok, 'u/d.pdf', { ...on, fetchImpl: async () => new Response('x', { status: 403 }) }), null);

  // A download that stops sending bytes gives up, so the open uses Supabase.
  const stalled = (url, init) => Promise.resolve(new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([37, 80]));
      init.signal.addEventListener('abort', () => controller.error(new Error('aborted')));
    },
  })));
  assert.equal(await downloadPdfFromR2(ok, 'u/d.pdf', { ...on, stallMs: 30, fetchImpl: stalled }), null);
  const noHeaders = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  assert.equal(await downloadPdfFromR2(ok, 'u/d.pdf', { ...on, stallMs: 30, fetchImpl: noHeaders }), null);
});

test('flag, migration, function config and CSP stay in step', () => {
  assert.equal(FEATURE_FLAGS['pdf-r2'].stage, 'rollout');
  const migration = readFileSync(new URL('../supabase/migrations/20261028090000_pdf_r2_mirror.sql', import.meta.url), 'utf8');
  assert.match(migration, /\('pdf-r2', 'off'/);
  assert.match(migration, /after delete or update of name, bucket_id on storage\.objects/);
  assert.match(migration, /enable row level security/);
  const toml = readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[functions\.pdf-file-url\]\s*\nverify_jwt = false/);
  const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const csp = vercel.headers.flatMap((r) => r.headers).find((h) => h.key === 'Content-Security-Policy' && h.value.includes('connect-src')).value;
  assert.match(csp, /connect-src [^;]*https:\/\/\*\.r2\.cloudflarestorage\.com/);
});
