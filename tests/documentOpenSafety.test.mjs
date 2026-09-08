import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { getDocumentOpenKey, isSameDocumentTab } from '../src/utils/documentTabIdentity.js';

test('managed local identities ignore picked paths and cannot match a cloud row', () => {
  const local = { name: 'plan.pdf', size: 3, storageMode: 'local', localId: 'local:one', _surveyPdfId: 'local:one' };
  const tab = { file: local, filePath: '/original/plan.pdf' };
  assert.equal(getDocumentOpenKey(local, '/original/plan.pdf'), getDocumentOpenKey(local));
  assert.equal(isSameDocumentTab(tab, { ...local }, '/different/plan.pdf'), true);
  assert.equal(isSameDocumentTab(tab, { ...local, localId: 'local:two' }, tab.filePath), false);
  assert.equal(isSameDocumentTab(tab, { id: 'local:one', name: 'plan.pdf' }), false);
  assert.equal(isSameDocumentTab(tab, { name: 'plan.pdf', size: 3, _surveyPdfId: 'local:one' }), false);
});
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
  let tabs = [{ id: 'tab-a', file: file('a'), actorUserId: 'actor-a' }];
  const documentOpenScope = { actorUserId: 'actor-a' };
  let activeTab = null;
  const pending = { current: new Set() };
  let nextId = 0;
  const invoke = (incoming) => extractHandler(shellSource,
    'const handleDocumentSelect =', '  // DEV-ONLY: Auto-open test PDF', {
      tabs, openingPdfsRef: pending, selectedPDF: tabs[0].file,
      documentOpenScope, documentOpenScopeRef: { current: documentOpenScope },
      getDocumentOpenKey, isSameDocumentTab,
      setTabs: update => { tabs = update(tabs); },
      setActiveTabId: id => { activeTab = id; },
      setSelectedPDF() {}, setCurrentView() {}, setIsLoading() {},
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
    const calls = { deletes: 0, listUpdates: 0, opens: 0, toasts: [] };
    const doc = { id: 'pending-upload', name: 'plan.pdf', file_path: 'owner/hash.pdf' };
    const original = structuredClone(doc);
    const handler = extractHandler(dashboardSource,
      'const handleDocumentClick =', '\n  useEffect(() => {', {
        documentOpenScope: null, documentOpenScopeRef: { current: null },
        onActivateOpenDocument: undefined,
        console: { log() {}, error() {} }, performance: { now: () => 0 },
        downloadFromStorage: async () => { throw error; },
        isStorageFileNotFoundError,
        showToast: (...args) => calls.toasts.push(args),
        onDocumentSelect: () => { calls.opens++; },
        deleteDocumentEverywhere: () => { calls.deletes++; },
        handleFileNotFound: () => { calls.deletes++; },
        setDocuments: () => { calls.listUpdates++; },
      });
    await handler(doc);
    assert.deepEqual(doc, original);
    assert.equal(calls.deletes, 0, 'opening a file never deletes the document or annotations');
    assert.equal(calls.listUpdates, 0, 'failed reads keep the document visible for recovery');
    assert.equal(calls.opens, 0);
    assert.equal(calls.toasts.length, 1);
    if (isStorageFileNotFoundError(error)) assert.match(calls.toasts[0][0], /annotations were kept/);
  });
}

test('Dashboard reuses a healthy open cloud document before requesting its bytes', async () => {
  let downloads = 0;
  let activations = 0;
  const scope = { actorUserId: 'actor-a' };
  const handler = extractHandler(dashboardSource,
    'const handleDocumentClick =', '\n  useEffect(() => {', {
      documentOpenScope: scope, documentOpenScopeRef: { current: scope },
      console: { log() {}, error() {} }, performance: { now: () => 0 },
      onActivateOpenDocument: () => { activations++; return true; },
      downloadFromStorage: async () => { downloads++; throw new Error('must not download'); },
      onDocumentSelect: () => assert.fail('must not replace the mounted file'),
      isStorageFileNotFoundError, showToast() {},
    });
  await handler({ id: 'a', name: 'plan.pdf', file_path: 'owner/hash.pdf' });
  assert.equal(activations, 1);
  assert.equal(downloads, 0);
});

