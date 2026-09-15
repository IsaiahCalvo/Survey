import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { canResolveThumbnailBytes, createThumbnailRequestPool } from '../src/home/thumbnailRequestPolicy.js';

const source = readFileSync(new URL('../src/home/PdfPageThumb.jsx', import.meta.url), 'utf8');
// Run the exact component loader with fake storage/PDF services. No browser,
// auth, network, or PDF parser is needed to count transfers and test races.
const loaderSource = source.slice(source.indexOf('const loadThumb ='), source.indexOf('/* US Letter portrait'));
const image = { url: 'data:image/jpeg;base64,preview', aspect: 0.75 };
const cloudDoc = { id: 'cloud', file_path: 'owner/source.pdf' };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function setup(overrides = {}) {
  const calls = { downloads: 0, renders: 0, slots: 0, releases: 0, writes: 0 };
  const dependencies = {
    thumbnailRequests: createThumbnailRequestPool(),
    thumbCacheKey: doc => doc.file_path ? `${doc.id}:${doc.file_path}` : null,
    checkedPreviewThumbCacheKey: descriptor => descriptor?.cacheKey || null,
    thumbnailStore: () => ({ get: async () => null, put: async () => { calls.writes++; } }),
    canResolveThumbnailBytes,
    sourceObjectId: value => value || null,
    acquireSlot: async () => { calls.slots++; },
    readBlobAsArrayBuffer: blob => blob.arrayBuffer(),
    resolvePdfBytes: async doc => { if (!doc.file) calls.downloads++; return new ArrayBuffer(1); },
    renderFirstPage: async () => { calls.renders++; return image; },
    releaseSlot: () => { calls.releases++; },
    ...overrides,
  };
  const load = new Function(...Object.keys(dependencies), `${loaderSource}\nreturn loadThumb;`)(...Object.values(dependencies));
  return { calls, load };
}

test('only selected previews or bytes already on-device may resolve a source', () => {
  assert.equal(canResolveThumbnailBytes(cloudDoc), false);
  assert.equal(canResolveThumbnailBytes(cloudDoc, true), true);
  assert.equal(canResolveThumbnailBytes({ file: new Blob() }), true);
  assert.equal(canResolveThumbnailBytes({ dataUrl: 'data:application/pdf;base64,A' }), true);
  assert.equal(canResolveThumbnailBytes({ dataUrl: 'blob:http://localhost/abc' }), true);
  assert.equal(canResolveThumbnailBytes({ dataUrl: 'https://example.test/a.pdf' }), false);
  assert.equal(canResolveThumbnailBytes({ dataUrl: '/a.pdf' }), false);
});

test('100 uncached cloud rows cause zero downloads and zero renders', async () => {
  const { calls, load } = setup();
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => load(`${i}`, { ...cloudDoc, id: `${i}` }, null)));
  assert.ok(results.every(result => result === 'DEFERRED'));
  assert.deepEqual(calls, { downloads: 0, renders: 0, slots: 0, releases: 0, writes: 0 });
});

test('a sparse catalog row describes only the selected preview and acquires once on cache miss', async () => {
  const { calls, load } = setup();
  const events = [];
  const descriptor = { actorUserId: 'actor', documentId: 'catalog', cacheKey: 'checked-key' };
  const describe = async input => { events.push(['describe', input.documentId]); return descriptor; };
  const acquire = async value => {
    events.push(['acquire', value]);
    return { actorUserId: 'actor', documentId: 'catalog', cacheKey: 'checked-key', blob: new Blob(['pdf']) };
  };
  assert.equal(await load('catalog-row', { id: 'catalog' }, null), 'DEFERRED');
  assert.equal(await load('catalog-preview', { id: 'catalog' }, null, true, () => false,
    describe, acquire, new AbortController().signal), image);
  assert.deepEqual(events, [['describe', 'catalog'], ['acquire', descriptor]]);
  assert.equal(calls.downloads, 0);
  assert.equal(calls.renders, 1);
  assert.equal(calls.writes, 1);
});

test('a checked catalog cache hit still proves current mode but skips PDF acquisition', async () => {
  const cached = { url: 'cached', aspect: 1 };
  const { calls, load } = setup({ thumbnailStore: () => ({ get: async key => key === 'checked-key' ? cached : null,
    put: async () => { calls.writes++; } }) });
  const descriptor = { actorUserId: 'actor', documentId: 'catalog', cacheKey: 'checked-key' };
  let descriptions = 0, acquisitions = 0;
  const result = await load('catalog-preview-cache', { id: 'catalog' }, null, true, () => false,
    async () => { descriptions++; return descriptor; }, async () => { acquisitions++; }, new AbortController().signal);
  assert.equal(result, cached);
  assert.equal(descriptions, 1);
  assert.equal(acquisitions, 0);
  assert.equal(calls.renders, 0);
});

