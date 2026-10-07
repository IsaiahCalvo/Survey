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
    // The panel portals its desktop header row into the rail's title row
    // (2026-10-07 rail headers round), so it imports createPortal.
    .replace("from 'react-dom'", `from ${JSON.stringify(pathToFileURL(require.resolve('react-dom')).href)}`)
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
    .replace("from './historyPageOverlay.js'", `from ${JSON.stringify(new URL('../src/components/revisions/historyPageOverlay.js', import.meta.url).href)}`)
    // w64: the pick-on-the-page filter helpers are a plain module too.
    .replace("from '../../utils/historyMarkFilter.js'", `from ${JSON.stringify(new URL('../src/utils/historyMarkFilter.js', import.meta.url).href)}`);
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
  const { render, flush, timeouts } = await mountPanel(t, {
    isActive: true,
    canRestore: false,
    onRestoreHistoryActivity: () => ({ ok: true }),
    getHistoryMarkIndex: () => present,
  });
  await render({});
  const text = () => document.querySelector('[data-testid="document-history-list"]').textContent;
  assert.match(text(), /Maya deleted a rectangle/);
  // RULED 2026-09-29 owner: cleaner History — a line's buttons show only
  // while it is the selected line (the red dot marks it as deleted at a
  // glance). Restore is still gated exactly as before; the line is selected
  // first so its buttons are on screen.
  assert.equal(document.querySelectorAll('[data-restore]').length, 0, 'no buttons on a line that is not selected');
  assert.equal(document.querySelector('[data-testid="document-history-list"] .dh-row').getAttribute('data-status'), 'deleted');
  await act(async () => {
    document.querySelector('[data-testid="document-history-list"] .dh-row').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  for (let i = 0; i < 12 && timeouts.size > 0; i += 1) await flush(timeouts);
  assert.equal(document.querySelectorAll('[data-restore]').length, 0, 'a viewer never sees Restore');
  await render({ canRestore: true });
  assert.equal(document.querySelectorAll('[data-restore]').length, 1, 'an editor sees Restore on the gone mark');
  present = new Map([['mark-1', { pageNumber: 2 }]]);
  await render({ canRestore: true, getHistoryMarkIndex: () => present });
  assert.equal(document.querySelectorAll('[data-restore]').length, 0);
  assert.match(text(), /Back on the page now/);
  // The selected line's on-page retries (no page in this DOM) run out.
  for (let i = 0; i < 12 && timeouts.size > 0; i += 1) await flush(timeouts);
});

