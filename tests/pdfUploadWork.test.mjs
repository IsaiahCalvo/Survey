import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { preparePdfUpload, readPdfPageCount, mapUploadsBounded } from '../src/home/pdfUploadWork.js';

test('upload snapshot is owned before hashing and retains metadata before the read await', async () => {
  const source = new File(['original source bytes'], 'source.pdf', { type: 'application/pdf', lastModified: 1234 });
  source.user_id = 'actor-a';
  source.id = 'must-not-copy-cloud-identity';
  source.arrayBuffer = () => assert.fail('instance read override must not run');
  source.slice = () => assert.fail('instance slice override must not run');
  let release; let reads = 0; let hashInput;
  const pending = preparePdfUpload(source, {
    readBlobAsArrayBuffer: async blob => {
      reads++; assert.equal(blob instanceof Blob, true); assert.equal(blob instanceof File, false);
      await new Promise(resolve => { release = resolve; });
      return blob.arrayBuffer();
    },
    computeContentSha256: async bytes => {
      hashInput = new TextDecoder().decode(bytes);
      bytes.fill(0); // A retained/detached hashing buffer must not own uploaded bytes.
      await Promise.resolve(); return 'expected-hash';
    },
  });
  Object.defineProperties(source, { name: { value: 'later.pdf' }, lastModified: { value: 9999 } });
  source.user_id = 'actor-b';
  release();
  const prepared = await pending;
  assert.equal(reads, 1); assert.equal(hashInput, 'original source bytes');
  assert.notEqual(prepared.file, source);
  assert.equal(await prepared.file.text(), 'original source bytes');
  assert.equal(prepared.file.name, 'source.pdf'); assert.equal(prepared.file.lastModified, 1234);
  assert.equal(prepared.file.type, 'application/pdf'); assert.equal(prepared.file.user_id, 'actor-a');
  assert.equal(prepared.file.id, undefined); assert.equal(prepared.contentSha, 'expected-hash');
});

test('upload preparation preserves compatibility readers and does not introduce PDF header rejection', async () => {
  const file = new File(['not a parsed PDF'], 'legacy.pdf', { type: 'application/pdf' });
  const prepared = await preparePdfUpload(file, {
    readBlobAsArrayBuffer: blob => new Response(blob).arrayBuffer(),
    computeContentSha256: async bytes => `length-${bytes.length}`,
  });
  assert.equal(await prepared.file.text(), 'not a parsed PDF');
  assert.equal(prepared.contentSha, 'length-16');
  assert.equal(Object.hasOwn(prepared.file, 'user_id'), false);
});

test('upload preparation stops on read/size/hash failure without returning a usable upload', async () => {
  const file = new File(['source'], 'source.pdf'); let hashes = 0;
  for (const readBlobAsArrayBuffer of [async () => { throw new Error('read failed'); }, async () => new ArrayBuffer(1)]) {
    await assert.rejects(preparePdfUpload(file, { readBlobAsArrayBuffer, computeContentSha256: async () => { hashes++; } }));
  }
  assert.equal(hashes, 0);
  await assert.rejects(preparePdfUpload(file, { readBlobAsArrayBuffer: blob => blob.arrayBuffer(), computeContentSha256: async () => { throw new Error('hash failed'); } }), /hash failed/);
});