test('a malformed issued cache key is treated as a miss and cannot supply pixels', async () => {
  let acquired = 0;
  const { load } = setup({ checkedPreviewThumbCacheKey: () => null });
  const descriptor = { actorUserId: 'actor', documentId: 'catalog', cacheKey: 'malformed' };
  const result = await load('catalog', { id: 'catalog' }, null, true, () => false,
    async () => descriptor,
    async value => { assert.equal(value, descriptor); acquired++; return { ...descriptor, blob: new Blob(['pdf']) }; });
  assert.equal(result, image);
  assert.equal(acquired, 1);
});

test('one preview unmount cannot abort shared acquisition while another consumer remains', async () => {
  const transfer = deferred();
  const first = new AbortController();
  const second = new AbortController();
  let acquired = 0;
  let requestSignal;
  const { load } = setup();
  const descriptor = { actorUserId: 'actor', documentId: 'catalog', cacheKey: 'checked-key' };
  const describe = async () => descriptor;
  const acquire = async (_descriptor, options) => {
    acquired++;
    requestSignal = options.signal;
    return transfer.promise;
  };
  const one = load('catalog', { id: 'catalog' }, null, true, () => first.signal.aborted,
    describe, acquire, first.signal);
  const two = load('catalog', { id: 'catalog' }, null, true, () => second.signal.aborted,
    describe, acquire, second.signal);
  await new Promise(setImmediate);
  first.abort();
  assert.equal(requestSignal.aborted, false);
  transfer.resolve({ ...descriptor, blob: new Blob(['pdf']) });
  assert.equal(await two, image);
  await one;
  assert.equal(acquired, 1);
});

test('a durable cache hit displays on a row without downloading or queueing', async () => {
  const { calls, load } = setup({ thumbnailStore: () => ({ get: async () => image }) });
  assert.equal(await load('cloud', cloudDoc, null), image);
  assert.deepEqual(calls, { downloads: 0, renders: 0, slots: 0, releases: 0, writes: 0 });
});

test('a deferred row cannot suppress a simultaneous selected preview', async () => {
  const { calls, load } = setup();
  const results = await Promise.all([load('cloud', cloudDoc, null), load('cloud', cloudDoc, null, true)]);
  assert.deepEqual(results, ['DEFERRED', image]);
  assert.deepEqual(calls, { downloads: 1, renders: 1, slots: 1, releases: 1, writes: 1 });
});

test('a row cache miss remains eligible for a later selected preview', async () => {
  const { load, calls } = setup();
  assert.equal(await load('cloud', cloudDoc, null), 'DEFERRED');
  assert.equal(await load('cloud', cloudDoc, null, true), image);
  assert.equal(calls.downloads, 1);
  assert.ok(source.indexOf("if (result === 'DEFERRED')") < source.indexOf('cacheThumb(docId, result)'));
  assert.match(source, /downloadDocument, describeCloudPreview, acquireCloudPreview, priority\]\)/);
});

test('local file thumbnails still render without network access', async () => {
  const { load, calls } = setup();
  assert.equal(await load('local', { id: 'local', file: new Blob() }, null), image);
  assert.equal(calls.downloads, 0);
  assert.equal(calls.renders, 1);
});

test('leaving a preview while it waits for a slot prevents the download', async () => {
  let cancelled = false;
  const { load, calls } = setup({ acquireSlot: async () => { cancelled = true; } });
  assert.equal(await load('cloud', cloudDoc, null, true, () => cancelled), 'DEFERRED');
  assert.equal(calls.downloads, 0);
  assert.equal(calls.renders, 0);
  assert.equal(calls.releases, 1);
});

test('coalesced preview survives cancellation of one consumer and downloads once', async () => {
  const { load, calls } = setup();
  const results = await Promise.all([
    load('cloud', cloudDoc, null, true, () => true),
    load('cloud', cloudDoc, null, true, () => false),
  ]);
  assert.deepEqual(results, [image, image]);
  assert.equal(calls.downloads, 1);
  assert.equal(calls.renders, 1);
});

test('cancellation during download skips PDF parsing and releases the slot', async () => {
  let cancelled = false;
  const { load, calls } = setup({ resolvePdfBytes: async () => { cancelled = true; return new ArrayBuffer(1); } });
  assert.equal(await load('cloud', cloudDoc, null, true, () => cancelled), 'DEFERRED');
  assert.equal(calls.renders, 0);
  assert.equal(calls.releases, 1);
});

test('a failed transfer releases its slot and does not poison the in-flight pool', async () => {
  let attempts = 0;
  const { load, calls } = setup({ resolvePdfBytes: async () => { if (++attempts === 1) throw new Error('offline'); return new ArrayBuffer(1); } });
  await assert.rejects(load('cloud', cloudDoc, null, true), /offline/);
  assert.equal(await load('cloud', cloudDoc, null, true), image);
  assert.equal(calls.releases, 2);
});
