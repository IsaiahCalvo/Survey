import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { excelExportScope } from '../src/services/excelExportAck.js';

const source = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const start = source.indexOf('const performOneDriveExport = useCallback(');
const end = source.indexOf('// Handler for OneDrive save modal', start);
assert.ok(start >= 0 && end > start);

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness({ token, upload, persist } = {}) {
  const template = { id: 'template-a', supabaseId: 'cloud-template-a', name: 'Plan A' };
  const definitionScope = { active: true, mode: 'legacy', file: { id: 'doc-a' }, generationId: null };
  const pending = { sourceScope: excelExportScope('account-a-doc-a', template), fileName: 'Plan A',
    sourceDefinitionScope: definitionScope, definitionMode: 'legacy',
    buffer: new Uint8Array([1, 2]), exportedMarkers: { m: { name: 'Export snapshot' } }, identityRecords: { m: { token: 'row-a' } } };
  const state = { pending, selection: { fileName: 'pending-selection.xlsx' }, writes: [], uploads: [], toasts: [],
    templates: [template], template, linked: false, localCalls: [], scopeRef: { current: pending.sourceScope } };
  const record = (name, value) => state.writes.push([name, value]);
  const setter = (key, name) => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; record(name, state[key]); };
  const deps = {
    useCallback: fn => fn, exportPendingData: pending, graphClient: { account: 'account-a' }, selectedTemplate: template,
    excelExportScope, excelBaselineId: 'account-a-doc-a', pdfIdRef: { current: 'account-a-doc-a' },
    excelExportScopeRef: state.scopeRef, isExportInProgressRef: { current: false },
    documentSurveyDefinitionScopeRef: { current: definitionScope },
    exportPendingDataRef: { current: pending },
    setIsExportingToOneDrive: value => record('oneDriveBusy', value), setIsExporting: value => record('busy', value),
    setExportPendingData: setter('pending', 'pending'), setPendingOneDriveExport: value => record('pendingOneDrive', value),
    setOneDriveSaveSelection: setter('selection', 'selection'),
    ensureFreshToken: async () => token ? token() : true,
    uploadFileToDrive: async (...args) => { state.uploads.push(['drive', ...args]); return upload ? upload() : { id: 'exported-file' }; },
    uploadExcelFile: async (...args) => { state.uploads.push(['personal', ...args]); return upload ? upload() : { id: 'exported-file' }; },
    setSelectedTemplate: setter('template', 'template'), setOneDriveFileId: value => record('fileId', value),
    setLinkedExcelExists: setter('linked', 'linked'), markExcelExportSynced: (...args) => record('ack', args),
    updateSupabaseTemplate: async (...args) => { record('persist', args); if (persist) await persist(); },
    sanitizeTemplateConfig: value => value, appTemplates: state.templates, handleTemplatesChange: setter('templates', 'templates'),
    showToast: (...args) => state.toasts.push(args), getExportErrorMessage: error => error.message,
    console: { error() {}, warn() {} },
    window: { electronAPI: new Proxy({}, { get: (_target, name) => async (...args) => { state.localCalls.push([name, ...args]); return ['/wrong-account/OneDrive']; } }) },
  };
  const run = Function(...Object.keys(deps), `${source.slice(start, end)}\nreturn performOneDriveExport;`)(...Object.values(deps));
  const switchScope = () => {
    state.scopeRef.current = excelExportScope('account-b-doc-b', { id: 'template-b' });
    state.pending = { sourceScope: state.scopeRef.current, fileName: 'New pending export' };
    deps.exportPendingDataRef.current = state.pending;
    state.selection = { fileName: 'new-selection.xlsx' };
    return { pending: state.pending, selection: state.selection };
  };
  return { run, state, deps, pending, switchScope };
}

test('actual OneDrive export uses the selected SharePoint drive and only cloud storage', async () => {
  const h = harness();
  assert.equal(await h.run({ fileName: 'Chosen.xlsx', folder: { type: 'sharepoint', driveId: 'chosen-drive', folderId: 'chosen-folder' } }), true);
  assert.deepEqual(h.state.uploads, [['drive', h.deps.graphClient, 'chosen-drive', 'chosen-folder', 'Chosen.xlsx', h.pending.buffer]]);
  assert.equal(h.state.template.sharePointDriveId, 'chosen-drive');
  assert.equal(h.state.template.oneDriveFileId, 'exported-file');
  assert.deepEqual(h.state.localCalls, [], 'cloud export must not mirror into an arbitrary local account folder');
  const ack = h.state.writes.find(([kind]) => kind === 'ack')[1];
  assert.strictEqual(ack[2], h.pending.exportedMarkers, 'ack uses the exported snapshot');
  assert.equal(ack[3], h.pending.sourceScope);
});

