import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFArray, StandardFonts, degrees } from 'pdf-lib';
import { diffSeq } from '../wordDiff.js';
import {
  wordsFromItems, compareDocs, alignPages, rowSummary, rowChanged, scanNote, formatList, changedAreas, snippetLine, dropTextAreas,
} from '../compare.js';
import { buildReport, toShown, pagePlacement, shownSize, wordRects } from '../compare-report.js';
import { inflate } from '../compress.js';
import { ToolError } from '../errors.js';

// Rebuild b from a and the hunks, checking equal hunks really are equal.
function applyHunks(a, b, hunks) {
  const out = [];
  let ai = 0;
  let bi = 0;
  for (const h of hunks) {
    assert.equal(h.a0, ai);
    assert.equal(h.b0, bi);
    if (h.type === 'equal') {
      assert.equal(h.a1 - h.a0, h.b1 - h.b0);
      for (let i = 0; i < h.a1 - h.a0; i += 1) assert.equal(a[h.a0 + i], b[h.b0 + i]);
    }
    out.push(...b.slice(h.b0, h.b1));
    ai = h.a1;
    bi = h.b1;
  }
  assert.equal(ai, a.length);
  assert.equal(bi, b.length);
  return out;
}

const lcsLength = (a, b) => {
  const dp = Array.from({ length: a.length + 1 }, () => new Int32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  return dp[0][0];
};
const kept = (hunks) => hunks.filter((h) => h.type === 'equal').reduce((n, h) => n + h.a1 - h.a0, 0);
const w = (s) => (s ? s.split(' ') : []);

test('diff: insertions, deletions and replacements', () => {
  assert.deepEqual(diffSeq(w('a b c'), w('a b c d e')), [
    { type: 'equal', a0: 0, a1: 3, b0: 0, b1: 3 }, { type: 'change', a0: 3, a1: 3, b0: 3, b1: 5 }]);
  assert.deepEqual(diffSeq(w('x a b'), w('a b')), [
    { type: 'change', a0: 0, a1: 1, b0: 0, b1: 0 }, { type: 'equal', a0: 1, a1: 3, b0: 0, b1: 2 }]);
  assert.deepEqual(diffSeq(w('total is 450 today'), w('total is 480 today')), [
    { type: 'equal', a0: 0, a1: 2, b0: 0, b1: 2 }, { type: 'change', a0: 2, a1: 3, b0: 2, b1: 3 }, { type: 'equal', a0: 3, a1: 4, b0: 3, b1: 4 }]);
  assert.deepEqual(diffSeq([], []), []);
  assert.deepEqual(diffSeq([], w('a')), [{ type: 'change', a0: 0, a1: 0, b0: 0, b1: 1 }]);
  assert.deepEqual(diffSeq(w('a b'), []), [{ type: 'change', a0: 0, a1: 2, b0: 0, b1: 0 }]);
  const a = w('the cat sat on the mat');
  const b = w('the dog sat on a mat today');
  assert.deepEqual(applyHunks(a, b, diffSeq(a, b)), b);
});

test('diff: always finds the fewest changes on small random inputs', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let t = 0; t < 1500; t += 1) {
    const a = Array.from({ length: Math.floor(rand() * 30) }, () => 'abcd'[Math.floor(rand() * 4)]);
    const b = a.filter(() => rand() > 0.3);
    if (rand() > 0.5) b.splice(Math.floor(rand() * b.length), 0, 'z', 'y');
    const hunks = diffSeq(a, b);
    assert.deepEqual(applyHunks(a, b, hunks), b);
    assert.equal(kept(hunks), lcsLength(a, b));
  }
});

