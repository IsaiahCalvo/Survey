import test from 'node:test';
import assert from 'node:assert/strict';
import { readPdfPageCount } from '../src/home/pdfUploadWork.js';

const never = () => new Promise(() => {});
async function outcome(promise) {
  let timer;
  try {
    return await Promise.race([
      promise.then(value => ({ value }), error => ({ error })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ hung: true }), 500); }),
    ]);
  } finally { clearTimeout(timer); }
}

test('a stuck page-count parse has a deadline and releases its owned task', async () => {
  let destroyed = 0, loads = 0;
  const result = await outcome(readPdfPageCount({}, {
    timeoutMs: 25, cleanupTimeoutMs: 10,
    readBlobAsArrayBuffer: async () => new ArrayBuffer(4),
    loadPdfjs: async () => ({ VerbosityLevel: { ERRORS: 0 }, getDocument() {
      loads++;
      return { promise: never(), destroy: async () => { destroyed++; } };
    } }),
  }));
  assert.equal(result.hung, undefined, 'optional parsing must not hold upload locks forever');
  assert.equal(result.error?.code, 'PDF_PAGE_COUNT_TIMEOUT');
  assert.equal(destroyed, 1);
  assert.equal(loads, 1, 'timeout must not start another parse');
});

function probe(overrides = {}) {
  const events = [], workers = [];
  class PDFWorker {
    constructor(options) { this.options = options; this.promise = Promise.resolve(); workers.push(this); events.push('worker-start'); }
    destroy() { events.push('worker-stop'); this.destroyed = true; }
  }
  const library = { PDFWorker, VerbosityLevel: { ERRORS: 0 },
    GlobalWorkerOptions: { workerPort: { terminate() { throw new Error('Do not terminate a viewer port'); } } },
    getDocument(options) {
      events.push('parse'); assert.equal(options.worker, workers.at(-1)); assert.equal(options.worker.options.port, undefined);
      return { promise: overrides.parse ? overrides.parse() : Promise.resolve({ numPages: 7 }),
        destroy: () => { events.push('task-stop'); return overrides.destroy ? overrides.destroy() : Promise.resolve(); } };
    } };
  return { events, workers, options: {
    timeoutMs: 35, cleanupTimeoutMs: 10,
    readBlobAsArrayBuffer: () => { events.push('read'); return overrides.read ? overrides.read() : Promise.resolve(new ArrayBuffer(4)); },
    loadPdfjs: () => { events.push('load'); return overrides.load ? overrides.load() : Promise.resolve(library); },
  } };
}

for (const stage of ['read', 'load']) test(`a stuck ${stage} cannot start a late parser after its deadline`, async () => {
  let resolve;
  const held = new Promise(done => { resolve = done; });
  const f = probe({ [stage]: () => held });
  const result = await outcome(readPdfPageCount({}, f.options));
  assert.equal(result.error?.code, 'PDF_PAGE_COUNT_TIMEOUT');
  resolve(stage === 'read' ? new ArrayBuffer(4) : { getDocument() { assert.fail('late parser'); } });
  await new Promise(setImmediate);
  assert.deepEqual(f.events, stage === 'read' ? ['read'] : ['read', 'load']);
});

test('a successful count survives stuck task cleanup and terminates only its own worker', async () => {
  const f = probe({ destroy: never });
  const result = await outcome(readPdfPageCount({}, f.options));
  assert.equal(result.value, 7);
  assert.deepEqual(f.events, ['read', 'load', 'worker-start', 'parse', 'task-stop', 'worker-stop']);
  assert.equal(f.workers[0].destroyed, true);
});

test('failed parse with stuck cleanup does not launch another worker', async () => {
  const f = probe({ parse: async () => { throw new Error('Unreadable PDF'); }, destroy: never });
  const result = await outcome(readPdfPageCount({}, f.options));
  assert.match(result.error?.message || '', /Unreadable PDF/);
  assert.equal(f.workers.length, 1); assert.equal(f.workers[0].destroyed, true);
});

test('already canceled probes do no file read, module load, or parser work', async () => {
  const f = probe(); const controller = new AbortController(); controller.abort();
  const result = await outcome(readPdfPageCount({}, { ...f.options, signal: controller.signal }));
  assert.equal(result.error?.code, 'PDF_PAGE_COUNT_ABORTED'); assert.deepEqual(f.events, []);
});

test('cancellation while parsing tears down owned resources and never retries', async () => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = probe({ parse: () => { started(); return never(); }, destroy: never });
  const controller = new AbortController();
  const pending = readPdfPageCount({}, { ...f.options, signal: controller.signal, timeoutMs: 200 });
  await ready; controller.abort();
  const result = await outcome(pending);
  assert.equal(result.error?.code, 'PDF_PAGE_COUNT_ABORTED');
  assert.equal(f.workers.length, 1); assert.equal(f.workers[0].destroyed, true);
});

test('late parse rejection after timeout is observed and cannot create another task', async () => {
  let reject;
  const held = new Promise((_resolve, fail) => { reject = fail; });
  const f = probe({ parse: () => held });
  const result = await outcome(readPdfPageCount({}, f.options));
  assert.equal(result.error?.code, 'PDF_PAGE_COUNT_TIMEOUT');
  reject(new Error('late parser failure')); await new Promise(setImmediate);
  assert.equal(f.workers.length, 1); assert.equal(f.workers[0].destroyed, true);
});

test('invalid deadline settings fail before reading any bytes', async () => {
  for (const value of [0, -1, NaN, Infinity, 1.5, 300001]) {
    const f = probe(); await assert.rejects(readPdfPageCount({}, { ...f.options, timeoutMs: value }), RangeError);
    await assert.rejects(readPdfPageCount({}, { ...f.options, cleanupTimeoutMs: value }), RangeError);
    assert.deepEqual(f.events, []);
  }
});
