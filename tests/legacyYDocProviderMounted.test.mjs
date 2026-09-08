import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import React, { act, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import { transformWithOxc } from 'vite';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as registry from '../src/lib/collab/ydocRegistry.js';
import * as archive from '../src/lib/collab/legacyYDocRecoveryArchive.js';
import { IDBFactory } from 'fake-indexeddb';
import { getLegacyYDocScopeKey } from '../src/lib/collab/legacyYDocScope.js';
import { createQueueRetryHandlers } from '../src/lib/collab/crdtQueueRetryHandlers.js';
import { attachDocumentCollaborationStatus } from '../src/lib/collab/documentCollaborationStatus.js';

// Mount the shipped provider, not a copied callback. Only its module boundaries
// are adapted: React, Yjs, registry retention and queue retry guards stay real;
// auth, cloud writes and persistence/session transport stay local test doubles.
const require = createRequire(import.meta.url);
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function mount(t, options = {}) {
  const archiveDB = new IDBFactory();
  const calls = { acquired: [], released: [], runtimes: [], undo: [], undoDisposed: [], metadata: [], backfill: [],
    hydrate: [], hydrateScopes: [], audits: [], deletes: [], retries: [], retryHandlers: [], sql: [], roles: [], intervals: [], recovery: [] };
  const documentId = `mounted-legacy-${crypto.randomUUID()}`;
  const docs = new Set();
  const keys = new Set();
  const context = React.createContext(null);
  let actor = 'actor-a';
  let enabled = true;
  let latest;
  let cleanupProps;
  const noopUI = () => null;
  const channels = [];
  const supabase = {
    auth: { session: () => ({ data: { session: { user: { id: actor } } } }), user: () => ({ id: actor }) },
    realtime: { connect() {} },
    rpc: async (_name, args) => { calls.roles.push(args.doc_id); return options.roleResult ? options.roleResult() : { data: 'owner', error: null }; },
    from(table) {
      const query = { table, filters: [] }; calls.sql.push(query);
      const builder = { select() { return builder; }, eq(...args) { query.filters.push(args); return builder; },
        then(resolve, reject) { return Promise.resolve({ data: [], error: null }).then(resolve, reject); } };
      return builder;
    },
    channel(name) {
      const channel = { name, on() { return channel; }, subscribe() { return channel; }, unsubscribe() {} };
      channels.push(channel); return channel;
    },
    removeChannel: async () => {},
  };
  const modules = {
    react: React, yjs: Y,
    'YDocContext.js': { YDocContext: context },
    'ydocRegistry.js': { ...registry,
      getOrCreateYDoc(key) { calls.acquired.push(key); keys.add(key); const doc = registry.getOrCreateYDoc(key); docs.add(doc); return doc; },
      releaseYDoc(key) { calls.released.push(key); registry.releaseYDoc(key); },
    },
    'legacyYDocScope.js': { getLegacyYDocScopeKey },
    'legacyYDocRecoveryArchive.js': { ...archive,
      prepareLegacyRecoveryClose: (id, args) => archive.prepareLegacyRecoveryClose(id, { ...args, indexedDB: archiveDB }),
    },
    'legacyYDocSession.js': { attachLegacyYDocSession(args) {
      if (options.runtimeUnavailable) throw new Error('local session unavailable');
      const controller = new AbortController();
      let current = true;
      const runtime = { args, signal: controller.signal,
        isCurrent: () => current,
        role: () => 'follower',
        restartTransport: async () => current ? { getChannel: () => ({ state: 'joined' }) } : null,
        getProvider: () => null,
        detach() { current = false; controller.abort(); return Promise.resolve(); },
        retire() { current = false; controller.abort(); args.onRetired?.({ event: 'SIGNED_OUT' }); },
        prepareLocalClose: async () => ({ local: true }),
        isLocalCloseReceiptCurrent: () => current,
        validateLocalCloseReceipt: async () => current,
      };
      calls.runtimes.push(runtime); return runtime;
    } },
    'LegacyYDocRecoveryNotice.jsx': { default: props => { calls.recovery.push(props); return null; } },
    'crdtFeatureFlag.js': { isCRDTEnabled: () => enabled },
    'StorageFailureBanner.jsx': { default: noopUI }, 'ReSignInModal.jsx': { default: noopUI }, 'ReadOnlyGate.jsx': { default: noopUI },
    'SupabaseYjsProvider.js': { createSupabaseYjsProvider: () => ({ disconnect() {}, getChannel: () => ({ state: 'joined' }) }) },
    'transportStatus.js': { hasRemoteDocumentCollaborator: () => false, isTransportChannelJoined: provider => provider?.getChannel?.()?.state === 'joined' },
    'originBuilder.js': { buildOrigin: args => ({ source: 'local', ...args }) },
    'deviceId.js': { getDeviceId: () => 'test-device' },
    'supabaseClient.js': { supabase, getSupabaseSession: async label => options.session ? options.session(label, actor) : { user: { id: actor } } },
    'crdtUndoManager.js': {
      getLocalFabricOrigin: args => ({ source: 'local-fabric', ...args }),
      createUndoManager(args) { calls.undo.push(args); return { undoManager: { on() {}, off() {}, undoStack: [], redoStack: [] },
        origin: { source: 'local-fabric', userId: args.userId }, dispose: () => calls.undoDisposed.push(args) }; },
    },
    'CollaboratorOutlineOverlay.jsx': { CollaboratorOutlineOverlay: noopUI },
    'useRemoteEditors.js': { useRemoteEditors: () => new Map() },
    'crdtBackfill.js': { runBackfill: async args => { calls.backfill.push(args); return options.backfill ? options.backfill(args) : { ranAs: 'test', count: 0 }; } },
    'crdtDedupePdfImports.js': { dedupePdfImports() {} },
    'crdtDualWriteQueue.js': { STORAGE_FAILURE_EVENT: 'test:storage-failure', drainQueue: async args => { calls.retries.push(args); return {}; } },
    'crdtQueueRetryHandlers.js': { createQueueRetryHandlers: args => { const handlers = createQueueRetryHandlers(args); calls.retryHandlers.push({ args, handlers }); return handlers; } },
    'useDualWriteQueue.js': { useDualWriteQueue: () => ({ stuckCount: 0, quarantinedAnnoIds: [], hasPending: false }) },
    'QuarantineMarkerOverlay.jsx': { QuarantineMarkerOverlay: noopUI },
    'annotationCloudSync.js': {
      upsertFabricAnnotation: async (...args) => { calls.deletes.push(['unexpected-upsert', ...args]); return { error: null }; },
      loadAllNonSurveyMarkerAnnotations: async (id, scope) => { calls.hydrate.push(id); calls.hydrateScopes.push(scope); return options.hydrate ? options.hydrate(id, scope) : { error: null, rawRows: [] }; },
      deleteAnnotations: async (...args) => { calls.deletes.push(args); return { success: true }; },
      deleteAnnotation: async (...args) => { calls.deletes.push(args); return { success: true }; },
    },
    'documentMetadataResolver.js': { resolveDocumentMetadata: async id => { calls.metadata.push(id); return options.metadata ? options.metadata(id) : { userId: actor, cutoverCompletedAt: null }; } },
    'cleanupResidueAudit.js': { auditResidue: args => { calls.audits.push(args); return { residueIds: ['residue'] }; } },
    'permissionScope.js': { isOwner: (user, owner) => user === owner },
    'documentCollaborationStatus.js': { attachDocumentCollaborationStatus },
    'CleanupResidueReviewPanel.jsx': { CleanupResidueReviewPanel: props => { cleanupProps = props; return null; } },
  };
  const key = `__providerTest_${crypto.randomUUID().replaceAll('-', '')}`;
  globalThis[key] = modules;
  const file = new URL('../src/components/collab/YDocProvider.jsx', import.meta.url);
  let source = await readFile(file, 'utf8');
  source = source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm, (_match, bindings, specifier) => {
    const name = specifier.split('/').at(-1);
    assert.ok(modules[name], `unmocked provider import ${specifier}`);
    const value = `globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}]`;
    if (bindings.startsWith('* as ')) return `const ${bindings.slice(5)} = ${value};`;
    if (bindings.startsWith('{')) return `const ${bindings.replace(/\bas\b/g, ':')} = ${value};`;
    return `const ${bindings} = ${value}.default;`;
  }).replaceAll('import.meta.env.MODE', '"test"');
  const transformed = await transformWithOxc(source, file.pathname, { lang: 'jsx' });
  const code = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href))
    + '\n//# sourceURL=mounted-YDocProvider.jsx';
  const Provider = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
  delete globalThis[key];
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const restores = [];
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restores.push(() => descriptor ? Object.defineProperty(globalThis, name, descriptor) : delete globalThis[name]);
  }
  t.mock.method(globalThis, 'setInterval', (callback, delay) => { const interval = { callback, delay, canceled: false }; calls.intervals.push(interval); return interval; });
  t.mock.method(globalThis, 'clearInterval', interval => { if (interval) interval.canceled = true; });
  const root = createRoot(document.getElementById('root'));
  let mounted = true;
  function Consumer() { latest = useContext(context); return null; }
  let props = { docId: documentId, actorUserId: 'actor-a', currentActorUserId: 'actor-a', isActive: true };
  const render = async (next = {}) => {
    props = { ...props, ...next }; actor = props.currentActorUserId;
    await act(async () => root.render(React.createElement(Provider, props, React.createElement(Consumer))));
  };
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
  t.after(async () => {
    await unmount();
    for (const doc of docs) doc.destroy();
    for (const key of keys) registry._evictForTest(key);
    dom.window.close(); restores.reverse().forEach(restore => restore());
  });
  if (options.rawRegistry) {
    const raw = registry.getOrCreateYDoc(documentId); keys.add(documentId); docs.add(raw);
    raw.getMap('annotations').set('unattributed-old-work', 'never import implicitly');
  }
  await render(options.props);
  return { calls, documentId, render, unmount, setEnabled: value => { enabled = value; },
    get value() { return latest; }, get cleanupProps() { return cleanupProps; } };
}

