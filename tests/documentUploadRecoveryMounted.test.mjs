import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import { IDBFactory } from 'fake-indexeddb';
import { createDocumentUploadJournal } from '../src/services/documentUploadJournal.js';
import { preparePdfUpload } from '../src/home/pdfUploadWork.js';
import { createClient } from '@supabase/supabase-js';
import { createDocumentUploadCloud } from '../src/services/documentUploadCloud.js';

const require = createRequire(import.meta.url);
const actorA = '11111111-1111-4111-8111-111111111111';
const actorB = '22222222-2222-4222-8222-222222222222';
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const defer = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const prepare = file => preparePdfUpload(file, { readBlobAsArrayBuffer: blob => blob.arrayBuffer(),
  computeContentSha256: async bytes => createHash('sha256').update(bytes).digest('hex') });
async function settle(predicate) {
  for (let turn = 0; turn < 1000; turn++) {
    if (predicate()) return;
    await act(async () => { await new Promise(setImmediate); });
  }
  assert.fail('Mounted recovery did not reach the expected state');
}
function lockManager(calls) {
  const queue = new Map();
  return { request(name, options, callback) {
    calls.push(name); assert.equal(options.mode, 'exclusive');
    const next = (queue.get(name) || Promise.resolve()).catch(() => {}).then(callback); queue.set(name, next); return next;
  } };
}

