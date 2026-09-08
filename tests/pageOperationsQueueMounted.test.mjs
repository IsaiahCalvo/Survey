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
import { buildFormFieldObject } from '../src/hooks/usePdfjsFormFieldPersistence.js';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

for (const fileKind of ['local', 'cloud']) {
  for (const unbound of [false, true]) {
    test(`${fileKind} copied form ${unbound ? 'rejects unmatched state before persistence' : 'queues bytes and matching native field identities together'}`, async t => {
      const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
      const restores = [];
      for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
        HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
        const before = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, value });
        restores.push(() => before ? Object.defineProperty(globalThis, key, before) : delete globalThis[key]);
      }
      const { usePageOperations, cleanup } = await loadUsePageOperations();
      const pdf = await PDFDocument.create();
      const field = pdf.getForm().createTextField('original');
      field.setText('embedded');
      field.addToPage(pdf.addPage([200, 200]), { x: 10, y: 10, width: 100, height: 20 });
      const ref = field.acroField.Kids().get(0);
      const sourceFieldId = `${ref.objectNumber}R${ref.generationNumber || ''}`;
      const file = new File([await pdf.save()], 'copied-form.pdf', { type: 'application/pdf' });
      Object.assign(file, fileKind === 'local'
        ? { storageMode: 'local', localId: `local:${crypto.randomUUID()}`, localRevision: 1 }
        : { storageMode: 'cloud', id: crypto.randomUUID(), user_id: crypto.randomUUID() });
      const state = { annotationsByPage: { 1: { objects: [buildFormFieldObject(1, {
        fieldId: unbound ? '99999R' : sourceFieldId, fieldName: 'original', fieldType: 'Tx', value: 'latest unsaved PDF value',
      }, 'original-author', 'editor')] } } };
      const before = structuredClone(state);
      const persisted = [], committed = [];
      let api;
      function Harness() {
        api = usePageOperations({ pdfFile: file, getPageState: () => state,
          onUpdatePDFFile: async (nextFile, nextState) => persisted.push({ file: nextFile, state: nextState }),
          commitPageState: next => committed.push(next),
          setPageNames() {}, setPageTransformations() {}, setClipboardPage() {}, setClipboardType() {},
        });
        return null;
      }
      const root = createRoot(document.getElementById('root'));
      t.after(async () => {
        await act(async () => root.unmount()); await cleanup(); dom.window.close();
        restores.reverse().forEach(restore => restore());
      });
      await act(async () => root.render(React.createElement(Harness)));
      let outcomes;
      await act(async () => {
        outcomes = await Promise.all([
          api.handleDuplicatePage(1),
          ...(unbound ? [] : [api.handleDuplicatePage(2)]),
        ]);
      });
      assert.deepEqual(state, before, 'source snapshot stays unchanged');
      if (unbound) {
        assert.deepEqual(outcomes, [false]);
        assert.equal(persisted.length, 0);
        assert.equal(committed.length, 0);
        return;
      }
      assert.deepEqual(outcomes, [true, true]);
      assert.equal(persisted.length, 2);
      for (let index = 0; index < persisted.length; index++) {
        const saved = persisted[index];
        const reopened = await PDFDocument.load(await saved.file.arrayBuffer());
        assert.equal(reopened.getPageCount(), index + 2);
        const fields = reopened.getForm().getFields();
        assert.equal(fields.length, index + 2, 'each queued copy has its own registered field');
        const carriers = Object.values(saved.state.annotationsByPage).flatMap(page => page.objects);
        assert.equal(new Set(carriers.map(object => object.data.fieldId)).size, index + 2);
        for (const carrier of carriers) {
          const native = fields.find(candidate => candidate.getName() === carrier.data.fieldName);
          assert.ok(native, 'saved state names an actual field in the same saved bytes');
          const widgetRef = native.acroField.Kids().get(0);
          assert.equal(carrier.data.fieldId, `${widgetRef.objectNumber}R${widgetRef.generationNumber || ''}`);
          assert.equal(carrier.data.id, `form-field:${carrier.pageNumber}:${carrier.data.fieldId}`);
          assert.equal(carrier.data.value, 'latest unsaved PDF value');
          assert.equal(carrier.meta.authorId, 'original-author');
        }
        assert.equal(committed[index], saved.state, 'commit uses the exact persisted graph');
      }
    });
  }
}

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