test('document close uses the supplied save gate and never falls back to browser navigation', async t => {
  const h = await mount(t);
  let navigated = 0;
  t.mock.method(window.history, 'back', () => { navigated += 1; });
  assert.equal(h.value.closeDocument().saved, false);
  assert.equal(navigated, 0);
  let checked = 0;
  await h.render({ closeDocument: async () => { checked += 1; return { saved: false }; } });
  assert.equal((await h.value.closeDocument()).saved, false);
  assert.equal(checked, 1);
  assert.equal(navigated, 0);
});

test('mounted inactive provider keeps role and save retries while only shared-status polling sleeps', async t => {
  const h = await mount(t, { props: { isActive: false } });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  const statusReads = () => h.calls.sql.filter(query => query.table === 'document_collaborators').length;
  assert.equal(h.value.docRole, 'owner');
  assert.equal(h.value.isDocShared, false);
  assert.equal(h.calls.roles.length, 1);
  assert.equal(statusReads(), 1);
  assert.equal(h.calls.intervals.some(item => item.delay === 30_000 && !item.canceled), false);
  assert.ok(h.calls.intervals.some(item => item.delay === 1_000 && !item.canceled), 'save retry stays mounted');
  await h.render({ isActive: true });
  assert.equal(statusReads(), 2);
  assert.equal(h.calls.roles.length, 2, 'wake refreshes role authority once');
  assert.ok(h.calls.intervals.some(item => item.delay === 30_000 && !item.canceled));
  await act(async () => h.calls.intervals.find(item => item.delay === 30_000 && !item.canceled).callback());
  assert.equal(h.calls.roles.length, 2, 'ordinary private-document polling does not repeat the role read');
  await h.render({ isActive: false });
  assert.equal(h.calls.intervals.some(item => item.delay === 30_000 && !item.canceled), false);
  assert.ok(h.calls.intervals.some(item => item.delay === 1_000 && !item.canceled));
  assert.equal(h.calls.runtimes.length, 1, 'activation does not recreate sync transport');
});