async function mount(t, initial = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'survey-document-recovery-mounted-'));
  const indexedDB = new IDBFactory(); let journal = createDocumentUploadJournal({ indexedDB });
  const state = { actorId: actorA, active: true, lists: [], bytesRead: 0, factories: [], cloudCalls: [], saved: [],
    discarded: [], locks: [], rows: new Map(), files: new Map(), chooseAlias: async () => false, ...initial };
  state.list = actor => journal.list(actor);
  state.discard = (actor, id) => journal.discard(actor, id);
  const journalAdapter = {
    create: (...args) => journal.create(...args), get: (...args) => journal.get(...args),
    list: actor => { state.lists.push(actor); return state.list(actor); },
    readFile: (...args) => { state.bytesRead++; return journal.readFile(...args); },
    patch: (...args) => journal.patch(...args), finish: (...args) => journal.finish(...args),
    discard: (actor, id) => { state.discarded.push([actor, id]); return state.discard(actor, id); },
  };
  state.cloud = {
    async readProject(id) { state.cloudCalls.push('readProject'); return { id, user_id: state.actorId, archived: false, user_archived_at: null }; },
    async readDocument(id) { state.cloudCalls.push('readDocument'); return structuredClone(state.rows.get(id) || null); },
    async findDocumentByHash(projectId, sha) { state.cloudCalls.push('findDocumentByHash'); return structuredClone([...state.rows.values()].find(row => row.project_id === projectId && row.content_sha256 === sha) || null); },
    async uploadFile(filePath, blob) { state.cloudCalls.push('uploadFile'); state.files.set(filePath, blob); return filePath; },
    async createDocument(row) { state.cloudCalls.push('createDocument'); const saved = { ...row, name_aliases: [], user_archived_at: null, updated_at: '2026-09-08T12:00:00Z' }; state.rows.set(row.id, saved); return structuredClone(saved); },
    async ensureDocumentFile(row) { state.cloudCalls.push('ensureDocumentFile'); return state.files.get(row.file_path); },
    async addAlias(row, name) { state.cloudCalls.push('addAlias'); const saved = state.rows.get(row.id); saved.name_aliases = [...new Set([...(saved.name_aliases || []), name])]; return structuredClone(saved); },
  };
  const key = `__documentRecoveryMounted${Math.random()}`;
  globalThis[key] = { preparePdfUpload, readPdfPageCount: async () => null,
    readBlobAsArrayBuffer: blob => blob.arrayBuffer(), computeContentSha256: async bytes => createHash('sha256').update(bytes).digest('hex') };
  let source = await readFile(new URL('../src/home/useDocumentUploadRecovery.js', import.meta.url), 'utf8');
  source = source.replace(/import \{ ([^}]+) \} from '([^']+)';/g, (line, names, file) => {
    if (file === 'react') return `import { ${names} } from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};`;
    if (file === './documentUploadRecovery.js') return `import { ${names} } from ${JSON.stringify(new URL('../src/home/documentUploadRecovery.js', import.meta.url).href)};`;
    return `const { ${names} } = globalThis[${JSON.stringify(key)}];`;
  });
  const hookPath = path.join(dir, 'hook.mjs'); await writeFile(hookPath, source);
  const { useDocumentUploadRecovery } = await import(pathToFileURL(hookPath));
  const panelSource = await readFile(new URL('../src/home/DocumentUploadRecoveryPanel.jsx', import.meta.url), 'utf8');
  const panelJs = await transformWithOxc(panelSource, 'panel.jsx', { lang: 'jsx' });
  const panelPath = path.join(dir, 'panel.mjs');
  await writeFile(panelPath, panelJs.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href)));
  const Panel = (await import(pathToFileURL(panelPath))).default;
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const globals = ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    navigator: { locks: lockManager(state.locks) }, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const node = document.getElementById('root'); const root = createRoot(node); let unmounted = false;
  const getJournal = () => journalAdapter;
  const makeCloud = async args => { state.factories.push(args); return state.makeCloud ? state.makeCloud(args) : state.cloud; };
  function App() {
    state.api = useDocumentUploadRecovery({ actorId: state.actorId, active: state.active, getJournal, makeCloud,
      chooseAlias: state.chooseAlias,
      onSaved: result => { state.saved.push({ actorId: state.actorId, result }); return state.afterSaved?.(); } });
    return React.createElement(Panel, { recovery: { ...state.api, retry: id => {
      state.pendingClick = state.api.retry(id); return state.pendingClick;
    } }, onDiscard: row => { state.pendingClick = state.api.discard(row.id); return state.pendingClick.catch(() => {}); } });
  }
  const render = async () => {
    await act(async () => { root.render(React.createElement(App)); });
    await act(async () => state.api.refresh());
  };
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()); } };
  t.after(async () => {
    await unmount(); journal.close(); dom.window.close(); delete globalThis[key];
    for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    await rm(dir, { recursive: true, force: true });
  });
  async function seed(n = 1, actor = actorA, name = 'Pending.pdf') {
    const prepared = await prepare(new File(['%PDF original'], name, { type: 'application/pdf', lastModified: 123 }));
    const input = { id: uuid(n), documentId: uuid(n + 100), projectId: null, name, size: prepared.file.size,
      type: prepared.file.type, lastModified: prepared.file.lastModified, contentSha: prepared.contentSha,
      filePath: `${actor}/${uuid(n + 100)}/${prepared.contentSha}.pdf`, archiveDocument: null };
    await act(async () => { await journal.create(actor, input, prepared.file); });
    return input;
  }
  await render();
  return { state, node, render, unmount, seed, journal: journalAdapter,
    async reopen() { journal.close(); journal = createDocumentUploadJournal({ indexedDB }); await act(async () => state.api.refresh()); } };
}

test('mounted panel lists only actual journal metadata; opening/focusing never replays cloud work', async t => {
  const f = await mount(t); await f.seed();
  await act(async () => f.state.api.refresh());
  assert.match(f.node.textContent, /Pending.pdf/); assert.match(f.node.textContent, /Clearing app data can erase them/);
  assert.equal(f.state.bytesRead, 0); assert.equal(f.state.factories.length, 0); assert.deepEqual(f.state.cloudCalls, []);
  await act(async () => { window.dispatchEvent(new window.Event('focus')); await new Promise(resolve => setTimeout(resolve, 180)); });
  assert.equal(f.state.bytesRead, 0); assert.equal(f.state.factories.length, 0);
  f.state.active = false; await f.render(); const scans = f.state.lists.length;
  await act(async () => f.state.api.refresh()); assert.equal(f.state.lists.length, scans); assert.equal(f.node.textContent, '');
  f.state.active = true; await f.render(); assert.match(f.node.textContent, /Pending.pdf/); assert.equal(f.state.factories.length, 0);
});