for (const alias of [false, true]) {
  test(`actual browser upload binds ${alias ? 'alias healing' : 'preview, upload and parser'} to the bytes read before hashing`, async () => {
    const source = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
    const start = source.indexOf('const handleFileUpload = async');
    const end = source.indexOf('// Create Project flow', start);
    assert.ok(start > 0 && end > start);
    const original = new File(['old physical bytes'], 'picked.pdf', { type: 'application/pdf', lastModified: 1234 });
    const event = { target: { files: [original], value: 'selected' } };
    const files = []; const events = []; const errors = []; let active = 0; let reads = 0;
    const dependencies = {
      preparePdfUpload, user: { id: 'actor-a' }, uploadTargetProjectRef: { current: null }, selectedProjectId: null, activeSection: 'documents',
      readBlobAsArrayBuffer: async blob => { reads++; return blob.arrayBuffer(); },
      computeContentSha256: async bytes => {
        assert.equal(new TextDecoder().decode(bytes), 'old physical bytes');
        bytes.fill(0);
        original.arrayBuffer = async () => new TextEncoder().encode('new physical bytes').buffer;
        Object.defineProperty(original, 'name', { value: 'changed.pdf' });
        await Promise.resolve(); return 'old-hash';
      },
      confirmSameNameDifferentContent: async input => { assert.equal(input.fileName, 'picked.pdf'); return { proceed: true }; },
      createSupabaseDocument: async input => {
        assert.equal(input.content_sha256, 'old-hash'); assert.equal(input.file_size, 18);
        return { ...input, id: 'resolved', name: alias ? 'existing-name.pdf' : input.name, file_path: 'actor-a/legacy.pdf', page_count: 2 };
      },
      replaceStorageDocument: async (file, path) => { files.push(['upload', file]); events.push(['replace', path]); return path; },
      readPdfPageCount: async file => { files.push(['parser', file]); return 2; },
      loadPdfjs: () => assert.fail('parser is stubbed'),
      onDocumentSelect: file => files.push(['viewer', file]),
      setDocuments: update => { const rows = update([]); files.push(['list', rows[0].file]); },
      setActiveUploads: update => { active = update(active); },
      archiveReplacedDocument: async () => events.push(['archive']),
      maybeOfferAlias: async () => events.push(['alias']), handleDocumentClick: async () => events.push(['open-existing']),
      refetchAllDocuments: () => events.push(['refresh']), updateSupabaseDocument: async () => {},
      setDashboardError: error => errors.push(error), onShowAuthModal: () => assert.fail('already signed in'),
      console: { error() {} }, perfUpload: { mark() {}, end() {} },
    };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await AsyncFunction(...Object.keys(dependencies), 'event', `${source.slice(start, end)}\nawait handleFileUpload(event);`)(...Object.values(dependencies), event);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reads, 1); assert.equal(active, 0); assert.deepEqual(errors, []); assert.equal(event.target.value, '');
    assert.deepEqual(files.map(([kind]) => kind).sort(), alias ? ['upload'] : ['list', 'parser', 'upload', 'viewer']);
    for (const [, file] of files) {
      assert.notEqual(file, original); assert.equal(file, files[0][1]);
      assert.equal(await file.text(), 'old physical bytes'); assert.equal(file.name, 'picked.pdf');
      assert.equal(file.user_id, 'actor-a'); assert.equal(file.lastModified, 1234);
      if (!alias) assert.equal(file.id, 'resolved');
    }
    assert.deepEqual(events[0], ['replace', 'actor-a/legacy.pdf']);
    if (alias) assert.deepEqual(events.map(([kind]) => kind), ['replace', 'archive', 'alias', 'open-existing', 'refresh']);
  });
}

test('desktop and browser alias repair both use storage replacement and its cache invalidation path', async () => {
  const source = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');
  const aliasBranches = source.split('if (resolvedDoc.content_sha256 === contentSha && resolvedDoc.name !== file.name) {').slice(1);
  assert.equal(aliasBranches.length, 2);
  for (const branch of aliasBranches) {
    const repair = branch.slice(0, branch.indexOf('await archiveReplacedDocument'));
    assert.match(repair, /await replaceStorageDocument\(file, resolvedDoc\.file_path\)/);
    assert.doesNotMatch(repair, /supabase\.storage|\.upload\(/);
    assert.match(repair, /catch \(upErr\)[\s\S]*return;/, 'failed healing cannot archive or open');
  }
});

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
  const uploaded = [];
  const entries = Array.from({ length: 8 }, (_, index) => ({
    file: new File([String(index)], `${index}.pdf`), name: `${index}.pdf`,
  }));
  const dependencies = {
    batchEntries: entries, preparePdfUpload, readPdfPageCount, mapUploadsBounded,
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
      uploaded.push(file);
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
  assert.equal(uploaded.length, entries.length);
  for (const file of uploaded) {
    const sourceFile = entries.find(entry => entry.file.name === file.name).file;
    assert.notEqual(file, sourceFile, 'batch upload uses the owned File, not the selected disk File');
    assert.equal(await file.text(), await sourceFile.text());
  }
});
