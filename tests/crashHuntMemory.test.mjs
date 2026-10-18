// Crash hunt 2026-10-07 — memory regressions found by the long "monkey" run
// (scratchpad crashHunt/harness.mjs) on the big drawing set.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { snapshotAnnotationPages, isSharedSnapshotPage } from '../src/utils/historySnapshotShare.js';
import { deepClone } from '../src/utils/deepClone.js';

const countingClone = () => {
  const calls = [];
  const clone = (value) => { calls.push(value); return deepClone(value); };
  return { clone, calls };
};

test('snapshots share the copy of a page that did not change', () => {
  const p1 = { objects: [{ id: 'a', left: 1 }] };
  const p2 = { objects: [{ id: 'b', left: 2 }] };
  const { clone, calls } = countingClone();
  const s1 = snapshotAnnotationPages({ 1: p1, 2: p2 }, clone);
  const s2 = snapshotAnnotationPages({ 1: p1, 2: p2 }, clone);
  assert.equal(calls.length, 2, 'each page copied once');
  assert.equal(s1[1], s2[1]);
  assert.equal(s1[2], s2[2]);
  assert.notEqual(s1, s2, 'each snapshot is its own map');
  assert.notEqual(s1[1], p1, 'the copy is not the live page');
  assert.deepEqual(s1[1], p1);
});

test('a changed page (a new page object) gets a new copy; the old snapshot keeps the old one', () => {
  const p1 = { objects: [{ id: 'a' }] };
  const { clone, calls } = countingClone();
  const before = snapshotAnnotationPages({ 1: p1 }, clone);
  const p1b = { ...p1, objects: [...p1.objects, { id: 'new' }] };
  const after = snapshotAnnotationPages({ 1: p1b }, clone);
  assert.equal(calls.length, 2);
  assert.equal(before[1].objects.length, 1);
  assert.equal(after[1].objects.length, 2);
});

test('a page restored from a snapshot is not copied again', () => {
  const { clone, calls } = countingClone();
  const snap = snapshotAnnotationPages({ 1: { objects: [{ id: 'a' }] } }, clone);
  assert.ok(isSharedSnapshotPage(snap[1]));
  // Undo made the snapshot live; the next snapshot of it reuses the pages.
  const again = snapshotAnnotationPages(snap, clone);
  assert.equal(calls.length, 1);
  assert.equal(again[1], snap[1]);
});

test('50 snapshots of a big document with one page changing each time stay small', () => {
  const big = {};
  for (let page = 1; page <= 36; page += 1) {
    big[page] = { objects: Array.from({ length: 200 }, (_, i) => ({ id: `${page}-${i}`, path: Array.from({ length: 20 }, (_, k) => k) })) };
  }
  const { clone, calls } = countingClone();
  let live = big;
  for (let step = 0; step < 50; step += 1) {
    snapshotAnnotationPages(live, clone);
    const key = String((step % 36) + 1);
    live = { ...live, [key]: { ...live[key], objects: [...live[key].objects, { id: `s${step}` }] } };
  }
  // 36 first copies + one per later change, not 50 x 36.
  assert.ok(calls.length <= 36 + 50, `copied ${calls.length} pages`);
});

test('a rebuilt page object with the same content reuses the earlier copy', () => {
  const { clone, calls } = countingClone();
  const first = snapshotAnnotationPages({ 7: { objects: [{ id: 'x', left: 3 }] } }, clone);
  // e.g. a re-projection after a page operation rebuilt every page object
  const again = snapshotAnnotationPages({ 7: { objects: [{ id: 'x', left: 3 }] } }, clone);
  assert.equal(calls.length, 1);
  assert.equal(again[7], first[7]);
  const changed = snapshotAnnotationPages({ 7: { objects: [{ id: 'x', left: 4 }] } }, clone);
  assert.equal(calls.length, 2);
  assert.equal(changed[7].objects[0].left, 4);
  assert.equal(first[7].objects[0].left, 3);
});

test('non-object values pass through, odd input falls back to the plain clone', () => {
  const { clone } = countingClone();
  assert.deepEqual(snapshotAnnotationPages({ 1: null, 2: 5 }, clone), { 1: null, 2: 5 });
  assert.equal(snapshotAnnotationPages(null, clone), null);
  assert.deepEqual(snapshotAnnotationPages([1, 2], clone), [1, 2]);
});

test('the viewer takes its undo snapshots through the sharing helper', () => {
  const src = fs.readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('const getHistorySnapshot = useCallback'), src.indexOf('const getAnnotationPageHistorySnapshot'));
  assert.match(body, /annotationsByPage: snapshotAnnotationPages\(annotationsByPageRef\.current/);
});