test('mounted explicit Retry completes the saved ID after cold journal reopen', async t => {
  const f = await mount(t); const pending = await f.seed(); await f.reopen();
  await act(async () => { f.node.querySelector('button[aria-label="Retry file Pending.pdf"]').click(); await f.state.pendingClick; });
  await settle(() => !f.state.api.busy);
  assert.equal(f.state.factories.length, 1); assert.equal(f.state.saved.length, 1);
  assert.equal(f.state.saved[0].result.document.id, pending.documentId);
  assert.equal(await f.journal.get(actorA, pending.id), null); assert.match(f.node.textContent, /File saved to the cloud/);
  assert.equal(f.node.querySelector('details').open, true); assert.equal(f.state.api.busy, false);
});

test('offline Retry preserves bytes and metadata; panel shows plain error and allows retry', async t => {
  const f = await mount(t); const pending = await f.seed(); await act(async () => f.state.api.refresh());
  const upload = f.state.cloud.uploadFile; f.state.cloud.uploadFile = async () => { throw new Error('private token-shaped transport detail'); };
  await act(async () => { f.node.querySelector('button[aria-label="Retry file Pending.pdf"]').click(); await f.state.pendingClick.catch(() => {}); });
  await settle(() => !f.state.api.busy);
  assert.match(f.node.textContent, /saved bytes and unfinished steps are kept/);
  assert.doesNotMatch(f.node.textContent, /private token-shaped/); assert.match(f.node.textContent, /Pending.pdf/);
  assert.equal(await (await f.journal.readFile(actorA, pending.id)).text(), '%PDF original');
  assert.equal(f.node.querySelector('button[aria-label="Retry file Pending.pdf"]').disabled, false);
  f.state.cloud.uploadFile = upload;
  await act(async () => { f.node.querySelector('button[aria-label="Retry file Pending.pdf"]').click(); await f.state.pendingClick; });
  await settle(() => !f.state.api.busy);
  assert.match(f.node.textContent, /File saved to the cloud/); assert.equal(await f.journal.get(actorA, pending.id), null);
});

test('same-render duplicate Retry is refused and busy panel disables every action', async t => {
  const f = await mount(t); const pending = await f.seed(); const held = defer();
  let reading = false;
  f.state.cloud.readDocument = async () => { reading = true; return held.promise; }; let run;
  await act(async () => { run = f.state.api.retry(pending.id); run.catch(() => {}); });
  await settle(() => reading);
  assert.equal(f.state.api.busy, true); assert.ok([...f.node.querySelectorAll('button')].every(button => button.disabled));
  await act(async () => assert.rejects(f.state.api.retry(pending.id), /already running/));
  assert.equal(f.state.factories.length, 1);
  await act(async () => { held.reject(new Error('offline')); await assert.rejects(run); });
  assert.equal(f.state.api.busy, false); assert.ok(await f.journal.get(actorA, pending.id));
});

test('A to B to A retires held cloud completion without removing the saved copy or showing success', async t => {
  const f = await mount(t); const pending = await f.seed(); const held = defer();
  f.state.cloud.readDocument = () => held.promise; let run;
  await act(async () => { run = f.state.api.retry(pending.id); run.catch(() => {}); });
  await settle(() => f.state.bytesRead > 0); const oldScope = f.state.factories[0];
  f.state.actorId = actorB; await f.render(); assert.doesNotMatch(f.node.textContent, /Pending.pdf|Saving file/);
  f.state.actorId = actorA; await f.render(); assert.match(f.node.textContent, /Pending.pdf/); assert.equal(oldScope.isCurrent(), false);
  await act(async () => { held.resolve(null); await assert.rejects(run, { code: 'scope-changed' }); });
  assert.equal(f.state.saved.length, 0); assert.equal(f.state.api.busy, false); assert.doesNotMatch(f.node.textContent, /File saved to the cloud/);
  assert.ok(await f.journal.get(actorA, pending.id)); assert.equal(await (await f.journal.readFile(actorA, pending.id)).text(), '%PDF original');
});

