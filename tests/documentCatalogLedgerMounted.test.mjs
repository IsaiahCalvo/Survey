import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
let serial = 0;
const actor = 'bb300000-0000-4000-8000-000000000001';
const creator = 'bb300000-0000-4000-8000-000000000002';
const documentId = 'bb300000-0000-4000-8000-000000000003';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function loadLedger(state) {
  const url = new URL('../src/home/DocumentsLedger.jsx', import.meta.url);
  let source = await readFile(url, 'utf8');
  source = source
    .replace("from 'react'", `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`)
    .replace("from 'react-dom'", `from ${JSON.stringify(pathToFileURL(require.resolve('react-dom')).href)}`)
    .replace("import { HubShell, Icon, Avatar, PdfThumb, Search, EmptyState } from './HubShell';",
      'const HubShell=({children})=>children; const Icon=()=>null; const Avatar=()=>null; const PdfThumb=()=>null; const Search=()=>null; const EmptyState=()=>null;')
    .replace("import { MoveCopyModal, RenameModal } from './BulkModals';",
      'const MoveCopyModal=()=>null; const RenameModal=props=>props.open?<div data-rename-name={props.initialName}/>:null;')
    .replace("import PdfPageThumb from './PdfPageThumb';", 'const PdfPageThumb=()=>null;')
    .replace("import { useStorage } from '../hooks/useDatabase';", 'const useStorage=()=>({downloadDocument:null});')
    .replace("import { closeButtonStyle, miniButtonStyle, moreButtonStyle } from './hubControls';",
      'const closeButtonStyle=()=>({}); const miniButtonStyle=()=>({}); const moreButtonStyle=()=>({});')
    .replace("import Spinner from '../components/Spinner';", 'const Spinner=()=>null;')
    .replace("import DismissBarrier from '../components/DismissBarrier';", 'const DismissBarrier=()=>null;')
    .replace("import useModalFocusTrap from './useModalFocusTrap';", 'const useModalFocusTrap=()=>{};');
  const transformed = await transformWithOxc(source, url.pathname, { lang: 'jsx' });
  const code = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  globalThis.__catalogLedgerState = state;
  const result = (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}#${++serial}`)).default;
  delete globalThis.__catalogLedgerState;
  return result;
}

async function mount(t, overrides = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://survey.test/' });
  const restore = [];
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    restore.push(() => old ? Object.defineProperty(globalThis, name, old) : delete globalThis[name]);
  }
  const state = { locks: 0, prepares: 0 };
  const Ledger = await loadLedger(state);
  const row = { id: documentId, user_id: creator, project_id: null, name: 'x'.repeat(1024),
    name_truncated: true, file_size: '9007199254740993', created_at: null,
    updated_at: '2026-09-14T00:00:00Z', locked_at: null };
  let props = { documents: [row], projects: [], user: { id: actor, name: 'Actor' },
    catalogActionsEnabled: true, onLockDocument: () => { state.locks++; },
    onPrepareRename: async value => { state.prepares++; return { ...value, name: 'Full title.pdf' }; },
    ...overrides };
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(React.createElement(Ledger, props)));
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); restore.reverse().forEach(fn => fn()); });
  const openMenu = async () => {
    const button = document.querySelector('button[aria-label="More"]');
    assert.ok(button);
    await act(async () => button.click());
  };
  const clickMenu = async label => {
    const button = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === label);
    assert.ok(button, label);
    await act(async () => button.click());
    return button;
  };
  const rerender = async next => {
    props = { ...props, ...next };
    await act(async () => root.render(React.createElement(Ledger, props)));
  };
  return { state, openMenu, clickMenu, rerender };
}

test('catalog creator mismatch does not disable the effective-owner lock action', async t => {
  const h = await mount(t);
  await h.openMenu();
  const lock = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Lock document');
  assert.equal(lock.disabled, false);
  await h.clickMenu('Lock document');
  assert.equal(h.state.locks, 1);
});

test('truncated catalog rename reads the full current name before opening the existing modal', async t => {
  const h = await mount(t);
  await h.openMenu();
  await h.clickMenu('Rename');
  assert.equal(h.state.prepares, 1);
  assert.equal(document.querySelector('[data-rename-name]')?.getAttribute('data-rename-name'), 'Full title.pdf');
});

test('a late full-name read cannot open rename after the signed actor changes', async t => {
  const pending = deferred();
  const h = await mount(t, { onPrepareRename: () => pending.promise });
  await h.openMenu();
  const rename = [...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === 'Rename');
  await act(async () => rename.click());
  await h.rerender({ user: { id: creator, name: 'Other actor' } });
  await act(async () => pending.resolve({ id: documentId, name: 'Wrong actor title.pdf' }));
  assert.equal(document.querySelector('[data-rename-name]'), null);
});

test('a catalog refresh that removes the document closes its full-name rename modal', async t => {
  const h = await mount(t);
  await h.openMenu();
  await h.clickMenu('Rename');
  assert.ok(document.querySelector('[data-rename-name]'));
  await h.rerender({ documents: [] });
  assert.equal(document.querySelector('[data-rename-name]'), null);
});
