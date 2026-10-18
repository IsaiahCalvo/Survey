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

async function mountHarness({ persist, sourceFile = null, readPdfBytes }) {
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
      readPdfBytes,
      onUpdatePDFFile: Harness.persist,
      // Deliberately stale until React re-renders: the hook must chain the
      // committed state internally just as it already chains the PDF File.
      getPageState: () => getter.current,
      commitPageState: Harness.commit,
      applyPageView: (operation) => { views.push(operation); return `view-before-${views.length}`; },
      restorePageView: Harness.restore,
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
  Harness.pdfFile = sourceFile || await pdfFixture();
  Harness.persist = persist;
  Harness.commit = (next, operation, step) => committed.push({ state: next, operation, step });
  Harness.restore = (view) => restored.push(view);
  await act(async () => root.render(React.createElement(Harness)));
  return {
    get api() { return api; },
    committed,
    views,
    restored,
    state,
    getter,
    renderFile: async (file, persistCallback = Harness.persist, callbacks = {}) => { Harness.pdfFile = file; Harness.persist = persistCallback; Harness.commit = callbacks.commit || Harness.commit; Harness.restore = callbacks.restore || Harness.restore; await act(async () => root.render(React.createElement(Harness))); },
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


test('cloud descriptor Cut/Paste saves reordered bytes and preserves document metadata', async()=>{
  const teardownDom=setupDom(),original=await pdfFixture(),bytes=await original.arrayBuffer(),persisted=[],reads=[];
  const descriptor={id:'cloud-document',name:'cloud.pdf',size:bytes.byteLength,filePath:'synthetic-owner/cloud.pdf',supabaseFilePath:'synthetic-owner/cloud.pdf',projectId:'project',user_id:'owner',contentSha256:'original-sha',_surveyPdfId:'stable-cloud-id'};
  const harness=await mountHarness({sourceFile:descriptor,readPdfBytes:async(file)=>{reads.push(file);return new Blob([bytes]);},persist:async(file)=>{persisted.push(file);}});
  try {
    await act(async()=>{harness.api.handleCutPage(1);assert.equal(await harness.api.handlePastePage(3,1,'cut'),true);await harness.api.flushPageOperations();});
    assert.equal(persisted.length,1);assert.deepEqual(await pageWidths(persisted[0]),[200,300,100]);assert.deepEqual(harness.restored,[]);
    for(const key of ['id','projectId','user_id','filePath','supabaseFilePath','contentSha256','_surveyPdfId'])assert.equal(persisted[0][key],descriptor[key]);
    assert.deepEqual(reads,[descriptor]);assert.deepEqual(harness.committed.at(-1).state.pageNames,{1:'B',2:'C',3:'A'});
    assert.equal(harness.committed.at(-1).state.annotationsByPage[1].objects[0].data.id,'mark-on-b');
  }finally{await harness.teardown();teardownDom();}
});


test('cloud Delete persists over the same storage path; metadata refresh and Undo retain the original deleted page',async()=>{
  const teardownDom=setupDom(),original=await pdfFixture();let stored=await original.arrayBuffer(),version=0;const persisted=[],reads=[];
  const descriptor={id:'cloud-document',name:'cloud.pdf',size:stored.byteLength,filePath:'same-object.pdf',contentSha256:'opened-sha',_surveyPdfId:'stable-cloud-id'};
  const harness=await mountHarness({sourceFile:descriptor,readPdfBytes:async file=>{reads.push(file);return stored;},persist:async file=>{stored=await file.arrayBuffer();file.contentSha256=`saved-${++version}`;persisted.push(file);}});
  try {
    await act(async()=>{await harness.api.handleDeletePage(1);await harness.api.flushPageOperations();});
    assert.deepEqual(await pageWidths(persisted[0]),[200,300]);const deleteStep=harness.committed.at(-1).step.id;
    await harness.renderFile({...descriptor,size:persisted[0].size,contentSha256:persisted[0].contentSha256});
    await act(async()=>{assert.equal(harness.api.undoPageOperation(deleteStep),true);await harness.api.flushPageOperations();});
    assert.deepEqual(await pageWidths(persisted[1]),[100,200,300]);assert.deepEqual(harness.committed.at(-1).state.pageNames,{1:'A',2:'B',3:'C'});
    assert.equal(harness.committed.at(-1).state.annotationsByPage[2].objects[0].data.id,'mark-on-b');assert.equal(reads.length,1,'never re-download the overwritten original');
    await act(async()=>{assert.equal(harness.api.redoPageOperation(deleteStep),true);await harness.api.flushPageOperations();});
    assert.deepEqual(await pageWidths(persisted[2]),[200,300]);assert.deepEqual(harness.restored,[]);
  }finally{await harness.teardown();teardownDom();}
});

test('two queued changes finish through the original tab callback while the active tab changes',async()=>{
  const teardownDom=setupDom(),original=await pdfFixture(),bytes=await original.arrayBuffer();let entered,release;const uploadEntered=new Promise(resolve=>{entered=resolve;}),uploadReleased=new Promise(resolve=>{release=resolve;});const oldWrites=[],otherWrites=[];
  const descriptor={id:'tab-a-document',name:'cloud.pdf',size:bytes.byteLength,filePath:'tab-a.pdf',contentSha256:'tab-a-sha'};
  const harness=await mountHarness({sourceFile:descriptor,readPdfBytes:async file=>{assert.equal(file.id,'tab-a-document');return bytes;},persist:async file=>{oldWrites.push(file);entered();await uploadReleased;}});
  try {
    let flushed;
    await act(async()=>{await harness.api.handlePastePage(3,1,'cut');await harness.api.handleDeletePage(2);flushed=harness.api.flushPageOperations();await uploadEntered;});
    await harness.renderFile({...descriptor},async file=>otherWrites.push(file));
    release();await act(async()=>{await flushed;});
    assert.equal(oldWrites.length,1);assert.equal(oldWrites[0].id,'tab-a-document');assert.equal(otherWrites.length,0);
    assert.deepEqual(await pageWidths(oldWrites[0]),[200,100]);assert.deepEqual(harness.committed.at(-1).state.pageNames,{1:'B',2:'A'});assert.equal(harness.committed.at(-1).state.annotationsByPage[1].objects[0].data.id,'mark-on-b');assert.deepEqual(harness.restored,[]);
  }finally{release();await harness.teardown();teardownDom();}
});

test('own metadata refresh during an upload keeps the original delete Undo step and bytes',async()=>{
  const teardownDom=setupDom(),original=await pdfFixture();let stored=await original.arrayBuffer(),entered,release;const enteredPromise=new Promise(resolve=>entered=resolve),releasedPromise=new Promise(resolve=>release=resolve),persisted=[];
  const descriptor={id:'cloud-delete',name:'cloud.pdf',size:stored.byteLength,filePath:'same-object.pdf',contentSha256:'original'};
  const harness=await mountHarness({sourceFile:descriptor,readPdfBytes:async()=>stored,persist:async file=>{stored=await file.arrayBuffer();file.contentSha256='saved-delete';persisted.push(file);if(persisted.length===1){entered();await releasedPromise;}}});
  try {
    let flushed;
    await act(async()=>{await harness.api.handleDeletePage(1);flushed=harness.api.flushPageOperations();await enteredPromise;});
    const step=harness.committed.at(-1).step.id;
    await harness.renderFile({...descriptor,size:persisted[0].size,contentSha256:'saved-delete'});
    release();await act(async()=>await flushed);
    await act(async()=>{assert.equal(harness.api.undoPageOperation(step),true);await harness.api.flushPageOperations();});
    assert.deepEqual(await pageWidths(persisted[1]),[100,200,300]);assert.deepEqual(harness.restored,[]);
  }finally{release();await harness.teardown();teardownDom();}
});


const replacementState = () => ({...initialState(),pageNames:{1:'Remote A',2:'Remote B'},annotationsByPage:{1:{objects:[{id:'remote-mark'}]}}});
async function replacementFile() {
  const pdf=await PDFDocument.create();pdf.addPage([444,600]);pdf.addPage([555,600]);
  const file=new File([await pdf.save()],'replacement.pdf',{type:'application/pdf'});file.id='same-doc';file.contentSha256='remote-version';return file;
}
for(const phase of ['read','upload','upload-error'])test(`true source replacement during ${phase} drops old queued work without overwriting or rolling back the replacement`,async()=>{
  const teardownDom=setupDom(),original=await pdfFixture(),bytes=await original.arrayBuffer();let entered,release;const enteredPromise=new Promise(resolve=>entered=resolve),releasedPromise=new Promise(resolve=>release=resolve),oldWrites=[],newWrites=[];
  const descriptor={id:'same-doc',name:'cloud.pdf',size:bytes.byteLength,filePath:'same.pdf',contentSha256:'old-version'};
  const harness=await mountHarness({sourceFile:descriptor,readPdfBytes:async()=>{if(phase==='read'){entered();await releasedPromise;}return bytes;},persist:async file=>{oldWrites.push(file);if(phase!=='read'){entered();await releasedPromise;if(phase==='upload-error')throw Error('old upload failed');}}});
  try {
    let flushed;
    await act(async()=>{await harness.api.handleDeletePage(1);flushed=harness.api.flushPageOperations();await enteredPromise;});
    const oldStep=harness.committed.at(-1).step.id,replacement=await replacementFile(),state=replacementState();harness.getter.current=state;
    await harness.renderFile(replacement,async file=>newWrites.push(file));
    let newFlushed;await act(async()=>{await harness.api.handleRotatePage(2);newFlushed=harness.api.flushPageOperations();});
    release();let current;await act(async()=>{current=await flushed;await newFlushed;});
    assert.equal(current,replacement);assert.equal(oldWrites.length,phase==='read'?0:1);assert.deepEqual(harness.restored,[]);
    assert.equal(harness.committed.length,2,'only the old and replacement gestures, no stale rollback');assert.equal(harness.api.undoPageOperation(oldStep),false);
    assert.equal(newWrites.length,1);assert.deepEqual(await pageWidths(newWrites[0]),[444,555]);
    assert.equal(harness.committed.at(-1).state.annotationsByPage[1].objects[0].id,'remote-mark');
  }finally{release();await harness.teardown();teardownDom();}
});

test('a genuine save error rolls back through its captured tab owner callbacks',async()=>{
  const teardownDom=setupDom(),original=await pdfFixture();let entered,release;const enteredPromise=new Promise(resolve=>entered=resolve),releasedPromise=new Promise(resolve=>release=resolve),otherCommits=[],otherRestores=[];
  const harness=await mountHarness({sourceFile:original,persist:async()=>{entered();await releasedPromise;throw Error('genuine offline error');}});
  try {
    let flushed;await act(async()=>{await harness.api.handleDeletePage(1);flushed=harness.api.flushPageOperations();await enteredPromise;});
    await harness.renderFile(original,async()=>{}, {commit: (...args)=>otherCommits.push(args),restore:view=>otherRestores.push(view)});
    release();await act(async()=>await flushed);
    assert.equal(harness.committed.at(-1).operation.type,'rollback');assert.deepEqual(harness.committed.at(-1).state.pageNames,harness.state.pageNames);
    assert.deepEqual(harness.restored,['view-before-1']);assert.deepEqual(otherCommits,[]);assert.deepEqual(otherRestores,[]);
  }finally{release();await harness.teardown();teardownDom();}
});