test('late metadata from old A cannot hide fresh A rows after A to B to A', async t => {
  const f = await mount(t); await f.seed(1, actorA, 'Fresh A.pdf'); const held = defer(); const list = f.state.list;
  f.state.list = () => held.promise; let pending;
  await act(async () => { pending = f.state.api.refresh(); });
  f.state.list = list; f.state.actorId = actorB; await f.render(); f.state.actorId = actorA; await f.render();
  await act(async () => { held.resolve([{ id: uuid(44), name: 'Old A.pdf', phase: 'ready' }]); await pending; });
  assert.match(f.node.textContent, /Fresh A.pdf/); assert.doesNotMatch(f.node.textContent, /Old A.pdf/); assert.equal(f.state.factories.length, 0);
});

test('discard click removes only the chosen actor-scoped local record, not cloud or another file', async t => {
  const f = await mount(t); const a = await f.seed(1); const b = await f.seed(2, actorA, 'Keep.pdf');
  await f.seed(1, actorB, 'Other account.pdf'); await act(async () => f.state.api.refresh());
  const remove = [...f.node.querySelectorAll('li')].find(item => item.textContent.includes('Pending.pdf')).querySelectorAll('button')[1];
  await act(async () => { remove.click(); await f.state.pendingClick; });
  await settle(() => !f.state.api.busy);
  assert.deepEqual(f.state.discarded, [[actorA, a.id]]); assert.equal(await f.journal.get(actorA, a.id), null);
  assert.ok(await f.journal.get(actorA, b.id)); assert.ok(await f.journal.get(actorB, a.id));
  assert.deepEqual(f.state.cloudCalls, []); assert.equal(f.state.factories.length, 0); assert.equal(f.state.saved.length, 0);
  assert.ok(f.state.locks.includes(`survey:document-upload:${actorA}:${a.id}`));
  assert.match(f.node.textContent, /Cloud files were not changed/);
});

test('failed discard and failed metadata refresh preserve the listed file and actual bytes', async t => {
  const f = await mount(t); const pending = await f.seed(); await act(async () => f.state.api.refresh());
  f.state.discard = async () => { throw new Error('disk unavailable'); };
  await act(async () => assert.rejects(f.state.api.discard(pending.id)));
  assert.match(f.node.textContent, /Pending.pdf/); assert.ok(await f.journal.readFile(actorA, pending.id));
  f.state.list = async () => { throw new Error('private IndexedDB reason'); };
  await act(async () => f.state.api.refresh()); assert.match(f.node.textContent, /Could not read file upload recovery/);
  assert.match(f.node.textContent, /Pending.pdf/); assert.doesNotMatch(f.node.textContent, /private IndexedDB/); assert.equal(f.state.factories.length, 0);
});

test('missing alias prompt callback fails closed and keeps pending choice and bytes', async t => {
  const f = await mount(t, { chooseAlias: undefined }); const pending = await f.seed();
  const row = { id: uuid(90), user_id: actorA, project_id: null, name: 'Existing.pdf', file_path: `${actorA}/legacy.pdf`,
    content_sha256: pending.contentSha, file_size: 13, archived: false, user_archived_at: null, updated_at: '2026-09-08T12:00:00Z' };
  f.state.rows.set(row.id, row); f.state.files.set(row.file_path, new Blob(['current bytes']));
  await act(async () => assert.rejects(f.state.api.retry(pending.id), error => error.code === 'alias-choice-required' || error.cause?.code === 'alias-choice-required'));
  const kept = await f.journal.get(actorA, pending.id); assert.equal(kept.aliasDecided, false); assert.ok(await f.journal.readFile(actorA, pending.id));
  assert.equal(f.state.saved.length, 0); assert.equal(f.state.cloudCalls.includes('addAlias'), false);
});

