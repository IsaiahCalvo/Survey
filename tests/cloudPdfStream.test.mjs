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
    probeTag: async () => 'untagged', source: async () => ({ url: 'https://signed', onBytes: (b) => cached.push(b) }),
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
  assert.equal(await tryOpenCloudPdfStream({ pdfjsReady: Promise.resolve(failing), filePath: 'a', probeTag: async () => 'untagged', source: async () => ({ url: 'u' }), onFallback }), null);
  assert.equal(failing.destroyed, 1);
  const hanging = fakePdfjs({ hang: true });
  assert.equal(await tryOpenCloudPdfStream({ pdfjsReady: Promise.resolve(hanging), filePath: 'a', probeTag: async () => 'untagged', source: async () => ({ url: 'u' }), timeoutMs: 10, onFallback }), null);
  assert.equal(hanging.destroyed, 1);
  assert.deepEqual(reasons, ['no-stream-source', 'sign failed', 'range 403', 'stream open timed out']);
});

import { shouldRetryStreamedOpenWithDownload } from '../src/services/cloudPdfStream.js';

test('a failure after a streamed open retries once through the download', () => {
  assert.equal(shouldRetryStreamedOpenWithDownload({ openedByStream: true, filePath: 'a.pdf', forced: new Set() }), true);
  // The stream's own callbacks may force the path to download during this
  // attempt; that must still reload by download, not show the error screen.
  assert.equal(shouldRetryStreamedOpenWithDownload({ openedByStream: true, filePath: 'a.pdf', forced: new Set(['a.pdf']) }), true);
  assert.equal(shouldRetryStreamedOpenWithDownload({ openedByStream: false, filePath: 'a.pdf', forced: new Set() }), false);
});

test('a timed-out open leaves no unhandled rejection', async () => {
  let rejectLate;
  const lib = { VerbosityLevel: {}, getDocument: () => ({ promise: new Promise((_, r) => { rejectLate = r; }), destroy: async () => {} }) };
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  assert.equal(await tryOpenCloudPdfStream({ pdfjsReady: Promise.resolve(lib), filePath: 'a', probeTag: async () => 'untagged', source: async () => ({ url: 'u' }), timeoutMs: 5 }), null);
  rejectLate(new Error('late'));
  await new Promise((r) => setTimeout(r, 20));
  process.off('unhandledRejection', onUnhandled);
  assert.equal(unhandled.length, 0);
});

test('no late-failure reload once a page view replaced the file', () => {
  assert.equal(shouldRetryStreamedOpenWithDownload({ openedByStream: true, filePath: 'a.pdf', forced: new Set(), stillCurrent: false }), false);
});

test('after a stream fallback the path is forced to download (no stream loop)', async () => {
  const forced = new Set();
  const pdfFile = { id: 'd', filePath: 'p.pdf' };
  const hanging = fakePdfjs({ hang: true });
  const result = await tryOpenCloudPdfStream({
    pdfjsReady: Promise.resolve(hanging), filePath: 'p.pdf', probeTag: async () => 'untagged', source: async () => ({ url: 'u' }), timeoutMs: 5,
    onFallback: () => forced.add('p.pdf'),
  });
  assert.equal(result, null);
  assert.deepEqual(
    chooseCloudPdfOpenPath({ pdfFile, protocol: 'https:', online: true, forceDownload: forced.has('p.pdf') }),
    { path: 'download', reason: 'needs-bytes' },
  );
});

test('PDFViewer marks fallback paths and re-arms the watchdog on stream fallback', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(src, /onFallback: \(why\) => \{[\s\S]{0,400}streamNeedsBytesPathsRef\.current\.add\(streamPath\);[\s\S]{0,120}setStreamFallbackCount/);
  assert.match(src, /\}, \[isLoadingPDF, pdfFile, loadRetryToken, streamFallbackCount\]\);/);
  assert.match(src, /streamNeedsBytesPathsRef\.current\.add\(pdfFile\.filePath\);\n\s*setLoadRetryToken/);
});

test('a getData failure after a streamed open is reported (cache + mirror check fallback)', async () => {
  const lib = fakePdfjs();
  lib.getDocument = () => ({ promise: Promise.resolve({ numPages: 1, getData: () => Promise.reject(new Error('range died')) }), destroy: async () => {} });
  const failed = [];
  const all = [];
  const result = await tryOpenCloudPdfStream({
    pdfjsReady: Promise.resolve(lib), filePath: 'a', probeTag: async () => 'untagged', source: async () => ({ url: 'u' }),
    onAllBytes: (b) => all.push(b), onBytesFailed: (e) => failed.push(e.message),
  });
  assert.ok(result.pdf);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(failed, ['range died']);
  assert.equal(all.length, 0);
});

