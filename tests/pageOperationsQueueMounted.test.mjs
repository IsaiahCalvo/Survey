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
      "import { useCallback, useMemo, useRef } from 'react';",
      `import { useCallback, useMemo, useRef } from ${JSON.stringify(reactUrl)};`,
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
    .replace(
      "from '../utils/pdfPageMutation.js';",
      `from ${JSON.stringify(moduleUrl('src/utils/pdfPageMutation.js'))};`,
    )
    // KAL-384: pdfPageMutation (and therefore pdf-lib) is now imported
    // dynamically at the call site so it stays out of the first-open bundle.
    // Rewrite the dynamic specifier too, otherwise the relocated copy of the
    // hook resolves it against the temp directory and the page op silently
    // fails.
    .replace(
      "await import('../utils/pdfPageMutation.js')",
      `await import(${JSON.stringify(moduleUrl('src/utils/pdfPageMutation.js'))})`,
    )
    .replace(
      "from '../utils/pageMutationTransaction.js';",
      `from ${JSON.stringify(moduleUrl('src/utils/pageMutationTransaction.js'))};`,
    )
    // pageContextOps landed after this harness started rewriting the temp
    // copy of the hook. Leave the specifier relative and the relocated
    // module resolves it against /tmp, not the repo.
    .replace(
      "from '../utils/pageContextOps.js';",
      `from ${JSON.stringify(moduleUrl('src/utils/pageContextOps.js'))};`,
    );

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

test('rapid queued page operations chain both PDF bytes and page-addressed state', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const { usePageOperations, cleanup } = await loadUsePageOperations();
  const root = createRoot(document.getElementById('root'));
  const persisted = [];
  const committed = [];
  const initialState = {
    annotationsByPage: {},
    surveyMarkers: {},
    annotations: {},
    pageNames: { 1: 'A', 2: 'B', 3: 'C' },
    pageTransformations: {},
    bookmarks: [],
    spaces: [],
    regionOverlayDisabled: new Map(),
  };
  let api;
  const setState = () => {};
  function Harness() {
    api = usePageOperations({
      pdfFile: Harness.pdfFile,
      onUpdatePDFFile: async (file) => persisted.push(file),
      // Deliberately stale until React re-renders: the hook must chain the
      // committed state internally just as it already chains the PDF File.
      getPageState: () => initialState,
      commitPageState: (state) => committed.push(state),
      setPageNames: setState,
      setPageTransformations: setState,
      clipboardPage: null,
      setClipboardPage: setState,
      clipboardType: null,
      setClipboardType: setState,
    });
    return null;
  }
  Harness.pdfFile = await pdfFixture();

  try {
    await act(async () => root.render(React.createElement(Harness)));
    let move;
    let remove;
    await act(async () => {
      move = api.handleReorderPages(1, 3);
      remove = api.handleDeletePage(1);
      await Promise.all([move, remove]);
    });

    assert.equal(await move, true);
    assert.equal(await remove, true);
    assert.equal(persisted.length, 2);
    assert.deepEqual(await pageWidths(persisted[0]), [200, 300, 100]);
    assert.deepEqual(await pageWidths(persisted[1]), [300, 100]);
    assert.deepEqual(committed.map((state) => state.pageNames), [
      { 1: 'B', 2: 'C', 3: 'A' },
      { 1: 'C', 2: 'A' },
    ]);
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