// The AppShell leak: PDFViewer folds callbacks it is given into the rail /
// tool bar API objects it publishes back into AppShell state. A callback that
// is a fresh closure each render kept the previous published API (and the
// PDFViewer render behind it, with its undo snapshots) alive, forming an
// endless chain. Every callback prop handed to PDFViewer must be a stable
// handler (useStableHandler / useCallback-free stable wrapper) or a setter.
test('every callback AppShell hands to PDFViewer keeps one identity', () => {
  const src = fs.readFileSync(new URL('../src/AppShell.jsx', import.meta.url), 'utf8');
  const start = src.indexOf('<PDFViewer\n');
  assert.ok(start > 0, 'PDFViewer element found');
  const block = src.slice(start, src.indexOf('/>', start));
  const props = [...block.matchAll(/\s(on[A-Z]\w*)=\{([^}]+)\}/g)].map(([, name, value]) => [name, value.trim()]);
  assert.ok(props.length >= 10, 'found the callback props');
  // The tab cache creates each publisher once, then reuses it for that tab.
  // Keep the allowlist tied to the exact prop and its memoized factory.
  const cached = new Map([
    ['onTopToolbarApiChange', 'chrome.top'],
    ['onBottomToolbarApiChange', 'chrome.bottom'],
    ['onLeftRailApiChange', 'chrome.left'],
    ['onRightRailApiChange', 'chrome.right'],
  ]);
  assert.match(src, /const chromeCache = useMemo\(\(\) => createTabChromeCache\([^\n]+, \[\]\)/);
  assert.match(src, /const chromeSetters = useMemo\(\(\) => \(\{[\s\S]*?\}\), \[\]\)/);
  assert.match(src, /const chrome = chromeCache\.callbacks\(tab\.id, chromeSetters\);/);
  const unstable = props.filter(([name, value]) =>
    !/^(stable[A-Z]\w*|set[A-Z]\w*|refetchTemplates)$/.test(value) && cached.get(name) !== value);
  assert.deepEqual(unstable, [], 'callback props that are not stable handlers');
});

// pdf.js keeps every drawn page's instructions and images until cleanup().
import { notePageDrawn, pageMounted, pageUnmounted } from '../src/utils/pdfPageCacheTrim.js';

const fakePdf = () => {
  const cleaned = [];
  const pages = new Map();
  return {
    cleaned,
    getPage(n) {
      if (!pages.has(n)) pages.set(n, { cleanup: () => { cleaned.push(n); return true; } });
      return Promise.resolve(pages.get(n));
    },
  };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

test('only the most recently drawn pages keep their pdf.js data', async () => {
  const pdf = fakePdf();
  for (let i = 0; i < 10; i += 1) notePageDrawn(pdf, i, 4);
  await settle();
  assert.deepEqual(pdf.cleaned.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
});

test('a page on screen is never cleaned, and is cleaned once it leaves', async () => {
  const pdf = fakePdf();
  pageMounted(pdf, 0);
  for (let i = 0; i < 6; i += 1) notePageDrawn(pdf, i, 1);
  await settle();
  assert.ok(!pdf.cleaned.includes(1), 'page index 0 (pdf page 1) kept while mounted');
  assert.deepEqual(pdf.cleaned.sort((a, b) => a - b), [2, 3, 4, 5]);
  pageUnmounted(pdf, 0, 1);
  await settle();
  assert.ok(pdf.cleaned.includes(1), 'cleaned after it left the screen');
});

test('drawing a page again makes it recent; a broken document is ignored', async () => {
  const pdf = fakePdf();
  notePageDrawn(pdf, 0, 2); notePageDrawn(pdf, 1, 2); notePageDrawn(pdf, 0, 2); notePageDrawn(pdf, 2, 2);
  await settle();
  assert.deepEqual(pdf.cleaned, [2]);
  const broken = { getPage: () => Promise.reject(new Error('closed')) };
  notePageDrawn(broken, 0, 0);
  await settle();
  assert.deepEqual(notePageDrawn(null, 0, 1), []);
});

// React clears a ref before an unmount cleanup runs, so a cleanup that reads
// canvasRef.current released nothing: every page canvas that left the screen
// kept its bitmap until a garbage collection (iOS caps canvas memory).
test('page and detail-tile canvases are released with the element captured at mount', () => {
  const src = fs.readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /useEffect\(\(\) => \(\) => releaseRasterCanvas\(canvasRef\.current\)/);
  assert.doesNotMatch(src, /return \(\) => \{[^}]*releaseRasterCanvas\(canvasRef\.current\)/);
  const captured = src.match(/const el = canvasRef\.current;[\s\S]{0,400}?releaseRasterCanvas\(el\)/g) || [];
  assert.equal(captured.length, 2);
});