test('closing a streamed document before all bytes arrive does not start a fallback download', async () => {
  const lib = fakePdfjs();
  let rejectData;
  const task = { destroyed: false, destroy: async () => { task.destroyed = true; rejectData(new Error('Worker was destroyed')); } };
  const pdf = { numPages: 1, getData: () => new Promise((_, reject) => { rejectData = reject; }), loadingTask: task };
  lib.getDocument = () => Object.assign(task, { promise: Promise.resolve(pdf) });
  const failed = [];
  const result = await tryOpenCloudPdfStream({
    pdfjsReady: Promise.resolve(lib), filePath: 'a', probeTag: async () => 'untagged', source: async () => ({ url: 'u' }),
    onAllBytes: () => {}, onBytesFailed: (e) => failed.push(e.message),
  });
  assert.equal(result.pdf, pdf);
  await pdf.loadingTask.destroy();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(failed, []);
});

// --- Mirrored files never paint unmirrored: the pre-paint tag probe ---
import { probePdfPresentationTag } from '../src/services/cloudPdfStream.js';
import { PDFDocument } from 'pdf-lib';
import { reflectPdfPagePresentations, pdfBytesHavePresentationTag } from '../src/utils/pdfPagePresentation.js';

function rangeFetch(bytes, log = []) {
  return async (url, { headers }) => {
    const range = headers.Range;
    log.push(range);
    let start; let end;
    const suffix = /^bytes=-(\d+)$/.exec(range);
    if (suffix) { start = Math.max(0, bytes.length - Number(suffix[1])); end = bytes.length - 1; } else {
      const m = /^bytes=(\d+)-(\d+)$/.exec(range); start = Number(m[1]); end = Math.min(bytes.length - 1, Number(m[2]));
    }
    const body = bytes.slice(start, end + 1);
    return { status: 206, headers: { get: () => `bytes ${start}-${end}/${bytes.length}` }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
  };
}

async function makePdf({ mirrored = false, pages = 3, objectStreams = false, filler = 0 } = {}) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i += 1) {
    const page = doc.addPage([600, 800]);
    page.drawText('x'.repeat(filler || 1), { x: 10, y: 10, size: 4 });
  }
  if (mirrored) await reflectPdfPagePresentations(doc, { 2: { mirrorH: true, mirrorV: false } });
  return doc.save({ useObjectStreams: objectStreams });
}

test('probe finds the mirror tag from the trailer and catalog only', async () => {
  const bytes = await makePdf({ mirrored: true, pages: 40, filler: 4000 });
  assert.equal(pdfBytesHavePresentationTag(bytes), true);
  const log = [];
  assert.equal(await probePdfPresentationTag('u', { fetchImpl: rangeFetch(bytes, log) }), 'tagged');
  assert.ok(log.length <= 3, `few small reads: ${log}`);
});

test('probe says untagged for a plain file (classic xref and xref stream)', async () => {
  assert.equal(await probePdfPresentationTag('u', { fetchImpl: rangeFetch(await makePdf({ pages: 40, filler: 4000 })) }), 'untagged');
  assert.equal(await probePdfPresentationTag('u', { fetchImpl: rangeFetch(await makePdf({ objectStreams: true })) }), 'untagged');
});

