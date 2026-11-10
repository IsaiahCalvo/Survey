// A file's search text kept on the device (2026-11-10): a reopened file
// searches at once instead of reading every page's text through pdf.js again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageThumbStore } from '../src/services/pageThumbStore.js';
import { loadSearchPageData, readSearchTextAhead } from '../src/utils/pdfSearchText.js';
import {
  keepSearchText,
  loadKeptSearchText,
  packSearchText,
  searchTextRowStamp,
  unpackSearchText,
} from '../src/utils/searchTextKeep.js';
import { pdfFileStamp, setPdfFileStamp } from '../src/utils/pdfFileStamp.js';
import { applyPageViewOperation, createPageView } from '../src/utils/pageViewDocument.js';

const settle = async (n = 30) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

async function memoryStore() {
  const { IDBFactory } = await import('fake-indexeddb');
  return createPageThumbStore({ indexedDb: new IDBFactory(), timeoutMs: 2000 });
}

class FakeViewport {
  constructor({ viewBox, userUnit = 1, scale, rotation }) {
    this.viewBox = viewBox; this.userUnit = userUnit; this.scale = scale; this.rotation = rotation;
    this.width = (viewBox[2] - viewBox[0]) * scale;
    this.height = (viewBox[3] - viewBox[1]) * scale;
    this.transform = [scale, 0, 0, -scale, 0, this.height];
  }
}

function runs(page) {
  return [
    { str: `Panel ${page}`, dir: 'ltr', width: 41.3125, height: 9.5, transform: [9.5, 0, 0, 9.5, 120.25 + page, 640.0625], fontName: 'g_d0_f1', hasEOL: false },
    { str: '', dir: 'ltr', width: 0, height: 0, transform: [1, 0, 0, 1, 0, 0], fontName: 'g_d0_f1', hasEOL: true },
    { str: 'مرحبا', dir: 'rtl', width: 22.1, height: 7, transform: [0, 7, -7, 0, 33.3333333333, 12.000001], fontName: 'g_d0_f2', hasEOL: false },
  ];
}

function fakeDoc(pages = 4) {
  const reads = [];
  return {
    reads,
    numPages: pages,
    async getPage(n) {
      return {
        async getTextContent() {
          reads.push(n);
          return { items: runs(n), styles: { g_d0_f1: { fontFamily: 'sans-serif', ascent: 0.9 }, g_d0_f2: { fontFamily: 'serif', vertical: true } }, lang: null };
        },
        getViewport: ({ scale }) => new FakeViewport({ viewBox: [0, 0, 1224, 792], userUnit: 1, scale, rotation: n === 2 ? 90 : 0 }),
      };
    },
  };
}

test('packed text reads back exactly: strings, fonts, directions, line ends and every number', () => {
  const pages = [1, 2, 3].map((n) => ({
    key: String(n - 1),
    textContent: { items: runs(n), styles: { g_d0_f1: { fontFamily: 'sans-serif' } }, lang: 'en' },
    viewport: { viewBox: [0, 0, 1224, 792], userUnit: 1, rotation: n === 2 ? 90 : 0 },
  }));
  pages[2].textContent.items.push({ type: 'beginMarkedContent', id: 'mc1' });
  const back = unpackSearchText(packSearchText(pages));
  assert.equal(back.size, 3);
  for (const page of pages) {
    const kept = back.get(page.key);
    assert.deepEqual(kept.textContent, page.textContent);
    assert.deepEqual(kept.viewport, page.viewport);
  }
  assert.equal(unpackSearchText(new ArrayBuffer(2)), null, 'a broken row reads as nothing kept');
});