test('mounted access refresh updates role and confirmed denial keeps revoked access sticky', async t => {
  let result = { data: 'viewer', error: null };
  const h = await mount(t, { roleResult: () => result });
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  const focus = async () => { await act(async () => window.dispatchEvent(new window.Event('focus'))); };
  assert.equal(h.value.docRole, 'viewer');
  assert.equal(h.value.accessRevoked, false);
  result = { data: null, error: { message: 'offline' } }; await focus();
  assert.equal(h.value.docRole, 'viewer', 'transient error does not remove the viewer gate');
  assert.equal(h.value.accessRevoked, false, 'an error is not an authoritative denial');
  result = { data: 'editor', error: null }; await focus();
  assert.equal(h.value.docRole, 'editor');
  result = { data: null, error: null }; await focus();
  assert.equal(h.value.accessRevoked, true);
  assert.equal(h.value.docRole, null, 'denied is not mislabeled as viewer');
  result = { data: 'owner', error: null }; await focus();
  assert.equal(h.value.docRole, 'owner');
  assert.equal(h.value.accessRevoked, true, 'role success cannot clear a revoked runtime');
  assert.equal(h.calls.runtimes.length, 1, 'role reads do not restart transport or claim saved work');
});

test('same raw document uses distinct actor-scoped registry objects and retains the untouched raw source', async t => {
  const h = await mount(t, { rawRegistry: true });
  const a = h.value.ydoc;
  assert.equal(a.guid, getLegacyYDocScopeKey(h.documentId, 'actor-a'));
  assert.equal(a.getMap('annotations').has('unattributed-old-work'), false);
  assert.equal(h.calls.runtimes[0].args.actorUserId, 'actor-a');
  assert.equal(h.calls.runtimes[0].args.documentId, h.documentId);
  await h.render({ actorUserId: 'actor-b', currentActorUserId: 'actor-b' });
  const b = h.value.ydoc;
  assert.notStrictEqual(a, b);
  assert.equal(b.guid, getLegacyYDocScopeKey(h.documentId, 'actor-b'));
  assert.equal(b.getMap('annotations').size, 0);
  assert.equal(a.isDestroyed, false);
  assert.equal(registry.snapshotRegisteredYDoc(h.documentId).state, 'present');
  assert.deepEqual(h.calls.released, [a.guid]);
  await h.unmount();
  assert.deepEqual(h.calls.released, [a.guid, b.guid]);
  assert.ok(!h.calls.acquired.includes(h.documentId));
});

