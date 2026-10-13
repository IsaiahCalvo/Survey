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

for (const error of [
  { status: 404, message: 'Object not found' },
  { statusCode: 400, message: 'Object not found' },
  new Error('offline'),
]) {
  test(`real document-open failure preserves all records: ${error.message}`, async () => {
    const calls = { deletes: 0, listUpdates: 0, opens: 0, toasts: [], openStarts: 0, openEnds: 0 };
    const doc = { id: 'pending-upload', name: 'plan.pdf', file_path: 'owner/hash.pdf' };
    const original = structuredClone(doc);
    const handler = extractHandler(dashboardSource,
      'const handleDocumentClick =', '\n  useEffect(() => {', {
        console: { log() {}, error() {} }, performance: { now: () => 0 },
        downloadFromStorage: async () => { throw error; },
        isStorageFileNotFoundError,
        showToast: (...args) => calls.toasts.push(args),
        onDocumentSelect: () => { calls.opens++; },
        // 2026-10-07: the tap shows "Opening <file>…" at once; a failed read
        // must take it away again so the home is usable.
        onDocumentOpenStart: () => { calls.openStarts++; },
        onDocumentOpenEnd: () => { calls.openEnds++; },
        deleteDocumentEverywhere: () => { calls.deletes++; },
        handleFileNotFound: () => { calls.deletes++; },
        setDocuments: () => { calls.listUpdates++; },
      });
    await handler(doc);
    assert.deepEqual(doc, original);
    assert.equal(calls.deletes, 0, 'opening a file never deletes the document or annotations');
    assert.equal(calls.listUpdates, 0, 'failed reads keep the document visible for recovery');
    assert.equal(calls.opens, 0);
    assert.equal(calls.openStarts, 1);
    assert.equal(calls.openEnds, 1, 'a failed open removes the opening cover');
    assert.equal(calls.toasts.length, 1);
    if (isStorageFileNotFoundError(error)) assert.match(calls.toasts[0][0], /annotations were kept/);
  });
}
