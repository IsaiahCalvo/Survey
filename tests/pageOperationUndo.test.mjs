// Owner 2026-10-07 (like Drawboard): Ctrl+Z takes back a page delete, turn,
// duplicate, move, paste or blank page, and Ctrl+Shift+Z does it again. The
// Undo runs the change's inverse through the same page-operation path
// (instant page view + page state remap + one background PDF rewrite).
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { JSDOM } from 'jsdom';
import { PDFDocument, degrees } from 'pdf-lib';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

import { inversePageOperation, pageOperationCheckpoint, pageOperationStepId } from '../src/utils/pageOperationHistory.js';
import { applyPageViewOperation } from '../src/utils/pageViewDocument.js';
import { transformPageState } from '../src/utils/pageAnnotationReindex.js';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

// ---- pure: the inverse of each operation ------------------------------------

test('each page change has the inverse that takes it back', () => {
  assert.deepEqual(inversePageOperation({ type: 'rotate', page: 2, delta: 90 }, { pageTransformBefore: null }), {
    pdfOperation: { type: 'rotate', page: 2, delta: -90 },
    stateOperation: { type: 'rotate', page: 2, delta: -90, pageTransformation: null },
  });
  assert.deepEqual(inversePageOperation({ type: 'move', from: 1, to: 3 }).pdfOperation, { type: 'move', from: 3, to: 1 });
  assert.deepEqual(inversePageOperation({ type: 'insert', afterPage: 0 }).pdfOperation, { type: 'delete', page: 1 });
  assert.deepEqual(inversePageOperation({ type: 'duplicate', page: 2 }).pdfOperation, { type: 'delete', page: 3 });
  assert.deepEqual(inversePageOperation({ type: 'copy', source: 3, afterPage: 1 }).pdfOperation, { type: 'delete', page: 2 });
  const entry = { src: 2, rot: 90, blank: null };
  const before = { annotationsByPage: {} };
  assert.deepEqual(inversePageOperation({ type: 'delete', page: 2 }, { deletedEntry: entry, stateBefore: before }), {
    pdfOperation: { type: 'restore', afterPage: 1, entry },
    stateOperation: { type: 'restore', afterPage: 1, from: before, fromPage: 2 },
  });
  assert.equal(inversePageOperation({ type: 'delete', page: 2 }), null, 'a delete without its page cannot be undone');
});

test('a page step is one legacy-lane checkpoint the timeline can find', () => {
  const { state, meta } = pageOperationCheckpoint(7, { type: 'delete', page: 2 }, 41, new Date(0));
  assert.deepEqual(state, { pageOperationStep: 7 });
  assert.equal(meta.checkpointId, 41);
  assert.equal(meta.reason, 'page:delete');
  assert.equal(pageOperationStepId(meta), 7);
  assert.equal(pageOperationStepId({ reason: 'annotations:save' }), null);
});

const pageModel = () => ({
  annotationsByPage: {
    1: { objects: [{ type: 'path', data: { id: 'a1', pageNumber: 1 } }] },
    2: { objects: [{ type: 'path', data: { id: 'b1', pageNumber: 2 } }, { type: 'rect', data: { id: 'b2', pageNumber: 2 } }] },
    3: { objects: [{ type: 'path', data: { id: 'c1', pageNumber: 3 } }] },
  },
  surveyMarkers: { m2: { id: 'm2', pageNumber: 2 }, m3: { id: 'm3', pageNumber: 3 } },
  annotations: {},
  pageNames: { 1: 'A', 2: 'B', 3: 'C' },
  pageTransformations: { 2: { rotation: 0, mirrorH: true } },
  bookmarks: [{ id: 'bk', pageIds: [2, 3], pageNumber: 2 }],
  spaces: [{ id: 's1', assignedPages: [{ pageId: 2, regions: [{ regionId: 'r1', pageId: 2 }] }, { pageId: 3 }] }],
  regionOverlayDisabled: new Map([['r1-2', true]]),
});

const plain = (state) => JSON.parse(JSON.stringify({ ...state, regionOverlayDisabled: [...(state.regionOverlayDisabled || new Map())] }));

test('the state goes back exactly: marks on moved / deleted pages return with their ids', () => {
  for (const operation of [
    { type: 'move', from: 1, to: 3 },
    { type: 'move', from: 3, to: 1 },
    { type: 'insert', afterPage: 0 },
    { type: 'insert', afterPage: 2 },
    { type: 'duplicate', page: 2 },
    { type: 'copy', source: 2, afterPage: 0 },
    { type: 'delete', page: 2 },
    { type: 'delete', page: 1 },
    { type: 'rotate', page: 2, delta: 90 },
  ]) {
    const before = pageModel();
    const after = transformPageState(before, operation);
    const inverse = inversePageOperation(operation, {
      stateBefore: before,
      deletedEntry: { src: operation.page, rot: 0 },
      pageTransformBefore: before.pageTransformations[operation.page] ?? null,
    });
    const back = transformPageState(after, inverse.stateOperation);
    assert.deepEqual(plain(back), plain(before), JSON.stringify(operation));
  }
});

// ---- mounted: the hook's Undo / Redo writes the same bytes as before -------