test('mounted runtime role callback updates context without role polling and cloud contracts keep raw document IDs', async t => {
  const h = await mount(t);
  await act(async () => h.calls.runtimes[0].args.onRoleChange('leader'));
  assert.equal(h.value.role, 'leader');
  assert.equal(h.calls.intervals.some(item => item.delay < 1000), false);
  assert.ok(h.calls.backfill.length > 0);
  for (const args of h.calls.backfill) {
    assert.equal(args.documentId, h.documentId);
    assert.equal(args.ydoc.guid, getLegacyYDocScopeKey(h.documentId, 'actor-a'));
    assert.equal(typeof args.isCurrent, 'function');
    assert.equal(args.isCurrent(), true);
    assert.strictEqual(args.signal, h.calls.runtimes[0].signal);
  }
  assert.ok(h.calls.metadata.every(id => id === h.documentId));
  assert.ok(h.calls.roles.every(id => id === h.documentId));
  assert.ok(h.calls.sql.flatMap(query => query.filters).filter(([name]) => name === 'document_id').every(([, id]) => id === h.documentId));
});

test('actor mismatch blocks retained retry, cleanup and origin callbacks and seals the old runtime', async t => {
  const h = await mount(t);
  const oldContext = h.value;
  const oldCleanup = h.cleanupProps.onCleanupAll;
  const retry = h.calls.retryHandlers.at(-1);
  assert.ok(retry);
  assert.equal(oldContext.getOriginContext().userId, 'actor-a');
  await h.render({ currentActorUserId: 'actor-b' });
  assert.equal(h.calls.runtimes[0].isCurrent(), false);
  assert.equal(h.value.accessRevoked, true);
  assert.equal(h.value.undoManager, null);
  assert.equal(oldContext.getOriginContext().userId, null);
  await assert.rejects(retry.handlers.retryCrdtWrite({ op: 'delete', documentId: h.documentId, annoId: 'old-anno', opts: { userId: 'actor-a' } }), /closed/);
  await act(async () => oldCleanup());
  assert.equal(h.calls.deletes.length, 0);
});

