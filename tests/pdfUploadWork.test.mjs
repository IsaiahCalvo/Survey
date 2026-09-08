import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { readPdfPageCount, mapUploadsBounded } from '../src/home/pdfUploadWork.js';

function parser(failures = 0) {
  const events = [];
  let attempt = 0;
  return {
    events,
    adapters: {
      readBlobAsArrayBuffer: async () => new ArrayBuffer(4),
      loadPdfjs: async () => ({
        VerbosityLevel: { ERRORS: 0 },
        getDocument(options) {
          const current = attempt++;
          events.push(['load', current, options]);
          return {
            promise: current < failures ? Promise.reject(new Error(`parse-${current}`)) : Promise.resolve({ numPages: 8 }),
            destroy: async () => { events.push(['destroy', current]); },
          };
        },
      }),
    },
  };
}

test('page counts release the loading task after a successful parse', async () => {
  const fake = parser();
  assert.equal(await readPdfPageCount({}, fake.adapters), 8);
  assert.deepEqual(fake.events.map(event => event.slice(0, 2)), [['load', 0], ['destroy', 0]]);
});

test('failed first parse is destroyed before recovery starts with fresh bytes', async () => {
  const fake = parser(1);
  assert.equal(await readPdfPageCount({}, fake.adapters), 8);
  assert.deepEqual(fake.events.map(event => event.slice(0, 2)), [['load', 0], ['destroy', 0], ['load', 1], ['destroy', 1]]);
  const [first, second] = fake.events.filter(event => event[0] === 'load').map(event => event[2]);
  assert.notEqual(first.data, second.data);
  assert.equal(second.stopAtErrors, false);
});

test('both failed parses release resources and preserve the final parse error', async () => {
  const fake = parser(2);
  await assert.rejects(readPdfPageCount({}, fake.adapters), /parse-1/);
  assert.deepEqual(fake.events.map(event => event.slice(0, 2)), [['load', 0], ['destroy', 0], ['load', 1], ['destroy', 1]]);
});

test('batch workers never exceed three and preserve input order despite failures', async () => {
  let active = 0;
  let peak = 0;
  const entries = [0, 1, 2, 3, 4, 5, 6];
  const results = await mapUploadsBounded(entries, async entry => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise(resolve => setTimeout(resolve, (7 - entry) % 3));
      if (entry === 2) throw new Error('upload failed');
      return { success: true, entry };
    } finally { active--; }
  });
  assert.equal(peak, 3);
  assert.equal(active, 0);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled', 'fulfilled']);
  assert.deepEqual(results.map(result => result.value?.entry ?? null), [0, 1, null, 3, 4, 5, 6]);
  assert.match(results[2].reason.message, /upload failed/);
});

test('empty batches do not start workers', async () => {
  assert.deepEqual(await mapUploadsBounded([], () => { throw new Error('unexpected'); }), []);
});

for (const [mode, marker] of [
  ['desktop', '// Background: store the bytes (content-addressed, idempotent —'],
  ['browser', '// Background: store the bytes (content-addressed, idempotent)'],
]) {
  for (const fail of [false, true]) {
    test(`${mode} retry writes the resolved legacy path and ${fail ? 'retains replacement on failure' : 'archives only after upload'}`, async () => {
      const source = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
      const start = source.indexOf('(async () => {', source.indexOf(marker));
      const end = source.indexOf('})();', start) + 5;
      assert.ok(start > 0 && end > start);
      const events = [];
      const errors = [];
      let active = 0;
      const dependencies = {
        file: new File(['pdf'], 'same.pdf'), projectId: 'project', contentSha: 'content-hash',
        resolvedDoc: { id: 'existing', file_path: 'owner/legacy/original.pdf', page_count: 2 },
        replaceStorageDocument: async (file, path) => {
          events.push(['upload', path]);
          if (fail) throw new Error('offline');
          return path;
        },
        uploadToStorage: async () => { events.push(['upload', 'owner/content-hash.pdf']); },
        readPdfPageCount: async () => 2, readBlobAsArrayBuffer: () => {}, loadPdfjs: () => {},
        setActiveUploads: updater => { active = updater(active); },
        archiveReplacedDocument: async id => events.push(['archive', id]),
        duplicateGate: { archiveDocId: 'old-version' },
        updateSupabaseDocument: async () => {}, refetchAllDocuments: () => events.push(['refresh']),
        setDashboardError: message => errors.push(message),
        perfUpload: { mark() {}, end() {} }, console: { error() {} },
      };
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      await AsyncFunction(...Object.keys(dependencies), `await ${source.slice(start, end)}`)(...Object.values(dependencies));
      assert.deepEqual(events[0], ['upload', 'owner/legacy/original.pdf']);
      assert.equal(events.some(([event]) => event === 'archive'), !fail);
      assert.equal(events.some(([event]) => event === 'refresh'), !fail);
      assert.equal(errors.length, fail ? 1 : 0);
      assert.equal(active, 0);
    });
  }
}

test('all dashboard page-count paths use resource cleanup and batch awaits outstanding parsers', async () => {
  const source = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  assert.equal((source.match(/readPdfPageCount\(file,/g) || []).length, 3);
  assert.equal(source.includes('pdfjsLib.getDocument('), false);
  assert.match(source, /await mapUploadsBounded\(batchEntries/);
  assert.match(source, /finally\s*\{\s*await pageCountPromise;/);
});

test('real dashboard batch keeps failed uploads in their slot until parser cleanup and preserves error rows', async () => {
  const source = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  const start = source.indexOf('const settledFiles = await mapUploadsBounded');
  const end = source.indexOf('// Count successes and collect errors', start);
  assert.ok(start >= 0 && end > start);
  let activeParsers = 0;
  let peakParsers = 0;
  let destroys = 0;
  const entries = Array.from({ length: 8 }, (_, index) => ({
    file: new File([String(index)], `${index}.pdf`), name: `${index}.pdf`,
  }));
  const dependencies = {
    batchEntries: entries, readPdfPageCount, mapUploadsBounded,
    computeContentSha256: async bytes => `hash-${bytes[0]}`,
    readBlobAsArrayBuffer: file => file.arrayBuffer(),
    loadPdfjs: async () => ({
      VerbosityLevel: { ERRORS: 0 },
      getDocument() {
        activeParsers++;
        peakParsers = Math.max(peakParsers, activeParsers);
        return {
          promise: new Promise(resolve => setTimeout(() => resolve({ numPages: 2 }), 4)),
          destroy: async () => { activeParsers--; destroys++; },
        };
      },
    }),
    uploadToStorage: async file => {
      if (file.name === '1.pdf') throw new Error('connection lost');
      return `owner/${file.name}`;
    },
    newProject: { id: 'project-1' },
    createSupabaseDocument: async data => ({ id: data.name, ...data }),
    updateSupabaseDocument: async () => {},
    console: { error() {}, warn() {} },
  };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const execute = AsyncFunction(...Object.keys(dependencies), `${source.slice(start, end)}\nreturn results;`);
  const results = await execute(...Object.values(dependencies));
  assert.equal(peakParsers, 3);
  assert.equal(activeParsers, 0);
  assert.equal(destroys, entries.length);
  assert.deepEqual(results.map(result => result.file), entries.map(entry => entry.file.name));
  assert.deepEqual(results[1], { success: false, file: '1.pdf', error: 'connection lost' });
  assert.equal(results.filter(result => result.success).length, 7);
});
