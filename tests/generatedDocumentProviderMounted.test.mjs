import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';
import { YDocContext } from '../src/components/collab/YDocContext.js';
import { useYDoc } from '../src/hooks/useYDoc.js';
import { resolveReadOnlyReason } from '../src/lib/collab/documentRole.js';
import { claimBodyReadOnly } from '../src/utils/readOnlyBodyReasons.js';
import { createGenerationCollaborationSession } from '../src/lib/collab/generationCollaborationSession.js';
import { getHistoryOrder, shouldUndoLocalBeforeLegacy } from '../src/utils/historyStacks.js';
import { applyAnnotationHistoryAction, invertAnnotationHistoryAction } from '../src/utils/annotationLocalHistory.js';
import * as annotationStore from '../src/services/annotationDocStore.js';
import { createDetachedYDoc } from '../src/lib/collab/ydocRegistry.js';

// Actual component/context/gate/session/auth bridge/status monitor. Only CSS,
// cloud transport, presence and retained-recovery I/O are adapted locally.
// This does not mount the full viewer or prove live Realtime/RLS deployment.
const require = createRequire(import.meta.url);
const id = n => `99800000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), docId = id(2), generation = id(3);
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function loadJsx(relative, modules) {
  const file = new URL(relative, import.meta.url), key = `__generatedMounted_${crypto.randomUUID().replaceAll('-', '')}`;
  globalThis[key] = modules;
  try {
    let source = await readFile(file, 'utf8');
    source = source.replace(/^import\s+['"][^'"]+\.css['"];?$/gm, '');
    source = source.replace(/^import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"];?/gm, (_match, bindings, specifier) => {
      const name = specifier.split('/').at(-1);
      assert.ok(modules[name], `Unexpected production dependency: ${specifier}`);
      const value = `globalThis[${JSON.stringify(key)}][${JSON.stringify(name)}]`;
      bindings = bindings.trim();
      if (bindings.startsWith('{')) return `const ${bindings.replace(/\bas\b/g, ':')} = ${value};`;
      const combined = /^(\w+),\s*(\{[\s\S]*\})$/.exec(bindings);
      if (combined) return `const ${combined[1]} = ${value}.default; const ${combined[2]} = ${value};`;
      return `const ${bindings} = ${value}.default;`;
    });
    const compiled = await transformWithOxc(source, file.pathname, { lang: 'jsx' });
    const code = compiled.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
    return await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  } finally { delete globalThis[key]; }
}

function checkedBundle() {
  return { actorUserId: actor, documentId: docId, pdfGenerationId: generation,
    pdf: { bucket_id: 'documents', path: `${actor}/_generations/current.pdf`, id: id(4), version: id(5), byte_length: '10', content_sha256: 'a'.repeat(64) },
    publication: { operation_id: id(6), generation_id: generation, published_at: '2026-09-09T00:00:00Z', wal_head: '0' } };
}

async function mount(t, { role = 'owner', strict = false, hookOwned = false, realHook = false, ...options } = {}) {
  // Native editable control outside React's root avoids React 18's legacy
  // input-event polyfill in Node while exercising the actual window gate.
  const dom = new JSDOM('<!doctype html><div id="root"></div><input id="typing">', { url: 'http://localhost/', pretendToBeVisual: true });
  const restore = [];
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    CustomEvent: dom.window.CustomEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restore.push(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  }
  const calls = { rpc: [], table: [], channels: [], auth: [], sync: [], presence: [], recovery: [], runtimes: [], intervals: [], snapshots: [],
    childMounts: 0, childUnmounts: 0, childOpenEpochs: [], hookOpens: [] };
  t.mock.method(globalThis, 'setInterval', (callback, ms) => { const timer = { callback, ms, canceled: false }; calls.intervals.push(timer); return timer; });
  t.mock.method(globalThis, 'clearInterval', timer => { if (timer) timer.canceled = true; });
  let authActor = actor, roleResult = role, latest, props, retainedClose, retainedReceipt, latestBridge, latestHook;
  const bundle = checkedBundle();
  function makeHandle() {
    const listeners = new Set();
    return { actorUserId: actor, documentId: docId, pdfGenerationId: generation,
      // A fake legacy-looking value must never become the context's Y.Doc.
      doc: { getMap() { assert.fail('The provider must not inspect a legacy Y.Doc'); } },
      getSyncStatus: () => ({ healthy: true }), getGenerationStatus: () => ({ blocked: false, pdfGenerationId: generation }),
      destroy() { assert.fail('The collaboration bridge must not destroy the hook-owned writer'); },
      flushLocalDurability() { assert.fail('The collaboration bridge must not capture the hook-owned writer'); },
      onSyncStatus(cb) { const record = { cb, disposed: false }; calls.sync.push(record); listeners.add(cb);
        return () => { record.disposed = true; listeners.delete(cb); }; },
      emitSync(value) { for (const cb of listeners) cb(value); },
    };
  }
  function makeClient() {
    const query = run => { const q = { setHeader(name, value) { assert.equal(name, 'Authorization'); assert.equal(value, 'Bearer local-token'); return q; },
      abortSignal(signal) { q.signal = signal; return q; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); } }; return q; };
    return {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: authActor }, access_token: 'local-token' } } }),
        onAuthStateChange(cb) { const record = { cb, disposed: false }; calls.auth.push(record);
          return { data: { subscription: { unsubscribe() { record.disposed = true; } } } }; },
      },
      realtime: { setAuth: async () => {} },
      rpc(name, params) { calls.rpc.push({ name, params });
        assert.equal(name, 'read_document_generation_collaboration', 'No legacy RPC/write');
        return query(async () => ({ data: { version: 1, actor_user_id: actor, document_id: docId, generation_id: generation,
          pdf: bundle.pdf, publication: bundle.publication,
          role: typeof roleResult === 'function' ? await roleResult() : roleResult }, error: null }));
      },
      from(table) { calls.table.push(table); assert.equal(table, 'document_collaborators');
        const q = query(() => ({ data: [], error: null })); q.select = () => q; q.eq = () => q; return q; },
      channel(name) { const channel = { name, disposed: false, on() { return channel; }, subscribe(cb) { channel.status = cb; return channel; } };
        calls.channels.push(channel); return channel; },
      removeChannel: async channel => { channel.disposed = true; },
    };
  }
  const modules = { react: { default: React, ...React }, 'YDocContext.js': { YDocContext },
    'useYDoc.js': { useYDoc }, 'documentRole.js': { resolveReadOnlyReason }, 'readOnlyBodyReasons.js': { claimBodyReadOnly } };
  modules['ReadOnlyGate.jsx'] = await loadJsx('../src/components/collab/ReadOnlyGate.jsx', modules);
  modules['generationCollaborationSession.js'] = { createGenerationCollaborationSession(args) {
    const runtime = createGenerationCollaborationSession({ ...args,
      recoveryFactory(recoveryScope) {
        const record = { scope: recoveryScope, prepared: [], validated: [] }; calls.recovery.push(record);
        return { prepare: async opts => { const receipt = {}; record.prepared.push({ receipt, opts }); return receipt; },
          validate: async (receipt, opts) => { record.validated.push({ receipt, opts }); return recoveryScope.isCurrent(); },
          isCurrent: receipt => recoveryScope.isCurrent() && record.prepared.some(item => item.receipt === receipt) };
      },
      presenceFactory(presenceScope) {
        const record = { scope: presenceScope, disposed: false, active: presenceScope.isActive }; calls.presence.push(record);
        return { getAwareness: () => ({ marker: 'display-only' }), setActive: v => { record.active = v; }, dispose: () => { record.disposed = true; } };
      },
    }); calls.runtimes.push(runtime); return runtime;
  } };
  const { GeneratedDocumentProvider, HookOwnedGeneratedDocumentProvider } = await loadJsx('../src/components/collab/GeneratedDocumentProvider.jsx', modules);
  let useAnnotationDoc;
  if (realHook) {
    const hookUrl = new URL('../src/hooks/useAnnotationDoc.js', import.meta.url);
    const key = `__bridgeHook_${crypto.randomUUID()}`;
    const boundary = args => {
      const doc = createDetachedYDoc(), pending = deferred(); let revision = 0;
      const handle = { ...makeHandle(), doc, documentId: args.documentId, actorUserId: args.actorUserId,
        pdfGenerationId: args.pdfGenerationId, writerId: `hook-writer-${calls.hookOpens.length}`,
        captures: 0, destroys: 0,
        getByPage: () => annotationStore.docToByPage(doc), getMeta: name => annotationStore.getMetaValue(doc, name),
        getSurveyMarkers: () => annotationStore.docToSurveyMarkers(doc), getDeletedPdfAnnotations: () => [],
        getLocalRevision: () => revision, onChange: () => () => {}, onHistoryQuarantine: () => () => {},
        setEraseEffectConsumer: () => {}, repairStackedInkDuplicates: () => annotationStore.repairStackedInkDuplicates(doc),
        applyByPage(value) { handle.captures++; return annotationStore.syncByPageToDoc(doc, value); },
        setMeta(name, value) { handle.captures++; return annotationStore.setMetaValue(doc, name, value); },
        applySurveyMarkers(value) { handle.captures++; return annotationStore.syncSurveyMarkersToDoc(doc, value); },
        flushLocalDurability: async () => receipt(), getLocalCloseReceipt: () => receipt(),
        isLocalReceiptCurrent: value => value?.writerId === handle.writerId && value?.revision === revision,
        revalidateLocalReceipt: async value => value,
        destroy: async () => { handle.destroys++; }, drain: async () => {}, flushSnapshot: async () => true,
      };
      const receipt = () => ({ locallyDurable: true, documentId: args.documentId,
        actorUserId: args.actorUserId, pdfGenerationId: args.pdfGenerationId, writerId: handle.writerId, revision });
      doc.on('update', () => { revision++; });
      calls.hookOpens.push({ args, handle, ...pending }); return pending.promise;
    };
    globalThis[key] = boundary;
    try {
      let source = await readFile(hookUrl, 'utf8');
      source = source.replace(/import\s+\{\s*supabase\s*\}\s+from\s+['"]\.\.\/supabaseClient\.js['"];?/, 'const supabase = {};')
        .replace(/import\s+\{\s*openAnnotationDoc\s*,\s*getClientId\s*\}\s+from\s+['"]\.\.\/services\/annotationDocSync\.js['"];?/,
          `const openAnnotationDoc = globalThis[${JSON.stringify(key)}]; const getClientId = () => 'owned-hook-client';`);
      source = source.replace(/from\s+(['"])([^'"]+)\1/g, (_all, _quote, specifier) => `from ${JSON.stringify(
        specifier.startsWith('.') ? new URL(specifier, hookUrl).href : pathToFileURL(require.resolve(specifier)).href)}`);
      ({ useAnnotationDoc } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`));
    } finally { delete globalThis[key]; }
  }
  const root = createRoot(document.getElementById('root')); let mounted = true;
  function Consumer(bridge) {
    latest = useContext(YDocContext);
    latestBridge = bridge;
    React.useEffect(() => { calls.childMounts++; return () => { calls.childUnmounts++; }; }, []);
    React.useEffect(() => {
      if (bridge.onGenerationSession) calls.childOpenEpochs.push(bridge.onGenerationSession);
    }, [bridge.onGenerationSession]);
    if (realHook) {
      const [annotationsByPage, setAnnotationsByPage] = React.useState({});
      const [spaces, setSpaces] = React.useState([]);
      const [surveyMarkers, setSurveyMarkers] = React.useState({});
      latestHook = useAnnotationDoc({ documentId: props.checkedBundle.documentId, userId: props.currentActorUserId,
        enabled: props.isActive, checkedBundle: bridge.checkedBundle, onGenerationSession: bridge.onGenerationSession,
        annotationsByPage, setAnnotationsByPage, spaces, setSpaces, surveyMarkers, setSurveyMarkers,
        docRole: latest.docRole, pageSizesRef: { current: {} } });
    }
    calls.snapshots.push({ value: latest, oldReceiptCurrent: retainedClose?.isLocalCloseReceiptCurrent(retainedReceipt) ?? null });
    return React.createElement('button', { id: 'mutation' }, 'Markup');
  }
  props = { checkedBundle: bundle, generationSession: makeHandle(), currentActorUserId: actor, client: makeClient(), isActive: true };
  const render = async next => {
    props = { ...props, ...next }; authActor = props.currentActorUserId;
    await act(async () => { const tree = hookOwned
      ? React.createElement(HookOwnedGeneratedDocumentProvider, props, bridge => React.createElement(Consumer, bridge))
      : React.createElement(GeneratedDocumentProvider, props, React.createElement(Consumer));
      root.render(strict ? React.createElement(React.StrictMode, null, tree) : tree); });
  };
  const unmount = async () => { if (mounted) { mounted = false; await act(async () => root.unmount()); } };
  t.after(async () => { await unmount(); for (const item of calls.hookOpens) item.handle.doc.destroy();
    dom.window.close(); restore.reverse().forEach(fn => fn()); });
  await render(options.props);
  return { calls, bundle, render, unmount, makeClient, makeHandle, get props() { return props; }, get value() { return latest; },
    get bridge() { return latestBridge; },
    get hook() { return latestHook; },
    resolveHookOpen: async index => act(async () => { const pending = calls.hookOpens[index]; pending.resolve(pending.handle); await pending.promise; }),
    publish: async (record, callback = latestBridge.onGenerationSession) => {
      let accepted; await act(async () => { accepted = callback(record); }); return accepted;
    },
    setRole: v => { roleResult = v; }, retain: (close, receipt) => { retainedClose = close; retainedReceipt = receipt; },
    focus: async () => { await act(async () => window.dispatchEvent(new window.Event('focus'))); },
    key(key, extra = {}, target = '#mutation') { const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra });
      document.querySelector(target).dispatchEvent(event); return event; },
  };
}