test('late identity results cannot create undo managers or begin old-actor cleanup after retirement', async t => {
  const identity = deferred();
  const h = await mount(t, { session: label => label.includes('undoManager') || label.includes('cleanupAudit') ? identity.promise : { user: { id: 'actor-a' } } });
  assert.equal(h.calls.undo.length, 0);
  await act(async () => h.calls.runtimes[0].retire());
  const metadataBefore = h.calls.metadata.length;
  await act(async () => identity.resolve({ user: { id: 'actor-a' } }));
  assert.equal(h.calls.undo.length, 0);
  assert.equal(h.calls.audits.length, 0);
  assert.equal(h.calls.metadata.length, metadataBefore);
});

test('backfill already waiting in its adapter receives a false scope guard after retirement', async t => {
  const backfill = deferred();
  const h = await mount(t, { backfill: () => backfill.promise });
  assert.ok(h.calls.backfill.length > 0);
  const args = h.calls.backfill[0];
  await act(async () => h.calls.runtimes[0].retire());
  assert.equal(args.isCurrent(), false);
  assert.equal(args.signal.aborted, true);
  await act(async () => backfill.resolve({ ranAs: 'cancelled', cancelled: true }));
  assert.equal(h.value.undoManager, null);
  assert.equal(h.value.getOriginContext().userId, null);
});

test('both mounted hydrate callers pass actor-bound guards that stay retired on same-actor return', async t => {
  const hydrate = deferred();
  const h = await mount(t, { hydrate: () => hydrate.promise });
  assert.equal(h.calls.hydrateScopes.length, 2, 'backfill prefetch and owner cleanup each request the shared read');
  const oldScopes = [...h.calls.hydrateScopes];
  const runtime = h.calls.runtimes[0];
  for (const scope of oldScopes) {
    assert.equal(scope.actorUserId, 'actor-a');
    assert.equal(scope.isCurrent(), true);
    assert.strictEqual(scope.signal, runtime.signal);
  }
  await h.render({ currentActorUserId: 'actor-b' });
  await h.render({ currentActorUserId: 'actor-a' });
  for (const scope of oldScopes) {
    assert.equal(scope.isCurrent(), false);
    assert.equal(scope.signal.aborted, true);
  }
  const newScopes = h.calls.hydrateScopes.slice(2);
  assert.equal(newScopes.length, 2);
  for (const scope of newScopes) {
    assert.equal(scope.isCurrent(), true);
    assert.strictEqual(scope.signal, h.calls.runtimes[1].signal);
  }
  await act(async () => hydrate.resolve({ error: null, rawRows: [] }));
  assert.equal(h.calls.backfill.length, 1, 'only the fresh caller may pass hydrate rows to backfill');
});

test('returning to the bound actor starts a fresh session and retries backfill canceled before its write', async t => {
  const hydrate = deferred();
  const h = await mount(t, { hydrate: () => hydrate.promise });
  const doc = h.value.ydoc;
  const oldRuntime = h.calls.runtimes[0];
  assert.equal(h.calls.roles.length, 1);
  assert.ok(h.calls.hydrate.length > 0);
  assert.equal(h.calls.backfill.length, 0);
  await h.render({ currentActorUserId: 'actor-b' });
  assert.equal(oldRuntime.isCurrent(), false);
  await h.render({ currentActorUserId: 'actor-a' });
  assert.equal(h.calls.runtimes.length, 2);
  assert.equal(h.calls.roles.length, 2, 'same-actor return needs a fresh authoritative role, not a retired cache');
  assert.equal(h.value.docRole, 'owner');
  assert.strictEqual(h.value.ydoc, doc);
  assert.equal(h.value.accessRevoked, false);
  assert.equal(h.value.getOriginContext().userId, 'actor-a');
  await act(async () => hydrate.resolve({ error: null, rawRows: [] }));
  assert.equal(h.calls.backfill.length, 1, 'fresh session must retry the canceled import');
  assert.strictEqual(h.calls.backfill[0].signal, h.calls.runtimes[1].signal);
  assert.deepEqual(h.calls.released, [], 'runtime restart must not release the still-mounted scoped doc');
});

