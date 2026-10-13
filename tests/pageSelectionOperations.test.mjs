// Owner 2026-10-07: "Pages should also have a select feature so that you can
// copy multiple, delete multiple, rearrange multiple, and drag multiple."
// A change to several pages is ONE batch (one view swap, one commit) and ONE
// Undo step that puts every page, mark and byte back.
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import {
  batchOperation,
  copyPagesAfter,
  deletePages,
  duplicatePages,
  movePagesNextTo,
  movePagesToIndex,
  movesForOrder,
  rotatePages,
} from '../src/utils/pageSelectionOperations.js';
import { inversePageOperationSteps } from '../src/utils/pageOperationHistory.js';
import { applyPageViewOperation, pageViewEntry } from '../src/utils/pageViewDocument.js';
import { pageCountChange, pageNumberAfterOperation, transformPageState } from '../src/utils/pageAnnotationReindex.js';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// Apply single-page ops to a plain list (what the page order becomes).
function applyToList(list, operations) {
  const out = [...list];
  for (const op of operations) {
    if (op.type === 'move') { const [x] = out.splice(op.from - 1, 1); out.splice(op.to - 1, 0, x); }
    else if (op.type === 'delete') out.splice(op.page - 1, 1);
    else if (op.type === 'duplicate') out.splice(op.page, 0, `${out[op.page - 1]}'`);
    else if (op.type === 'copy') out.splice(op.afterPage, 0, `${out[op.source - 1]}'`);
    else if (op.type === 'rotate') out[op.page - 1] = `${out[op.page - 1]}@${op.delta}`;
  }
  return out;
}

const range = (n) => Array.from({ length: n }, (_, i) => i + 1);

