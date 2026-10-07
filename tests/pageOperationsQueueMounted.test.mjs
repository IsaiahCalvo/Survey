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

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function loadUsePageOperations() {
  const hookPath = path.join(repoRoot, 'src/hooks/usePageOperations.js');
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const moduleUrl = (relativePath) => pathToFileURL(path.join(repoRoot, relativePath)).href;
  let source = await readFile(hookPath, 'utf8');
  source = source
    .replace(
      "import { useCallback, useEffect, useMemo, useRef } from 'react';",
      `import { useCallback, useEffect, useMemo, useRef } from ${JSON.stringify(reactUrl)};`,
    )
    .replace(
      "import { showToast } from '../utils/toast';",
      'const showToast = () => {};',
    )
    .replace(
      "from '../utils/pageMutationFile.js';",
      `from ${JSON.stringify(moduleUrl('src/utils/pageMutationFile.js'))};`,
    )
    .replace(
      "from '../utils/pageAnnotationReindex.js';",
      `from ${JSON.stringify(moduleUrl('src/utils/pageAnnotationReindex.js'))};`,
    )
    // KAL-384: pdf-lib stays out of the first-open bundle; the hook reaches
    // it through the off-thread helper (a worker in the browser, a dynamic
    // import here, where Node has no Worker). Point the relocated copy of
    // the hook at the real module, or the page op silently fails.
    .replace(
      "from '../utils/pdfPageMutationOffThread.js';",
      `from ${JSON.stringify(moduleUrl('src/utils/pdfPageMutationOffThread.js'))};`,
    )
    // Any other ../utils module the hook imports (page Undo / Redo helpers).
    .replace(/from '\.\.\/utils\/([A-Za-z0-9_]+\.js)';/g, (_m, file) => `from ${JSON.stringify(moduleUrl(`src/utils/${file}`))};`);

  const tempDir = await mkdtemp(path.join(tmpdir(), 'page-operations-queue-test-'));
  const modulePath = path.join(tempDir, 'usePageOperations.mjs');
  await writeFile(modulePath, source);
  return {
    usePageOperations: (await import(pathToFileURL(modulePath).href)).usePageOperations,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

async function pdfFixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 200]);
  pdf.addPage([200, 300]);
  pdf.addPage([300, 400]);
  const bytes = await pdf.save();
  const file = new File([bytes], 'queued.pdf', { type: 'application/pdf' });
  file._surveyPdfId = 'queued-pdf-id';
  return file;
}

