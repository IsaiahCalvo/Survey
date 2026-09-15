import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
let moduleId = 0;

async function loadPanel() {
  const sourceUrl = new URL('../src/components/revisions/RevisionsPanel.jsx', import.meta.url);
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const jsxUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  const readOnlyUrl = new URL('../src/utils/readOnlyBodyReasons.js', import.meta.url).href;
  let source = await readFile(sourceUrl, 'utf8');
  source = source
    .replace("from 'react'", `from ${JSON.stringify(reactUrl)}`)
    .replace("import { supabase } from '../../supabaseClient';", 'const supabase = globalThis.__historyPollingSupabase;')
    .replace("import Icon from '../../Icons';", 'const Icon = () => null;')
    .replace(/import \{[^}]+\} from '\.\.\/\.\.\/services\/documentRevisionService';/, 'const { createRevision, listRevisions, getRevision, restoreRevision } = globalThis.__historyPollingService;')
    .replace(/import \{\s*getDocumentHistoryStorageStatus,\s*listDocumentHistoryEvents,\s*subscribeDocumentHistoryStorage,?\s*\} from '\.\.\/\.\.\/services\/documentHistoryService';/, 'const { getDocumentHistoryStorageStatus, listDocumentHistoryEvents, subscribeDocumentHistoryStorage } = globalThis.__historyPollingService;')
    .replace(/import \{\s*inspectLegacyDocumentHistory,\s*selectLegacyDocumentHistoryBucket,?\s*\} from '\.\.\/\.\.\/services\/legacyDocumentHistoryRecovery\.js';/, 'const { inspectLegacyDocumentHistory, selectLegacyDocumentHistoryBucket } = globalThis.__historyPollingService;')
    .replace("import { resolveRegionRestoreCascade, describeHistoryEventSubject } from '../../services/annotationTrashHistory';", 'const resolveRegionRestoreCascade = () => null; const describeHistoryEventSubject = () => null;')
    .replace("from '../../utils/readOnlyBodyReasons.js'", `from ${JSON.stringify(readOnlyUrl)}`);
  const transformed = await transformWithOxc(source, fileURLToPath(sourceUrl), { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxUrl));
  return (await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}#${++moduleId}`)).default;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function mountPanel(t, initialProps, serviceOverrides = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const calls = { revisions: [], history: [], status: [], subscribe: [], owner: [], legacyInspect: [], legacySelect: [] };
  const listeners = new Set();
  globalThis.__historyPollingSupabase = {
    from(table) {
      return {
        select() { return this; },
        eq(column, value) { calls.owner.push({ table, column, value }); return this; },
        async maybeSingle() {
          if (serviceOverrides.ownerReject) throw new Error('offline owner lookup');
          const actor = currentProps?.user?.id;
          return { data: actor ? { user_id: actor, project_id: null, projects: null } : null, error: null };
        },
      };
    },
  };
  globalThis.__historyPollingService = {
    async listRevisions(id) {
      calls.revisions.push(id);
      return serviceOverrides.listRevisions ? serviceOverrides.listRevisions(id) : [];
    },
    async listDocumentHistoryEvents(id, options) {
      calls.history.push({ id, options });
      return serviceOverrides.listDocumentHistoryEvents
        ? serviceOverrides.listDocumentHistoryEvents(id, options)
        : [];
    },
    async getDocumentHistoryStorageStatus(options) {
      calls.status.push(options);
      if (serviceOverrides.getDocumentHistoryStorageStatus) {
        return serviceOverrides.getDocumentHistoryStorageStatus(options);
      }
      return { available: true, pendingCount: 0, protectedBytes: 0, confirmedCacheBytes: 0, legacyUnscopedAvailable: false, errorCode: null };
    },
    subscribeDocumentHistoryStorage(options, listener) {
      calls.subscribe.push(options);
      if (serviceOverrides.subscribeDocumentHistoryStorage) {
        return serviceOverrides.subscribeDocumentHistoryStorage(options, listener);
      }
      listeners.add(listener);
      let active = true;
      return () => { if (active) listeners.delete(listener); active = false; };
    },
    async inspectLegacyDocumentHistory(options) {
      calls.legacyInspect.push(options);
      return serviceOverrides.inspectLegacyDocumentHistory
        ? serviceOverrides.inspectLegacyDocumentHistory(options)
        : { status: 'absent', version: 1, buckets: [] };
    },
    async selectLegacyDocumentHistoryBucket(inspection, options) {
      calls.legacySelect.push({ inspection, options });
      return serviceOverrides.selectLegacyDocumentHistoryBucket
        ? serviceOverrides.selectLegacyDocumentHistoryBucket(inspection, options)
        : { status: 'selected', version: 1, sourceBucketId: options.sourceBucketId, documentId: options.openLocalDocumentId, rows: [] };
    },
    async createRevision(...args) {
      return serviceOverrides.createRevision?.(...args) || { revision_number: 2 };
    },
    async getRevision(...args) {
      return serviceOverrides.getRevision?.(...args) || { snapshot_json: { annotations: [] } };
    },
    async restoreRevision(...args) {
      return serviceOverrides.restoreRevision?.(...args) || { revision_number: 3 };
    },
  };
  const timeouts = new Map();
  const intervals = new Map();
  let timerId = 0;
  window.setTimeout = (callback, delay) => { timeouts.set(++timerId, { callback, delay }); return timerId; };
  window.clearTimeout = (id) => timeouts.delete(id);
  window.setInterval = (callback, delay) => { intervals.set(++timerId, { callback, delay }); return timerId; };
  window.clearInterval = (id) => intervals.delete(id);
  window.confirm = () => true;
  window.prompt = () => '';
  const RevisionsPanel = await loadPanel();
  const root = createRoot(document.getElementById('root'));
  let props = { documentId: 'doc-a', user: null, embedded: true, isActive: false, ...initialProps };
  let currentProps = props;
  const render = async (next = {}) => {
    props = { ...props, ...next };
    currentProps = props;
    await act(async () => root.render(React.createElement(RevisionsPanel, props)));
  };
  const renderBeforePassiveEffects = (next = {}) => {
    props = { ...props, ...next };
    currentProps = props;
    const priorActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT;
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      flushSync(() => root.render(React.createElement(RevisionsPanel, props)));
    } finally {
      globalThis.IS_REACT_ACT_ENVIRONMENT = priorActEnvironment;
    }
  };
  const recorded = async () => act(async () => {
    for (const listener of [...listeners]) listener();
  });
  const flush = async (timers) => act(async () => {
    for (const [id, { callback }] of [...timers]) {
      if (timers === timeouts) timers.delete(id);
      await callback();
    }
  });
  const click = async (selector) => act(async () => {
    const button = document.querySelector(selector);
    assert.ok(button, selector);
    button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  let unmounted = false;
  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    await act(async () => root.unmount());
  };
  t.after(async () => {
    await unmount();
    assert.equal(intervals.size, 0, 'unmount removes polling');
    assert.equal(timeouts.size, 0, 'unmount removes pending refresh');
    dom.window.close();
    delete globalThis.__historyPollingService;
    delete globalThis.__historyPollingSupabase;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await render();
  return { calls, timeouts, intervals, listeners, render, renderBeforePassiveEffects,
    recorded, flush, click, unmount };
}

test('hidden embedded history does not fetch, listen, or poll; reopen fetches fresh data', async (t) => {
  const mounted = await mountPanel(t, { user: { id: 'actor-a' } });
  const { calls, timeouts, intervals, render, recorded, flush } = mounted;
  assert.equal(calls.revisions.length, 0);
  assert.equal(calls.history.length, 0);
  assert.equal(calls.owner.length, 0);
  assert.equal(intervals.size, 0);
  await recorded();
  assert.equal(timeouts.size, 0, 'no event listener while hidden');

  await render({ isActive: true });
  assert.deepEqual(calls.revisions, ['doc-a']);
  assert.deepEqual(calls.history, [{ id: 'doc-a', options: { limit: 200, actorUserId: 'actor-a' } }]);
  assert.deepEqual(calls.status, [{ actorUserId: 'actor-a' }]);
  assert.deepEqual(calls.subscribe, [{ actorUserId: 'actor-a' }]);
  assert.equal(calls.owner.length, 1);
  assert.equal(intervals.size, 1);
  assert.equal([...intervals.values()][0].delay, 10000);
  await flush(intervals);
  assert.equal(calls.history.length, 2, 'visible polling still refreshes');
  await recorded();
  assert.equal(timeouts.size, 1);
  await render({ isActive: false });
  assert.equal(intervals.size, 0);
  assert.equal(timeouts.size, 0, 'hiding cancels scheduled event refresh');
  await recorded();
  assert.equal(timeouts.size, 0, 'hiding removes the event listener');
  await flush(intervals);
  await flush(timeouts);
  assert.equal(calls.history.length, 2);
  await render({ isActive: true });
  assert.equal(calls.history.length, 3, 'reopen performs a fresh read');
  await recorded();
  await flush(timeouts);
  assert.equal(calls.history.length, 4, 'visible event refresh still works');
  await recorded(); // Leave pending work to verify unmount cleanup too.
});

test('floating history requires both an open drawer and an active document', async (t) => {
  const { calls, intervals, render, click } = await mountPanel(t, { embedded: false, isActive: true });
  assert.equal(calls.history.length, 0, 'closed drawer does not read');
  await click('[data-testid="kal48-revisions-launcher"]');
  assert.equal(calls.history.length, 1);
  assert.deepEqual(calls.history[0], { id: 'doc-a', options: { limit: 200, guestScopeId: 'device-local' } });
  assert.equal(calls.revisions.length, 0, 'guest never reads cloud revisions');
  assert.equal(calls.owner.length, 0, 'guest never reads cloud ownership');
  assert.equal(intervals.size, 1);
  await render({ isActive: false });
  assert.equal(intervals.size, 0);
  await render({ isActive: true });
  assert.equal(calls.history.length, 2);
  await click('[aria-label="Close version history panel"]');
  assert.equal(intervals.size, 0);
  await click('[data-testid="kal48-revisions-launcher"]');
  assert.equal(calls.history.length, 3);
});

test('an explicit missing scope does not turn an auth-null cloud document into guest history', async (t) => {
  const { calls, intervals } = await mountPanel(t, {
    isActive: true,
    user: null,
    historyScope: null,
  });
  assert.equal(calls.history.length, 0);
  assert.equal(calls.status.length, 0);
  assert.equal(calls.subscribe.length, 0);
  assert.equal(calls.revisions.length, 0);
  assert.equal(calls.owner.length, 0);
  assert.equal(intervals.size, 0);
});

test('valid to null to valid history identity stays hook-safe and never falls into guest scope', async (t) => {
  const { calls, render, renderBeforePassiveEffects } = await mountPanel(t, {
    isActive: true,
    user: { id: 'actor-a' },
    historyScope: { actorUserId: 'actor-a' },
  }, {
    async listDocumentHistoryEvents(id) {
      return [{ client_event_id: `row-${id}`, summary: `Row for ${id}`,
        occurred_at: '2026-09-14T12:00:00Z', payload: {} }];
    },
  });
  assert.match(document.body.textContent, /Row for doc-a/);
  renderBeforePassiveEffects({ documentId: null, historyScope: null });
  assert.equal(document.querySelector('[data-testid="kal48-revisions-panel"]'), null);
  assert.doesNotMatch(document.body.textContent, /Row for doc-a/);
  await render({ documentId: 'doc-b', historyScope: { actorUserId: 'actor-a' } });
  assert.match(document.body.textContent, /Row for doc-b/);
  assert.equal(calls.history.some(({ options }) => options.guestScopeId === 'device-local'), false);
});

test('signed actor scopes local reads while cloud collaborator rows remain visible', async (t) => {
  const collaborator = {
    id: 'cloud-row', client_event_id: 'cloud-row', user_id: 'other-user', summary: 'A teammate edited a mark',
    occurred_at: '2026-09-14T12:00:00.000Z', payload: {},
  };
  const { calls } = await mountPanel(t, { isActive: true, user: { id: 'actor-a' } }, {
    async listDocumentHistoryEvents() { return [collaborator]; },
  });
  assert.deepEqual(calls.history, [{ id: 'doc-a', options: { limit: 200, actorUserId: 'actor-a' } }]);
  assert.deepEqual(calls.subscribe, [{ actorUserId: 'actor-a' }]);
  assert.equal(calls.owner.length, 1);
  assert.match(document.body.textContent, /A teammate edited a mark/);
});

test('explicit device scope wins for a signed-in managed-local document and keeps activity restore', async (t) => {
  const restored = [];
  const localDeleted = {
    client_event_id: 'local-delete', user_id: 'actor-a', event_type: 'annotation_deleted',
    summary: 'Deleted local mark', occurred_at: '2026-09-14T12:00:00.000Z', page_number: 1,
    payload: { restoreAction: { type: 'fabric:create', pageNumber: 1, annotation: { id: 'mark-a' } } },
  };
  const { calls, click } = await mountPanel(t, {
    isActive: true,
    user: { id: 'actor-a' },
    historyScope: { guestScopeId: 'device-local' },
    onRestoreHistoryActivity(event) {
      restored.push(event.client_event_id);
      return { ok: true, pageNumber: 1 };
    },
  }, {
    async listRevisions() { throw new Error('device scope must not read cloud revisions'); },
    async listDocumentHistoryEvents() { return [localDeleted]; },
    async getDocumentHistoryStorageStatus() {
      return { available: true, pendingCount: 2, protectedBytes: 1, confirmedCacheBytes: 0,
        legacyUnscopedAvailable: false, errorCode: null };
    },
  });
  assert.deepEqual(calls.history, [{
    id: 'doc-a', options: { limit: 200, guestScopeId: 'device-local' },
  }]);
  assert.deepEqual(calls.status, [{ guestScopeId: 'device-local' }]);
  assert.deepEqual(calls.subscribe, [{ guestScopeId: 'device-local' }]);
  assert.equal(calls.revisions.length, 0);
  assert.equal(calls.owner.length, 0);
  assert.equal(document.querySelector('[data-testid="kal48-save-revision"]'), null);
  assert.match(document.body.textContent, /Across your documents, 2 local history items are stored only on this device/);
  assert.match(document.body.textContent, /Deleted local activity can still be restored above/);
  assert.ok(document.querySelector('[data-testid="document-history-restore-local-delete"]'));
  await click('[data-testid="document-history-restore-local-delete"]');
  assert.deepEqual(restored, ['local-delete']);
});

test('document, actor, and hide changes reject late history results', async (t) => {
  const first = deferred();
  const second = deferred();
  let read = 0;
  const { calls, render } = await mountPanel(t, { isActive: true, user: { id: 'actor-a' } }, {
    async listDocumentHistoryEvents() {
      read += 1;
      return read === 1 ? first.promise : second.promise;
    },
  });
  await render({ documentId: 'doc-b', user: { id: 'actor-b' } });
  await act(async () => first.resolve([{ id: 'old', client_event_id: 'old', summary: 'Old account row', occurred_at: '2026-09-14T10:00:00Z' }]));
  assert.doesNotMatch(document.body.textContent, /Old account row/);
  await render({ isActive: false });
  await act(async () => second.resolve([{ id: 'hidden', client_event_id: 'hidden', summary: 'Hidden late row', occurred_at: '2026-09-14T11:00:00Z' }]));
  assert.doesNotMatch(document.body.textContent, /Hidden late row/);
  assert.equal(calls.history.length, 2);
  assert.equal(calls.owner.length, 2, 'owner reads occur only for the two visible scopes');
});

test('a scope change clears the prior account row in the layout commit', async (t) => {
  const revision = { id: 'rev-1', revisionNumber: 1, createdAt: '2026-09-14T10:00:00Z',
    annotationCount: 1, label: null, origin: 'manual' };
  const { renderBeforePassiveEffects } = await mountPanel(t, {
    isActive: true,
    user: { id: 'actor-a' },
  }, {
    async listRevisions() { return [revision]; },
    async listDocumentHistoryEvents(id) {
      if (id === 'local-b') return new Promise(() => {});
      return [{ id: 'account-a', client_event_id: 'account-a', user_id: 'actor-a',
        summary: 'Account A private row', occurred_at: '2026-09-14T12:00:00Z', payload: {} }];
    },
  });
  assert.match(document.body.textContent, /Account A private row/);
  assert.ok(document.querySelector('[data-testid="kal48-save-revision"]'));
  assert.ok(document.querySelector('[data-testid="kal48-restore-v1"]'));
  renderBeforePassiveEffects({
    documentId: 'local-b',
    user: { id: 'actor-a' },
    historyScope: { guestScopeId: 'device-local' },
  });
  assert.doesNotMatch(document.body.textContent, /Account A private row/,
    'old scope is gone before passive effects run');
  assert.equal(document.querySelector('[data-testid="kal48-save-revision"]'), null,
    'old owner save control is gone before passive effects run');
  assert.equal(document.querySelector('[data-testid="kal48-restore-v1"]'), null,
    'old owner restore control is gone before passive effects run');
});

test('local rows keep unique client identities through cloud transition and reorder', async (t) => {
  let rows = [
    { client_event_id: 'local-one', user_id: 'actor-a', summary: 'First local row',
      occurred_at: '2026-09-14T12:00:00Z', payload: {} },
    { client_event_id: 'local-two', user_id: 'actor-a', summary: 'Second local row',
      occurred_at: '2026-09-14T11:00:00Z', payload: {} },
  ];
  const keyWarnings = [];
  const priorConsoleError = console.error;
  console.error = (...args) => {
    const message = args.map(String).join(' ');
    if (/same key|unique [`']?key/i.test(message)) keyWarnings.push(message);
    else priorConsoleError(...args);
  };
  t.after(() => { console.error = priorConsoleError; });

  const { recorded, flush, timeouts, click } = await mountPanel(t, {
    isActive: true,
    user: { id: 'actor-a' },
  }, {
    async listDocumentHistoryEvents() { return rows; },
  });
  assert.match(document.body.textContent, /First local row/);
  assert.match(document.body.textContent, /Second local row/);
  assert.ok(document.querySelector('[data-testid="document-history-event-local-one"]'));
  assert.ok(document.querySelector('[data-testid="document-history-event-local-two"]'));
  await click('[data-testid="document-history-event-local-one"]');

  rows = [
    { ...rows[1], occurred_at: '2026-09-14T13:00:00Z' },
    { ...rows[0], id: 'server-one', occurred_at: '2026-09-14T10:00:00Z' },
  ];
  await recorded();
  await flush(timeouts);
  const eventNodes = [...document.querySelectorAll('[data-testid^="document-history-event-"]')];
  assert.deepEqual(eventNodes.map((node) => node.dataset.testid), [
    'document-history-event-local-two',
    'document-history-event-local-one',
  ]);
  assert.equal(document.querySelector('[data-testid="document-history-event-server-one"]'), null,
    'a cloud-confirmed row keeps its original client selector');
  assert.match(
    document.querySelector('[data-testid="document-history-event-local-one"]')?.style.border || '',
    /rgb\(111, 143, 203\)/,
    'selection survives the local-to-cloud row transition',
  );
  assert.equal(keyWarnings.length, 0, 'React reports no duplicate or missing event keys');
});

test('a scoped notice invalidates an older read and reloads after the debounce', async (t) => {
  const oldRead = deferred();
  let read = 0;
  const { calls, recorded, flush, timeouts } = await mountPanel(t, { isActive: true }, {
    async listDocumentHistoryEvents() {
      read += 1;
      if (read === 1) return oldRead.promise;
      return [{ id: 'fresh', client_event_id: 'fresh', summary: 'Fresh local row', occurred_at: '2026-09-14T12:00:00Z' }];
    },
  });
  await recorded();
  await act(async () => oldRead.resolve([{ id: 'old', client_event_id: 'old', summary: 'Old load row', occurred_at: '2026-09-14T10:00:00Z' }]));
  assert.doesNotMatch(document.body.textContent, /Old load row/);
  await flush(timeouts);
  assert.match(document.body.textContent, /Fresh local row/);
});

test('storage health and preserved legacy data are stated without exposing legacy rows', async (t) => {
  await mountPanel(t, { isActive: true }, {
    async getDocumentHistoryStorageStatus() {
      return { available: false, pendingCount: 0, protectedBytes: 0, confirmedCacheBytes: 0,
        protectedFull: true, legacyUnscopedAvailable: true,
        errorCode: 'DOCUMENT_HISTORY_PROTECTED_CAP_EXCEEDED' };
    },
  });
  assert.match(document.querySelector('[data-testid="document-history-storage-status"]')?.textContent || '', /storage is full/i);
  assert.match(document.querySelector('[data-testid="document-history-legacy-notice"]')?.textContent || '', /stays on this device/i);
  assert.doesNotMatch(document.body.textContent, /migrat/i);
});

test('a managed-local user explicitly inspects, matches, and restores legacy history without changing its raw cache', async (t) => {
  const rawLegacy = JSON.stringify({
    'old-bucket': [{ client_event_id: 'legacy-delete', summary: 'Deleted older rectangle' }],
  });
  const recovered = {
    __local: true,
    __legacyRecovery: true,
    __canRestore: true,
    document_id: 'old-bucket',
    client_event_id: 'legacy-delete',
    event_type: 'annotation_deleted',
    summary: 'Deleted older rectangle',
    occurred_at: '2026-09-14T12:00:00.000Z',
    page_number: 1,
    payload: {
      restoreAction: {
        type: 'fabric:create',
        pageNumber: 1,
        annotation: { id: 'legacy-rect', type: 'rect', left: 40, top: 50, width: 80, height: 60 },
      },
    },
  };
  const restoredAnnotations = [];
  const normalRows = [];
  const { calls, click } = await mountPanel(t, {
    documentId: 'managed-local-a',
    isActive: true,
    user: { id: 'actor-a' },
    historyScope: { guestScopeId: 'device-local' },
    onRestoreHistoryActivity(event) {
      restoredAnnotations.push(event.payload.restoreAction.annotation);
      normalRows.push({
        client_event_id: 'new-local-restore-event',
        event_type: 'annotation_restored',
        summary: 'Restored older rectangle',
        occurred_at: '2026-09-14T12:01:00.000Z',
        payload: {},
      });
      return { ok: true, pageNumber: 1 };
    },
  }, {
    async listDocumentHistoryEvents() { return [...normalRows]; },
    async getDocumentHistoryStorageStatus() {
      return { available: true, pendingCount: 0, protectedBytes: 0, confirmedCacheBytes: 0,
        protectedFull: false, legacyUnscopedAvailable: true, errorCode: null };
    },
    async inspectLegacyDocumentHistory({ authorizationToken }) {
      assert.equal(typeof authorizationToken, 'string');
      assert.ok(authorizationToken.length > 0);
      return {
        status: 'ready', version: 1, inspectionDigest: 'digest-a', authorizationDigest: 'auth-a',
        buckets: [{ bucketId: 'old-bucket', rowCount: 1, recoverableRowCount: 1 }],
      };
    },
    async selectLegacyDocumentHistoryBucket(_inspection, options) {
      assert.equal(options.sourceBucketId, 'old-bucket');
      assert.equal(options.confirmedSourceBucketId, 'old-bucket');
      assert.equal(options.openLocalDocumentId, 'managed-local-a');
      assert.equal(options.confirmedOpenLocalDocumentId, 'managed-local-a');
      return { status: 'selected', version: 1, sourceBucketId: 'old-bucket',
        documentId: 'managed-local-a', rows: [recovered] };
    },
  });
  window.localStorage.setItem('survey_document_history_events_v1', rawLegacy);

  assert.equal(document.querySelector('[data-testid^="document-history-legacy-row-"]'), null,
    'the notice exposes no old row before consent and document matching');
  await click('[data-testid="document-history-legacy-review"]');
  assert.equal(calls.legacyInspect.length, 0, 'opening the notice does not parse the cache');
  await click('[data-testid="document-history-legacy-consent-confirm"]');
  assert.equal(calls.legacyInspect.length, 1);
  assert.equal(document.querySelector('[data-testid^="document-history-legacy-row-"]'), null);
  await click('[data-testid="document-history-legacy-bucket-old-bucket"]');
  assert.equal(calls.legacySelect.length, 0, 'choosing a bucket does not expose rows');
  await click('[data-testid="document-history-legacy-match-confirm-button"]');
  assert.equal(calls.legacySelect.length, 1);
  assert.match(document.body.textContent, /Deleted older rectangle/);

  window.confirm = () => { throw new Error('recovered restore must not open a native blocking dialog'); };
  await click('[data-testid="document-history-legacy-restore-legacy-delete"]');
  assert.deepEqual(restoredAnnotations, [{ id: 'legacy-rect', type: 'rect', left: 40, top: 50, width: 80, height: 60 }]);
  assert.match(document.body.textContent, /Restored older rectangle/,
    'the proven restore path refreshes the normal durable local timeline');
  assert.equal(window.localStorage.getItem('survey_document_history_events_v1'), rawLegacy,
    'review and restore leave the legacy cache byte-for-byte unchanged');
});

test('cloud history gives local-copy guidance and never inspects or restores legacy rows', async (t) => {
  const restored = [];
  const { calls, click } = await mountPanel(t, {
    documentId: 'cloud-doc',
    isActive: true,
    user: { id: 'actor-a' },
    historyScope: { actorUserId: 'actor-a' },
    onRestoreHistoryActivity(event) { restored.push(event); return { ok: true }; },
  }, {
    async getDocumentHistoryStorageStatus() {
      return { available: true, pendingCount: 0, protectedBytes: 0, confirmedCacheBytes: 0,
        protectedFull: false, legacyUnscopedAvailable: true, errorCode: null };
    },
  });
  await click('[data-testid="document-history-legacy-review"]');
  assert.match(document.querySelector('[data-testid="document-history-legacy-cloud-guidance"]')?.textContent || '',
    /Open a local copy/);
  assert.equal(calls.legacyInspect.length, 0);
  assert.equal(calls.legacySelect.length, 0);
  assert.deepEqual(restored, []);
  assert.equal(document.querySelector('[data-testid^="document-history-legacy-row-"]'), null);
});

test('legacy inspection is cleared on a document change and its late result cannot expose buckets', async (t) => {
  const inspection = deferred();
  const { calls, click, render } = await mountPanel(t, {
    documentId: 'managed-local-a',
    isActive: true,
    historyScope: { guestScopeId: 'device-local' },
  }, {
    async getDocumentHistoryStorageStatus() {
      return { available: true, pendingCount: 0, protectedBytes: 0, confirmedCacheBytes: 0,
        protectedFull: false, legacyUnscopedAvailable: true, errorCode: null };
    },
    async inspectLegacyDocumentHistory() { return inspection.promise; },
  });
  await click('[data-testid="document-history-legacy-review"]');
  await click('[data-testid="document-history-legacy-consent-confirm"]');
  assert.equal(calls.legacyInspect.length, 1);
  await render({ documentId: 'managed-local-b' });
  await act(async () => inspection.resolve({
    status: 'ready', version: 1, inspectionDigest: 'late', authorizationDigest: 'late',
    buckets: [{ bucketId: 'old-bucket', rowCount: 1, recoverableRowCount: 1 }],
  }));
  assert.equal(document.querySelector('[data-testid="document-history-legacy-buckets"]'), null);
  assert.doesNotMatch(document.body.textContent, /old-bucket/);
});

test('an account change on the same local PDF clears recovery and rejects a late bucket selection', async (t) => {
  const selection = deferred();
  const { click, render } = await mountPanel(t, {
    documentId: 'managed-local-a',
    isActive: true,
    user: { id: 'actor-a' },
    historyScope: { guestScopeId: 'device-local' },
  }, {
    async getDocumentHistoryStorageStatus() {
      return { available: true, pendingCount: 0, protectedBytes: 0, confirmedCacheBytes: 0,
        protectedFull: false, legacyUnscopedAvailable: true, errorCode: null };
    },
    async inspectLegacyDocumentHistory() {
      return {
        status: 'ready', version: 1, inspectionDigest: 'digest-a', authorizationDigest: 'auth-a',
        buckets: [{ bucketId: 'old-bucket', rowCount: 1, recoverableRowCount: 1 }],
      };
    },
    async selectLegacyDocumentHistoryBucket() { return selection.promise; },
  });
  await click('[data-testid="document-history-legacy-review"]');
  await click('[data-testid="document-history-legacy-consent-confirm"]');
  await click('[data-testid="document-history-legacy-bucket-old-bucket"]');
  await click('[data-testid="document-history-legacy-match-confirm-button"]');
  await render({ user: { id: 'actor-b' } });
  await act(async () => selection.resolve({
    status: 'selected', version: 1, sourceBucketId: 'old-bucket', documentId: 'managed-local-a',
    rows: [{ __legacyRecovery: true, __canRestore: true, client_event_id: 'late-row',
      event_type: 'annotation_deleted', summary: 'Late account row', payload: { restoreAction: {} } }],
  }));
  assert.equal(document.querySelector('[data-testid="document-history-legacy-selected"]'), null);
  assert.doesNotMatch(document.body.textContent, /Late account row|old-bucket/);
  assert.ok(document.querySelector('[data-testid="document-history-legacy-review"]'),
    'the new account sees only the payload-free starting notice');
});

test('pending storage status states its account-wide or device-wide scope', async (t) => {
  const { render } = await mountPanel(t, { isActive: true }, {
    async getDocumentHistoryStorageStatus() {
      return { available: true, pendingCount: 2, protectedBytes: 100, confirmedCacheBytes: 0,
        protectedFull: false, legacyUnscopedAvailable: false, errorCode: null };
    },
  });
  assert.match(document.querySelector('[data-testid="document-history-storage-status"]')?.textContent || '',
    /Across your documents, 2 local history items are stored only on this device/);
  await render({ user: { id: 'actor-a' } });
  assert.match(document.querySelector('[data-testid="document-history-storage-status"]')?.textContent || '',
    /For this account, 2 local history items are not yet backed up/);
});

test('an immutable event conflict says the earlier saved event was kept', async (t) => {
  await mountPanel(t, { isActive: true, user: { id: 'actor-a' } }, {
    async getDocumentHistoryStorageStatus() {
      return { available: true, pendingCount: 1, protectedBytes: 100, confirmedCacheBytes: 0,
        protectedFull: false, legacyUnscopedAvailable: false,
        errorCode: 'DOCUMENT_HISTORY_EVENT_CONFLICT' };
    },
  });
  assert.equal(
    document.querySelector('[data-testid="document-history-storage-status"]')?.textContent?.trim(),
    'A conflicting history event was not saved. The earlier saved event was kept.',
  );
});

test('a late revision open cannot enable read-only after A-B-A scope changes', async (t) => {
  const opened = deferred();
  const revision = { id: 'rev-1', revisionNumber: 1, createdAt: '2026-09-14T10:00:00Z',
    annotationCount: 1, label: null, origin: 'manual' };
  const { render, click } = await mountPanel(t, { isActive: true, user: { id: 'actor-a' } }, {
    async listRevisions() { return [revision]; },
    async getRevision() { return opened.promise; },
  });
  await click('[data-testid="kal48-open-v1"]');
  await render({ documentId: 'doc-b' });
  await render({ documentId: 'doc-a' });
  await act(async () => opened.resolve({ snapshot_json: { annotations: [{}] } }));
  assert.equal(document.querySelector('[data-testid="kal48-readonly-banner"]'), null);
  assert.equal(document.body.hasAttribute('data-readonly'), false);
});

test('a late restore cannot publish status or refresh after A-B-A scope changes', async (t) => {
  const restored = deferred();
  const revision = { id: 'rev-1', revisionNumber: 1, createdAt: '2026-09-14T10:00:00Z',
    annotationCount: 1, label: null, origin: 'manual' };
  const { calls, render, click } = await mountPanel(t, { isActive: true, user: { id: 'actor-a' } }, {
    async listRevisions() { return [revision]; },
    async restoreRevision() { return restored.promise; },
  });
  await click('[data-testid="kal48-restore-v1"]');
  await render({ documentId: 'doc-b', user: { id: 'actor-b' } });
  await render({ documentId: 'doc-a', user: { id: 'actor-a' } });
  const readsBeforeReply = calls.history.length;
  await act(async () => restored.resolve({ revision_number: 2 }));
  assert.equal(document.querySelector('[data-testid="kal48-status"]'), null);
  assert.equal(calls.history.length, readsBeforeReply, 'late restore does not refresh either scope');
});

test('unmount rejects a late revision result', async (t) => {
  const opened = deferred();
  const revision = { id: 'rev-1', revisionNumber: 1, createdAt: '2026-09-14T10:00:00Z',
    annotationCount: 1, label: null, origin: 'manual' };
  const { click, unmount } = await mountPanel(t, { isActive: true, user: { id: 'actor-a' } }, {
    async listRevisions() { return [revision]; },
    async getRevision() { return opened.promise; },
  });
  await click('[data-testid="kal48-open-v1"]');
  await unmount();
  await act(async () => opened.resolve({ snapshot_json: { annotations: [{}] } }));
  assert.equal(document.body.hasAttribute('data-readonly'), false);
});

test('offline revision reads do not hide scoped local history', async (t) => {
  await mountPanel(t, { isActive: true, user: { id: 'actor-a' } }, {
    ownerReject: true,
    async listRevisions() { throw new Error('offline'); },
    async listDocumentHistoryEvents() {
      return [{ id: 'local', client_event_id: 'local', user_id: 'actor-a', summary: 'Local event remains visible',
        occurred_at: '2026-09-14T12:00:00Z', payload: {} }];
    },
  });
  assert.match(document.body.textContent, /Local event remains visible/);
  assert.doesNotMatch(document.body.textContent, /Error:/);
});

test('a denied history refresh clears rows from an earlier successful read', async (t) => {
  let read = 0;
  const { recorded, flush, timeouts } = await mountPanel(t, {
    isActive: true,
    user: { id: 'actor-a' },
    onRestoreHistoryActivity: () => ({ ok: true }),
  }, {
    async listDocumentHistoryEvents() {
      read += 1;
      if (read > 1) throw Object.assign(new Error('document_history_events permission denied'), { code: '42501' });
      return [{ id: 'prior', client_event_id: 'prior', user_id: 'actor-a', summary: 'Prior private row',
        event_type: 'annotation_deleted', occurred_at: '2026-09-14T12:00:00Z',
        payload: { actionType: 'delete', restoreAction: { annotation: { id: 'mark-a' } } } }];
    },
  });
  assert.match(document.body.textContent, /Prior private row/);
  assert.ok(document.querySelector('[data-testid="document-history-restore-prior"]'));
  await recorded();
  await flush(timeouts);
  assert.doesNotMatch(document.body.textContent, /Prior private row/);
  assert.equal(document.querySelector('[data-testid="document-history-restore-prior"]'), null);
  assert.match(document.body.textContent, /document_history_events permission denied/);
});