function assertNoLegacy(value) {
  assert.equal(value.ydoc, null); assert.equal(value.undoManager, null); assert.equal(value.undoCtx, null);
  assert.equal(value.isCRDTEnabled, false); assert.equal(value.localCloseRequired, true);
}

test('hook-owned bridge keeps pending children mounted while a valid handle becomes ready', async t => {
  const h = await mount(t, { hookOwned: true });
  assert.equal(h.calls.childMounts, 1); assert.equal(h.calls.childUnmounts, 0);
  assert.equal(h.calls.childOpenEpochs.length, 1); assert.equal(h.calls.rpc.length, 0);
  assert.equal(h.value.docRole, 'viewer'); assert.equal(h.value.localCloseSession, null); assertNoLegacy(h.value);
  const callback = h.bridge.onGenerationSession, handle = h.makeHandle();
  assert.equal(await h.publish({ checkedBundle: h.bundle, handle }), true);
  assert.equal(h.value.docRole, 'owner'); assert.equal(h.calls.childMounts, 1); assert.equal(h.calls.childUnmounts, 0);
  assert.equal(h.bridge.onGenerationSession, callback); assert.equal(h.calls.childOpenEpochs.length, 1);
  assert.equal(await h.publish({ checkedBundle: h.bundle, handle }), true);
  assert.equal(h.calls.runtimes.length, 1, 'Repeating the same published handle does not replace the runtime');
  assertNoLegacy(h.value);
});

