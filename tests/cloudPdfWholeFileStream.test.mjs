// Open speed (2026-11-09): a streamed cloud PDF reads the whole file in one
// GET and hands pdf.js each piece as it lands, instead of getData() asking for
// every missing chunk as one big range that pdf.js only sees once it has fully
// arrived (page 1, later pages and text search all waited for the last byte).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createCloudRangeTransport,
  streamGetDocumentOptions,
  tryOpenCloudPdfStream,
  STREAM_PUSH_BYTES,
} from '../src/services/cloudPdfStream.js';

class FakeRangeBase {
  constructor(length) { this.length = length; this.ranges = []; this.pieces = []; this.done = 0; }
  onDataRange(begin, chunk) { this.ranges.push([begin, chunk.length]); }
  onDataProgressiveRead(chunk) { this.pieces.push(chunk); }
  onDataProgressiveDone() { this.done += 1; }
}
const lib = { PDFDataRangeTransport: FakeRangeBase };
const fileOf = (n) => Uint8Array.from({ length: n }, (_, i) => (i * 7) % 256);
const settle = async (n = 30) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const joined = (pieces) => {
  const out = new Uint8Array(pieces.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of pieces) { out.set(p, at); at += p.length; }
  return out;
};

// A fetch whose body arrives in `step`-byte reads. `dropAfter` errors the read
// once that many bytes of this response were sent.
function bodyFetch(file, { log = [], step = 40_000, dropAfter = Infinity, total = file.length, status } = {}) {
  return async (url, init = {}) => {
    const range = init.headers?.Range;
    log.push({ range: range ?? null, priority: init.priority });
    let start = 0;
    let end = total;
    if (range) {
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range);
      start = Number(a);
      end = Math.min(total, Number(b) + 1);
    }
    const body = fileOf(total).slice(start, end);
    let sent = 0;
    const thisDrop = dropAfter;
    dropAfter = Infinity;
    return {
      status: status ?? (range ? 206 : 200),
      headers: { get: () => null },
      arrayBuffer: async () => body.buffer,
      body: {
        getReader: () => ({
          read: async () => {
            if (sent >= thisDrop) throw new Error('network drop');
            if (sent >= body.length) return { done: true };
            const value = body.slice(sent, Math.min(body.length, sent + step, thisDrop));
            sent += value.length;
            return { value, done: false };
          },
          cancel: async () => {},
        }),
      },
    };
  };
}

test('the whole file comes in one plain GET, in order, at low priority', async () => {
  const file = fileOf(600_000);
  const log = [];
  const t = createCloudRangeTransport({ pdfjsLib: lib, url: 'u', length: file.length, fetchImpl: bodyFetch(file, { log }) });
  const box = await t.startFullStream();
  assert.deepEqual(log, [{ range: null, priority: 'low' }]);
  assert.deepEqual(joined(t.pieces), file);
  assert.equal(t.done, 1);
  // Pieces are batched (fewer worker messages), the last one may be short.
  for (const piece of t.pieces.slice(0, -1)) assert.ok(piece.length >= STREAM_PUSH_BYTES);
  assert.deepEqual(box.bytes, file);
  // Each piece is its own buffer: pdf.js transfers (detaches) what it gets.
  assert.ok(t.pieces.every((p) => p.byteOffset === 0 && p.byteLength === p.buffer.byteLength));
  assert.ok(t.pieces.every((p) => p.buffer !== box.bytes.buffer));
});

test('a drop part way resumes from the last byte by range', async () => {
  const file = fileOf(500_000);
  const log = [];
  const errors = [];
  const t = createCloudRangeTransport({
    pdfjsLib: lib, url: 'u', length: file.length, retryDelayMs: 0,
    fetchImpl: bodyFetch(file, { log, dropAfter: 200_000 }), onError: (e) => errors.push(e),
  });
  const box = await t.startFullStream();
  assert.deepEqual(log.map((l) => l.range), [null, `bytes=200000-${file.length}`]);
  assert.deepEqual(box.bytes, file);
  assert.deepEqual(joined(t.pieces), file);
  assert.deepEqual(errors, []);
});

test('a file longer or shorter than the stored size stops the stream for good', async () => {
  for (const total of [500_001, 499_000]) {
    const errors = [];
    const log = [];
    const t = createCloudRangeTransport({
      pdfjsLib: lib, url: 'u', length: 500_000, retryDelayMs: 0,
      fetchImpl: bodyFetch(fileOf(total), { log, total }), onError: (e) => errors.push(e.message),
    });
    await assert.rejects(t.startFullStream(), /stream size mismatch/);
    assert.deepEqual(errors, ['stream size mismatch'], String(total));
    assert.equal(log.length, 1, 'no retries');
    assert.equal(t.done, 0);
    // A failed transport asks for no more ranges either.
    t.requestDataRange(0, 10);
    await settle();
    assert.equal(log.length, 1);
  }
});

