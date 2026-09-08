import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { readPdfPageCount } from '../src/home/pdfUploadWork.js';

const require = createRequire(import.meta.url);
const installedPdfjs = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'), 'utf8');
// Use the installed public PDFWorker class unchanged. A browser-mode VM avoids
// pdf.js's Node-only fake-worker path; only browser messaging is synthetic.
const workerSource = installedPdfjs.slice(installedPdfjs.indexOf('class PDFWorker {'), installedPdfjs.indexOf('class WorkerTransport {'));
assert.ok(workerSource.startsWith('class PDFWorker {') && workerSource.trimEnd().endsWith('}'));

function fixture(t, options = {}) {
  const ports = [], wrappers = [], urls = [], revoked = [];
  let nativeCalls = 0, documentCalls = 0, taskDestroyCalls = 0;
  let entered; const parsing = new Promise(resolve => { entered = resolve; });
  const viewerPort = { terminate() { assert.fail('the viewer worker is not owned by the metadata probe'); } };
  const workerOptions = { workerSrc: options.workerSrc || 'https://offline.invalid/pdf.worker.mjs', workerPort: viewerPort };
  class NativeWorker {
    constructor(url, config) {
      nativeCalls++;
      if (options.nativeThrow) throw new Error('native worker denied');
      this.url = String(url); this.config = config; this.terminations = 0; this.listeners = new Map(); ports.push(this);
    }
    addEventListener(type, callback) { this.listeners.set(type, callback); }
    removeEventListener(type, callback) { if (this.listeners.get(type) === callback) this.listeners.delete(type); }
    dispatch(type) { this.listeners.get(type)?.({ type }); }
    postMessage() {}
    terminate() { this.terminations++; }
  }
  class ProbeURL extends URL {
    static createObjectURL(blob) { const url = `blob:https://offline.invalid/probe-${urls.length + 1}`; urls.push({ url, blob }); return url; }
    static revokeObjectURL(url) { revoked.push(url); }
  }
  class MessageHandler { on() {} send() {} destroy() {} }
  const location = new ProbeURL(options.location || 'https://offline.invalid/app');
  const globals = { isNodeJS: false, URL: ProbeURL, Blob, Promise, AbortController, Worker: NativeWorker, MessageHandler,
    window: { location }, GlobalWorkerOptions: workerOptions, getVerbosityLevel: () => 0,
    info() {}, warn() {}, shadow: (object, key, value) => { Object.defineProperty(object, key, { value }); return value; } };
  vm.runInNewContext(`${workerSource}\nthis.InstalledPDFWorker = PDFWorker;`, globals);
  class PDFWorker extends globals.InstalledPDFWorker {
    constructor(config) {
      if (options.wrapperThrow) throw new Error('PDFWorker construction failed');
      super(config); wrappers.push(this);
    }
  }
  const replacements = { Worker: options.noWorker ? undefined : NativeWorker, window: { location }, location, URL: ProbeURL };
  for (const [key, value] of Object.entries(replacements)) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => { if (prior) Object.defineProperty(globalThis, key, prior); else delete globalThis[key]; });
  }
  const lib = { PDFWorker, GlobalWorkerOptions: workerOptions, VerbosityLevel: { ERRORS: 0 }, getDocument({ worker }) {
    documentCalls++; entered();
    if (options.documentThrow) throw new Error('getDocument failed');
    assert.ok(worker instanceof PDFWorker);
    return {
      promise: options.success ? worker.promise.then(() => ({ numPages: 5 })) : new Promise(() => {}),
      destroy() { taskDestroyCalls++; return options.cleanupHang ? new Promise(() => {}) : Promise.resolve(); },
    };
  } };
  return { ports, wrappers, urls, revoked, parsing, viewerPort, workerOptions,
    calls: () => ({ nativeCalls, documentCalls, taskDestroyCalls }),
    run: extra => readPdfPageCount(new Blob(['%PDF local fixture']), {
      readBlobAsArrayBuffer: blob => blob.arrayBuffer(), loadPdfjs: async () => lib,
      timeoutMs: 25, cleanupTimeoutMs: 5, ...extra,
    }),
    assertReleased() {
      assert.ok(ports.length > 0, 'the test created a native browser worker');
      assert.ok(ports.every(port => port.terminations === 1), 'every owned native worker was terminated exactly once');
      assert.ok(ports.every(port => port.listeners.size === 0), 'native failure listeners were removed');
      assert.ok(wrappers.every(worker => worker.destroyed), 'all constructed public PDFWorker wrappers were destroyed');
      assert.equal(workerOptions.workerPort, viewerPort);
      assert.deepEqual(revoked, urls.map(entry => entry.url), 'every created wrapper URL was revoked');
    },
  };
}

