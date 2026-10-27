// Open speed and edit smoothness: the viewer asks to save the cloud render copy
// (all marks, for the next open's early paint) on every marks change. On a
// 240-sheet set one whole-document write cost 90-300 ms on the main thread:
// twice during an open and at the drop of every edit. It is written once the
// marks are quiet; a load, leaving the page or hiding it writes it at once.
// Each page is its own key under a small index, only changed pages are
// written, and the work is split across idle slices.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const store = new Map();
const writes = [];
let failWriteAt = null; // throw QuotaExceededError on this many-th setItem
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => {
    if (failWriteAt != null && writes.length + 1 >= failWriteAt) {
      const error = new Error('quota');
      error.name = 'QuotaExceededError';
      throw error;
    }
    writes.push(key);
    store.set(key, String(value));
  },
  removeItem: (key) => { store.delete(key); },
};
const win = new EventTarget();
const doc = new EventTarget();
doc.visibilityState = 'visible';
globalThis.window = win;
globalThis.document = doc;

mock.timers.enable({ apis: ['setTimeout'] });
const {
  saveCloudRenderAnnotationsByPage,
  loadCloudRenderAnnotationsByPage,
} = await import('../src/viewerShared.js');

const meta = { documentId: 'doc-1', cutoverTs: null };
const index = (pdfId) => `cloudRenderAnnotationsByPage_${pdfId}`;
const page = (pdfId, key) => `${index(pdfId)}#${key}`;
const marks = (n) => ({ 1: { objects: Array.from({ length: n }, (_, i) => ({ id: `m${i}` })) } });
const pages = (count, perPage = 2, tag = 'a') => Object.fromEntries(Array.from({ length: count }, (_, p) => [
  String(p + 1),
  { objects: Array.from({ length: perPage }, (_, i) => ({ id: `${tag}${p}-${i}` })) },
]));
const indexWrites = (pdfId) => writes.filter((key) => key === index(pdfId)).length;
const saved = (pdfId) => loadCloudRenderAnnotationsByPage(pdfId, meta);
const forget = (pdfId) => { for (const key of [...store.keys()]) if (key.startsWith(index(pdfId))) store.delete(key); };

test('a burst of changes is written once, after the marks are quiet, with the last state', () => {
  writes.length = 0;
  for (let i = 1; i <= 5; i += 1) saveCloudRenderAnnotationsByPage('pdf-a', meta, marks(i));
  assert.equal(writes.length, 0, 'nothing is written while marks keep changing');
  mock.timers.tick(1000);
  saveCloudRenderAnnotationsByPage('pdf-a', meta, marks(6));
  mock.timers.tick(1000);
  assert.equal(writes.length, 0, 'each change restarts the quiet wait');
  mock.timers.tick(600);
  assert.equal(indexWrites('pdf-a'), 1, 'one write after the quiet wait');
  assert.equal(saved('pdf-a')[1].objects.length, 6, 'the write holds the last state');
});

test('loading the same document writes its pending copy first', () => {
  writes.length = 0;
  saveCloudRenderAnnotationsByPage('pdf-b', meta, marks(3));
  const loaded = loadCloudRenderAnnotationsByPage('pdf-b', meta);
  assert.equal(loaded[1].objects.length, 3, 'the load sees the latest marks');
  assert.equal(indexWrites('pdf-b'), 1);
  mock.timers.tick(2000);
  assert.equal(indexWrites('pdf-b'), 1, 'the flushed save is not written again');
});

test('leaving or hiding the page writes every pending copy', () => {
  writes.length = 0;
  saveCloudRenderAnnotationsByPage('pdf-c', meta, marks(2));
  saveCloudRenderAnnotationsByPage('pdf-d', meta, marks(4));
  win.dispatchEvent(new Event('pagehide'));
  assert.equal(indexWrites('pdf-c'), 1);
  assert.equal(indexWrites('pdf-d'), 1);

  writes.length = 0;
  saveCloudRenderAnnotationsByPage('pdf-c', meta, marks(5));
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  doc.visibilityState = 'visible';
  assert.deepEqual(writes, [page('pdf-c', '1'), index('pdf-c')]);
  assert.equal(saved('pdf-c')[1].objects.length, 5);
  writes.length = 0;
  mock.timers.tick(2000);
  assert.equal(writes.length, 0, 'nothing left to write');
});

test('an edit on one page writes that page and the index only', () => {
  writes.length = 0;
  const before = pages(240);
  saveCloudRenderAnnotationsByPage('pdf-e', meta, before);
  mock.timers.tick(1600);
  assert.equal(writes.length, 241, 'the first save writes every page, then the index');
  assert.equal(writes.at(-1), index('pdf-e'), 'the index is written last');

  writes.length = 0;
  const edited = { ...before, 17: { objects: [...before[17].objects, { id: 'new' }] } };
  saveCloudRenderAnnotationsByPage('pdf-e', meta, edited);
  mock.timers.tick(1600);
  assert.deepEqual(writes, [page('pdf-e', '17'), index('pdf-e')]);
  assert.deepEqual(saved('pdf-e'), JSON.parse(JSON.stringify(edited)));
});

test('a reopen with the same marks writes no page, and a removed page loses its key', () => {
  forget('pdf-f');
  const all = pages(5);
  saveCloudRenderAnnotationsByPage('pdf-f', meta, all);
  mock.timers.tick(1600);
  assert.deepEqual(saved('pdf-f'), JSON.parse(JSON.stringify(all)), 'the load reads every page');

  writes.length = 0;
  saveCloudRenderAnnotationsByPage('pdf-f', meta, JSON.parse(JSON.stringify(all)));
  mock.timers.tick(1600);
  assert.deepEqual(writes, [index('pdf-f')], 'unchanged pages are not written again');

  writes.length = 0;
  const { 3: _dropped, ...fewer } = all;
  saveCloudRenderAnnotationsByPage('pdf-f', meta, fewer);
  mock.timers.tick(1600);
  assert.deepEqual(writes, [index('pdf-f')]);
  assert.equal(store.has(page('pdf-f', '3')), false, 'the dropped page key is removed');
  assert.deepEqual(Object.keys(saved('pdf-f')).sort(), ['1', '2', '4', '5']);
});