test('a reopened file searches from the kept text: no page is read through pdf.js', async () => {
  const store = await memoryStore();
  const stampOf = async () => 'abc123';
  const first = fakeDoc(4);
  // First open: the read-ahead reads every page, then keeps the text.
  const kept = [];
  readSearchTextAhead(first, 4, {
    delayMs: 0,
    sideReaders: 0,
    openReader: async () => null,
    waitForIdle: async () => {},
    waitForStill: () => null,
    loadKept: (doc, n) => loadKeptSearchText(doc, n, { store, stampOf }),
    keep: async (doc, done) => { kept.push(await keepSearchText(doc, done, { store, stampOf })); },
  });
  for (let i = 0; i < 100 && !kept.length; i += 1) await settle();
  assert.deepEqual(first.reads.sort(), [1, 2, 3, 4]);
  assert.deepEqual(kept, [true], 'the text was kept once every page was read');
  const rows = await store.loadDoc(searchTextRowStamp('abc123'));
  assert.equal(rows.length, 1);
  assert.deepEqual(await store.loadDoc('abc123'), [], 'kept apart from the page previews');

  // Reopen (a new pdf.js document of the same bytes).
  const again = fakeDoc(4);
  const keptAgain = [];
  const stopAgain = readSearchTextAhead(again, 4, {
    delayMs: 60_000,
    openReader: async () => { throw new Error('no side reader needed'); },
    loadKept: (doc, n) => loadKeptSearchText(doc, n, { store, stampOf }),
    keep: async () => { keptAgain.push(true); },
  });
  // The kept text loads at once (a search started before it is here reads
  // pages through pdf.js, so the first rows never wait for it).
  await settle(100);
  const page2 = await loadSearchPageData(again, 2);
  const firstPage2 = await loadSearchPageData(first, 2);
  assert.equal(page2.text, firstPage2.text);
  assert.deepEqual(page2.ranges, firstPage2.ranges);
  assert.deepEqual(page2.items, firstPage2.items);
  assert.equal(page2.viewport.rotation, 90, 'with the page viewport');
  assert.deepEqual(page2.viewportTransform, firstPage2.viewportTransform);
  assert.deepEqual(again.reads, [], 'nothing read through pdf.js');
  stopAgain();
  await store.close();
});

test('no stamp in time, or no store: search reads through pdf.js as before', async () => {
  const doc = fakeDoc(2);
  const stop = readSearchTextAhead(doc, 2, {
    delayMs: 60_000,
    loadKept: (d, n) => loadKeptSearchText(d, n, { stampOf: async () => null, store: { isDisabled: false, loadDoc: async () => { throw new Error('not asked'); } } }),
  });
  assert.equal((await loadSearchPageData(doc, 1)).text, 'Panel 1 مرحبا');
  assert.deepEqual(doc.reads, [1]);
  stop();
});

test('the file stamp is shared from the preview session, and waits for it a while', async () => {
  const base = {};
  const later = pdfFileStamp(base, { waitMs: 500 });
  setPdfFileStamp(base, Promise.resolve('f00d'));
  assert.equal(await later, 'f00d');
  assert.equal(await pdfFileStamp(base), 'f00d');
  assert.equal(await pdfFileStamp({}, { waitMs: 10 }), null, 'none known in time');
});

test('nothing is kept while the Pages view shows a turned, moved or removed page', async () => {
  const store = await memoryStore();
  const stampOf = async () => 'view123';
  const base = fakeDoc(3);
  const done = new Map([1, 2, 3].map((n) => [n, { textContent: { items: runs(n), styles: {} }, viewport: new FakeViewport({ viewBox: [0, 0, 1224, 792], scale: 1, rotation: 0 }) }]));
  const turned = applyPageViewOperation(createPageView(base), { type: 'rotate', page: 2, delta: 90 });
  assert.equal(await keepSearchText(turned, done, { store, stampOf }), false, 'a turned page: not kept');
  const removed = applyPageViewOperation(createPageView(base), { type: 'delete', page: 3 });
  assert.equal(await keepSearchText(removed, new Map([...done].slice(0, 2)), { store, stampOf }), false, 'a removed page: not kept');
  assert.deepEqual(await store.loadDoc(searchTextRowStamp('view123')), []);
  // The view with no edit is the file itself: kept.
  assert.equal(await keepSearchText(createPageView(base), done, { store, stampOf }), true);
  await store.close();
});