test('unmount retires a pending cloud factory before any engine call', async t => {
  const f = await mount(t); const pending = await f.seed(); const held = defer(); f.state.makeCloud = () => held.promise;
  let run; await act(async () => { run = f.state.api.retry(pending.id); run.catch(() => {}); });
  await settle(() => f.state.factories.length === 1); await f.unmount();
  held.resolve(f.state.cloud); await assert.rejects(run, { code: 'scope-changed' });
  assert.deepEqual(f.state.cloudCalls, []); assert.equal(f.state.saved.length, 0); assert.ok(await f.journal.get(actorA, pending.id));
});

test('failed atomic staging never claims a saved retry copy and never calls cloud', async t => {
  const f = await mount(t); const prepared = await prepare(new File(['%PDF original'], 'New.pdf', { type: 'application/pdf', lastModified: 123 }));
  f.journal.create = async () => { throw new Error('IndexedDB quota exceeded'); };
  await act(async () => assert.rejects(f.state.api.start({ file: prepared.file, prepared }), error => error.recoveryCreated === false));
  assert.match(f.node.textContent, /Keep the original file and check device storage/);
  assert.doesNotMatch(f.node.textContent, /saved bytes and unfinished steps are kept/);
  assert.deepEqual(await f.journal.list(actorA), []); assert.equal(f.state.factories.length, 0);
});

test('complete receipt Retry performs local cleanup without creating a cloud client', async t => {
  const f = await mount(t); const pending = await f.seed();
  const target = { id: pending.documentId, user_id: actorA, project_id: null, name: pending.name, file_path: pending.filePath,
    content_sha256: pending.contentSha, file_size: pending.size, archived: false, user_archived_at: null, updated_at: null };
  await act(async () => {
    await f.journal.patch(actorA, pending.id, { phase: 'document-confirmed', target, aliasDecided: true });
    await f.journal.patch(actorA, pending.id, { phase: 'archive-confirmed' });
    await f.journal.patch(actorA, pending.id, { phase: 'complete' }); await f.state.api.refresh();
  });
  assert.match(f.node.textContent, /Retry clears only this local retry copy/);
  await act(async () => { f.node.querySelector('button[aria-label="Retry file Pending.pdf"]').click(); await f.state.pendingClick; });
  assert.equal(f.state.factories.length, 0); assert.deepEqual(f.state.cloudCalls, []); assert.equal(await f.journal.get(actorA, pending.id), null);
  assert.equal(f.state.saved[0].result.file, null);
});

test('completion stays busy while onSaved is pending and retires its late UI receipt', async t => {
  const f = await mount(t); const pending = await f.seed(); const held = defer(); f.state.afterSaved = () => held.promise;
  let run; await act(async () => { run = f.state.api.retry(pending.id); run.catch(() => {}); });
  await settle(() => f.state.saved.length === 1);
  assert.equal(f.state.api.busy, true); assert.doesNotMatch(f.node.textContent, /File saved to the cloud/);
  f.state.actorId = actorB; await f.render();
  await act(async () => { held.resolve(); await assert.rejects(run, { code: 'scope-changed' }); });
  assert.equal(f.node.textContent, ''); assert.equal(f.state.api.busy, false);
});