test('a write cut short before its index paints nothing rather than mixed pages', () => {
  forget('pdf-g');
  saveCloudRenderAnnotationsByPage('pdf-g', meta, pages(4, 2, 'old'));
  mock.timers.tick(1600);
  // A newer write reached page 2, then the tab died before the index.
  const value = store.get(page('pdf-g', '2'));
  store.set(page('pdf-g', '2'), value.replace(/^\S+/, 'newer-gen'));
  assert.equal(loadCloudRenderAnnotationsByPage('pdf-g', meta), null);
  store.delete(page('pdf-g', '3'));
  assert.equal(loadCloudRenderAnnotationsByPage('pdf-g', meta), null, 'a missing page also paints nothing');
});

test('a copy saved before pages had their own keys still loads, and is replaced on save', () => {
  forget('pdf-h');
  store.set(index('pdf-h'), JSON.stringify({ version: 1, documentId: 'doc-1', cutoverTs: null, annotationsByPage: marks(2) }));
  assert.equal(loadCloudRenderAnnotationsByPage('pdf-h', meta)[1].objects.length, 2);
  assert.equal(loadCloudRenderAnnotationsByPage('pdf-h', { documentId: 'other' }), null, 'another document never reads it');
  saveCloudRenderAnnotationsByPage('pdf-h', meta, marks(3));
  mock.timers.tick(1600);
  assert.equal(JSON.parse(store.get(index('pdf-h'))).version, 2);
  assert.equal(saved('pdf-h')[1].objects.length, 3);
});

test('a copy that does not fit is removed, and later saves of as many marks are skipped', () => {
  forget('pdf-i');
  saveCloudRenderAnnotationsByPage('pdf-i', meta, pages(3, 2, 'fit'));
  mock.timers.tick(1600);
  writes.length = 0;
  failWriteAt = 3;
  saveCloudRenderAnnotationsByPage('pdf-i', meta, pages(6, 2, 'big'));
  mock.timers.tick(1600);
  failWriteAt = null;
  assert.equal([...store.keys()].some((key) => key.startsWith(index('pdf-i'))), false, 'no part of the copy is left');
  writes.length = 0;
  saveCloudRenderAnnotationsByPage('pdf-i', meta, pages(6, 2, 'bigger'));
  mock.timers.tick(1600);
  assert.equal(writes.length, 0);
});

test('at idle the copy is written a slice at a time, without one long task', () => {
  forget('pdf-j');
  const idle = [];
  globalThis.requestIdleCallback = (callback) => { idle.push(callback); return idle.length; };
  const realNow = performance.now;
  let now = 0;
  performance.now = () => now;
  try {
    // Each page write costs 1 ms of fake time.
    const realSet = localStorage.setItem;
    localStorage.setItem = (key, value) => { now += 1; realSet(key, value); };
    writes.length = 0;
    saveCloudRenderAnnotationsByPage('pdf-j', meta, pages(40));
    mock.timers.tick(1600);
    assert.equal(writes.length, 0, 'nothing is written before the idle callback');
    let slices = 0;
    while (idle.length) {
      const before = writes.length;
      idle.shift()({ timeRemaining: () => 50, didTimeout: false });
      slices += 1;
      // At most 10 ms of 1 ms page writes, plus the index after the last page.
      assert.ok(writes.length - before <= 11, `slice ${slices} wrote ${writes.length - before} keys`);
    }
    localStorage.setItem = realSet;
    assert.ok(slices >= 4, `written over ${slices} idle slices`);
    assert.equal(writes.at(-1), index('pdf-j'));
    assert.equal(Object.keys(saved('pdf-j')).length, 40);
  } finally {
    performance.now = realNow;
    delete globalThis.requestIdleCallback;
  }
});

test('a copy another tab wrote meanwhile is not trusted: the next save rewrites what it skipped', () => {
  forget('pdf-k');
  const mine = pages(3, 2, 'mine');
  saveCloudRenderAnnotationsByPage('pdf-k', meta, mine);
  mock.timers.tick(1600);
  // Another tab with the same document saves page 1 under its own generation.
  const theirs = JSON.parse(store.get(index('pdf-k')));
  store.set(page('pdf-k', '1'), `other-gen x\n${JSON.stringify({ objects: [{ id: 'theirs' }] })}`);
  store.set(index('pdf-k'), JSON.stringify({ ...theirs, pages: { ...theirs.pages, 1: 'other-gen' } }));
  const event = new Event('storage');
  event.key = page('pdf-k', '1');
  win.dispatchEvent(event);
  // This tab then edits page 2 only.
  const edited = { ...mine, 2: { objects: [...mine[2].objects, { id: 'new' }] } };
  saveCloudRenderAnnotationsByPage('pdf-k', meta, edited);
  mock.timers.tick(1600);
  assert.deepEqual(saved('pdf-k'), JSON.parse(JSON.stringify(edited)), 'the copy loads, holding this tab\'s marks');
});

test('wiring: the viewer still saves on marks changes and loads on open', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /saveCloudRenderAnnotationsByPage\(\s*pdfId,/);
  assert.match(viewer, /loadCloudRenderAnnotationsByPage\(id, \{/);
});