test('actual annotation hook owns one open and close per activation through the bridge', async t => {
  const h = await mount(t, { hookOwned: true, realHook: true });
  assert.equal(h.calls.hookOpens.length, 1); assert.equal(h.calls.childMounts, 1);
  assert.equal(h.calls.hookOpens[0].args.checkedBundle, h.bundle);
  assert.equal(h.calls.hookOpens[0].args.pdfGenerationId, generation);
  assert.equal(h.value.localCloseSession, null); assert.equal(h.value.docRole, 'viewer');
  await h.resolveHookOpen(0);
  assert.equal(h.value.docRole, 'owner'); assert.equal(h.hook.initialHydration.ready, true);
  assert.equal(h.calls.hookOpens.length, 1); assert.equal(h.calls.childMounts, 1);
  const oldHandle = h.calls.hookOpens[0].handle, close = h.value.localCloseSession, receipt = await close.prepareLocalClose();
  h.retain(close, receipt);
  await h.render({ isActive: false });
  assert.equal(oldHandle.destroys, 1); assert.equal(h.value.localCloseSession, close);
  assert.equal(close.isLocalCloseReceiptCurrent(receipt), true, 'Hide retains the exact closed writer recovery scope');
  const start = h.calls.snapshots.length;
  await h.render({ isActive: true });
  assert.equal(h.calls.hookOpens.length, 2); assert.equal(h.calls.childMounts, 1);
  assert.equal(h.value.docRole, 'viewer'); assert.equal(h.value.localCloseSession, null);
  assert.ok(h.calls.snapshots.slice(start).every(s => s.oldReceiptCurrent === false && s.value.docRole === 'viewer'));
  await h.resolveHookOpen(1);
  assert.equal(h.value.docRole, 'owner'); assert.equal(h.calls.hookOpens.length, 2);
  assert.equal(oldHandle.destroys, 1); assert.equal(close.isLocalCloseReceiptCurrent(receipt), false);
  await h.unmount(); assert.equal(h.calls.hookOpens[1].handle.destroys, 1);
  assert.equal(h.calls.childUnmounts, 1); assertNoLegacy(h.value);
});

