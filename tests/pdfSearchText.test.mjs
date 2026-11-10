// Text search speed (2026-11-09): page text is read once per open document,
// shared by every Search panel mount, and read ahead after the open on a side
// reader (its own pdf.js worker) so a search finds it ready.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildSearchPageData,
  loadSearchPageData,
  readSearchTextAhead,
} from '../src/utils/pdfSearchText.js';

const settle = async (n = 20) => { for (let i = 0; i < n; i += 1) await new Promise((r) => setTimeout(r, 0)); };

function fakeDoc(pages = 5, { failPage = null, label = 'main' } = {}) {
  const reads = [];
  return {
    reads,
    numPages: pages,
    async getPage(n) {
      return {
        async getTextContent() {
          reads.push(n);
          if (n === failPage) throw new Error('bad page');
          return { items: [{ str: `${label} page ${n}`, transform: [1, 0, 0, 1, 0, 0], width: 10, height: 10, fontName: 'f' }], styles: { f: {} } };
        },
        getViewport: () => ({ width: 100, height: 100, transform: [1, 0, 0, 1, 0, 0] }),
      };
    },
  };
}

test('page data keeps item indices for every run', () => {
  const data = buildSearchPageData({ items: [{ str: 'A' }, { str: '' , hasEOL: true }, { str: 'B' }], styles: {} }, { transform: [] });
  assert.equal(data.text, 'A B');
  assert.deepEqual(data.ranges.map((r) => [r.start, r.end, r.itemIndex]), [[0, 1, 0], [2, 3, 2]]);
});

test('a page is read once per document, even when asked twice at once', async () => {
  const doc = fakeDoc();
  const [a, b] = await Promise.all([loadSearchPageData(doc, 2), loadSearchPageData(doc, 2)]);
  assert.equal(a, b);
  assert.equal(a.text, 'main page 2');
  assert.equal(await loadSearchPageData(doc, 2), a);
  assert.deepEqual(doc.reads, [2]);
});

test('a failed read is not kept, so a later search tries again', async () => {
  const errors = console.error;
  console.error = () => {};
  try {
    const doc = fakeDoc(3, { failPage: 1 });
    assert.equal(await loadSearchPageData(doc, 1), null);
    assert.equal(await loadSearchPageData(doc, 1), null);
    assert.deepEqual(doc.reads, [1, 1]);
  } finally {
    console.error = errors;
  }
});

test('the read-ahead reads every page on side readers, skipping pages already read', async () => {
  const doc = fakeDoc(6);
  await loadSearchPageData(doc, 3);
  const sides = [fakeDoc(6, { label: 'side' }), fakeDoc(6, { label: 'side' })];
  let opened = 0;
  const destroyed = [];
  readSearchTextAhead(doc, 6, {
    delayMs: 0,
    sideReaders: 2,
    openReader: async () => {
      const side = sides[opened];
      const n = opened++;
      return { doc: side, task: { destroy: async () => { destroyed.push(n); } } };
    },
    waitForIdle: async () => { throw new Error('no idle reads with side readers'); },
  });
  for (let i = 0; i < 50 && destroyed.length < 2; i += 1) await settle();
  assert.deepEqual(doc.reads, [3]);
  assert.deepEqual([...sides[0].reads, ...sides[1].reads].sort(), [1, 2, 4, 5, 6]);
  for (const n of [1, 2, 4, 5, 6]) assert.equal((await loadSearchPageData(doc, n)).text, `side page ${n}`);
  assert.deepEqual(destroyed.sort(), [0, 1], 'side readers are closed when done');
});

test('without a side reader the read-ahead reads on the viewer document in idle time', async () => {
  const doc = fakeDoc(3);
  let idles = 0;
  readSearchTextAhead(doc, 3, { delayMs: 0, openReader: async () => null, waitForIdle: async () => { idles += 1; } });
  for (let i = 0; i < 30 && doc.reads.length < 3; i += 1) await settle();
  assert.deepEqual(doc.reads, [1, 2, 3]);
  assert.equal(idles, 3);
});

test('the read-ahead waits while the viewer moves, on side readers and on the viewer document', async () => {
  const doc = fakeDoc(4);
  const side = fakeDoc(4, { label: 'side' });
  let moving = true;
  let release = null;
  const waitForStill = () => (moving ? new Promise((resolve) => { release = () => { moving = false; resolve(); }; }) : null);
  readSearchTextAhead(doc, 4, {
    delayMs: 0,
    sideReaders: 1,
    openReader: async () => ({ doc: side, task: { destroy: async () => {} } }),
    waitForIdle: async () => {},
    waitForStill,
  });
  await settle(10);
  assert.deepEqual(side.reads, [], 'no page read while the viewer moves');
  release();
  for (let i = 0; i < 30 && side.reads.length < 4; i += 1) await settle();
  assert.deepEqual(side.reads, [1, 2, 3, 4], 'every page read once it is still, none skipped');

  const plain = fakeDoc(2);
  moving = true;
  readSearchTextAhead(plain, 2, { delayMs: 0, openReader: async () => null, waitForIdle: async () => {}, waitForStill });
  await settle(10);
  assert.deepEqual(plain.reads, []);
  release();
  for (let i = 0; i < 30 && plain.reads.length < 2; i += 1) await settle();
  assert.deepEqual(plain.reads, [1, 2]);
});

test('one read-ahead per document; stopping it stops the reads', async () => {
  const doc = fakeDoc(50);
  let opens = 0;
  const stop = readSearchTextAhead(doc, 50, { delayMs: 0, sideReaders: 1, openReader: async () => { opens += 1; return null; }, waitForIdle: () => new Promise((r) => setTimeout(r, 1)) });
  const joined = readSearchTextAhead(doc, 50, { delayMs: 0, openReader: async () => { opens += 1; return null; } });
  await settle(5);
  stop();
  joined();
  const after = doc.reads.length;
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(opens, 1);
  assert.ok(doc.reads.length <= after + 1);
  assert.ok(after < 50);
});

test('the read-ahead caps how many pages it reads ahead', async () => {
  const doc = fakeDoc(10);
  readSearchTextAhead(doc, 10, { delayMs: 0, maxPages: 4, openReader: async () => null, waitForIdle: async () => {} });
  await settle(40);
  assert.deepEqual(doc.reads, [1, 2, 3, 4]);
});

test('the side reader waits for the whole file before asking for its bytes', () => {
  const source = fs.readFileSync(new URL('../src/utils/pdfSearchText.js', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('async function openSideReader'));
  assert.ok(body.indexOf('pdfDoc.getDownloadInfo()') < body.indexOf('await pdfDoc.getData()'), 'getData() only after getDownloadInfo');
});

test('the viewer reads text ahead for the front tab and the panel shares it', () => {
  const sidebar = fs.readFileSync(new URL('../src/PDFSidebar.jsx', import.meta.url), 'utf8');
  assert.match(sidebar, /readSearchTextAhead\(pdfDoc, numPages\)/);
  assert.match(sidebar, /if \(!pdfDoc \|\| !tabActive\) return undefined;/);
  const panel = fs.readFileSync(new URL('../src/sidebar/SearchTextPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /loadSearchPageData\(pdfDoc, pageNumber\)/);
  assert.doesNotMatch(panel, /page\.getTextContent\(\)/);
});

test('search lays out only the runs a match touches, never the whole page text layer', () => {
  const panel = fs.readFileSync(new URL('../src/sidebar/SearchTextPanel.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(panel, /textContentSource: pageData\.textContent\b/);
  assert.match(panel, /items: missing\.map\(\(index\) => pageData\.items\[index\]\)/);
});