async function loadUsePageOperations() {
  const hookPath = path.join(repoRoot, 'src/hooks/usePageOperations.js');
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const moduleUrl = (relativePath) => pathToFileURL(path.join(repoRoot, relativePath)).href;
  let source = await readFile(hookPath, 'utf8');
  source = source
    .replace("import { useCallback, useEffect, useMemo, useRef } from 'react';", `import { useCallback, useEffect, useMemo, useRef } from ${JSON.stringify(reactUrl)};`)
    .replace("import { showToast } from '../utils/toast';", 'const showToast = () => {};')
    .replace(/from '\.\.\/utils\/([A-Za-z0-9_]+\.js)';/g, (_m, file) => `from ${JSON.stringify(moduleUrl(`src/utils/${file}`))};`);
  const tempDir = await mkdtemp(path.join(tmpdir(), 'page-undo-test-'));
  const modulePath = path.join(tempDir, 'usePageOperations.mjs');
  await writeFile(modulePath, source);
  return {
    usePageOperations: (await import(pathToFileURL(modulePath).href)).usePageOperations,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

const SIZES = [[100, 200, 0], [200, 300, 90], [300, 400, 0]];

async function pdfFixture() {
  const pdf = await PDFDocument.create();
  SIZES.forEach(([w, h, r]) => pdf.addPage([w, h]).setRotation(degrees(r)));
  return new File([await pdf.save()], 'undo.pdf', { type: 'application/pdf' });
}

function fakeBase() {
  const pages = SIZES.map(([w, h, rotate], i) => ({
    pageNumber: i + 1,
    rotate,
    view: [0, 0, w, h],
    userUnit: 1,
    getViewport({ scale = 1, rotation = rotate } = {}) {
      const turned = ((rotation % 360) + 360) % 360 % 180 !== 0;
      return { width: (turned ? h : w) * scale, height: (turned ? w : h) * scale, rotation };
    },
  }));
  return {
    doc: { numPages: 3, fingerprints: ['fp', null], getPage: async (n) => pages[n - 1], getPageIndex: async () => 0 },
    pagesByNumber: { 1: pages[0], 2: pages[1], 3: pages[2] },
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
  const h = {
    persisted: [],
    steps: [],
    view: doc,
    state: pageModel(),
  };
  function Harness() {
    h.api = usePageOperations({
      pdfFile: Harness.pdfFile,
      onUpdatePDFFile: async (file) => { h.persisted.push(file); },
      getPageState: () => h.state,
      commitPageState: (next, operation, step) => { h.state = next; if (step) h.steps.push(step); },
      applyPageView: (operation) => {
        const before = h.view;
        h.view = applyPageViewOperation(h.view, operation, { pagesByNumber });
        return before;
      },
      restorePageView: (view) => { h.view = view; },
      setPageNames: () => {},
      setPageTransformations: () => {},
      clipboardPage: null,
      setClipboardPage: () => {},
      clipboardType: null,
      setClipboardType: () => {},
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

test('Undo of every page change restores pages (bytes and view) and marks; Redo re-applies', async () => {
  const teardownDom = setupDom();
  try {
    const cases = [
      ['delete', (api) => api.handleDeletePage(2)],
      ['delete first', (api) => api.handleDeletePage(1)],
      ['rotate', (api) => api.handleRotatePage(2, -90)],
      ['duplicate', (api) => api.handleDuplicatePage(2)],
      ['move', (api) => api.handleReorderPages(1, 3)],
      ['paste copy above', (api) => api.handlePastePage(1, 3, 'copy', 'above')],
      ['paste cut below', (api) => api.handlePastePage(3, 1, 'cut', 'below')],
      ['blank at top', (api) => api.handleInsertBlankPage(0)],
      ['blank after turned page', (api) => api.handleInsertBlankPage(2)],
    ];
    for (const [label, run] of cases) {
      const h = await mount();
      try {
        const originalBytes = await bytesSignature(h.original);
        const originalView = await viewSignature(h.view);
        const originalState = plain(h.state);
        await act(async () => { await run(h.api); await h.api.flushPageOperations(); });
        const changedBytes = await bytesSignature(h.persisted.at(-1));
        const changedView = await viewSignature(h.view);
        const changedState = plain(h.state);
        assert.notDeepEqual(changedBytes, originalBytes, `${label}: the change happened`);
        assert.deepEqual(changedView, changedBytes, `${label}: view = bytes`);
        const step = h.steps.at(-1);
        assert.equal(step.phase, 'do', label);

        await act(async () => { assert.equal(h.api.undoPageOperation(step.id), true); await h.api.flushPageOperations(); });
        assert.deepEqual(await bytesSignature(h.persisted.at(-1)), originalBytes, `${label}: undo bytes`);
        assert.deepEqual(await viewSignature(h.view), originalView, `${label}: undo view`);
        assert.deepEqual(plain(h.state), originalState, `${label}: undo marks / names / spaces`);
        assert.equal(h.steps.at(-1).phase, 'undo');

        await act(async () => { assert.equal(h.api.redoPageOperation(step.id), true); await h.api.flushPageOperations(); });
        assert.deepEqual(await bytesSignature(h.persisted.at(-1)), changedBytes, `${label}: redo bytes`);
        assert.deepEqual(await viewSignature(h.view), changedView, `${label}: redo view`);
        assert.deepEqual(plain(h.state), changedState, `${label}: redo state (same ids)`);
        // One upload per press, never a storm.
        assert.equal(h.persisted.length, 3, `${label}: uploads`);
      } finally {
        await h.teardown();
      }
    }
  } finally {
    teardownDom();
  }
});

test('a step of another document version is refused (cannot be undone)', async () => {
  const teardownDom = setupDom();
  const h = await mount();
  try {
    assert.equal(h.api.undoPageOperation(999), false);
    assert.equal(h.api.redoPageOperation(999), false);
  } finally {
    await h.teardown();
    teardownDom();
  }
});
