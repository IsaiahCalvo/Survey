import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act, useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';

const require = createRequire(import.meta.url);
const hookUrl = new URL('../src/hooks/usePageOperations.js', import.meta.url);
const deferred = () => { let resolve, reject; const promise = new Promise((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; };
async function fixture(name = 'clickable-link-test.pdf') {
  const doc = await PDFDocument.create(); doc.addPage([200, 300]);
  return new File([await doc.save()], name, { type: 'application/pdf' });
}
async function pageCount(file) { return (await PDFDocument.load(await Blob.prototype.arrayBuffer.call(file))).getPageCount(); }
async function mount(t) {
  const dom = new JSDOM('<div id="root"></div>'); const original = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const state = { file: await fixture(), actor: 'actor-a', writes: [], commits: [], toasts: [], errors: [] };
  const globalKey = `__pageOperations${crypto.randomUUID()}`; globalThis[globalKey] = state;
  let source = await readFile(hookUrl, 'utf8');
  source = source.replace("import { showToast } from '../utils/toast';", `const showToast = (...args) => globalThis[${JSON.stringify(globalKey)}].toasts.push(args);`)
    .replace(/from\s+(['"])([^'"]+)\1/g, (_all, _quote, specifier) => `from ${JSON.stringify(specifier.startsWith('.') ? new URL(specifier, hookUrl).href : pathToFileURL(require.resolve(specifier)).href)}`)
    .replace("import('../utils/pdfPageMutation.js')", `import(${JSON.stringify(new URL('../src/utils/pdfPageMutation.js', import.meta.url).href)})`);
  source = `const console = {error: (...args) => globalThis[${JSON.stringify(globalKey)}].errors.push(args)};\n${source}`;
  const { usePageOperations } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  let api, setFile, edit, setActor;
  function Probe() {
    const [file, updateFile] = useState(state.file);
    const [actor, updateActor] = useState(state.actor);
    const [view, updateView] = useState({ annotationsByPage: {}, pageNames: { 1: 'Original' } });
    const viewRef = useRef(view); viewRef.current = view;
    state.file = file; state.actor = actor; state.view = view;
    setFile = updateFile; setActor = updateActor; edit = updateView;
    const getPageState = useCallback(() => viewRef.current, []);
    api = usePageOperations({ pdfFile: file, actorUserId: actor, getPageState,
      withMutation: async run => { if (state.prepare) { state.prepareEntered.resolve(); await state.prepare.promise; } return run(); },
      onUpdatePDFFile: async next => {
        // AppShell's actual guard binds the source File in the render callback.
        assert.equal(state.file, file, 'queued work must use the latest same-document callback');
        assert.equal(state.actor, actor, 'a previous actor cannot publish');
        state.writes.push({ source: file, file: next });
        if (state.holdPersist) { state.persistEntered.resolve(); await state.holdPersist.promise; }
        if (state.actor !== actor || state.file !== file) throw new Error('stale persistence result');
        flushSync(() => updateFile(next));
        return next;
      },
      commitPageState: next => { state.commits.push(next); viewRef.current = next; updateView(next); },
      setPageNames() {}, setPageTransformations() {}, setClipboardPage() {}, setClipboardType() {},
    });
    return null;
  }
  const root = createRoot(document.getElementById('root')); let unmounted = false;
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()); } };
  await act(async () => root.render(React.createElement(Probe)));
  t.after(async () => {
    state.holdPersist?.resolve(); await unmount(); dom.window.close(); delete globalThis[globalKey];
    for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  return { state, api: () => api, unmount,
    edit: async next => act(async () => edit(next)),
    actor: async value => act(async () => setActor(value)),
    file: async value => act(async () => setFile(value)),
  };
}

test('second page action uses the live hydrated graph after persistence flushSync already rendered the first File', async t => {
  const h = await mount(t);
  await act(async () => assert.equal(await h.api().handleDuplicatePage(1), true));
  assert.equal(await pageCount(h.state.file), 2);
  // PDF reload/form/native hydration changes live state after the first commit.
  await h.edit(previous => ({ ...previous, annotationsByPage: { 1: { objects: [
    { type: 'rect', pageNumber: 1, data: { id: 'hydrated-or-new-mark' }, left: 10, top: 20, width: 30, height: 40 },
  ] } } }));
  await act(async () => assert.equal(await h.api().handleDuplicatePage(1), true));
  assert.equal(await pageCount(h.state.file), 3); assert.equal(h.state.writes.length, 2);
  assert.equal(h.state.view.annotationsByPage[1].objects[0].data.id, 'hydrated-or-new-mark');
  assert.equal(h.state.view.annotationsByPage[2].objects.length, 1, 'second action remaps the current graph');
  assert.deepEqual(h.state.toasts, []);
});

test('two queued page actions use each newly rendered source callback and grow one PDF from one to three pages', async t => {
  const h = await mount(t); const firstApi = h.api(); let result;
  await act(async () => { result = await Promise.all([firstApi.handleDuplicatePage(1), firstApi.handleDuplicatePage(2)]); });
  assert.deepEqual(result, [true, true]); assert.equal(await pageCount(h.state.file), 3);
  assert.equal(h.state.writes[1].source, h.state.writes[0].file); assert.equal(h.state.commits.length, 2);
});

for (const change of ['edit', 'file', 'actor-aba', 'unmount']) test(`${change} during delayed byte work cannot overwrite current state or transplant queued work`, async t => {
  const h = await mount(t); const source = h.state.file;
  const bytes = await source.arrayBuffer(); const entered = deferred(), release = deferred();
  source.arrayBuffer = async () => { entered.resolve(); await release.promise; return bytes; };
  let pending, queued;
  await act(async () => { pending = h.api().handleDuplicatePage(1); queued = h.api().handleDuplicatePage(1); await entered.promise; });
  if (change === 'edit') await h.edit(previous => ({ ...previous, pageNames: { 1: 'new edit' } }));
  if (change === 'file') await h.file(await fixture('different.pdf'));
  if (change === 'actor-aba') { await h.actor('actor-b'); await h.actor('actor-a'); }
  if (change === 'unmount') await h.unmount();
  let results;
  await act(async () => { release.resolve(); results = await Promise.all([pending, queued]); });
  assert.equal(results[0], false);
  if (change === 'edit') {
    assert.equal(results[1], true, 'later action may capture the new edit afresh after the rejected old action');
    assert.equal(h.state.view.pageNames[1], 'new edit');
  } else {
    assert.deepEqual(results, [false, false]); assert.deepEqual(h.state.writes, []); assert.deepEqual(h.state.commits, []);
  }
});

for (const change of ['file', 'actor-aba', 'unmount']) test(`${change} during persistence cannot commit old remapped state or run its queued successor`, async t => {
  const h = await mount(t); h.state.holdPersist = deferred(); h.state.persistEntered = deferred();
  let pending, queued;
  await act(async () => { pending = h.api().handleDuplicatePage(1); queued = h.api().handleDuplicatePage(1); await h.state.persistEntered.promise; });
  if (change === 'file') await h.file(await fixture('different.pdf'));
  if (change === 'actor-aba') { await h.actor('actor-b'); await h.actor('actor-a'); }
  if (change === 'unmount') await h.unmount();
  let results;
  await act(async () => { h.state.holdPersist.resolve(); results = await Promise.all([pending, queued]); });
  assert.deepEqual(results, [false, false]); assert.equal(h.state.writes.length, 1); assert.deepEqual(h.state.commits, []);
});

test('same-scope edits during persistence are kept and the partial-save warning does not claim rollback', async t => {
  const h = await mount(t); h.state.holdPersist = deferred(); h.state.persistEntered = deferred();
  let pending;
  await act(async () => { pending = h.api().handleDuplicatePage(1); await h.state.persistEntered.promise; });
  await h.edit(previous => ({ ...previous, pageNames: { 1: 'new edit while saving' } }));
  await act(async () => { h.state.holdPersist.resolve(); assert.equal(await pending, false); });
  assert.equal(h.state.view.pageNames[1], 'new edit while saving'); assert.deepEqual(h.state.commits, []);
  assert.equal(await pageCount(h.state.file), 2, 'persistence cannot be rolled back by the hook');
  assert.match(h.state.toasts[0][0], /PDF bytes may have saved/);
});

test('a retired preparation rejection produces no stale toast or write', async t => {
  const h = await mount(t); h.state.prepare = deferred(); h.state.prepareEntered = deferred();
  let pending;
  await act(async () => { pending = h.api().handleDuplicatePage(1); await h.state.prepareEntered.promise; });
  await h.actor('actor-b'); await h.actor('actor-a');
  await act(async () => { h.state.prepare.reject(new Error('old permission check failed')); assert.equal(await pending, false); });
  assert.deepEqual(h.state.writes, []); assert.deepEqual(h.state.toasts, []);
});