test('diff: large inputs are fast and correct', () => {
  // About 200 pages of 600 words, with 300 scattered edits.
  const a = Array.from({ length: 120_000 }, (_, i) => `w${(i * 7919) % 50_000}`);
  const b = a.slice();
  for (let i = 0; i < 300; i += 1) b[(i * 397) % b.length] = `new${i}`;
  let t0 = Date.now();
  let hunks = diffSeq(a, b);
  assert.ok(Date.now() - t0 < 2000, `took ${Date.now() - t0} ms`);
  assert.deepEqual(applyHunks(a, b, hunks), b);
  assert.equal(hunks.filter((h) => h.type === 'change').length, 300);

  // Two unrelated documents: anchors take over, still quick.
  const c = Array.from({ length: 60_000 }, (_, i) => `q${(i * 31) % 3000}`);
  t0 = Date.now();
  hunks = diffSeq(a.slice(0, 60_000), c);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  assert.deepEqual(applyHunks(a.slice(0, 60_000), c, hunks), c);

  // One in five words changed.
  const d = a.slice(0, 60_000);
  const e = d.map((x, i) => (i % 5 === 0 ? `x${i}` : x));
  t0 = Date.now();
  hunks = diffSeq(d, e);
  assert.ok(Date.now() - t0 < 3000, `took ${Date.now() - t0} ms`);
  assert.deepEqual(applyHunks(d, e, hunks), e);

  // Very repetitive text with one word inserted.
  const f = Array.from({ length: 60_000 }, (_, i) => ['the', 'a', 'of'][i % 3]);
  const g = f.slice();
  g.splice(30_000, 0, 'new');
  hunks = diffSeq(f, g);
  assert.equal(kept(hunks), 60_000);
});

const item = (str, x, y, width, extra = {}) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10, hasEOL: false, ...extra });

test('words from pdf.js text items', () => {
  const words = wordsFromItems([
    item('Hello big ', 50, 700, 50),
    item('world', 100, 700, 25, { hasEOL: true }),
    // A word drawn one letter at a time joins back up.
    item('T', 50, 680, 6), item('o', 56, 680, 5), item('p', 61, 680, 5),
    item(' end', 66, 680, 20),
  ]);
  assert.deepEqual(words.map((x) => x.t), ['Hello', 'big', 'world', 'Top', 'end']);
  const [x0, y0, x1, y1] = words[0].box;
  assert.equal(x0, 50);
  assert.equal(x1, 75);
  assert.ok(y0 < 700 && y1 > 707);
  // Letters far apart stay separate words.
  assert.deepEqual(wordsFromItems([item('A', 0, 0, 6), item('B', 100, 0, 6)]).map((x) => x.t), ['A', 'B']);
});

// A page of words laid out in lines, boxes made up from their position.
function page(text, { view = [0, 0, 612, 792], rotate = 0 } = {}) {
  const words = w(text).map((t, i) => ({ t, box: [50 + (i % 8) * 60, 700 - Math.floor(i / 8) * 20, 50 + (i % 8) * 60 + 50, 712 - Math.floor(i / 8) * 20] }));
  return { view, rotate, words };
}

test('compare: counts per page and pairs moved pages', () => {
  const oldPages = [page('one two three four'), page('alpha beta gamma'), page('last page here')];
  const newPages = [page('one two 3 four five'), page('a brand new page'), page('alpha beta gamma'), page('last page here')];
  const r = compareDocs(oldPages, newPages);
  assert.deepEqual(r.rows.map((x) => [x.a, x.b]), [[0, 0], [null, 1], [1, 2], [2, 3]]);
  const [first, added] = r.rows;
  assert.deepEqual(first.removed, [2]);
  assert.deepEqual(first.added.sort(), [2, 4]);
  assert.equal(rowSummary(first), 'Page 1: 1 word removed, 2 added.');
  assert.deepEqual(first.snippets.map(snippetLine), ['"three" became "3"', 'Added "five"']);
  assert.equal(rowSummary(added), 'New page 2 was added (4 words).');
  assert.equal(rowSummary(r.rows[2]), null);
  assert.equal(rowSummary(r.rows[3]), null);
  assert.equal(r.rows.filter(rowChanged).length, 2);
  assert.equal(r.removed, 1);
  assert.equal(r.added, 6);
});

test('compare: ligatures and soft hyphens are not changes', () => {
  const r = compareDocs([page('ﬁnal o­ffice')], [page('final office')]);
  assert.equal(r.removed + r.added, 0);
});