test('actual hook stays blocked after a client swap until a fresh checked bundle opens', async t => {
  const h = await mount(t, { hookOwned: true, realHook: true });
  await h.resolveHookOpen(0);
  const oldHandle = h.calls.hookOpens[0].handle, oldCallback = h.bridge.onGenerationSession;
  const close = h.value.localCloseSession, receipt = await close.prepareLocalClose();
  h.retain(close, receipt);
  await h.render({ client: h.makeClient() });
  assert.equal(h.calls.hookOpens.length, 1, 'Callback changes cannot cause an unchecked writer reopen');
  assert.equal(h.value.docRole, 'viewer'); assert.equal(h.value.localCloseSession, null);
  assert.equal(close.isLocalCloseReceiptCurrent(receipt), false);
  assert.equal(await h.publish({ checkedBundle: h.bundle, handle: oldHandle }, oldCallback), false);
  const freshBundle = structuredClone(h.bundle);
  await h.render({ checkedBundle: freshBundle });
  assert.equal(h.calls.hookOpens.length, 2); assert.equal(oldHandle.destroys, 1);
  assert.equal(h.calls.hookOpens[1].args.checkedBundle, freshBundle);
  assert.equal(h.value.docRole, 'viewer');
  await h.resolveHookOpen(1);
  assert.equal(h.value.docRole, 'owner'); assert.equal(h.calls.childMounts, 1);
});