function activationHarness({ actor = 'actor-a', tabActor = actor, loadFlags = {}, listed = true } = {}) {
  const existingFile = file('a', loadFlags);
  const documentOpenScope = { actorUserId: actor };
  const documentOpenScopeRef = { current: documentOpenScope };
  const state = { file: null, active: null, view: null };
  const activate = extractHandler(shellSource,
    'const handleActivateOpenDocument =', '\n  const handleDocumentSelect =', {
      documentOpenScope, documentOpenScopeRef,
      documents: listed ? [{ id: 'a' }] : [],
      tabs: [{ id: 'tab-a', file: existingFile, actorUserId: tabActor }],
      isSameDocumentTab,
      setSelectedPDF: (value) => { state.file = value; },
      setActiveTabId: (value) => { state.active = value; },
      setCurrentView: (value) => { state.view = value; },
    });
  return { activate, state, existingFile, documentOpenScopeRef };
}

test('healthy exact cloud identity activates its existing file only for the same actor', () => {
  const h = activationHarness();
  assert.equal(h.activate({ id: 'a', name: 'renamed.pdf', file_size: 900 }), true);
  assert.equal(h.state.file, h.existingFile);
  assert.equal(h.state.active, 'tab-a');
  assert.equal(h.state.view, 'viewer');
  assert.equal(h.activate({ id: 'b', name: 'plan.pdf', file_size: 123 }), false);
  assert.equal(h.activate({ name: 'plan.pdf', file_size: 123 }), false);
  assert.equal(activationHarness({ tabActor: 'other' }).activate({ id: 'a' }), false);
  assert.equal(activationHarness({ actor: null }).activate({ id: 'a' }), false);
  assert.equal(activationHarness({ listed: false }).activate({ id: 'a' }), false);
});

test('failed and rewritten files keep the normal fresh-download path', () => {
  for (const flag of ['__pdfLoadFailed', '__rewrittenForParse']) {
    const h = activationHarness({ loadFlags: { [flag]: true } });
    assert.equal(h.activate({ id: 'a' }), false);
    assert.equal(h.state.file, null);
  }
});

test('a stale activation callback cannot reopen a prior actor tab, even after switching back', () => {
  const h = activationHarness();
  h.documentOpenScopeRef.current = { actorUserId: 'actor-a' };
  assert.equal(h.activate({ id: 'a' }), false);
  assert.equal(h.state.file, null);
});

for (const stage of ['storage', 'legacy-fetch', 'legacy-blob', 'error']) {
  test(`account switch during ${stage} open never opens the old file or shows its error`, async () => {
    const scope = { actorUserId: 'actor-a' };
    const scopeRef = { current: scope };
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    let opens = 0;
    let toasts = 0;
    let blobReads = 0;
    const handler = extractHandler(dashboardSource,
      'const handleDocumentClick =', '\n  useEffect(() => {', {
        documentOpenScope: scope, documentOpenScopeRef: scopeRef,
        console: { log() {}, error() {} }, performance: { now: () => 0 },
        onActivateOpenDocument: () => false,
        downloadFromStorage: async () => { await pending; if (stage === 'error') throw new Error('offline'); return new Blob(['pdf']); },
        fetch: async () => {
          if (stage === 'legacy-fetch') await pending;
          return { blob: async () => { blobReads++; if (stage === 'legacy-blob') await pending; return new Blob(['pdf']); } };
        },
        onDocumentSelect: () => { opens++; },
        isStorageFileNotFoundError, showToast: () => { toasts++; },
        File,
      });
    const opening = handler({ id: 'a', name: 'plan.pdf',
      ...(stage.startsWith('legacy') ? { dataUrl: 'data:application/pdf;base64,cGRm' } : { file_path: 'owner/hash.pdf' }),
    });
    await Promise.resolve();
    scopeRef.current = { actorUserId: 'actor-b' };
    release();
    await opening;
    assert.equal(opens, 0);
    assert.equal(toasts, 0);
    if (stage === 'legacy-fetch') assert.equal(blobReads, 0, 'stale fetch does not read the response body');
  });
}

test('same-actor fresh download still opens a new file with cloud identity', async () => {
  const scope = { actorUserId: 'actor-a' };
  let opened;
  const handler = extractHandler(dashboardSource,
    'const handleDocumentClick =', '\n  useEffect(() => {', {
      documentOpenScope: scope, documentOpenScopeRef: { current: scope },
      console: { log() {}, error() {} }, performance: { now: () => 0 },
      onActivateOpenDocument: () => false,
      downloadFromStorage: async () => new Blob(['pdf']),
      onDocumentSelect: (value) => { opened = value; },
      isStorageFileNotFoundError, showToast: () => assert.fail('unexpected open failure'), File,
    });
  await handler({ id: 'a', name: 'plan.pdf', file_path: 'owner/hash.pdf', user_id: 'owner' });
  assert.equal(opened.id, 'a');
  assert.equal(opened.supabaseFilePath, 'owner/hash.pdf');
  assert.equal(opened.user_id, 'owner');
  assert.equal(await opened.text(), 'pdf');
});
