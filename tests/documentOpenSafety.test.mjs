import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getDocumentOpenKey, isSameDocumentTab } from '../src/utils/documentTabIdentity.js';
import { isStorageFileNotFoundError } from '../src/utils/storageErrors.js';

const shellSource = await readFile(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
const dashboardSource = await readFile(new URL('../src/Dashboard.jsx', import.meta.url), 'utf8');

function extractHandler(source, start, end, dependencies) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, 'execute the current application handler');
  return Function(...Object.keys(dependencies), `${source.slice(from, to)}\nreturn ${start.match(/const (\w+)/)[1]};`)(...Object.values(dependencies));
}

function file(id, options = {}) {
  return { id, name: 'plan.pdf', size: 123, lastModified: 1000, ...options };
}

test('document IDs separate same-name same-size files, including shared storage bytes', () => {
  const a = file('a', { supabaseFilePath: 'owner/hash.pdf' });
  const b = file('b', { supabaseFilePath: 'owner/hash.pdf' });
  assert.equal(isSameDocumentTab({ file: a }, b), false);
  assert.notEqual(getDocumentOpenKey(a), getDocumentOpenKey(b));
  assert.equal(isSameDocumentTab({ file: a }, file('a', { name: 'renamed.pdf', size: 900 })), true);
  assert.equal(isSameDocumentTab({ file: a }, file(null)), false);
});

test('local paths must match on both sides; stable local edits keep their identity', () => {
  const local = file(null);
  assert.equal(isSameDocumentTab({ file: local, filePath: '/a/plan.pdf' }, file(null), '/b/plan.pdf'), false);
  assert.equal(isSameDocumentTab({ file: local, filePath: '/a/plan.pdf' }, file(null)), false);
  assert.equal(isSameDocumentTab({ file: local, filePath: '/a/plan.pdf' }, local), true);
  assert.equal(isSameDocumentTab({ file: local }, file(null, { lastModified: 2000 })), false);
  assert.equal(isSameDocumentTab({ file: file(null, { _surveyPdfId: 'local-1' }) }, file(null, { _surveyPdfId: 'local-1', size: 500 })), true);
});

test('real tab handler opens distinct IDs and reuses an ID after name or size changes', () => {
  let tabs = [{ id: 'tab-a', file: file('a') }];
  let activeTab = null;
  const pending = { current: new Set() };
  let nextId = 0;
  const invoke = (incoming) => extractHandler(shellSource,
    'const handleDocumentSelect =', '  // DEV-ONLY: Auto-open test PDF', {
      tabs, openingPdfsRef: pending, selectedPDF: tabs[0].file,
      getDocumentOpenKey, isSameDocumentTab,
      setTabs: update => { tabs = update(tabs); },
      setActiveTabId: id => { activeTab = id; },
      setSelectedPDF() {}, setCurrentView() {}, setIsLoading() {},
      // 2026-10-07: the handler also clears the home's "Opening <file>…" cover.
      setPendingDocumentOpen() {},
      generateTabId: () => `new-${++nextId}`,
      setTimeout: callback => callback(),
    })(incoming);
  invoke(file('b'));
  assert.equal(tabs.length, 2);
  assert.equal(activeTab, 'new-1');
  invoke(file('a', { name: 'renamed.pdf', size: 999 }));
  assert.equal(tabs.length, 2);
  assert.equal(activeTab, 'tab-a');
});

test('a Home tap hands the library row to the viewer without downloading it first', async () => {
  const calls = { deletes: 0, listUpdates: 0, opens: [], downloads: 0, toasts: 0 };
  const doc = { id: 'doc-1', name: 'plan.pdf', file_path: 'owner/hash.pdf', content_sha256: 'abc', user_id: 'u1' };
  const original = structuredClone(doc);
  const handler = extractHandler(dashboardSource,
    'const handleDocumentClick =', '\n  useEffect(() => {', {
      console: { log() {}, error() {} }, performance: { now: () => 0 },
      // The viewer streams the file (services/cloudPdfStream.js) and falls
      // back to the download itself; the home never fetches the bytes.
      downloadFromStorage: async () => { calls.downloads++; throw new Error('home must not download'); },
      isStorageFileNotFoundError,
      showToast: () => { calls.toasts++; },
      onDocumentSelect: (...args) => { calls.opens.push(args); },
      onDocumentOpenStart() {},
      onDocumentOpenEnd() {},
      deleteDocumentEverywhere: () => { calls.deletes++; },
      handleFileNotFound: () => { calls.deletes++; },
      setDocuments: () => { calls.listUpdates++; },
    });
  await handler(doc);
  assert.deepEqual(doc, original, 'the library row is not mutated');
  assert.equal(calls.downloads, 0);
  assert.equal(calls.toasts, 0);
  assert.equal(calls.deletes, 0);
  assert.equal(calls.listUpdates, 0);
  assert.equal(calls.opens.length, 1);
  const [opened, filePath] = calls.opens[0];
  assert.equal(filePath, 'owner/hash.pdf');
  assert.equal(opened.id, 'doc-1');
  assert.equal(opened.name, 'plan.pdf');
  assert.equal(opened.filePath, 'owner/hash.pdf');
  assert.equal(opened.supabaseFilePath, 'owner/hash.pdf');
  assert.equal(opened.contentSha256, 'abc');
  assert.equal(opened.user_id, 'u1');
  assert.equal(typeof opened.arrayBuffer, 'undefined', 'no bytes: the viewer takes the streaming path');
});

for (const error of [
  { status: 404, message: 'Object not found' },
  { statusCode: 400, message: 'Object not found' },
  new Error('offline'),
]) {
  test(`real document-open failure preserves all records: ${error.message}`, async () => {
    const calls = { deletes: 0, listUpdates: 0, toasts: [], openEnds: 0 };
    const doc = { id: 'pending-upload', name: 'plan.pdf', file_path: 'owner/hash.pdf' };
    const original = structuredClone(doc);
    const handler = extractHandler(dashboardSource,
      'const handleDocumentClick =', '\n  useEffect(() => {', {
        console: { log() {}, error() {} }, performance: { now: () => 0 },
        downloadFromStorage: async () => { throw error; },
        isStorageFileNotFoundError,
        showToast: (...args) => calls.toasts.push(args),
        // The open itself fails (the viewer could not take the document).
        onDocumentSelect: () => { throw error; },
        onDocumentOpenStart() {},
        onDocumentOpenEnd: () => { calls.openEnds++; },
        deleteDocumentEverywhere: () => { calls.deletes++; },
        handleFileNotFound: () => { calls.deletes++; },
        setDocuments: () => { calls.listUpdates++; },
      });
    await handler(doc);
    assert.deepEqual(doc, original);
    assert.equal(calls.deletes, 0, 'opening a file never deletes the document or annotations');
    assert.equal(calls.listUpdates, 0, 'failed reads keep the document visible for recovery');
    assert.equal(calls.openEnds, 1, 'a failed open removes the opening cover');
    assert.equal(calls.toasts.length, 1);
    if (isStorageFileNotFoundError(error)) assert.match(calls.toasts[0][0], /annotations were kept/);
  });
}