function sdkCloudFixture() {
  const rows = new Map(), files = new Map(), requests = [];
  const client = createClient('https://document-upload-mount.invalid', 'fixture-not-a-secret', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `mounted-upload-${crypto.randomUUID()}` },
    global: { fetch: async (input, init = {}) => {
      const url = new URL(String(input)), method = init.method || 'GET';
      requests.push({ url, method, headers: new Headers(init.headers) });
      if (url.pathname.includes('/storage/v1/object/documents/')) {
        const key = decodeURIComponent(url.pathname.split('/storage/v1/object/documents/')[1]);
        if (method === 'GET') return files.has(key) ? new Response(files.get(key))
          : Response.json({ statusCode: '404', error: 'NotFound', message: 'missing' }, { status: 404 });
        if (files.has(key)) return Response.json({ statusCode: '409', error: 'ResourceAlreadyExists', message: 'exists' }, { status: 409 });
        files.set(key, init.body.get('')); return Response.json({ Key: `documents/${key}` });
      }
      assert.ok(url.pathname.endsWith('/documents'), `Unexpected endpoint ${url.pathname}`);
      const selected = row => Object.fromEntries((url.searchParams.get('select') || '').split(',').map(key => [key, row[key] ?? null]));
      if (method === 'POST') {
        const row = { ...JSON.parse(init.body), name_aliases: [], archived: false, user_archived_at: null,
          created_at: '2026-09-08T12:00:00Z', updated_at: '2026-09-08T12:00:00Z' };
        rows.set(row.id, row); return Response.json(selected(row));
      }
      assert.equal(method, 'GET', 'composition must not issue hidden updates');
      const found = [...rows.values()].filter(row => [...url.searchParams].every(([key, value]) => {
        if (key === 'select' || key === 'limit') return true;
        if (value === 'is.null') return row[key] === null;
        assert.ok(value.startsWith('eq.'), value); return String(row[key]) === value.slice(3);
      }));
      return Response.json(found.map(selected));
    } },
  });
  client.auth.getSession = async () => ({ data: { session: { user: { id: actorA }, access_token: 'mounted-fixture-token' } }, error: null });
  client.auth.onAuthStateChange = () => ({ data: { subscription: { unsubscribe() {} } } });
  return { rows, files, requests, create: args => createDocumentUploadCloud({ ...args, client }) };
}

for (const reused of [false, true]) test(`mounted hook + actual journal + actual SDK transport complete ${reused ? 'published legacy reuse' : 'a new PDF'} without live network`, async t => {
  const f = await mount(t); const pending = await f.seed(); const sdk = sdkCloudFixture();
  f.state.makeCloud = sdk.create;
  if (reused) {
    const row = { id: uuid(90), user_id: actorA, project_id: null, name: pending.name,
      file_path: `${actorA}/legacy file.pdf`, file_size: 44, content_sha256: pending.contentSha,
      page_count: 8, name_aliases: [], archived: false, user_archived_at: null,
      created_at: '2026-09-08T12:00:00Z', updated_at: '2026-09-08T12:00:00Z' };
    sdk.rows.set(row.id, row); sdk.files.set(row.file_path, new Blob(['newer published PDF edits']));
  }
  await f.reopen(); assert.equal(sdk.requests.length, 0);
  await act(async () => { f.node.querySelector('button[aria-label="Retry file Pending.pdf"]').click(); await f.state.pendingClick; });
  const result = f.state.saved[0].result;
  assert.equal(result.reused, reused); assert.equal(result.document.id, reused ? uuid(90) : pending.documentId);
  assert.equal(await result.file.text(), reused ? 'newer published PDF edits' : '%PDF original');
  assert.equal(await f.journal.get(actorA, pending.id), null); assert.match(f.node.textContent, /File saved to the cloud/);
  assert.equal(sdk.requests.filter(request => request.method === 'POST' && request.url.pathname.includes('/storage/')).length, reused ? 0 : 1);
  assert.equal(sdk.requests.filter(request => request.method === 'PATCH').length, 0);
  for (const request of sdk.requests) assert.equal(request.headers.get('authorization'), 'Bearer mounted-fixture-token');
});

test('a completed row cannot be retried while its final metadata refresh is held', async t => {
  const f = await mount(t); const pending = await f.seed(); await act(async () => f.state.api.refresh());
  const held = defer(); let reading = false;
  f.state.afterSaved = () => { f.state.list = () => { reading = true; return held.promise; }; };
  let run; await act(async () => { run = f.state.api.retry(pending.id); run.catch(() => {}); });
  await settle(() => reading);
  const retry = f.node.querySelector('button[aria-label="Retry file Pending.pdf"]');
  const safe = f.state.api.busy || !retry || retry.disabled;
  await act(async () => { held.resolve([]); await run; });
  assert.equal(safe, true, 'the deleted local attempt must not remain actionable during its final list refresh');
  assert.equal(f.state.api.busy, false); assert.equal(await f.journal.get(actorA, pending.id), null);
});