test('compare: pages with no text pair up and are named in the note', () => {
  const r = compareDocs([page('a b'), page(''), page('')], [page('a b'), page(''), page(''), page('')]);
  assert.deepEqual(r.rows.map((x) => [x.a, x.b]), [[0, 0], [1, 1], [2, 2], [null, 3]]);
  assert.equal(scanNote([page('a'), page(''), page(''), page('')], [page('a')]), 'No text found on old pages 2-4. They may be scans or drawings. The text compare can\'t see changes there.');
  assert.equal(scanNote([page('a')], [page('a')]), null);
  assert.equal(rowSummary({ a: 1, b: 1, removed: [], added: [], looks: [[0, 0, 1, 1]] }), 'Page 2: looks different, but the words are the same.');
});

test('align pages: most shared words win, order is kept', () => {
  const shared = new Map([[0 * 3 + 1, 50], [1 * 3 + 2, 40]]);
  assert.deepEqual(alignPages(2, 3, shared), [[null, 0], [0, 1], [1, 2]]);
  assert.deepEqual(alignPages(0, 2, new Map()), [[null, 0], [null, 1]]);
  assert.equal(formatList([1, 2, 3, 5, 7, 8]), '1-3, 5, 7-8');
});

test('changed areas: finds a changed spot, ignores faint noise', () => {
  const W = 200;
  const H = 100;
  const a = new Uint8ClampedArray(W * H * 4).fill(255);
  const b = a.slice();
  assert.deepEqual(changedAreas(a, b, W, H), []);
  for (let y = 40; y < 50; y += 1) for (let x = 120; x < 140; x += 1) b.fill(0, (y * W + x) * 4, (y * W + x) * 4 + 3);
  b[0] = 250; // Faint, under the tolerance.
  const boxes = changedAreas(a, b, W, H);
  assert.equal(boxes.length, 1);
  const [x0, y0, x1, y1] = boxes[0];
  assert.ok(x0 <= 0.6 && x1 >= 0.7 && y0 <= 0.4 && y1 >= 0.5 && x1 - x0 < 0.2, String(boxes[0]));
});

test('look areas already explained by changed words are dropped', () => {
  // page() puts word 0 at x 50..100, y 700..712 on a 612 x 792 page.
  const pg = page('Total is 450');
  const atWord = [50 / 612 - 0.005, 1 - 712 / 792 - 0.005, 100 / 612 + 0.005, 1 - 700 / 792 + 0.005];
  const elsewhere = [0.5, 0.5, 0.6, 0.6];
  // The rest of the line shifts when a word gets longer.
  const restOfLine = [0.2, atWord[1], 0.9, atWord[3]];
  assert.deepEqual(dropTextAreas([atWord, elsewhere, restOfLine], pg, [0], pg, [0]), [elsewhere]);
  assert.deepEqual(dropTextAreas([atWord], pg, [], pg, []), [atWord]);
  // On a turned page the word sits somewhere else, so the area stays.
  const turned = page('Total is 450', { rotate: 90 });
  assert.deepEqual(dropTextAreas([atWord], turned, [0], turned, []), [atWord]);
});

test('rotation math: words land where the turned page is drawn', () => {
  const view = [10, 20, 210, 120];
  for (const rot of [0, 90, 180, 270]) {
    const [dw, dh] = shownSize(view, rot);
    const corners = [[10, 20], [210, 20], [10, 120], [210, 120]].map(([x, y]) => toShown(view, rot, x, y));
    for (const [x, y] of corners) assert.ok(x >= 0 && x <= dw && y >= 0 && y <= dh);
    // pdf-lib draws form point (fx, fy) at (x, y) + R(-rot) * s * (fx, fy).
    const p = pagePlacement(view, rot, 5, 7, 2);
    const t = (-rot * Math.PI) / 180;
    const fx = 30;
    const fy = 40;
    const drawn = [p.x + 2 * (fx * Math.cos(t) - fy * Math.sin(t)), p.y + 2 * (fx * Math.sin(t) + fy * Math.cos(t))];
    const shown = toShown(view, rot, fx + 10, fy + 20);
    assert.ok(Math.abs(drawn[0] - (5 + 2 * shown[0])) < 1e-9 && Math.abs(drawn[1] - (7 + 2 * shown[1])) < 1e-9, `rot ${rot}`);
  }
  // Words side by side on a line become one mark.
  const pg = page('a b c d');
  assert.equal(wordRects(pg, [0, 1, 2], 0, 0, 1).length, 1);
  assert.equal(wordRects(pg, [0, 2], 0, 0, 1).length, 2);
});