test('old retry and cleanup callbacks cannot adopt a fresh runtime when the same actor returns', async t => {
  const h = await mount(t);
  const oldRetry = h.calls.retryHandlers.at(-1);
  const oldCleanup = h.cleanupProps.onCleanupAll;
  assert.deepEqual(h.cleanupProps.residueIds, ['residue']);
  await h.render({ currentActorUserId: 'actor-b' });
  await h.render({ currentActorUserId: 'actor-a' });
  assert.equal(h.calls.runtimes.length, 2);
  await assert.rejects(oldRetry.handlers.retryCrdtWrite({ op: 'delete', documentId: h.documentId, annoId: 'old-anno', opts: { userId: 'actor-a' } }), /closed/);
  await act(async () => oldCleanup());
  assert.equal(h.calls.deletes.length, 0, 'an old audited cleanup action must not acquire the new runtime');
});

test('raw registry close requires a verified separate archive; an export callback cannot grant a receipt', async t => {
  const h = await mount(t, { rawRegistry: true });
  const close = h.value.localCloseSession;
  assert.equal(h.value.localCloseRequired, true);
  assert.equal(close.scopeKey, getLegacyYDocScopeKey(h.documentId, 'actor-a'));
  assert.equal(close.isLocalCloseReceiptCurrent({ local: true }), false);
  await assert.rejects(close.validateLocalCloseReceipt({ local: true }), /local document changed/);
  const notice = h.calls.recovery.at(-1);
  assert.equal(notice.documentId, h.documentId);
  if (notice.onState) await act(async () => notice.onState({ state: 'absent', sources: [], exported: true }));
  assert.equal(close.isLocalCloseReceiptCurrent({ local: true }), false);
  assert.equal(registry.snapshotRegisteredYDoc(h.documentId).state, 'present');
  const receipt = await close.prepareLocalClose();
  assert.equal(receipt.recovery.rawRegistryState, 'present');
  assert.ok(receipt.recovery.archiveId);
  assert.equal(await close.validateLocalCloseReceipt(receipt), true);
  assert.equal(registry.snapshotRegisteredYDoc(h.documentId).state, 'present');
  registry.getOrCreateYDoc(h.documentId).getMap('new-unattributed-root').set('edit', true);
  assert.equal(close.isLocalCloseReceiptCurrent(receipt), false);
  await assert.rejects(close.validateLocalCloseReceipt(receipt), /local document changed/);
});

test('a runtime startup failure still requires local close proof and does not crash the provider', async t => {
  const h = await mount(t, { runtimeUnavailable: true });
  assert.equal(h.value.localCloseRequired, true);
  assert.equal(h.value.localCloseSession, null);
  assert.equal(h.value.accessRevoked, true);
});

test('disabled local-document branch does not require legacy close proof; unresolved actor does', async t => {
  const h = await mount(t, { props: { docId: null } });
  assert.equal(h.value.localCloseRequired, false);
  assert.equal(h.calls.acquired.length, 0);
  await h.render({ docId: h.documentId, actorUserId: null, currentActorUserId: null });
  assert.equal(h.value.localCloseRequired, true);
  assert.equal(h.value.accessRevoked, true);
  assert.equal(h.calls.acquired.length, 0);
  h.setEnabled(false);
  await h.render({ actorUserId: 'actor-a', currentActorUserId: 'actor-a' });
  assert.equal(h.value.localCloseRequired, false);
});
