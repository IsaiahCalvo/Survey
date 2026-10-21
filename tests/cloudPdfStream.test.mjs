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
  assert.equal(shouldRetryStreamedOpenWithDownload({ openedByStream: true, filePath: 'a.pdf', forced: new Set(['a.pdf']) }), false);
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
  const bad = createCloudRangeTransport({ pdfjsLib: { PDFDataRangeTransport: FakeRangeBase }, url: 'u', length: 64, fetchImpl: transportFetch([], { status: 403 }), onError: (e) => errors.push(e.message) });
  bad.requestDataRange(0, 2);
  bad.requestDataRange(2, 4);
  await settle();
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

test('a range failure after the streamed open reloads by full download, tagged or not', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const body = src.match(/onBytesFailed: \(\) => \{([\s\S]{0,400}?)\n {12}\},/)?.[1] || '';
  assert.match(body, /streamNeedsBytesPathsRef\.current\.add\(streamPath\)/);
  assert.match(body, /setLoadRetryToken\(\(t\) => t \+ 1\)/);
  assert.doesNotMatch(body, /pdfBytesHavePresentationTag/);
});