for (const editBetweenActions of [false, true]) {
  test(`queued page action ${editBetweenActions ? 'keeps edits received between actions and rejects the stale graph' : 'accepts a live view matching the prior committed graph'}`, async t => {
    const dom = new JSDOM('<div id="root"></div>');
    const restores = [];
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
      const before = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, { configurable: true, value });
      restores.push(() => before ? Object.defineProperty(globalThis, key, before) : delete globalThis[key]);
    }
    const { usePageOperations, cleanup } = await loadUsePageOperations();
    const file = await pdfFixture();
    let live = { annotationsByPage: {}, pageNames: { 1: 'A', 2: 'B', 3: 'C' } };
    const persisted = [], committed = [];
    let api;
    function Harness() {
      api = usePageOperations({ pdfFile: file, getPageState: () => live,
        onUpdatePDFFile: async (next, state) => persisted.push({ file: next, state }),
        commitPageState: state => {
          committed.push(state);
          live = structuredClone(state);
          if (editBetweenActions && committed.length === 1) {
            live.annotationsByPage[2] = { objects: [{ type: 'rect', data: { id: 'edit-between-actions' }, pageNumber: 2 }] };
          }
        }, setPageNames() {}, setPageTransformations() {}, setClipboardPage() {}, setClipboardType() {},
      });
      return null;
    }
    const root = createRoot(document.getElementById('root'));
    t.after(async () => { await act(async () => root.unmount()); await cleanup(); dom.window.close(); restores.reverse().forEach(restore => restore()); });
    await act(async () => root.render(React.createElement(Harness)));
    let outcomes;
    await act(async () => { outcomes = await Promise.all([api.handleReorderPages(1, 3), api.handleDeletePage(1)]); });
    assert.deepEqual(outcomes, [true, !editBetweenActions]);
    assert.equal(persisted.length, editBetweenActions ? 1 : 2);
    assert.equal(committed.length, persisted.length);
    if (editBetweenActions) {
      assert.equal(live.annotationsByPage[2].objects[0].data.id, 'edit-between-actions');
      assert.deepEqual(live.pageNames, { 1: 'B', 2: 'C', 3: 'A' });
      assert.deepEqual(await pageWidths(persisted[0].file), [200, 300, 100]);
    } else {
      assert.deepEqual(live.pageNames, { 1: 'C', 2: 'A' });
      assert.deepEqual(await pageWidths(persisted[1].file), [300, 100]);
    }
  });
}

for (const savedDuringRewrite of [true, false]) {
  test(`managed page action rejects ${savedDuringRewrite ? 'a newer saved revision' : 'unsaved live edits'} during byte rewrite`, async t => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true });
    const restores = [];
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
      HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
      const before = Object.getOwnPropertyDescriptor(globalThis, key);
      Object.defineProperty(globalThis, key, { configurable: true, value });
      restores.push(() => before ? Object.defineProperty(globalThis, key, before) : delete globalThis[key]);
    }
    const { usePageOperations, cleanup } = await loadUsePageOperations();
    const file = await pdfFixture();
    Object.assign(file, { localId: `local:${crypto.randomUUID()}`, storageMode: 'local', localRevision: 1 });
    file._surveyPdfId = file.localId;
    const bytes = await file.arrayBuffer();
    let enterRead, releaseRead;
    const entered = new Promise(resolve => { enterRead = resolve; });
    const released = new Promise(resolve => { releaseRead = resolve; });
    file.arrayBuffer = async () => { enterRead(); await released; return bytes; };
    let state = { annotationsByPage: {}, surveyMarkers: {}, annotations: {},
      pageNames: { 1: 'A', 2: 'B', 3: 'C' }, pageTransformations: {},
      bookmarks: [], spaces: [], regionOverlayDisabled: new Map() };
    const persisted = [], committed = [];
    let api;
    function Harness() {
      api = usePageOperations({ pdfFile: file,
        onUpdatePDFFile: async (...args) => persisted.push(args), getPageState: () => state,
        commitPageState: (...args) => committed.push(args),
        setPageNames() {}, setPageTransformations() {}, setClipboardPage() {}, setClipboardType() {},
      });
      return null;
    }
    const root = createRoot(document.getElementById('root'));
    t.after(async () => {
      releaseRead(); await act(async () => root.unmount()); await cleanup();
      dom.window.close(); restores.reverse().forEach(restore => restore());
    });
    await act(async () => root.render(React.createElement(Harness)));
    let pending;
    await act(async () => { pending = api.handleDeletePage(1); await entered; });
    state = { ...state, annotationsByPage: { 2: { objects: [{ type: 'rect', id: 'newer-edit' }] } } };
    if (savedDuringRewrite) file.localRevision = 2;
    let result;
    await act(async () => { releaseRead(); result = await pending; });
    assert.equal(result, false);
    assert.deepEqual(persisted, [], 'cannot overwrite the newer canonical state');
    assert.deepEqual(committed, [], 'cannot replace newer UI annotations with a stale remap');
    assert.equal(state.annotationsByPage[2].objects[0].id, 'newer-edit');
    assert.equal(file.localRevision, savedDuringRewrite ? 2 : 1);
  });
}