test('actual OneDrive export refuses a stale source before any token or upload work', async () => {
  let tokens = 0;
  const h = harness({ token: () => { tokens++; return true; } });
  const newer = h.switchScope();
  assert.equal(await h.run(), false);
  assert.equal(tokens, 0);
  assert.equal(h.state.uploads.length, 0);
  assert.strictEqual(h.state.pending, newer.pending);
  assert.strictEqual(h.state.selection, newer.selection);
});

test('actual OneDrive export stops after token refresh if the source changed', async () => {
  const token = deferred();
  const h = harness({ token: () => token.promise });
  const running = h.run();
  const newer = h.switchScope();
  token.resolve(true);
  assert.equal(await running, false);
  assert.equal(h.state.uploads.length, 0);
  assert.strictEqual(h.state.pending, newer.pending);
  assert.strictEqual(h.state.selection, newer.selection);
});

test('actual OneDrive export never applies a completed upload to a new source', async () => {
  const upload = deferred();
  const h = harness({ upload: () => upload.promise });
  const running = h.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.uploads.length, 1);
  const newer = h.switchScope();
  const writesBefore = h.state.writes.length;
  upload.resolve({ id: 'old-file' });
  assert.equal(await running, false);
  assert.deepEqual(h.state.writes.slice(writesBefore).filter(([kind]) => ['template', 'fileId', 'linked', 'ack', 'persist', 'templates'].includes(kind)), []);
  assert.strictEqual(h.state.pending, newer.pending);
  assert.strictEqual(h.state.selection, newer.selection);
});

test('actual OneDrive export does not publish old template lists after persistence awaits', async () => {
  const persist = deferred();
  const h = harness({ persist: () => persist.promise });
  const running = h.run();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.state.writes.filter(([kind]) => kind === 'persist').length, 1);
  const newer = h.switchScope();
  const writesBefore = h.state.writes.length;
  persist.resolve();
  await running;
  assert.deepEqual(h.state.writes.slice(writesBefore).filter(([kind]) => ['template', 'linked', 'ack', 'templates'].includes(kind)), []);
  assert.equal(h.state.toasts.some(([, type]) => type === 'success'), false);
  assert.strictEqual(h.state.pending, newer.pending);
  assert.strictEqual(h.state.selection, newer.selection);
});

test('actual OneDrive export rejects a missing uploaded item ID without false acknowledgement', async () => {
  const h = harness({ upload: async () => ({}) });
  assert.equal(await h.run(), false);
  assert.equal(h.state.writes.some(([kind]) => ['template', 'linked', 'ack', 'persist'].includes(kind)), false);
});

function openHarness(template, metadata) {
  const calls = [];
  const scopeRef = { current: excelExportScope('account-doc', template) };
  const deps = {
    useCallback: fn => fn, selectedTemplate: template, graphClient: { account: 'selected-account' }, excelExportScopeRef: scopeRef,
    getFileById: async (...args) => { calls.push(['metadata', ...args]); return metadata ? metadata() : { webUrl: 'https://tenant.sharepoint.com/book.xlsx' }; },
    openExternalDestination: async url => calls.push(['external', url]),
    window: { electronAPI: { openPath: async path => calls.push(['local', path]) } },
    showToast: (...args) => calls.push(['toast', ...args]),
  };
  const callbackStart = source.indexOf('const handleOpenExcel = useCallback(');
  const callbackEnd = source.indexOf('// Check if linked Excel file exists', callbackStart);
  assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
  const run = Function(...Object.keys(deps), `${source.slice(callbackStart, callbackEnd)}\nreturn handleOpenExcel;`)(...Object.values(deps));
  return { run, calls, scopeRef, client: deps.graphClient };
}

test('actual Open Excel resolves the selected SharePoint item and opens its cloud URL', async () => {
  const h = openHarness({ linkedExcelPath: '/drives/drive-a/items/file-a', isOneDrive: true, oneDriveFileId: 'file-a', sharePointDriveId: 'drive-a' });
  await h.run();
  assert.deepEqual(h.calls, [['metadata', h.client, 'file-a', 'drive-a'], ['external', 'https://tenant.sharepoint.com/book.xlsx']]);
});