test('StrictMode hook bridge ignores a late cancelled open and keeps one live published writer', async t => {
  const h = await mount(t, { hookOwned: true, realHook: true, strict: true });
  assert.equal(h.calls.hookOpens.length, 2, 'StrictMode replays the hook effect');
  const cancelled = h.calls.hookOpens[0].handle, active = h.calls.hookOpens[1].handle;
  assert.equal(h.value.docRole, 'viewer'); assert.equal(h.value.localCloseSession, null);
  await h.resolveHookOpen(1);
  assert.equal(h.value.docRole, 'owner');
  const close = h.value.localCloseSession, runtimeCount = h.calls.runtimes.length;
  await h.resolveHookOpen(0);
  assert.equal(cancelled.destroys, 1); assert.equal(active.destroys, 0);
  assert.equal(h.value.localCloseSession, close); assert.equal(h.calls.runtimes.length, runtimeCount);
  assert.equal(h.calls.presence.filter(item => !item.disposed).length, 1);
  assert.equal(h.calls.auth.filter(item => !item.disposed).length, 1);
  await h.unmount();
  assert.equal(cancelled.destroys, 1); assert.equal(active.destroys, 1);
  for (const group of ['auth', 'sync', 'presence', 'channels']) assert.ok(h.calls[group].every(item => item.disposed), group);
  assert.ok(h.calls.intervals.every(timer => timer.canceled));
});

for (const field of ['currentActorUserId', 'checkedBundle', 'client']) test(`hook-owned ${field} A-B-A cannot accept either stale callback`, async t => {
  const h = await mount(t, { hookOwned: true }), callbackA = h.bridge.onGenerationSession;
  const original = h.props[field], handle = h.makeHandle();
  await h.publish({ checkedBundle: h.bundle, handle });
  const close = h.value.localCloseSession, receipt = await close.prepareLocalClose(); h.retain(close, receipt);
  const next = field === 'currentActorUserId' ? id(99) : field === 'checkedBundle' ? structuredClone(h.bundle) : h.makeClient();
  await h.render({ [field]: next }); const callbackB = h.bridge.onGenerationSession;
  assert.equal(await h.publish({ checkedBundle: h.bundle, handle }, callbackA), false);
  assert.equal(close.isLocalCloseReceiptCurrent(receipt), false);
  await h.render({ [field]: original });
  assert.notEqual(h.bridge.onGenerationSession, callbackA); assert.notEqual(h.bridge.onGenerationSession, callbackB);
  assert.equal(await h.publish({ checkedBundle: h.bundle, handle }, callbackA), false);
  assert.equal(await h.publish({ checkedBundle: h.bundle, handle }, callbackB), false);
  assert.equal(h.value.docRole, 'viewer'); assert.equal(h.value.localCloseSession, null);
  assert.equal(await h.publish({ checkedBundle: h.bundle, handle: h.makeHandle() }), true);
  assert.equal(h.value.docRole, 'owner'); assertNoLegacy(h.value);
});

test('hook-owned bridge rejects mismatched handles and unissued open records', async t => {
  const h = await mount(t, { hookOwned: true }), handle = h.makeHandle();
  for (const record of [null, {}, { checkedBundle: h.bundle, handle: null },
    { checkedBundle: structuredClone(h.bundle), handle },
    ...['actorUserId', 'documentId', 'pdfGenerationId'].map(field => ({ checkedBundle: h.bundle, handle: { ...handle, [field]: id(99) } }))]) {
    assert.equal(await h.publish(record), false);
    assert.equal(h.value.localCloseSession, null); assert.equal(h.value.docRole, 'viewer');
  }
  assert.equal(h.calls.rpc.length, 0); assert.equal(h.calls.runtimes.length, 0);
  await h.publish({ checkedBundle: h.bundle, handle });
  assert.equal(h.value.docRole, 'owner');
});

test('hiding a pending reactivation never restores an older active writer recovery scope', async t => {
  const h = await mount(t, { hookOwned: true }), handleA = h.makeHandle(), callbackA = h.bridge.onGenerationSession;
  await h.publish({ checkedBundle: h.bundle, handle: handleA });
  const close = h.value.localCloseSession, receipt = await close.prepareLocalClose(); h.retain(close, receipt);
  await h.render({ isActive: false }); assert.equal(h.value.localCloseSession, close);
  assert.equal(await h.publish({ checkedBundle: h.bundle, handle: handleA }, callbackA), false);
  await h.render({ isActive: true }); const callbackB = h.bridge.onGenerationSession;
  assert.equal(h.value.localCloseSession, null); assert.equal(close.isLocalCloseReceiptCurrent(receipt), false);
  await h.render({ isActive: false });
  assert.equal(h.value.localCloseSession, null, 'Pending B has no writer to retain; A must not return');
  assert.equal(await h.publish({ checkedBundle: h.bundle, handle: h.makeHandle() }, callbackB), false);
  assert.equal(close.isLocalCloseReceiptCurrent(receipt), false);
  await h.render({ isActive: true });
  assert.equal(await h.publish({ checkedBundle: h.bundle, handle: h.makeHandle() }), true);
  assert.notEqual(h.value.localCloseSession, close); assert.equal(h.calls.childMounts, 1);
});