async function pageWidths(file) {
  const pdf = await PDFDocument.load(await file.arrayBuffer());
  return pdf.getPages().map((page) => page.getWidth());
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
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

const initialState = () => ({
  annotationsByPage: { 2: { objects: [{ type: 'path', data: { id: 'mark-on-b', pageNumber: 2 } }] } },
  surveyMarkers: {},
  annotations: {},
  pageNames: { 1: 'A', 2: 'B', 3: 'C' },
  pageTransformations: {},
  bookmarks: [],
  spaces: [],
  regionOverlayDisabled: new Map(),
});

async function mountHarness({ persist }) {
  const { usePageOperations, cleanup } = await loadUsePageOperations();
  const root = createRoot(document.getElementById('root'));
  const committed = [];
  const views = [];
  const restored = [];
  const state = initialState();
  const getter = { current: state };
  let api;
  const setState = () => {};
  function Harness() {
    api = usePageOperations({
      pdfFile: Harness.pdfFile,
      onUpdatePDFFile: persist,
      // Deliberately stale until React re-renders: the hook must chain the
      // committed state internally just as it already chains the PDF File.
      getPageState: () => getter.current,
      commitPageState: (next, operation) => committed.push({ state: next, operation }),
      applyPageView: (operation) => { views.push(operation); return `view-before-${views.length}`; },
      restorePageView: (view) => restored.push(view),
      setPageNames: setState,
      setPageTransformations: setState,
      clipboardPage: null,
      setClipboardPage: setState,
      clipboardType: null,
      setClipboardType: setState,
      flushDelayMs: 5,
    });
    return null;
  }
  Harness.pdfFile = await pdfFixture();
  await act(async () => root.render(React.createElement(Harness)));
  return {
    get api() { return api; },
    committed,
    views,
    restored,
    state,
    getter,
    teardown: async () => {
      await act(async () => root.unmount());
      await cleanup();
    },
  };
}

// Owner 2026-10-01 (instant page operations): the page-addressed state and
// the viewer's page view change at once (optimistic); quick successive
// operations are written into the PDF bytes in ONE rewrite + upload.
test('rapid page operations show at once and coalesce into one PDF rewrite', async () => {
  const teardownDom = setupDom();
  const persisted = [];
  const harness = await mountHarness({ persist: async (file) => persisted.push(file) });
  try {
    let move;
    let remove;
    await act(async () => {
      move = harness.api.handleReorderPages(1, 3);
      remove = harness.api.handleDeletePage(1);
    });
    // Visible before any byte was written.
    assert.equal(await move, true);
    assert.equal(await remove, true);
    assert.deepEqual(harness.views, [
      { type: 'move', from: 1, to: 3 },
      { type: 'delete', page: 1 },
    ]);
    assert.deepEqual(harness.committed.map(({ state }) => state.pageNames), [
      { 1: 'B', 2: 'C', 3: 'A' },
      { 1: 'C', 2: 'A' },
    ]);

    await act(async () => { await harness.api.flushPageOperations(); });
    assert.equal(persisted.length, 1);
    assert.deepEqual(await pageWidths(persisted[0]), [300, 100]);

    // A later operation builds on the saved bytes, not the original file.
    await act(async () => {
      harness.api.handleRotatePage(2);
      await harness.api.flushPageOperations();
    });
    assert.equal(persisted.length, 2);
    const rotated = await PDFDocument.load(await persisted[1].arrayBuffer());
    assert.deepEqual(rotated.getPages().map((page) => page.getRotation().angle), [0, 90]);
    assert.deepEqual(harness.restored, []);
  } finally {
    await harness.teardown();
    teardownDom();
  }
});

test('a failed save rolls back every unsaved page operation (state and view)', async () => {
  const teardownDom = setupDom();
  const harness = await mountHarness({ persist: async () => { throw new Error('offline'); } });
  try {
    await act(async () => {
      harness.api.handleReorderPages(1, 3);
      harness.api.handleDeletePage(1);
      await harness.api.flushPageOperations();
    });
    // Back to the view and state from before the FIRST unsaved operation.
    assert.deepEqual(harness.restored, ['view-before-1']);
    const last = harness.committed.at(-1);
    assert.equal(last.operation.type, 'rollback');
    assert.deepEqual(last.state.pageNames, harness.state.pageNames);
    assert.deepEqual(last.state.annotationsByPage, harness.state.annotationsByPage);
    // Fresh objects, so the cloud capture writes the restored page numbers
    // instead of skipping marks it already saw.
    assert.notEqual(last.state.annotationsByPage[2].objects[0], harness.state.annotationsByPage[2].objects[0]);
  } finally {
    await harness.teardown();
    teardownDom();
  }
});

test('an edit made between two page operations is kept (no stale chaining)', async () => {
  const teardownDom = setupDom();
  const harness = await mountHarness({ persist: async () => {} });
  try {
    await act(async () => { harness.api.handleReorderPages(1, 3); });
    // React rendered the move, then the user renamed a page: the getter now
    // returns a newer state than the one the move produced.
    const afterMove = harness.committed.at(-1).state;
    harness.getter.current = { ...afterMove, pageNames: { ...afterMove.pageNames, 1: 'B (renamed)' } };
    await act(async () => {
      harness.api.handleRotatePage(3);
      await harness.api.flushPageOperations();
    });
    assert.equal(harness.committed.at(-1).state.pageNames[1], 'B (renamed)');
  } finally {
    await harness.teardown();
    teardownDom();
  }
});