test('a stream that keeps failing gives up quietly (pdf.js keeps reading by range)', async () => {
  const errors = [];
  const t = createCloudRangeTransport({
    pdfjsLib: lib, url: 'u', length: 1000, retryDelayMs: 0,
    fetchImpl: async () => ({ status: 500, body: null, arrayBuffer: async () => new ArrayBuffer(0) }),
    onError: (e) => errors.push(e),
  });
  await assert.rejects(t.startFullStream(), /stream 500/);
  assert.deepEqual(errors, []);
});

test('closing the document stops the stream', async () => {
  const file = fileOf(400_000);
  let reads = 0;
  const fetchImpl = async () => ({
    status: 200,
    body: { getReader: () => ({ read: async () => { reads += 1; await new Promise((r) => setTimeout(r, 5)); return { value: file.slice(0, 1000), done: false }; }, cancel: async () => {} }) },
  });
  const t = createCloudRangeTransport({ pdfjsLib: lib, url: 'u', length: file.length, fetchImpl });
  const all = t.startFullStream();
  await settle(5);
  t.abort();
  await assert.rejects(all, (e) => e.aborted === true);
  const after = reads;
  await settle(10);
  assert.ok(reads <= after + 1);
});

test('pdf.js is told to take the streamed pieces', () => {
  const t = createCloudRangeTransport({ pdfjsLib: lib, url: 'u', length: 10, fetchImpl: async () => ({}) });
  assert.equal(streamGetDocumentOptions('u', 0, { transport: t, length: 10 }).disableStream, false);
  // A transport without the whole-file read keeps the old contract.
  assert.equal(streamGetDocumentOptions('u', 0, { transport: {}, length: 10 }).disableStream, true);
});

function openLib({ getData } = {}) {
  const calls = { getData: 0, transport: null, streamStartedBeforeOpen: null };
  return {
    calls,
    PDFDataRangeTransport: FakeRangeBase,
    VerbosityLevel: { ERRORS: 0 },
    getDocument(options) {
      calls.transport = options.range;
      const promise = (async () => {
        await settle(2);
        calls.streamStartedBeforeOpen = calls.fetches > 0;
        return { numPages: 3, getData: async () => { calls.getData += 1; return getData ? getData() : new Uint8Array(0); } };
      })();
      return { promise, destroy: async () => {} };
    },
  };
}

test('a streamed open hands on the whole file without getData, and starts the read after the open', async () => {
  const file = fileOf(300_000);
  const pdfjs = openLib();
  pdfjs.calls.fetches = 0;
  const inner = bodyFetch(file);
  const fetchImpl = async (...args) => { pdfjs.calls.fetches += 1; return inner(...args); };
  const cached = [];
  const all = [];
  const result = await tryOpenCloudPdfStream({
    pdfjsLib: pdfjs, filePath: 'p', source: async () => ({ url: 'https://x/signed', size: file.length, onBytes: (b) => cached.push(b) }),
    probeTag: async () => 'untagged', fetchImpl, onAllBytes: (b) => all.push(b),
  });
  assert.ok(result?.pdf);
  assert.equal(pdfjs.calls.streamStartedBeforeOpen, false);
  await settle();
  assert.equal(pdfjs.calls.getData, 0);
  assert.deepEqual(all[0], file);
  assert.deepEqual(cached[0], file);
  assert.deepEqual(joined(pdfjs.calls.transport.pieces), file);
});

test('when the whole-file read fails, the bytes come from getData instead', async () => {
  const bytes = new Uint8Array([9, 9, 9]);
  const pdfjs = openLib({ getData: () => bytes });
  pdfjs.calls.fetches = 0;
  const all = [];
  const failed = [];
  const result = await tryOpenCloudPdfStream({
    pdfjsLib: pdfjs, filePath: 'p', source: async () => ({ url: 'https://x/signed', size: 1000 }),
    probeTag: async () => 'untagged',
    fetchImpl: async () => ({ status: 503, body: null }),
    onAllBytes: (b) => all.push(b), onBytesFailed: (e) => failed.push(e),
  });
  assert.ok(result?.pdf);
  for (let i = 0; i < 40 && !all.length; i += 1) await new Promise((r) => setTimeout(r, 300));
  assert.equal(pdfjs.calls.getData, 1);
  assert.deepEqual(all, [bytes]);
  assert.deepEqual(failed, []);
});