test('unmounted hook-owned callback cannot start authority or reclaim a writer', async t => {
  const h = await mount(t, { hookOwned: true }), callback = h.bridge.onGenerationSession;
  await h.unmount(); const reads = h.calls.rpc.length;
  assert.equal(await h.publish({ checkedBundle: h.bundle, handle: h.makeHandle() }, callback), false);
  assert.equal(h.calls.rpc.length, reads); assert.equal(h.calls.runtimes.length, 0);
});

test('unknown and confirmed viewer authority mount the real body/keyboard mutation gate', async t => {
  const gate = deferred(), h = await mount(t, { role: () => gate.promise });
  assert.equal(h.value.docRole, 'viewer'); assert.equal(h.value.authorityStatus, 'checking'); assertNoLegacy(h.value);
  assert.equal(document.body.dataset.readonly, 'true');
  for (const [key, options] of [['Delete', {}], ['Backspace', {}], ['z', { ctrlKey: true }], ['Z', { metaKey: true, shiftKey: true }]]) {
    assert.equal(h.key(key, options).defaultPrevented, true);
  }
  assert.equal(h.key('s', { ctrlKey: true }).defaultPrevented, false);
  assert.equal(h.key('Backspace', {}, '#typing').defaultPrevented, false);
  await act(async () => gate.resolve('viewer'));
  assert.equal(h.value.authorityStatus, 'confirmed'); assert.equal(h.value.docRole, 'viewer');
  assert.equal(h.key('Delete').defaultPrevented, true);
});

for (const role of ['editor', 'owner']) test(`only a confirmed ${role} unlocks mutation controls`, async t => {
  const h = await mount(t, { role });
  assert.equal(h.value.docRole, role); assert.equal(h.value.authorityStatus, 'confirmed'); assertNoLegacy(h.value);
  assert.notEqual(document.body.dataset.readonly, 'true'); assert.equal(h.key('z', { ctrlKey: true }).defaultPrevented, false);
  h.setRole('viewer'); await h.focus();
  assert.equal(h.value.docRole, 'viewer'); assert.equal(h.key('Delete').defaultPrevented, true);
});

test('wrong actor blocks in the first render and returning actor cannot revive the retired session', async t => {
  const h = await mount(t), close = h.value.localCloseSession, receipt = await close.prepareLocalClose();
  h.retain(close, receipt); const start = h.calls.snapshots.length;
  await h.render({ currentActorUserId: id(9) });
  const changed = h.calls.snapshots.slice(start);
  assert.ok(changed.length); assert.ok(changed.every(s => s.value.accessRevoked && s.value.docRole === 'viewer' && s.oldReceiptCurrent === false));
  assert.equal(changed[0].value.localCloseSession, null); assert.equal(changed[0].value.getOriginContext().userId, null);
  await h.render({ currentActorUserId: actor });
  await act(async () => h.value.setLoginExpired(false)); await h.focus();
  assert.equal(h.value.accessRevoked, true); assert.equal(h.value.docRole, 'viewer');
  assert.equal(close.isLocalCloseReceiptCurrent(receipt), false); assert.equal(h.key('Delete').defaultPrevented, true);
});

for (const replace of ['checkedBundle', 'generationSession', 'client']) test(`${replace} replacement cannot render old authority or reuse a close receipt`, async t => {
  const h = await mount(t), close = h.value.localCloseSession, receipt = await close.prepareLocalClose();
  h.retain(close, receipt); const gate = deferred(); h.setRole(() => gate.promise);
  const start = h.calls.snapshots.length;
  const replacement = replace === 'checkedBundle' ? structuredClone(h.bundle) : replace === 'client' ? h.makeClient() : h.makeHandle();
  await h.render({ [replace]: replacement });
  const snapshots = h.calls.snapshots.slice(start);
  assert.ok(snapshots.every(s => s.value.docRole === 'viewer' && s.oldReceiptCurrent === false));
  assert.equal(snapshots[0].value.localCloseSession, null);
  assert.equal(close.isLocalCloseReceiptCurrent(receipt), false);
  await assert.rejects(close.validateLocalCloseReceipt(receipt));
  await act(async () => gate.resolve('editor'));
  assert.equal(h.value.docRole, 'editor'); assert.notEqual(h.value.localCloseSession, close);
  assertNoLegacy(h.value);
});

