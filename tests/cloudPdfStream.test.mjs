import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chooseCloudPdfOpenPath,
  streamGetDocumentOptions,
  tryOpenCloudPdfStream,
  STREAM_RANGE_CHUNK_BYTES,
} from '../src/services/cloudPdfStream.js';

const cloud = { id: 'doc-1', filePath: 'user/abc.pdf' };
const base = { protocol: 'https:', online: true };

test('cloud document on the web streams', () => {
  assert.deepEqual(chooseCloudPdfOpenPath({ pdfFile: cloud, ...base }), { path: 'stream', reason: 'cloud' });
});

test('fallbacks that need the bytes keep the full download', () => {
  const cases = [
    [{ pdfFile: { ...cloud, arrayBuffer: async () => new ArrayBuffer(0) } }, 'local', 'local-bytes'],
    [{ pdfFile: { id: 'x' } }, 'download', 'no-cloud-path'],
    [{ pdfFile: cloud, protocol: 'file:' }, 'download', 'file-protocol'],
    [{ pdfFile: cloud, online: false }, 'download', 'offline'],
    [{ pdfFile: cloud, forceDownload: true }, 'download', 'needs-bytes'],
    [{ pdfFile: cloud, hasDurablePresentation: true }, 'download', 'presentation-state'],
    [{ pdfFile: cloud, streamSupported: false }, 'download', 'stream-unavailable'],
    [{ pdfFile: null }, 'download', 'no-file'],
  ];
  for (const [input, path, reason] of cases) {
    assert.deepEqual(chooseCloudPdfOpenPath({ ...base, ...input }), { path, reason });
  }
});

test('stream options request ranges and progressive loading', () => {
  const options = streamGetDocumentOptions('https://x/signed', 0);
  assert.equal(options.url, 'https://x/signed');
  assert.equal(options.rangeChunkSize, STREAM_RANGE_CHUNK_BYTES);
  assert.equal(options.disableAutoFetch, false);
  assert.equal(options.disableStream, false);
  assert.equal(options.disableRange, false);
  assert.equal(options.isEvalSupported, false);
});

function fakePdfjs({ fail = false, hang = false, bytes = new Uint8Array([1, 2, 3]) } = {}) {
  const calls = [];
  let destroyed = 0;
  return {
    calls,
    get destroyed() { return destroyed; },
    VerbosityLevel: { ERRORS: 0 },
    getDocument(options) {
      calls.push(options);
      const promise = hang ? new Promise(() => {})
        : fail ? Promise.reject(new Error('range 403'))
          : Promise.resolve({ numPages: 2, getData: async () => bytes });
      return { promise, destroy: async () => { destroyed += 1; } };
    },
  };
}

test('stream success returns the pdf and hands on the full bytes', async () => {
  const lib = fakePdfjs();
  const cached = [];
  const all = [];
  const result = await tryOpenCloudPdfStream({
    pdfjsReady: Promise.resolve(lib),
    filePath: 'a.pdf',
    source: async () => ({ url: 'https://signed', onBytes: (b) => cached.push(b) }),
    onAllBytes: (b) => all.push(b),
  });
  assert.equal(result.pdf.numPages, 2);
  assert.equal(lib.calls[0].url, 'https://signed');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(cached.length, 1);
  assert.equal(all.length, 1);
});

test('cached bytes skip the stream', async () => {
  const lib = fakePdfjs();
  const blob = { size: 3 };
  const result = await tryOpenCloudPdfStream({ pdfjsReady: Promise.resolve(lib), filePath: 'a.pdf', source: async () => ({ blob }) });
  assert.equal(result.blob, blob);
  assert.equal(lib.calls.length, 0);
});

test('no source, range/CORS failure and timeout fall back (null) without throwing', async () => {
  const reasons = [];
  const onFallback = (r) => reasons.push(r);
  assert.equal(await tryOpenCloudPdfStream({ pdfjsReady: Promise.resolve(fakePdfjs()), filePath: 'a', source: async () => null, onFallback }), null);
  assert.equal(await tryOpenCloudPdfStream({ pdfjsReady: Promise.resolve(fakePdfjs()), filePath: 'a', source: async () => { throw new Error('sign failed'); }, onFallback }), null);
  const failing = fakePdfjs({ fail: true });
  assert.equal(await tryOpenCloudPdfStream({ pdfjsReady: Promise.resolve(failing), filePath: 'a', source: async () => ({ url: 'u' }), onFallback }), null);
  assert.equal(failing.destroyed, 1);
  const hanging = fakePdfjs({ hang: true });
  assert.equal(await tryOpenCloudPdfStream({ pdfjsReady: Promise.resolve(hanging), filePath: 'a', source: async () => ({ url: 'u' }), timeoutMs: 10, onFallback }), null);
  assert.equal(hanging.destroyed, 1);
  assert.deepEqual(reasons, ['no-stream-source', 'sign failed', 'range 403', 'stream open timed out']);
});

import { shouldRetryStreamedOpenWithDownload } from '../src/services/cloudPdfStream.js';

test('a failure after a streamed open retries once through the download', () => {
  assert.equal(shouldRetryStreamedOpenWithDownload({ openedByStream: true, filePath: 'a.pdf', forced: new Set() }), true);
  assert.equal(shouldRetryStreamedOpenWithDownload({ openedByStream: true, filePath: 'a.pdf', forced: new Set(['a.pdf']) }), false);
  assert.equal(shouldRetryStreamedOpenWithDownload({ openedByStream: false, filePath: 'a.pdf', forced: new Set() }), false);
});

test('a timed-out open leaves no unhandled rejection', async () => {
  let rejectLate;
  const lib = { VerbosityLevel: {}, getDocument: () => ({ promise: new Promise((_, r) => { rejectLate = r; }), destroy: async () => {} }) };
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  assert.equal(await tryOpenCloudPdfStream({ pdfjsReady: Promise.resolve(lib), filePath: 'a', source: async () => ({ url: 'u' }), timeoutMs: 5 }), null);
  rejectLate(new Error('late'));
  await new Promise((r) => setTimeout(r, 20));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled.length, 0);
});

test('no late-failure reload once a page view replaced the file', () => {
  assert.equal(shouldRetryStreamedOpenWithDownload({ openedByStream: true, filePath: 'a.pdf', forced: new Set(), stillCurrent: false }), false);
});
