import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
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
    .replace("import { supabase } from '../../supabaseClient';", 'const supabase = null;')
    .replace("import Icon from '../../Icons';", 'const Icon = () => null;')
    .replace(/import \{[^}]+\} from '\.\.\/\.\.\/services\/documentRevisionService';/, 'const { createRevision, listRevisions, getRevision, restoreRevision } = globalThis.__historyPollingService;')
    .replace("import { listDocumentHistoryEvents, findDeletedSpaceHistoryEvent, isTrashHistoryEvent } from '../../services/documentHistoryService';", 'const { listDocumentHistoryEvents } = globalThis.__historyPollingService; const findDeletedSpaceHistoryEvent = async () => null; const isTrashHistoryEvent = (e) => [\'annotation_deleted\', \'survey_marker_deleted\'].includes(e?.event_type);')
    .replace("import { resolveRegionRestoreCascade, describeHistoryEventSubject } from '../../services/annotationTrashHistory';", 'const resolveRegionRestoreCascade = () => null; const describeHistoryEventSubject = () => null;')
    .replace("from '../../utils/readOnlyBodyReasons.js'", `from ${JSON.stringify(readOnlyUrl)}`)
    // RULED 2026-09-28 owner: History option A — the feed / geometry / page
    // overlay helpers are plain modules; load them from disk.
    .replace("from '../../utils/historyFeed.js'", `from ${JSON.stringify(new URL('../src/utils/historyFeed.js', import.meta.url).href)}`)
    .replace("from '../../utils/historyGeometry.js'", `from ${JSON.stringify(new URL('../src/utils/historyGeometry.js', import.meta.url).href)}`)
    .replace("from './historyPageOverlay.js'", `from ${JSON.stringify(new URL('../src/components/revisions/historyPageOverlay.js', import.meta.url).href)}`);
  const transformed = await transformWithOxc(source, fileURLToPath(sourceUrl), { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxUrl));
  return (await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}#${++moduleId}`)).default;
}

async function mountPanel(t, initialProps) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const calls = { revisions: [], history: [] };
  globalThis.__historyPollingService = {
    async listRevisions(id) { calls.revisions.push(id); return []; },
    async listDocumentHistoryEvents(id, options) { calls.history.push({ id, options }); return globalThis.__historyRows || []; },
  };
  const timeouts = new Map();
  const intervals = new Map();
  let timerId = 0;
  window.setTimeout = (callback, delay) => { timeouts.set(++timerId, { callback, delay }); return timerId; };
  window.clearTimeout = (id) => timeouts.delete(id);
  window.setInterval = (callback, delay) => { intervals.set(++timerId, { callback, delay }); return timerId; };
  window.clearInterval = (id) => intervals.delete(id);
  const RevisionsPanel = await loadPanel();
  const root = createRoot(document.getElementById('root'));
  let props = { documentId: 'doc-a', user: null, embedded: true, isActive: false, ...initialProps };
  const render = async (next = {}) => {
    props = { ...props, ...next };
    await act(async () => root.render(React.createElement(RevisionsPanel, props)));
  };
  const recorded = async (documentId = props.documentId) => act(async () => {
    window.dispatchEvent(new window.CustomEvent('document-history:event-recorded', { detail: { documentId } }));
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
  t.after(async () => {
    await act(async () => root.unmount());
    assert.equal(intervals.size, 0, 'unmount removes polling');
    assert.equal(timeouts.size, 0, 'unmount removes pending refresh');
    dom.window.close();
    delete globalThis.__historyPollingService;
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  await render();
  return { calls, timeouts, intervals, render, recorded, flush, click };
}

test('hidden embedded history does not fetch, listen, or poll; reopen fetches fresh data', async (t) => {
  const mounted = await mountPanel(t);
  const { calls, timeouts, intervals, render, recorded, flush } = mounted;
  assert.equal(calls.revisions.length, 0);
  assert.equal(calls.history.length, 0);
  assert.equal(intervals.size, 0);
  await recorded();
  assert.equal(timeouts.size, 0, 'no event listener while hidden');

  await render({ isActive: true });
  // w55 (ruled change): named versions are hidden until rebuilt, so the panel
  // no longer reads revisions; History reads a first page of 50 and pages
  // older rows on demand ("Load older") instead of one fixed 200-row read.
  assert.deepEqual(calls.revisions, []);
  assert.deepEqual(calls.history, [{ id: 'doc-a', options: { limit: 50 } }]);
  assert.equal(intervals.size, 1);
  assert.equal([...intervals.values()][0].delay, 10000);
  await flush(intervals);
  assert.equal(calls.history.length, 2, 'visible polling still refreshes');
  await recorded('other-doc');
  assert.equal(timeouts.size, 0, 'other documents do not trigger reads');
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

// RULED 2026-09-28 owner: History option A — Restore sits only on a deleted
// mark that is still gone, only for people who can edit; a mark that is back
// says so instead.
test('option A: Restore only for editors, only while the mark is gone', async (t) => {
  const now = new Date().toISOString();
  globalThis.__historyRows = [{
    id: 'd1', client_event_id: 'd1', document_id: 'doc-a', user_id: 'u1', event_type: 'annotation_deleted',
    page_number: 2, annotation_id: 'mark-1', summary: 'Maya Chen deleted a rectangle on page 2',
    payload: { restoreAction: { type: 'fabric:create', pageNumber: 2 }, previewAnnotation: { type: 'rect', left: 1, top: 1, width: 5, height: 5 } },
    occurred_at: now, created_at: now,
  }];
  t.after(() => { delete globalThis.__historyRows; });
  let present = new Map();
  const { render } = await mountPanel(t, {
    isActive: true,
    canRestore: false,
    onRestoreHistoryActivity: () => ({ ok: true }),
    getHistoryMarkIndex: () => present,
  });
  await render({});
  const text = () => document.querySelector('[data-testid="document-history-list"]').textContent;
  assert.match(text(), /Maya deleted a rectangle/);
  assert.equal(document.querySelectorAll('[data-restore]').length, 0, 'a viewer never sees Restore');
  await render({ canRestore: true });
  assert.equal(document.querySelectorAll('[data-restore]').length, 1, 'an editor sees Restore on the gone mark');
  present = new Map([['mark-1', { pageNumber: 2 }]]);
  await render({ canRestore: true, getHistoryMarkIndex: () => present });
  assert.equal(document.querySelectorAll('[data-restore]').length, 0);
  assert.match(text(), /Back on the page now/);
});