test('late old role reply cannot unlock a replacement handle', async t => {
  const oldRole = deferred(), nextRole = deferred(); let useOld = true;
  const h = await mount(t, { role: () => useOld ? oldRole.promise : nextRole.promise });
  useOld = false; await h.render({ generationSession: h.makeHandle() });
  await act(async () => oldRole.resolve('owner'));
  assert.equal(h.value.docRole, 'viewer'); assert.equal(h.key('Delete').defaultPrevented, true);
  await act(async () => nextRole.resolve('viewer'));
  assert.equal(h.value.authorityStatus, 'confirmed'); assert.equal(h.value.docRole, 'viewer');
});

test('a keyed generation remount invalidates the old close receipt during the first new render', async t => {
  const h = await mount(t), close = h.value.localCloseSession, receipt = await close.prepareLocalClose();
  h.retain(close, receipt); const start = h.calls.snapshots.length;
  const nextGeneration = id(88), nextBundle = structuredClone(h.bundle);
  nextBundle.pdfGenerationId = nextGeneration; nextBundle.publication.generation_id = nextGeneration;
  const nextHandle = { ...h.makeHandle(), pdfGenerationId: nextGeneration,
    getGenerationStatus: () => ({ blocked: false, pdfGenerationId: nextGeneration }) };
  await h.render({ checkedBundle: nextBundle, generationSession: nextHandle });
  const snapshots = h.calls.snapshots.slice(start);
  assert.ok(snapshots.length); assert.equal(snapshots[0].value.localCloseSession, null);
  assert.ok(snapshots.every(s => s.oldReceiptCurrent === false), 'Retained close proof must fail before the old keyed child passive cleanup');
});

test('StrictMode and unmount dispose every owned bridge, listener, presence and timer', async t => {
  const h = await mount(t, { strict: true });
  assert.equal(h.value.docRole, 'owner'); assert.ok(h.calls.runtimes.length >= 2);
  assert.equal(h.calls.presence.filter(p => !p.disposed).length, 1);
  assert.equal(h.calls.auth.filter(p => !p.disposed).length, 1);
  const close = h.value.localCloseSession, receipt = await close.prepareLocalClose();
  await h.unmount();
  assert.equal(close.isLocalCloseReceiptCurrent(receipt), false);
  for (const group of ['auth', 'sync', 'presence', 'channels']) assert.ok(h.calls[group].every(item => item.disposed), group);
  assert.ok(h.calls.intervals.every(timer => timer.canceled));
  assert.notEqual(document.body.dataset.readonly, 'true');
  const reads = h.calls.rpc.length; window.dispatchEvent(new window.Event('focus')); await act(async () => {});
  assert.equal(h.calls.rpc.length, reads);
});

test('an authority reply arriving after unmount cannot publish context or retain listeners', async t => {
  const role = deferred(), h = await mount(t, { role: () => role.promise });
  assert.equal(h.value.authorityStatus, 'checking'); await h.unmount();
  const renders = h.calls.snapshots.length, reads = h.calls.rpc.length;
  await act(async () => role.resolve('owner'));
  assert.equal(h.calls.snapshots.length, renders); assert.equal(h.calls.rpc.length, reads);
  assert.ok(h.calls.auth.every(item => item.disposed)); assert.ok(h.calls.sync.every(item => item.disposed));
  assert.ok(h.calls.presence.every(item => item.disposed)); assert.notEqual(document.body.dataset.readonly, 'true');
});

test('inactive viewer releases only the global gate; activation rechecks and reinstalls it', async t => {
  const h = await mount(t, { role: 'viewer' }), count = h.calls.runtimes.length;
  await h.render({ isActive: false }); assert.notEqual(document.body.dataset.readonly, 'true');
  assert.equal(h.value.docRole, 'viewer'); assert.equal(h.calls.presence.at(-1).active, false);
  await h.render({ isActive: true }); assert.equal(document.body.dataset.readonly, 'true');
  assert.equal(h.calls.runtimes.length, count); assert.equal(h.calls.presence.at(-1).active, true);
});

test('checked close callback is used and missing callback never pretends success', async t => {
  const h = await mount(t); assert.equal(h.value.closeDocument().saved, false);
  let called = 0; await h.render({ closeDocument: async () => { called++; return { saved: false }; } });
  assert.equal((await h.value.closeDocument()).saved, false); assert.equal(called, 1);
  assert.ok(h.calls.rpc.every(c => c.name === 'read_document_generation_collaboration'));
  assert.ok(h.calls.table.every(table => table === 'document_collaborators'));
});