test('probe follows an incremental update to the latest catalog', async () => {
  const base = await makePdf({ mirrored: true, pages: 30, filler: 4000 });
  // Incremental update: a new catalog without the tag, appended.
  const text = Buffer.from(base).toString('latin1');
  const root = Number(/\/Root (\d+) 0 R/.exec(text.slice(text.lastIndexOf('trailer')))[1]);
  const pagesRef = /\/Pages (\d+ \d+ R)/.exec(text)[1];
  const prev = Number(/startxref\s+(\d+)/.exec(text.slice(text.lastIndexOf('startxref')))[1]);
  const size = Number(/\/Size (\d+)/.exec(text.slice(text.lastIndexOf('trailer')))[1]);
  const objAt = base.length;
  const obj = `${root} 0 obj\n<< /Type /Catalog /Pages ${pagesRef} >>\nendobj\n`;
  const xrefAt = objAt + obj.length;
  const update = `${obj}xref\n0 1\n0000000000 65535 f \n${root} 1\n${String(objAt).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${size} /Root ${root} 0 R /Prev ${prev} >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  const updated = new Uint8Array([...base, ...Buffer.from(update, 'latin1')]);
  // The tag is still in the old bytes, but the live catalog no longer has it.
  assert.equal(await probePdfPresentationTag('u', { fetchImpl: rangeFetch(updated) }), 'untagged');
});

test('probe is unknown (download) when ranges are not honoured or reads fail', async () => {
  const whole = async () => ({ status: 200, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
  assert.equal(await probePdfPresentationTag('u', { fetchImpl: whole }), 'unknown');
  assert.equal(await probePdfPresentationTag('u', { fetchImpl: async () => { throw new Error('cors'); } }), 'unknown');
  assert.equal(await probePdfPresentationTag('u', { fetchImpl: rangeFetch(new Uint8Array(Buffer.from('not a pdf'))) }), 'unknown');
});

test('a tagged or unknown stream hands back no pdf, so the download applies the mirror before paint', async () => {
  for (const [tag, reason] of [['tagged', 'presentation-tag'], ['unknown', 'presentation-tag-unknown']]) {
    const lib = fakePdfjs();
    const reasons = [];
    const all = [];
    const result = await tryOpenCloudPdfStream({
      pdfjsReady: Promise.resolve(lib), filePath: 'm.pdf', source: async () => ({ url: 'u' }),
      probeTag: async () => tag, onFallback: (r) => reasons.push(r), onAllBytes: (b) => all.push(b),
    });
    assert.equal(result, null);
    assert.deepEqual(reasons, [reason]);
    assert.equal(lib.destroyed, 1);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(all.length, 0);
  }
});

test('the pdf is not handed back before the tag probe answers', async () => {
  const lib = fakePdfjs();
  let answer;
  const pending = tryOpenCloudPdfStream({
    pdfjsReady: Promise.resolve(lib), filePath: 'a', source: async () => ({ url: 'u' }),
    probeTag: () => new Promise((r) => { answer = r; }),
  });
  let settled = false;
  pending.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(settled, false);
  answer('untagged');
  assert.ok((await pending).pdf);
});

test('probe uses the stored size when Content-Range is not readable (CORS)', async () => {
  const bytes = await makePdf({ mirrored: true, pages: 40, filler: 4000 });
  const inner = rangeFetch(bytes);
  const hidden = async (url, init) => { const r = await inner(url, init); return { ...r, headers: { get: () => null } }; };
  assert.equal(await probePdfPresentationTag('u', { fetchImpl: hidden }), 'unknown');
  assert.equal(await probePdfPresentationTag('u', { fetchImpl: hidden, size: bytes.length }), 'tagged');
  const plain = await makePdf({ pages: 40, filler: 4000 });
  const inner2 = rangeFetch(plain);
  const hidden2 = async (url, init) => { const r = await inner2(url, init); return { ...r, headers: { get: () => null } }; };
  assert.equal(await probePdfPresentationTag('u', { fetchImpl: hidden2, size: plain.length }), 'untagged');
});

test('the stored size reaches the probe', async () => {
  const seen = [];
  await tryOpenCloudPdfStream({
    pdfjsReady: Promise.resolve(fakePdfjs()), filePath: 'a', source: async () => ({ url: 'u', size: 1234 }),
    probeTag: async (url, size) => { seen.push(size); return 'untagged'; },
  });
  assert.deepEqual(seen, [1234]);
});

test('a tagged probe falls back at once, without waiting for pdf.js', async () => {
  // pdf.js never answers and the open timeout is far away: resolving at all
  // proves the probe rejected without waiting on pdf.js.
  const hanging = fakePdfjs({ hang: true });
  const result = await tryOpenCloudPdfStream({
    pdfjsReady: Promise.resolve(hanging), filePath: 'a', source: async () => ({ url: 'u' }),
    probeTag: async () => 'tagged', timeoutMs: 2 ** 31 - 1,
  });
  assert.equal(result, null);
  assert.equal(hanging.destroyed, 1);
});

import { createCloudRangeTransport } from '../src/services/cloudPdfStream.js';

class FakeRangeBase {
  constructor(length) { this.length = length; this.ranges = []; }
  onDataRange(begin, chunk) { this.ranges.push([begin, Array.from(chunk)]); }
}
const transportBytes = Uint8Array.from({ length: 64 }, (_, i) => i);
const transportFetch = (log, { status = 206, ignoreRange = false } = {}) => async (url, init) => {
  log.push(init.headers.Range);
  const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
  const body = ignoreRange ? transportBytes : transportBytes.slice(Number(a), Number(b) + 1);
  return { status: ignoreRange ? 200 : status, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

test('range transport fetches each chunk with Range and needs no readable headers', async () => {
  const log = [];
  const t = createCloudRangeTransport({ pdfjsLib: { PDFDataRangeTransport: FakeRangeBase }, url: 'u', length: 64, fetchImpl: transportFetch(log) });
  t.requestDataRange(8, 12);
  await settle();
  assert.deepEqual(log, ['bytes=8-11']);
  assert.deepEqual(t.ranges, [[8, [8, 9, 10, 11]]]);
});

test('range transport slices a full-file 200 and reports failures once', async () => {
  const t = createCloudRangeTransport({ pdfjsLib: { PDFDataRangeTransport: FakeRangeBase }, url: 'u', length: 64, fetchImpl: transportFetch([], { ignoreRange: true }) });
  t.requestDataRange(4, 6);
  await settle();
  assert.deepEqual(t.ranges, [[4, [4, 5]]]);
  const errors = [];
  const bad = createCloudRangeTransport({ pdfjsLib: { PDFDataRangeTransport: FakeRangeBase }, url: 'u', length: 64, fetchImpl: transportFetch([], { status: 403 }), retryDelayMs: 0, onError: (e) => errors.push(e.message) });
  bad.requestDataRange(0, 2);
  bad.requestDataRange(2, 4);
  for (let i = 0; i < 20; i += 1) await settle();
  assert.deepEqual(errors, ['range 403']);
  assert.deepEqual(bad.ranges, []);
});

test('no transport without a known size or pdf.js support', () => {
  const lib = { PDFDataRangeTransport: FakeRangeBase };
  assert.equal(createCloudRangeTransport({ pdfjsLib: lib, url: 'u', length: NaN, fetchImpl: async () => {} }), null);
  assert.equal(createCloudRangeTransport({ pdfjsLib: {}, url: 'u', length: 10, fetchImpl: async () => {} }), null);
});

test('the stream open uses the range transport when the stored size is known', async () => {
  const lib = fakePdfjs();
  lib.PDFDataRangeTransport = FakeRangeBase;
  const result = await tryOpenCloudPdfStream({
    pdfjsLib: lib, filePath: 'p', source: async () => ({ url: 'https://x/signed', size: 64 }),
    probeTag: async () => 'untagged', fetchImpl: transportFetch([]),
  });
  assert.ok(result?.pdf);
  assert.ok(lib.calls[0].range instanceof FakeRangeBase);
  assert.equal(lib.calls[0].length, 64);
  assert.equal(lib.calls[0].url, undefined);
  assert.equal(lib.calls[0].disableAutoFetch, false);
});

test('a range chunk is retried before the stream gives up', async () => {
  let calls = 0;
  const flaky = async (url, init) => {
    calls += 1;
    if (calls < 3) throw new Error('network');
    return transportFetch([])(url, init);
  };
  const errors = [];
  const t = createCloudRangeTransport({ pdfjsLib: { PDFDataRangeTransport: FakeRangeBase }, url: 'u', length: 64, fetchImpl: flaky, retryDelayMs: 0, onError: (e) => errors.push(e) });
  t.requestDataRange(0, 2);
  for (let i = 0; i < 10; i += 1) await settle();
  assert.equal(calls, 3);
  assert.deepEqual(errors, []);
  assert.deepEqual(t.ranges, [[0, [0, 1]]]);
});

test('a range failure after the open reports onStreamBroken and keeps the pdf', async () => {
  const lib = fakePdfjs();
  lib.PDFDataRangeTransport = FakeRangeBase;
  const broken = [];
  const result = await tryOpenCloudPdfStream({
    pdfjsLib: lib, filePath: 'p', source: async () => ({ url: 'https://x/signed', size: 64 }),
    probeTag: async () => 'untagged', fetchImpl: async () => ({ status: 500, arrayBuffer: async () => new ArrayBuffer(0) }),
    onStreamBroken: (e) => broken.push(e.message),
  });
  assert.ok(result?.pdf);
  lib.calls[0].range.requestDataRange(0, 2);
  await new Promise((r) => setTimeout(r, 2000));
  assert.deepEqual(broken, ['range 500']);
  assert.equal(lib.destroyed, 0);
});

test('a range failure after pdf.js resolves but before the open returns falls back', async () => {
  const lib = fakePdfjs();
  lib.PDFDataRangeTransport = FakeRangeBase;
  let releaseTag;
  const fallbacks = [];
  const broken = [];
  const pending = tryOpenCloudPdfStream({
    pdfjsLib: lib, filePath: 'p', source: async () => ({ url: 'https://x/signed', size: 64 }),
    probeTag: () => new Promise((r) => { releaseTag = () => r('untagged'); }),
    fetchImpl: async () => ({ status: 500, arrayBuffer: async () => new ArrayBuffer(0) }),
    onFallback: (why) => fallbacks.push(why),
    onStreamBroken: (e) => broken.push(e.message),
  });
  while (!lib.calls[0] || !releaseTag) await settle();
  lib.calls[0].range.requestDataRange(0, 2);
  await new Promise((r) => setTimeout(r, 2000));
  releaseTag();
  assert.equal(await pending, null);
  assert.deepEqual(fallbacks, ['range 500']);
  assert.deepEqual(broken, []);
  assert.ok(lib.destroyed >= 1);
});

test('range transport rejects a file whose size is not the stored size (no retries)', async () => {
  const sized = (total, { status = 206, headers = true } = {}) => async (url, init) => {
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
    const file = Uint8Array.from({ length: total }, (_, i) => i % 256);
    const body = status === 200 ? file : file.slice(Number(a), Math.min(total, Number(b) + 1));
    return {
      status,
      headers: { get: (name) => (headers && name.toLowerCase() === 'content-range' ? `bytes ${a}-${b}/${total}` : null) },
      arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
    };
  };
  // Cross-origin Content-Range is often unreadable: the bodies alone must
  // reveal the mismatch (the last chunk asks one byte past the stored end).
  for (const [fetchImpl, label, begin, end] of [
    [sized(80), '206 longer file', 0, 8],
    [sized(48), '206 shorter file', 0, 8],
    [sized(80, { status: 200 }), '200 full body', 0, 8],
    [sized(80, { headers: false }), '206 longer file, no headers, last chunk', 56, 64],
    [sized(60, { headers: false }), '206 shorter file, no headers, last chunk', 56, 64],
  ]) {
    let calls = 0;
    const errors = [];
    const t = createCloudRangeTransport({
      pdfjsLib: { PDFDataRangeTransport: FakeRangeBase }, url: 'u', length: 64, retryDelayMs: 0,
      fetchImpl: async (...args) => { calls += 1; return fetchImpl(...args); },
      onError: (e) => errors.push(e.message),
    });
    t.requestDataRange(begin, end);
    for (let i = 0; i < 10; i += 1) await settle();
    assert.deepEqual(errors, ['range size mismatch'], label);
    assert.deepEqual(t.ranges, [], label);
    assert.equal(calls, 1, label);
  }
  // Matching sizes still stream.
  const ok = createCloudRangeTransport({ pdfjsLib: { PDFDataRangeTransport: FakeRangeBase }, url: 'u', length: 64, fetchImpl: sized(64) });
  ok.requestDataRange(0, 2);
  await settle();
  assert.deepEqual(ok.ranges, [[0, [0, 1]]]);
  const okNoHeaders = createCloudRangeTransport({ pdfjsLib: { PDFDataRangeTransport: FakeRangeBase }, url: 'u', length: 64, fetchImpl: sized(64, { headers: false }) });
  okNoHeaders.requestDataRange(62, 64);
  await settle();
  assert.deepEqual(okNoHeaders.ranges, [[62, [62, 63]]]);
});

test('a pdf.js parse error on the stream falls back to the full download', async () => {
  for (const name of ['InvalidPDFException', 'FormatError', 'UnknownErrorException']) {
    let destroyed = 0;
    const lib = {
      VerbosityLevel: {},
      getDocument: () => {
        const error = Object.assign(new Error('Invalid PDF structure.'), { name });
        const promise = Promise.reject(error);
        promise.catch(() => {});
        return { promise, destroy: async () => { destroyed += 1; } };
      },
    };
    const reasons = [];
    const result = await tryOpenCloudPdfStream({
      pdfjsReady: Promise.resolve(lib), filePath: 'p', source: async () => ({ url: 'https://x/signed', size: 64 }),
      probeTag: async () => 'untagged', onFallback: (why) => reasons.push(why),
    });
    assert.equal(result, null, name);
    assert.deepEqual(reasons, ['Invalid PDF structure.'], name);
    assert.equal(destroyed, 1, name);
  }
});
