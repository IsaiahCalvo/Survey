import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFHexString, PDFName, PDFString } from 'pdf-lib';
import {
  readOutline, planSplit, safeFileName, splitByBookmarks, describeOutline, levelCounts,
} from '../bookmarks.js';
import { ToolError } from '../errors.js';

const N = PDFName.of;

// Page i is (100 + i) wide, so a part's pages can be told apart.
async function sampleDoc(n) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i += 1) doc.addPage([100 + i, 200]);
  return doc;
}

// Builds a real /Outlines tree. Each node: { title, page, children, how }
// where how picks the destination style: 'dest' (default), 'action', 'named'
// (name tree), 'oldNamed' (catalog /Dests) or 'number' (a bare page number).
function addOutline(doc, tree) {
  const ctx = doc.context;
  const pages = doc.getPages();
  const nameTree = [];
  const oldDests = ctx.obj({});
  let k = 0;
  const destFor = (node) => {
    const arr = () => ctx.obj([pages[node.page].ref, N('Fit')]);
    switch (node.how) {
      case 'action': return { A: ctx.obj({ S: N('GoTo'), D: arr() }) };
      case 'named': { const key = `dest${k += 1}`; nameTree.push(PDFString.of(key), arr()); return { Dest: PDFString.of(key) }; }
      case 'oldNamed': { const key = `old${k += 1}`; oldDests.set(N(key), ctx.obj({ D: arr() })); return { Dest: N(key) }; }
      case 'number': return { Dest: ctx.obj([node.page, N('Fit')]) };
      default: return { Dest: arr() };
    }
  };
  const build = (nodes, parentRef) => {
    const refs = nodes.map(() => ctx.nextRef());
    nodes.forEach((node, i) => {
      const dict = ctx.obj({ Title: PDFHexString.fromText(node.title), Parent: parentRef, ...destFor(node) });
      if (i > 0) dict.set(N('Prev'), refs[i - 1]);
      if (i + 1 < nodes.length) dict.set(N('Next'), refs[i + 1]);
      if (node.children?.length) {
        const kids = build(node.children, refs[i]);
        dict.set(N('First'), kids[0]);
        dict.set(N('Last'), kids[kids.length - 1]);
        dict.set(N('Count'), ctx.obj(node.children.length));
      }
      ctx.assign(refs[i], dict);
    });
    return refs;
  };
  const rootRef = ctx.nextRef();
  const top = build(tree, rootRef);
  ctx.assign(rootRef, ctx.obj({ Type: N('Outlines'), First: top[0], Last: top[top.length - 1], Count: ctx.obj(tree.length) }));
  doc.catalog.set(N('Outlines'), rootRef);
  if (nameTree.length) doc.catalog.set(N('Names'), ctx.obj({ Dests: ctx.register(ctx.obj({ Names: ctx.obj(nameTree) })) }));
  if (oldDests.entries().length) doc.catalog.set(N('Dests'), ctx.register(oldDests));
}

const widths = async (bytes) => (await PDFDocument.load(bytes)).getPages().map((p) => p.getWidth());

const BOOK = [
  { title: 'Cover', page: 0 },
  {
    title: 'Chapter 1: Site', page: 2, how: 'action',
    children: [{ title: '1.1 Survey', page: 2, how: 'named' }, { title: '1.2 Levels', page: 4, how: 'oldNamed' }],
  },
  { title: 'Chapter 2 / Plans?', page: 6, children: [{ title: 'Ünits — 2.1', page: 7, how: 'number' }] },
];

test('bookmarks: reads titles, levels and every kind of destination', async () => {
  const doc = await sampleDoc(9);
  addOutline(doc, BOOK);
  const again = await PDFDocument.load(await doc.save());
  const outline = readOutline(again);
  assert.deepEqual(outline.map((o) => [o.title, o.page]), [['Cover', 0], ['Chapter 1: Site', 2], ['Chapter 2 / Plans?', 6]]);
  assert.deepEqual(outline[1].children.map((o) => [o.title, o.page]), [['1.1 Survey', 2], ['1.2 Levels', 4]]);
  assert.deepEqual(outline[2].children.map((o) => [o.title, o.page]), [['Ünits — 2.1', 7]]);
  assert.deepEqual(levelCounts(outline), [3, 3]);
});