test('role downgrade invalidates the old close receipt and forces read-only recovery', async t => {
  const h = await mount(t), close = h.value.localCloseSession, receipt = await close.prepareLocalClose();
  assert.equal(close.isLocalCloseReceiptCurrent(receipt), true);
  h.setRole('viewer'); await h.focus();
  assert.equal(close.isLocalCloseReceiptCurrent(receipt), false);
  await close.prepareLocalClose();
  assert.equal(h.calls.recovery.at(-1).prepared.at(-1).opts.readOnly, true);
  assert.equal(h.key('Delete').defaultPrevented, true);
});

test('an invalid replacement handle stays blocked and makes no new cloud request', async t => {
  const h = await mount(t), requests = h.calls.rpc.length;
  await h.render({ generationSession: { ...h.makeHandle(), actorUserId: id(99) } });
  assert.equal(h.value.accessRevoked, true); assert.equal(h.value.docRole, 'viewer');
  assert.equal(h.value.localCloseSession, null); assertNoLegacy(h.value);
  assert.equal(h.calls.rpc.length, requests); assert.equal(h.key('Delete').defaultPrevented, true);
});

test('auth sign-out stays revoked after later same-actor sign-in events', async t => {
  const h = await mount(t), auth = h.calls.auth.find(item => !item.disposed);
  await act(async () => auth.cb('SIGNED_OUT', null));
  assert.equal(h.value.accessRevoked, true); assert.equal(h.value.getAwareness(), null);
  await act(async () => auth.cb('SIGNED_IN', { user: { id: actor }, access_token: 'local-token' }));
  assert.equal(h.value.docRole, 'viewer'); assert.equal(h.value.loginExpired, true);
  assert.equal(h.key('z', { ctrlKey: true }).defaultPrevented, true);
});

test('actual viewer undo callback still selects local annotation history with the mounted null legacy context', async t => {
  const h = await mount(t), source = await readFile(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const startMarker = 'const handleUndo = useCallback(() => {';
  const start = source.indexOf(startMarker), end = source.indexOf('}, [applyLocalAnnotationHistoryAction,', start);
  assert.ok(start >= 0 && end > start, 'Actual viewer callback must remain identifiable');
  const body = source.slice(start + startMarker.length, end);
  const annotation = { type: 'rect', data: { id: 'modern-a' }, meta: { authorId: actor } };
  const action = { type: 'fabric:create', pageNumber: 1, annotationId: 'modern-a', storageKey: 'modern-a', annotation,
    __historyMeta: { checkpointId: 10 } };
  let annotations = { 1: { objects: [annotation] } }, version = 0;
  const events = [], undoRef = { current: [action] }, redoRef = { current: [] };
  const noop = () => {};
  const dependencies = {
    deferUntilEraseCommitsFinish: () => false, recordAnnotationUndoRedo: noop,
    localAnnotationUndoRef: undoRef, localAnnotationRedoRef: redoRef,
    undoHistoryMetaRef: { current: [] }, undoHistoryRef: { current: [] }, redoHistoryRef: { current: [] },
    shouldUndoLocalBeforeLegacy, getHistoryOrder, invertAnnotationHistoryAction,
    isLegacyAnnotationHistoryMeta: meta => meta !== null, shouldScopeCalloutHistoryRestore: () => false,
    summarizeHistoryActionForLog: value => value, summarizeHistoryMetaForLog: value => value, mapYjsMeta: value => value,
    pushHistoryDebugEvent: (kind, detail) => events.push({ kind, detail }), isUndoingRef: { current: false },
    applyLocalAnnotationHistoryAction: inverse => { annotations = applyAnnotationHistoryAction(annotations, inverse); return true; },
    setLocalAnnotationHistoryVersion: update => { version = update(version); },
    yjsDoc: h.value.ydoc, yjsUndoManager: h.value.undoManager, yjsUndoCtx: h.value.undoCtx,
    effectiveDocumentLockedRef: { current: false },
    userUndo: () => assert.fail('Generated provider cannot route through legacy undo'),
  };
  // Execute the production callback body, not a copied selection expression.
  // Drawing/DOM and unrelated legacy checkpoint branches are outside this test.
  const undo = new Function(...Object.keys(dependencies), `return function handleUndo() {${body}}`)(...Object.values(dependencies));
  undo();
  assert.equal(events.find(e => e.kind === 'undo_choice').detail.chosenSource, 'local annotation history');
  assert.equal(annotations[1].objects.length, 0); assert.deepEqual(undoRef.current, []); assert.deepEqual(redoRef.current, [action]);
  assert.equal(version, 1); assertNoLegacy(h.value);
  undo(); // Empty modern history and no legacy manager: harmless no-op.
  assert.equal(events.filter(e => e.kind === 'undo_choice').at(-1).detail.chosenSource, 'none');
});