test('silent native worker startup cannot survive the page-count deadline', { timeout: 1000 }, async t => {
  const f = fixture(t);
  await assert.rejects(f.run(), { code: 'PDF_PAGE_COUNT_TIMEOUT' });
  f.assertReleased();
  assert.equal(f.calls().documentCalls, 1, 'timeout does not launch another worker');
});

test('native worker construction failure does not fall back to parsing on the main thread', async t => {
  const f = fixture(t, { nativeThrow: true, workerSrc: 'https://cdn.offline.invalid/pdf.worker.mjs' });
  await assert.rejects(f.run());
  assert.equal(f.calls().documentCalls, 0);
  assert.equal(f.ports.length, 0);
  assert.equal(f.workerOptions.workerPort, f.viewerPort);
  assert.ok(f.urls.length > 0, 'the constructor failed after allocating its wrapper URL');
  assert.deepEqual(f.revoked, f.urls.map(entry => entry.url));
});

test('PDFWorker wrapper construction failure still terminates its native port', async t => {
  const f = fixture(t, { wrapperThrow: true });
  await assert.rejects(f.run(), /PDFWorker construction failed/);
  f.assertReleased();
  assert.equal(f.calls().documentCalls, 0);
});

test('synchronous getDocument failure releases each probe before any retry', async t => {
  const f = fixture(t, { documentThrow: true });
  await assert.rejects(f.run(), /getDocument failed/);
  f.assertReleased();
  assert.equal(f.calls().documentCalls, f.ports.length);
});

test('scope cancellation terminates a silent native worker and preserves the viewer port', { timeout: 1000 }, async t => {
  const f = fixture(t); const controller = new AbortController();
  const pending = f.run({ signal: controller.signal, timeoutMs: 500 });
  await f.parsing; controller.abort();
  await assert.rejects(pending, { code: 'PDF_PAGE_COUNT_ABORTED' });
  f.assertReleased();
});

for (const event of ['error', 'messageerror']) test(`native worker ${event} stops the probe and releases its resources`, { timeout: 1000 }, async t => {
  const f = fixture(t); const pending = f.run({ timeoutMs: 500 });
  await f.parsing;
  assert.ok(f.ports[0].listeners.has(event));
  f.ports[0].dispatch(event);
  await assert.rejects(pending, { code: 'PDF_PAGE_COUNT_WORKER_FAILED' });
  f.assertReleased();
  assert.equal(f.calls().documentCalls, 1);
});

test('a browser without Worker cannot fall back to main-thread PDF parsing', async t => {
  const f = fixture(t, { noWorker: true });
  await assert.rejects(f.run(), { code: 'PDF_PAGE_COUNT_WORKER_UNAVAILABLE' });
  assert.equal(f.calls().documentCalls, 0);
  assert.equal(f.ports.length, 0); assert.equal(f.wrappers.length, 0);
  assert.equal(f.workerOptions.workerPort, f.viewerPort);
});

test('hung loading-task cleanup cannot prevent native port termination', { timeout: 1000 }, async t => {
  const f = fixture(t, { cleanupHang: true });
  await assert.rejects(f.run(), { code: 'PDF_PAGE_COUNT_TIMEOUT' });
  assert.equal(f.calls().taskDestroyCalls, 1);
  f.assertReleased();
});

test('successful metadata parsing releases its own worker and leaves the viewer global port untouched', async t => {
  const f = fixture(t, { success: true });
  assert.equal(await f.run(), 5);
  f.assertReleased();
  assert.equal(f.calls().taskDestroyCalls, 1);
  assert.equal(f.ports[0].config.type, 'module');
});

for (const options of [
  { workerSrc: 'https://cdn.offline.invalid/pdf.worker.mjs' },
  { workerSrc: 'file:///offline/pdf.worker.mjs', location: 'file:///offline/app.html' },
]) test(`temporary worker wrapper URLs are released for ${options.workerSrc}`, { timeout: 1000 }, async t => {
  const f = fixture(t, options);
  await assert.rejects(f.run(), { code: 'PDF_PAGE_COUNT_TIMEOUT' });
  f.assertReleased();
  assert.ok(f.urls.length > 0, 'cross-origin and file origins use an owned module wrapper');
});