test('actual Open Excel resolves personal OneDrive without guessing a local folder', async () => {
  const h = openHarness({ linkedExcelPath: '/Documents/book.xlsx', isOneDrive: true, oneDriveFileId: 'personal-file' });
  await h.run();
  assert.deepEqual(h.calls, [['metadata', h.client, 'personal-file', undefined], ['external', 'https://tenant.sharepoint.com/book.xlsx']]);
});

test('actual Open Excel opens an explicitly linked local file without Graph calls', async () => {
  const h = openHarness({ linkedExcelPath: '/Users/example/Documents/book.xlsx' });
  await h.run();
  assert.deepEqual(h.calls, [['local', '/Users/example/Documents/book.xlsx']]);
});

test('actual Open Excel ignores a cloud URL resolved after the source switches', async () => {
  const metadata = deferred();
  const h = openHarness({ linkedExcelPath: '/Documents/book.xlsx', isOneDrive: true, oneDriveFileId: 'personal-file' }, () => metadata.promise);
  const running = h.run();
  h.scopeRef.current = 'other-account-document';
  metadata.resolve({ webUrl: 'https://tenant.sharepoint.com/old.xlsx' });
  await running;
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][0], 'metadata');
});

function saveHarness({ exists, metadata } = {}) {
  const calls = [];
  const scopeRef = { current: 'initial-scope' };
  const deps = {
    useCallback: fn => fn, graphClient: {}, selectedTemplate: { id: 'template-a', name: 'Plan A' }, excelExportScopeRef: scopeRef,
    setShowOneDriveSaveModal: value => calls.push(['modal', value]), setIsExportingToOneDrive: value => calls.push(['busy', value]),
    checkFileExistsInDrive: async (...args) => { calls.push(['exists', ...args]); return exists ? exists() : { exists: true, fileId: 'existing' }; },
    checkFileExists: async () => exists ? exists() : { exists: false },
    getTemplateIdFromExcel: async (...args) => { calls.push(['metadata', ...args]); return metadata ? metadata() : { templateId: 'template-a' }; },
    setTemplateOverwriteData: value => calls.push(['warning-data', value]), setShowTemplateOverwriteWarning: value => calls.push(['warning', value]),
    performOneDriveExport: async selection => calls.push(['export', selection]), showToast: (...args) => calls.push(['toast', ...args]),
    console: { error() {} },
  };
  const callbackStart = source.indexOf('const handleOneDriveSave = useCallback(');
  const callbackEnd = source.indexOf('// Handler for template overwrite confirmation', callbackStart);
  assert.ok(callbackStart >= 0 && callbackEnd > callbackStart);
  const run = Function(...Object.keys(deps), `${source.slice(callbackStart, callbackEnd)}\nreturn handleOneDriveSave;`)(...Object.values(deps));
  const selection = { fileName: 'Chosen.xlsx', folder: { type: 'sharepoint', driveId: 'chosen-drive', folderId: 'chosen-folder' } };
  return { run: () => run(selection), calls, scopeRef, client: deps.graphClient };
}

test('actual save duplicate check reads template metadata in the selected drive', async () => {
  const h = saveHarness();
  await h.run();
  assert.deepEqual(h.calls.find(([kind]) => kind === 'metadata'), ['metadata', h.client, 'existing', 'chosen-drive']);
  assert.equal(h.calls.filter(([kind]) => kind === 'export').length, 1);
});

test('actual save stops on failed duplicate lookup instead of overwriting', async () => {
  const h = saveHarness({ exists: async () => { throw new Error('network failure'); } });
  await h.run();
  assert.equal(h.calls.some(([kind]) => kind === 'export'), false);
  assert.equal(h.calls.some(([kind]) => kind === 'toast'), true);
});

for (const meta of [null, { templateId: 'other-template', templateName: 'Other Plan' }]) {
  test(`actual save requires explicit overwrite for ${meta ? 'another template' : 'unread metadata'}`, async () => {
    const h = saveHarness({ metadata: async () => meta });
    await h.run();
    assert.equal(h.calls.some(([kind]) => kind === 'export'), false);
    assert.ok(h.calls.some(([kind, value]) => kind === 'warning' && value === true));
  });
}

test('actual save drops a duplicate result after switching sources', async () => {
  const exists = deferred();
  const h = saveHarness({ exists: () => exists.promise });
  const running = h.run();
  h.scopeRef.current = 'new-source';
  const before = h.calls.length;
  exists.resolve({ exists: true, fileId: 'old-file' });
  await running;
  assert.deepEqual(h.calls.slice(before), []);
});