// w64 (owner 2026-09-29): with History open, picking a mark on the page shows
// only that mark's lines, selects its newest one and says so in a small bar;
// Clear, Esc or deselecting ends it; a mark with no lines says so plainly.
test('w64: a pick on the page filters History to that mark until cleared', async (t) => {
  const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
  const line = (id, mark, action, type, m) => ({
    id, client_event_id: id, document_id: 'doc-a', user_id: 'u1', event_type: 'local_annotation_history_added',
    page_number: 1, annotation_id: mark, summary: `Maya Chen ${action === 'create' ? 'created' : 'moved'} a ${type} on page 1`,
    payload: { actionType: action, annotationType: type }, occurred_at: iso(m), created_at: iso(m),
  });
  globalThis.__historyRows = [
    line('a3', 'ell-1', 'create', 'ellipse', 1),
    line('a2', 'rect-1', 'move', 'rect', 5),
    line('a1', 'rect-1', 'create', 'rect', 40),
  ];
  t.after(() => { delete globalThis.__historyRows; });
  const { calls, render } = await mountPanel(t, { isActive: true });
  await render({});
  const rows = () => [...document.querySelectorAll('[data-testid="document-history-list"] .dh-row')];
  const bar = () => document.querySelector('[data-testid="document-history-mark-filter"]')?.textContent || null;
  const pick = (items, pageNumber = 1) => act(async () => {
    window.dispatchEvent(new window.CustomEvent('annotations:page-selection', { detail: { pageNumber, items } }));
  });
  assert.equal(rows().length, 3);
  await pick([{ id: 'rect-1', typeKey: 'rect' }]);
  assert.match(bar(), /Showing history for this rectangle/);
  assert.deepEqual(rows().map((r) => r.getAttribute('data-mark')), ['rect-1', 'rect-1']);
  assert.ok(rows()[0].classList.contains('sel'), 'the newest line for the mark is selected');
  assert.notEqual(document.activeElement, document.querySelector('[data-testid="document-history-list"]'), 'focus stays on the page');
  // Esc ends it.
  await act(async () => { window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' })); });
  assert.equal(bar(), null);
  assert.equal(rows().length, 3);
  // Multi-pick across pages, then deselect on one page keeps the other.
  await pick([{ id: 'rect-1', typeKey: 'rect' }], 1);
  await pick([{ id: 'ell-1', typeKey: 'ellipse' }], 2);
  assert.match(bar(), /these 2 marks/);
  assert.equal(rows().length, 3);
  await pick([], 1);
  assert.match(bar(), /this ellipse/);
  // Deselecting everything ends it.
  await pick([], 2);
  assert.equal(bar(), null);
  // Clear.
  await pick([{ id: 'rect-1', typeKey: 'rect' }]);
  await act(async () => {
    document.querySelector('[data-testid="document-history-mark-filter-clear"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  assert.equal(bar(), null);
  assert.equal(rows().length, 3);
  // A mark with no lines (and nothing older to read) says so, without extra reads.
  const reads = calls.history.length;
  await pick([{ id: 'never', typeKey: 'counter' }]);
  assert.equal(document.querySelector('[data-testid="document-history-empty"]').textContent, 'This counter has no history yet.');
  assert.equal(calls.history.length, reads);
  // Hidden panel: picks are remembered but never filter.
  await pick([], 1);
  await render({ isActive: false });
  await pick([{ id: 'rect-1', typeKey: 'rect' }]);
  await render({ isActive: true });
  assert.equal(bar(), null);
});

// w64 review round: picking one mark and then another selects the second
// mark's newest line (it used to end with no line selected); a multi-pick
// that only shrinks keeps the line you clicked.
test('w64: picking A then B selects B\'s newest line; a shrinking pick keeps your line', async (t) => {
  const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
  const line = (id, mark, type, m) => ({
    id, client_event_id: id, document_id: 'doc-a', user_id: 'u1', event_type: 'local_annotation_history_added',
    page_number: 1, annotation_id: mark, summary: `Maya Chen created a ${type} on page 1`,
    payload: { actionType: 'create', annotationType: type }, occurred_at: iso(m), created_at: iso(m),
  });
  globalThis.__historyRows = [line('b1', 'ell-1', 'ellipse', 1), line('a2', 'rect-1', 'rect', 5), line('a1', 'rect-2', 'rect', 9)];
  t.after(() => { delete globalThis.__historyRows; });
  const { render, flush, timeouts } = await mountPanel(t, { isActive: true });
  await render({});
  const rows = () => [...document.querySelectorAll('[data-testid="document-history-list"] .dh-row')].map((r) => [r.getAttribute('data-mark'), r.classList.contains('sel')]);
  const pick = (items, pageNumber = 1) => act(async () => {
    window.dispatchEvent(new window.CustomEvent('annotations:page-selection', { detail: { pageNumber, items } }));
  });
  await pick([{ id: 'rect-1', typeKey: 'rect' }]);
  assert.deepEqual(rows(), [['rect-1', true]]);
  await pick([{ id: 'ell-1', typeKey: 'ellipse' }]);
  assert.deepEqual(rows(), [['ell-1', true]]);
  // Multi-pick over two pages; click the older line; page 2's pick goes away.
  await pick([{ id: 'rect-1', typeKey: 'rect' }], 1);
  await pick([{ id: 'rect-2', typeKey: 'rect' }], 2);
  assert.deepEqual(rows(), [['rect-1', true], ['rect-2', false]]);
  await act(async () => {
    document.querySelectorAll('[data-testid="document-history-list"] .dh-row')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  assert.deepEqual(rows(), [['rect-1', false], ['rect-2', true]]);
  await pick([], 1);
  assert.deepEqual(rows(), [['rect-2', true]], 'the line you clicked stays selected');
  // The clicked line's on-page highlight retries while the page mounts (no
  // page in this DOM): let those retries run out.
  for (let i = 0; i < 12 && timeouts.size > 0; i += 1) await flush(timeouts);
});