test('movesForOrder reaches any order, moving only the pages that must move', () => {
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  for (let trial = 0; trial < 300; trial += 1) {
    const n = 1 + Math.floor(rand() * 12);
    const order = range(n);
    for (let i = n - 1; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const moves = movesForOrder(order);
    assert.deepEqual(applyToList(range(n), moves), order, `order ${order}`);
    assert.ok(moves.length < Math.max(1, n), 'never more moves than pages');
  }
  assert.deepEqual(movesForOrder([1, 2, 3]), [], 'already in order: nothing');
});

test('a block of pages moves as one block, in its own order', () => {
  // 1..8, pages 2, 5, 6 dropped after page 7 (index 4 of the 5 that stay).
  const plan = movePagesToIndex(8, [6, 2, 5], 4);
  assert.deepEqual(plan.order, [1, 3, 4, 7, 2, 5, 6, 8]);
  assert.deepEqual(applyToList(range(8), plan.operations), plan.order);
  assert.deepEqual(plan.selection, [5, 6, 7]);
  assert.ok(plan.operations.length <= 3, 'at most one move per lifted page');
  // To the very start / end.
  assert.deepEqual(movePagesToIndex(5, [4, 5], 0).order, [4, 5, 1, 2, 3]);
  assert.deepEqual(movePagesToIndex(5, [1, 2], 3).order, [3, 4, 5, 1, 2]);
  // Cut + paste below / above a page.
  assert.deepEqual(movePagesNextTo(6, [1, 2], 5, 'below').order, [3, 4, 5, 1, 2, 6]);
  assert.deepEqual(movePagesNextTo(6, [5, 6], 2, 'above').order, [1, 5, 6, 2, 3, 4]);
  assert.deepEqual(movePagesNextTo(6, [2, 4], 4, 'below').order, [1, 3, 2, 4, 5, 6], 'anchor inside the block');
});

test('copy, duplicate, delete and turn of several pages', () => {
  const copy = copyPagesAfter(5, [2, 4], 0);
  assert.deepEqual(applyToList(range(5), copy.operations), ["2'", "4'", 1, 2, 3, 4, 5]);
  assert.deepEqual(copy.selection, [1, 2]);
  const copyBelow = copyPagesAfter(5, [1, 5], 3);
  assert.deepEqual(applyToList(range(5), copyBelow.operations), [1, 2, 3, "1'", "5'", 4, 5]);
  assert.deepEqual(copyBelow.selection, [4, 5]);
  const dup = duplicatePages(5, [2, 3, 5]);
  assert.deepEqual(applyToList(range(5), dup.operations), [1, 2, "2'", 3, "3'", 4, 5, "5'"]);
  assert.deepEqual(dup.selection, [3, 5, 8]);
  const del = deletePages(5, [2, 4, 5]);
  assert.deepEqual(applyToList(range(5), del.operations), [1, 3]);
  assert.deepEqual(del.selection, [2]);
  assert.deepEqual(deletePages(3, [1, 2, 3]).operations, [], 'never every page');
  assert.deepEqual(applyToList(range(3), rotatePages(3, [3, 1], -90).operations), ['1@-90', 2, '3@-90']);
  assert.equal(batchOperation([]), null);
  assert.deepEqual(batchOperation([{ type: 'delete', page: 1 }]), { type: 'delete', page: 1 });
});

const pageModel = () => ({
  annotationsByPage: Object.fromEntries(range(5).map((n) => [n, { objects: [{ type: 'path', data: { id: `m${n}`, pageNumber: n } }] }])),
  surveyMarkers: { s2: { id: 's2', pageNumber: 2 }, s4: { id: 's4', pageNumber: 4 } },
  annotations: {},
  pageNames: { 1: 'A', 2: 'B', 3: 'C', 4: 'D', 5: 'E' },
  pageTransformations: { 3: { rotation: 90, mirrorH: true } },
  bookmarks: [{ id: 'bk', pageIds: [2, 4], pageNumber: 4 }],
  spaces: [{ id: 'sp', assignedPages: [{ pageId: 2 }, { pageId: 5 }] }],
  regionOverlayDisabled: new Map(),
});
const plain = (state) => JSON.parse(JSON.stringify({ ...state, regionOverlayDisabled: [...(state.regionOverlayDisabled || new Map())] }));

test('a batch remaps the state like its steps, and its inverse puts it back exactly', () => {
  const plans = [
    deletePages(5, [2, 4]),
    movePagesToIndex(5, [1, 3], 3),
    duplicatePages(5, [2, 5]),
    copyPagesAfter(5, [4, 5], 0),
    rotatePages(5, [1, 3], 90),
  ];
  for (const plan of plans) {
    const before = pageModel();
    const batch = batchOperation(plan.operations);
    let a = 0; let b = 0;
    const idsA = () => `copy-${a++}`;
    const idsB = () => `copy-${b++}`;
    // Walk the steps as the hook does, keeping each step's context.
    let state = before;
    let view = { numPages: 5, fingerprints: ['fp'], getPage: async () => ({}) };
    const steps = [];
    for (const op of batch.operations || [batch]) {
      const context = { stateBefore: state, pageTransformBefore: state.pageTransformations?.[op.page] ?? null };
      if (op.type === 'delete') context.deletedEntry = pageViewEntry(view, op.page);
      steps.push({ pdfOperation: op, context });
      state = transformPageState(state, op, { createId: idsA });
      view = applyPageViewOperation(view, op);
    }
    assert.deepEqual(plain(transformPageState(before, batch, { createId: idsB })), plain(state), 'batch = its steps');
    const inverse = inversePageOperationSteps(steps);
    assert.deepEqual(plain(transformPageState(state, inverse.stateOperation)), plain(before), JSON.stringify(batch));
    assert.equal(pageCountChange(batch) + 5, view.numPages);
  }
  // The current page follows its page through a batch.
  assert.equal(pageNumberAfterOperation(5, batchOperation(movePagesToIndex(5, [5], 0).operations), 5), 1);
  assert.equal(pageNumberAfterOperation(3, batchOperation(deletePages(5, [1, 2]).operations), 3), 1);
});

// ---- mounted: the hook runs a selection as ONE step with exact Undo/Redo ---

async function loadUsePageOperations() {
  const hookPath = path.join(repoRoot, 'src/hooks/usePageOperations.js');
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const moduleUrl = (relativePath) => pathToFileURL(path.join(repoRoot, relativePath)).href;
  let source = await readFile(hookPath, 'utf8');
  source = source
    .replace("import { useCallback, useEffect, useMemo, useRef } from 'react';", `import { useCallback, useEffect, useMemo, useRef } from ${JSON.stringify(reactUrl)};`)
    .replace("import { showToast } from '../utils/toast';", 'const showToast = () => {};')
    .replace(/from '\.\.\/utils\/([A-Za-z0-9_]+\.js)';/g, (_m, file) => `from ${JSON.stringify(moduleUrl(`src/utils/${file}`))};`);
  const tempDir = await mkdtemp(path.join(tmpdir(), 'page-multi-test-'));
  const modulePath = path.join(tempDir, 'usePageOperations.mjs');
  await writeFile(modulePath, source);
  return {
    usePageOperations: (await import(pathToFileURL(modulePath).href)).usePageOperations,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

const SIZES = [[100, 100], [110, 120], [120, 140], [130, 160], [140, 180]];

async function pdfFixture() {
  const pdf = await PDFDocument.create();
  SIZES.forEach(([w, h]) => pdf.addPage([w, h]));
  return new File([await pdf.save()], 'multi.pdf', { type: 'application/pdf' });
}

function fakeBase() {
  const pages = SIZES.map(([w, h], i) => ({
    pageNumber: i + 1,
    rotate: 0,
    view: [0, 0, w, h],
    userUnit: 1,
    getViewport({ scale = 1, rotation = 0 } = {}) {
      const turned = ((rotation % 360) + 360) % 360 % 180 !== 0;
      return { width: (turned ? h : w) * scale, height: (turned ? w : h) * scale, rotation };
    },
  }));
  return {
    doc: { numPages: SIZES.length, fingerprints: ['fp', null], getPage: async (n) => pages[n - 1], getPageIndex: async () => 0 },
    pagesByNumber: Object.fromEntries(pages.map((page) => [page.pageNumber, page])),
  };
}

async function bytesSignature(file) {
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  return pdf.getPages().map((page) => `${page.getWidth()}x${page.getHeight()}@${page.getRotation().angle}`);
}

async function viewSignature(view) {
  const out = [];
  for (let n = 1; n <= view.numPages; n += 1) {
    const page = await view.getPage(n);
    out.push(`${page.view[2]}x${page.view[3]}@${((page.rotate % 360) + 360) % 360}`);
  }
  return out;
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return () => {
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  };
}

async function mount() {
  const { usePageOperations, cleanup } = await loadUsePageOperations();
  const root = createRoot(document.getElementById('root'));
  const { doc, pagesByNumber } = fakeBase();
  const h = { persisted: [], steps: [], commits: 0, view: doc, state: pageModel(), clipboard: null, clipboardType: null };
  function Harness() {
    h.api = usePageOperations({
      pdfFile: Harness.pdfFile,
      onUpdatePDFFile: async (file) => { h.persisted.push(file); },
      getPageState: () => h.state,
      commitPageState: (next, operation, step) => { h.state = next; h.commits += 1; h.lastOperation = operation; if (step) h.steps.push(step); },
      applyPageView: (operation) => {
        const before = h.view;
        h.view = applyPageViewOperation(h.view, operation, { pagesByNumber });
        return before;
      },
      restorePageView: (view) => { h.view = view; },
      setPageNames: () => {},
      setPageTransformations: () => {},
      clipboardPage: h.clipboard,
      setClipboardPage: (value) => { h.clipboard = value; },
      clipboardType: h.clipboardType,
      setClipboardType: (value) => { h.clipboardType = value; },
      flushDelayMs: 1,
    });
    return null;
  }
  Harness.pdfFile = await pdfFixture();
  h.original = Harness.pdfFile;
  await act(async () => root.render(React.createElement(Harness)));
  h.teardown = async () => { await act(async () => root.unmount()); await cleanup(); };
  return h;
}

test('every action on a selection is one step; Undo restores pages, bytes and marks exactly; Redo re-applies', async () => {
  const teardownDom = setupDom();
  try {
    const cases = [
      ['delete 2 + 4', (api) => api.handleDeletePage([2, 4]), [2]],
      ['delete 1-4', (api) => api.handleDeletePage([1, 2, 3, 4]), [1]],
      ['rotate 1 + 3 left', (api) => api.handleRotatePage([1, 3], -90), [1, 3]],
      ['duplicate 2 + 3', (api) => api.handleDuplicatePage([2, 3]), [3, 5]],
      ['drag first two to the end', (api) => api.handleReorderPages([1, 2], { index: 3, pageCount: 5 }), [4, 5]],
      ['drag last two to the start', (api) => api.handleReorderPages([4, 5], { index: 0, pageCount: 5 }), [1, 2]],
      ['drag 1, 3, 5 into the middle', (api) => api.handleReorderPages([1, 3, 5], { index: 1, pageCount: 5 }), [2, 3, 4]],
      ['paste copies of 2 + 4 above 1', (api) => api.handlePastePage(1, [2, 4], 'copy', 'above'), [1, 2]],
      ['paste cut 1 + 2 below 5', (api) => api.handlePastePage(5, [1, 2], 'cut', 'below'), [4, 5]],
    ];
    for (const [label, run, selection] of cases) {
      const h = await mount();
      try {
        const originalBytes = await bytesSignature(h.original);
        const originalView = await viewSignature(h.view);
        const originalState = plain(h.state);
        let result;
        await act(async () => { result = await run(h.api); await h.api.flushPageOperations(); });
        assert.deepEqual(result, selection, `${label}: the new selection`);
        assert.equal(h.commits, 1, `${label}: one commit`);
        assert.equal(h.steps.length, 1, `${label}: one Undo step`);
        const changedBytes = await bytesSignature(h.persisted.at(-1));
        const changedView = await viewSignature(h.view);
        const changedState = plain(h.state);
        assert.notDeepEqual(changedBytes, originalBytes, `${label}: the change happened`);
        assert.deepEqual(changedView, changedBytes, `${label}: view = bytes`);
        const step = h.steps[0];

        await act(async () => { assert.equal(h.api.undoPageOperation(step.id), true); await h.api.flushPageOperations(); });
        assert.deepEqual(await bytesSignature(h.persisted.at(-1)), originalBytes, `${label}: undo bytes`);
        assert.deepEqual(await viewSignature(h.view), originalView, `${label}: undo view`);
        assert.deepEqual(plain(h.state), originalState, `${label}: undo marks / names / spaces`);

        await act(async () => { assert.equal(h.api.redoPageOperation(step.id), true); await h.api.flushPageOperations(); });
        assert.deepEqual(await bytesSignature(h.persisted.at(-1)), changedBytes, `${label}: redo bytes`);
        assert.deepEqual(await viewSignature(h.view), changedView, `${label}: redo view`);
        assert.deepEqual(plain(h.state), changedState, `${label}: redo state (same ids)`);
        assert.equal(h.persisted.length, 3, `${label}: one upload per press`);
      } finally {
        await h.teardown();
      }
    }
  } finally {
    teardownDom();
  }
});

test('copy / cut of a selection puts the pages on the clipboard', async () => {
  const teardownDom = setupDom();
  const h = await mount();
  try {
    await act(async () => { h.api.handleCopyPage([4, 2, 2]); });
    assert.deepEqual(h.clipboard, [2, 4]);
    assert.equal(h.clipboardType, 'copy');
    await act(async () => { h.api.handleCutPage([3]); });
    assert.equal(h.clipboard, 3, 'one page stays a plain number');
    assert.equal(h.clipboardType, 'cut');
  } finally {
    await h.teardown();
    teardownDom();
  }
});
