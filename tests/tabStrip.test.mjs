// Desktop tab strip rules (Drawboard shell audit, Chunk C, 2026-10-13):
// close actions, the tab that takes over, the unsaved-work confirm, and the
// saved open tabs that come back after a reload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canRenameTab,
  closeConfirmFor,
  libraryHasLoaded,
  persistableDocumentId,
  pickActiveTabAfterClose,
  planTabRestore,
  readTabSession,
  serializeTabSession,
  tabIdsForCloseAction,
  tabSessionStorageKey,
  tabsWithUnsavedWork,
  writeTabSession,
} from '../src/tabs/tabStrip.js';

const HOME = 'home-tab';
const home = { id: HOME, name: 'Home', file: null, isHome: true };
const cloud = (n, extra = {}) => ({ id: `t${n}`, name: `Doc ${n}.pdf`, file: { id: `doc-${n}`, name: `Doc ${n}.pdf` }, ...extra });
const local = (n, extra = {}) => ({ id: `t${n}`, name: `Local ${n}.pdf`, file: { name: `Local ${n}.pdf` }, ...extra });

const memoryStorage = () => {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)); },
    removeItem: (key) => { map.delete(key); },
    map,
  };
};

test('close actions pick the right tabs and never Home', () => {
  const tabs = [home, cloud(1), cloud(2), cloud(3)];
  assert.deepEqual(tabIdsForCloseAction(tabs, 'close', 't2'), ['t2']);
  assert.deepEqual(tabIdsForCloseAction(tabs, 'close', HOME), []);
  assert.deepEqual(tabIdsForCloseAction(tabs, 'closeOthers', 't2'), ['t1', 't3']);
  assert.deepEqual(tabIdsForCloseAction(tabs, 'closeAll', 't2'), ['t1', 't2', 't3']);
  assert.deepEqual(tabIdsForCloseAction(tabs, 'rename', 't2'), []);
});

test('the tab to the right takes over, else the left, else Home', () => {
  const tabs = [home, cloud(1), cloud(2), cloud(3)];
  // The old single close: closing the active middle tab shows its right neighbour.
  assert.equal(pickActiveTabAfterClose(tabs, ['t2'], 't2', HOME), 't3');
  assert.equal(pickActiveTabAfterClose(tabs, ['t3'], 't3', HOME), 't2');
  assert.equal(pickActiveTabAfterClose(tabs, ['t1'], 't3', HOME), 't3', 'a surviving active tab stays');
  assert.equal(pickActiveTabAfterClose(tabs, ['t1', 't3'], 't2', HOME), 't2', 'close others keeps the tab');
  assert.equal(pickActiveTabAfterClose(tabs, ['t1', 't2', 't3'], 't2', HOME), HOME);
  assert.equal(pickActiveTabAfterClose(tabs, ['t2', 't3'], 't2', HOME), 't1');
  assert.equal(pickActiveTabAfterClose(tabs, ['t1'], HOME, HOME), HOME);
});

test('only a local file with unsaved changes counts as work a close would lose', () => {
  const tabs = [home, cloud(1, { hasUnsavedAnnotations: true }), local(2, { hasUnsavedAnnotations: true }), local(3)];
  assert.deepEqual(tabsWithUnsavedWork(tabs, ['t1', 't2', 't3']).map((t) => t.id), ['t2']);
});

test('the close confirm: none for clean closes, one for unsaved work, always for Close all', () => {
  const clean = [home, cloud(1), cloud(2)];
  assert.equal(closeConfirmFor({ tabs: clean, closingIds: ['t1'], action: 'close' }), null);
  assert.equal(closeConfirmFor({ tabs: clean, closingIds: ['t2'], action: 'closeOthers' }), null);
  assert.equal(closeConfirmFor({ tabs: [home, cloud(1)], closingIds: ['t1'], action: 'closeAll' }), null,
    'Close all of a single tab is just a close');

  const all = closeConfirmFor({ tabs: clean, closingIds: ['t1', 't2'], action: 'closeAll' });
  assert.equal(all.title, 'Close all open documents (2)?');
  assert.equal(all.danger, false);
  assert.equal(all.confirmLabel, 'Close all');

  const dirty = [home, local(1, { hasUnsavedAnnotations: true }), cloud(2), local(3, { hasUnsavedAnnotations: true })];
  const one = closeConfirmFor({ tabs: dirty, closingIds: ['t1'], action: 'close' });
  assert.equal(one.title, 'Close without saving?');
  assert.match(one.message, /"Local 1\.pdf" has changes that are not saved/);
  assert.equal(one.danger, true);
  assert.equal(one.confirmLabel, 'Close without saving');

  const others = closeConfirmFor({ tabs: dirty, closingIds: ['t1', 't3'], action: 'closeOthers' });
  assert.equal(others.title, 'Close 2 documents?');
  assert.match(others.message, /^2 documents have changes/);

  const allDirty = closeConfirmFor({ tabs: dirty, closingIds: ['t1', 't2', 't3'], action: 'closeAll' });
  assert.equal(allDirty.title, 'Close all open documents (3)?');
  assert.equal(allDirty.danger, true);
});