async function fixturePdf(lines, sizes) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((text, i) => {
    const p = doc.addPage(sizes?.[i] || [612, 792]);
    p.drawText(text, { x: 50, y: 700, size: 12, font });
    if (i === 1) p.setRotation(degrees(90));
  });
  return doc.save();
}

async function pageOps(doc, index) {
  const contents = doc.getPage(index).node.Contents();
  const streams = contents instanceof PDFArray ? contents.asArray().map((r) => doc.context.lookup(r)) : [contents];
  const parts = await Promise.all(streams.map(async (s) => {
    const raw = s.getContents();
    const filtered = s.dict.get(PDFName.of('Filter'));
    return new TextDecoder().decode(filtered ? await inflate(raw) : raw);
  }));
  return parts.join('\n');
}

test('report: summary page, then changed pages side by side with marks', async () => {
  const oldBytes = await fixturePdf(['Total is 450', 'Turned page', 'Same page']);
  const newBytes = await fixturePdf(['Total is 480', 'Turned page', 'Same page', 'Extra page']);
  const oldPages = [page('Total is 450'), page('Turned page', { rotate: 90 }), page('Same page')];
  const newPages = [page('Total is 480'), page('Turned page', { rotate: 90 }), page('Same page'), page('Extra page')];
  const result = compareDocs(oldPages, newPages);
  result.rows[1].looks = [[0.1, 0.1, 0.3, 0.2]];
  const steps = [];
  const bytes = await buildReport({
    oldBytes, newBytes, oldName: 'plan-v1.pdf', newName: 'plan-v2 ünï 设计.pdf', oldPages, newPages, result, looked: true, progress: (m) => steps.push(m),
  });
  const doc = await PDFDocument.load(bytes);
  // Summary + page 1 (words), page 2 (looks), new page 4 (added).
  assert.equal(doc.getPageCount(), 4);
  assert.deepEqual([doc.getPage(0).getWidth(), doc.getPage(0).getHeight()], [612, 792]);
  assert.deepEqual(steps, ['Making the report: page 1 of 3', 'Making the report: page 2 of 3', 'Making the report: page 3 of 3']);
  // Old and new side by side on a wider sheet.
  assert.ok(doc.getPage(1).getWidth() > 2 * 612);
  assert.ok(doc.getPage(2).getWidth() > 2 * 792, 'turned pages are laid out as seen');
  const sheet = await pageOps(doc, 1);
  assert.match(sheet, /0\.86 0\.15 0\.15 rg/, 'red mark on the old side');
  assert.match(sheet, /0\.08 0\.6 0\.25 rg/, 'green mark on the new side');
  assert.equal((sheet.match(/ Do\b/g) || []).length, 2, 'both pages drawn');
  const turned = await pageOps(doc, 2);
  assert.match(turned, /0\.95 0\.55 0\.05 RG/, 'orange box on a page that looks different');
  const added = await pageOps(doc, 3);
  assert.equal((added.match(/ Do\b/g) || []).length, 1, 'only the new page exists');

  const all = await PDFDocument.load(await buildReport({
    oldBytes, newBytes, oldName: 'a.pdf', newName: 'b.pdf', oldPages, newPages, result, show: 'all',
  }));
  assert.equal(all.getPageCount(), 5);
});

test('report: no changes still makes a summary page', async () => {
  const bytes = await fixturePdf(['Hello']);
  const pages = [page('Hello')];
  const doc = await PDFDocument.load(await buildReport({
    oldBytes: bytes, newBytes: bytes, oldName: 'a.pdf', newName: 'b.pdf', oldPages: pages, newPages: pages, result: compareDocs(pages, pages),
  }));
  assert.equal(doc.getPageCount(), 1);
});

test('report: a file pdf-lib cannot read gives a plain message', async () => {
  const good = await fixturePdf(['Hello']);
  const pages = [page('Hello')];
  await assert.rejects(buildReport({
    oldBytes: new Uint8Array([1, 2, 3]), newBytes: good, oldName: 'a.pdf', newName: 'b.pdf', oldPages: pages, newPages: pages, result: compareDocs(pages, pages),
  }), (e) => e instanceof ToolError && /old file could not be read/.test(e.message));
});