for (const fileKind of ['cloud', 'guest']) {
  for (const change of ['state', 'file', 'none']) {
    test(`${fileKind} page action ${change === 'none' ? 'persists unchanged capture' : `rejects changed ${change}`} after delayed PDF read`, async t => {
      const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
      const restores = [];
      for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
        HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
        const before = Object.getOwnPropertyDescriptor(globalThis, key);
        Object.defineProperty(globalThis, key, { configurable: true, value });
        restores.push(() => before ? Object.defineProperty(globalThis, key, before) : delete globalThis[key]);
      }
      const { usePageOperations, cleanup } = await loadUsePageOperations();
      let file = await pdfFixture();
      if (fileKind === 'cloud') Object.assign(file, {
        id: crypto.randomUUID(), user_id: crypto.randomUUID(), storageMode: 'cloud',
      });
      const original = file;
      const bytes = await file.arrayBuffer();
      let enterRead, releaseRead;
      const entered = new Promise(resolve => { enterRead = resolve; });
      const released = new Promise(resolve => { releaseRead = resolve; });
      file.arrayBuffer = async () => { enterRead(); await released; return bytes; };
      let state = { annotationsByPage: {}, surveyMarkers: {}, annotations: {},
        pageNames: { 1: 'A', 2: 'B', 3: 'C' }, pageTransformations: {},
        bookmarks: [], spaces: [], regionOverlayDisabled: new Map() };
      const persisted = [], committed = [];
      let api;
      function Harness() {
        api = usePageOperations({ pdfFile: file,
          onUpdatePDFFile: async (...args) => persisted.push(args), getPageState: () => state,
          commitPageState: (...args) => committed.push(args),
          setPageNames() {}, setPageTransformations() {}, setClipboardPage() {}, setClipboardType() {},
        });
        return null;
      }
      const root = createRoot(document.getElementById('root'));
      t.after(async () => {
        releaseRead(); await act(async () => root.unmount()); await cleanup();
        dom.window.close(); restores.reverse().forEach(restore => restore());
      });
      await act(async () => root.render(React.createElement(Harness)));
      let pending;
      await act(async () => { pending = api.handleDeletePage(1); await entered; });
      if (change === 'state') {
        state = { ...state, annotationsByPage: { 2: { objects: [{ type: 'rect', id: 'incoming-mark' }] } } };
        await act(async () => root.render(React.createElement(Harness)));
      } else if (change === 'file') {
        file = await pdfFixture();
        // A new File with the SAME document identity is still a newer byte capture.
        Object.assign(file, { id: original.id, user_id: original.user_id, storageMode: original.storageMode });
        await act(async () => root.render(React.createElement(Harness)));
      } else {
        // The local revision check must not apply to cloud/guest metadata.
        original.localRevision = 99;
      }
      let result;
      await act(async () => { releaseRead(); result = await pending; });
      assert.equal(result, change === 'none');
      if (change !== 'none') {
        assert.deepEqual(persisted, [], 'stale capture never reaches byte persistence');
        assert.deepEqual(committed, [], 'stale remap never replaces live page state');
        if (change === 'state') assert.equal(state.annotationsByPage[2].objects[0].id, 'incoming-mark');
        else assert.deepEqual(await pageWidths(file), [100, 200, 300]);
      } else {
        assert.equal(persisted.length, 1);
        assert.deepEqual(await pageWidths(persisted[0][0]), [200, 300]);
        assert.equal(committed.length, 1);
        assert.deepEqual(committed[0][0].pageNames, { 1: 'B', 2: 'C' });
        assert.equal(persisted[0][0].id, original.id);
      }
    });
  }
}

for (const fileKind of ['cloud', 'guest']) {
test(`${fileKind} rapid queued page operations chain both PDF bytes and page-addressed state`, async () => {
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
  if (fileKind === 'cloud') Object.assign(Harness.pdfFile, {
    id: crypto.randomUUID(), user_id: crypto.randomUUID(), storageMode: 'cloud',
  });

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
}