test('bookmarks: plan by top level and by level 2', () => {
  const outline = BOOK.map(function strip(n) { return { title: n.title, page: n.page, children: (n.children || []).map(strip) }; });
  assert.deepEqual(planSplit(outline, 9, 1), [
    { title: 'Cover', start: 0, end: 1 },
    { title: 'Chapter 1: Site', start: 2, end: 5 },
    { title: 'Chapter 2 / Plans?', start: 6, end: 8 },
  ]);
  assert.deepEqual(planSplit(outline, 9, 2), [
    { title: 'Cover', start: 0, end: 1 },
    { title: 'Chapter 1: Site - 1.1 Survey', start: 2, end: 3 },
    { title: '1.2 Levels', start: 4, end: 5 },
    { title: 'Chapter 2 / Plans?', start: 6, end: 6 },
    { title: 'Ünits — 2.1', start: 7, end: 8 },
  ]);
  // Out-of-order bookmarks, pages before the first one, and ones that point nowhere.
  const odd = [{ title: 'B', page: 5, children: [] }, { title: 'A', page: 2, children: [] }, { title: 'Lost', page: null, children: [] }];
  assert.deepEqual(planSplit(odd, 8, 1), [
    { title: 'Before the first bookmark', start: 0, end: 1 },
    { title: 'A', start: 2, end: 4 },
    { title: 'B', start: 5, end: 7 },
  ]);
});

test('bookmarks: safe file names', () => {
  assert.equal(safeFileName('Chapter 2 / Plans?', 'x'), 'Chapter 2 Plans');
  assert.equal(safeFileName('  ..a:b*c"d<e>f|g\u0001h.. ', 'x'), 'a b c d e f g h');
  assert.equal(safeFileName('???', 'Bookmark 3'), 'Bookmark 3');
  assert.equal(Array.from(safeFileName('é'.repeat(200), 'x')).length, 80);
});

test('bookmarks: splits into one PDF per bookmark, named after it', async () => {
  const doc = await sampleDoc(9);
  addOutline(doc, BOOK);
  const bytes = await doc.save();
  const seen = [];
  const top = await splitByBookmarks(bytes, { level: 1 }, (m) => seen.push(m));
  assert.deepEqual(top.map((p) => p.name), ['1 Cover.pdf', '2 Chapter 1 Site.pdf', '3 Chapter 2 Plans.pdf']);
  assert.deepEqual(await widths(top[1].bytes), [102, 103, 104, 105]);
  assert.deepEqual(seen, ['File 1 of 3', 'File 2 of 3', 'File 3 of 3']);
  const two = await splitByBookmarks(bytes, { level: 2 });
  assert.equal(two.length, 5);
  assert.equal(two[4].name, '5 Ünits — 2.1.pdf');
  assert.deepEqual(await widths(two[4].bytes), [107, 108]);
  // Every page lands in exactly one part.
  assert.equal((await Promise.all(two.map((p) => widths(p.bytes)))).flat().length, 9);
});

test('bookmarks: numbers pad so the files sort in order', async () => {
  const doc = await sampleDoc(12);
  addOutline(doc, Array.from({ length: 12 }, (_, i) => ({ title: `Sheet ${i + 1}`, page: i })));
  const parts = await splitByBookmarks(await doc.save());
  assert.equal(parts[0].name, '01 Sheet 1.pdf');
  assert.equal(parts[11].name, '12 Sheet 12.pdf');
});

test('bookmarks: plain messages when there are none, or none that point anywhere', async () => {
  const plain = await (await sampleDoc(3)).save();
  await assert.rejects(splitByBookmarks(plain), (e) => e instanceof ToolError && /no bookmarks/.test(e.message));
  assert.match(describeOutline([]), /no bookmarks/);
  const doc = await sampleDoc(3);
  addOutline(doc, [{ title: 'Gone', page: 0, how: 'named' }]);
  doc.catalog.delete(N('Names'));
  await assert.rejects(splitByBookmarks(await doc.save()), (e) => e instanceof ToolError && /don't point/.test(e.message));
});

test('bookmarks: a looping outline is read once and stops', async () => {
  const doc = await sampleDoc(3);
  addOutline(doc, [{ title: 'A', page: 0 }, { title: 'B', page: 1 }]);
  const root = doc.context.lookup(doc.catalog.get(N('Outlines')));
  const last = doc.context.lookup(root.get(N('Last')));
  last.set(N('Next'), root.get(N('First')));
  assert.deepEqual(readOutline(doc).map((o) => o.title), ['A', 'B']);
});

test('bookmarks: the note lists what was found', () => {
  const outline = [{ title: 'A', page: 0, children: [{ title: 'a1', page: 0, children: [] }] }, { title: 'B', page: 1, children: [] }];
  assert.equal(describeOutline(outline), 'Found 2 top-level bookmarks: A and B. 1 more sits one level down.');
  const many = Array.from({ length: 7 }, (_, i) => ({ title: `S${i}`, page: i, children: [] }));
  assert.equal(describeOutline(many), 'Found 7 top-level bookmarks: S0, S1, S2, S3 and 3 more.');
});