test('only cloud documents are saved; in-flight uploads and local files are not', () => {
  assert.equal(persistableDocumentId(home), null);
  assert.equal(persistableDocumentId(local(1)), null);
  assert.equal(persistableDocumentId({ id: 'x', file: { id: 'temp-123' } }), null);
  assert.equal(persistableDocumentId(cloud(4)), 'doc-4');
  assert.equal(canRenameTab(cloud(4), true), true);
  assert.equal(canRenameTab(cloud(4), false), false);
  assert.equal(canRenameTab(local(1), true), false);
});

test('serialize keeps order, the active document, and drops duplicates and local files', () => {
  const tabs = [home, cloud(2), local(9), cloud(1), { ...cloud(2), id: 'dupe' }];
  assert.deepEqual(serializeTabSession(tabs, 't1'), {
    v: 1,
    tabs: [{ id: 'doc-2', name: 'Doc 2.pdf' }, { id: 'doc-1', name: 'Doc 1.pdf' }],
    active: 'doc-1',
  });
  assert.equal(serializeTabSession(tabs, HOME).active, null, 'Home in front is saved as no active document');
  assert.equal(serializeTabSession(tabs, 't9').active, null);
});

test('saved per user; bad records and broken storage read as nothing', () => {
  const storage = memoryStorage();
  const session = serializeTabSession([home, cloud(1), cloud(2)], 't2');
  assert.equal(writeTabSession(storage, 'user-a', session), true);
  assert.deepEqual(readTabSession(storage, 'user-a'), session);
  assert.equal(readTabSession(storage, 'user-b'), null, 'another user sees nothing');
  assert.equal(tabSessionStorageKey(null), null);
  assert.equal(writeTabSession(storage, null, session), false, 'signed out: nothing written');

  storage.setItem(tabSessionStorageKey('user-c'), '{not json');
  assert.equal(readTabSession(storage, 'user-c'), null);
  storage.setItem(tabSessionStorageKey('user-c'), JSON.stringify({ v: 99, tabs: [] }));
  assert.equal(readTabSession(storage, 'user-c'), null);

  const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  assert.equal(readTabSession(throwing, 'user-a'), null);
  assert.equal(writeTabSession(throwing, 'user-a', session), false);
  assert.equal(readTabSession(null, 'user-a'), null);
});

test('restore plan: saved order, deleted or unshared documents skipped, open ones not doubled', () => {
  const session = {
    v: 1,
    tabs: [{ id: 'doc-3', name: '3' }, { id: 'gone', name: 'x' }, { id: 'doc-1', name: '1' }, { id: 'doc-2', name: '2' }],
    active: 'doc-1',
  };
  const library = [{ id: 'doc-1', name: 'Doc 1.pdf' }, { id: 'doc-2', name: 'Doc 2.pdf' }, { id: 'doc-3', name: 'Doc 3.pdf' }];
  const plan = planTabRestore(session, library, [home, cloud(2)]);
  assert.deepEqual(plan.rows.map((row) => row.id), ['doc-3', 'doc-1']);
  assert.deepEqual(plan.skipped, ['gone']);
  assert.equal(plan.activeDocumentId, 'doc-1');

  const activeGone = planTabRestore({ ...session, active: 'gone' }, library, [home]);
  assert.equal(activeGone.activeDocumentId, null, 'a vanished active document leaves Home in front');

  assert.deepEqual(planTabRestore(null, library, [home]), { rows: [], activeDocumentId: null, skipped: [] });
});

test('the library counts as loaded only with a real document in it', () => {
  assert.equal(libraryHasLoaded([]), false);
  assert.equal(libraryHasLoaded([{ id: 'temp-1' }]), false);
  assert.equal(libraryHasLoaded([{ id: 'temp-1' }, { id: 'doc-1' }]), true);
});

test('the tab strip wiring: one guarded close path, no page-drop stub, restore wired', () => {
  const appShell = readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  const tabBar = readFileSync(new URL('../src/TabBar.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(appShell, /being implemented/);
  assert.doesNotMatch(tabBar, /application\/pdf-page/);
  assert.match(appShell, /<MemoTabBar[\s\S]{0,300}onTabClose=\{stableTabCloseRequest\}/);
  assert.match(appShell, /<MemoTabBar[\s\S]{0,400}onTabMenuAction=\{stableTabMenuAction\}/);
  assert.match(appShell, /onCloseAfterFailure=\{stableTabClose\}/, 'a failed load still closes without asking');
  assert.match(appShell, /useTabSession\(\{[\s\S]{0,300}enabled: !isNarrowShell/, 'the phone keeps opening on Home');
  assert.match(tabBar, /onAuxClick=/);
  assert.match(tabBar, /onContextMenu=/);
});
