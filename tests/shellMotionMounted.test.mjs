// Drawboard shell audit, Chunk A (2026-10-13): mounted checks for the exits.
//   - UndoToast keeps its contract (one message, one Undo, onUndo once then
//     onDismiss) and now plays a short exit: the last message stays, takes no
//     clicks and is hidden from assistive tech for the exit time, then goes.
//     <html data-undo-toast-open> is set while it shows. Reduced motion: no exit.
//   - MotionPresence keeps a closed dialog's last card for the exit, marked
//     data-motion-state="closing" + aria-hidden + inert, then drops it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const reactUrl = pathToFileURL(require.resolve('react')).href;
const reactDomUrl = pathToFileURL(require.resolve('react-dom')).href;
const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
const motionUrl = pathToFileURL(path.join(repoRoot, 'src/utils/motion.js')).href;

async function loadJsx(relPath, rewrite) {
  const file = path.join(repoRoot, relPath);
  let source = rewrite(await readFile(file, 'utf8'));
  const out = await transformWithOxc(source, file, { lang: 'jsx' });
  source = out.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  const dir = await mkdtemp(path.join(tmpdir(), 'shell-motion-test-'));
  const modulePath = path.join(dir, `${path.basename(relPath, '.jsx')}.mjs`);
  await writeFile(modulePath, source);
  return { mod: await import(pathToFileURL(modulePath).href), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const loadUndoToast = () => loadJsx('src/components/collab/UndoToast.jsx', (s) => s
  .replace("from 'react';", `from ${JSON.stringify(reactUrl)};`)
  .replace("from 'react-dom';", `from ${JSON.stringify(reactDomUrl)};`)
  .replace("from '../../utils/motion.js';", `from ${JSON.stringify(motionUrl)};`)
  .replace("import './UndoToast.css';", ''));

const loadPresence = () => loadJsx('src/components/MotionPresence.jsx', (s) => s
  .replace("from 'react';", `from ${JSON.stringify(reactUrl)};`)
  .replace("from '../utils/motion.js';", `from ${JSON.stringify(motionUrl)};`));

function setupDom({ reduced = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  dom.window.matchMedia = (q) => ({ matches: reduced && q === '(prefers-reduced-motion: reduce)', addEventListener() {}, removeEventListener() {} });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return dom;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('UndoToast: Undo runs once then dismisses; the toast plays a 120 ms exit with the last message, then leaves', async () => {
  setupDom();
  const { mod, cleanup } = await loadUndoToast();
  const { UndoToast } = mod;
  const root = createRoot(document.getElementById('root'));
  let undone = 0;
  let dismissed = 0;
  let toast = { kind: 'single', message: 'Moved to Archive', onUndo: () => { undone += 1; } };
  const render = () => act(async () => root.render(React.createElement(UndoToast, { toast, onDismiss: () => { dismissed += 1; toast = null; } })));
  try {
    await render();
    const el = () => document.querySelector('.undo-toast');
    assert.ok(el(), 'shown');
    assert.equal(el().querySelector('.undo-toast__message').textContent, 'Moved to Archive');
    assert.equal(el().getAttribute('data-state'), 'open');
    assert.equal(document.documentElement.hasAttribute('data-undo-toast-open'), true);
    await act(async () => el().querySelector('.undo-toast__action').click());
    assert.equal(undone, 1);
    assert.equal(dismissed, 1);
    await render(); // the queue cleared the toast (useUndoToast would re-render the parent)
    // Leaving: still there with the old message, no clicks, hidden from AT.
    assert.ok(el(), 'kept for the exit');
    assert.match(el().className, /undo-toast--leaving/);
    assert.equal(el().getAttribute('aria-hidden'), 'true');
    assert.equal(el().querySelector('.undo-toast__action').disabled, true);
    assert.equal(el().querySelector('.undo-toast__message').textContent, 'Moved to Archive');
    await act(async () => el().querySelector('.undo-toast__action').click());
    assert.equal(undone, 1, 'a click during the exit does nothing');
    await act(async () => { await wait(200); });
    assert.equal(el(), null, 'gone after the exit');
    assert.equal(document.documentElement.hasAttribute('data-undo-toast-open'), false);

    // A new toast during an exit replaces it at once.
    toast = { kind: 'single', message: 'First', onUndo() {} };
    await render();
    toast = null;
    await render();
    assert.match(el().className, /undo-toast--leaving/);
    toast = { kind: 'bulk', message: 'Second', onUndo() {} };
    await render();
    assert.equal(document.querySelectorAll('.undo-toast').length, 1);
    assert.equal(el().querySelector('.undo-toast__message').textContent, 'Second');
    assert.doesNotMatch(el().className, /leaving/);
  } finally {
    await act(async () => root.unmount());
    assert.equal(document.documentElement.hasAttribute('data-undo-toast-open'), false, 'flag cleared on unmount');
    await cleanup();
  }
});

test('UndoToast under reduced motion: no exit, gone at once', async () => {
  setupDom({ reduced: true });
  const { mod, cleanup } = await loadUndoToast();
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(mod.UndoToast, { toast: { message: 'Bye', onUndo() {} }, onDismiss() {} })));
    assert.ok(document.querySelector('.undo-toast'));
    await act(async () => root.render(React.createElement(mod.UndoToast, { toast: null, onDismiss() {} })));
    assert.equal(document.querySelector('.undo-toast'), null);
  } finally {
    await act(async () => root.unmount());
    await cleanup();
  }
});

test('MotionPresence keeps the last open card for the exit, marked closing / aria-hidden / inert, then drops it', async () => {
  setupDom();
  const { mod, cleanup } = await loadPresence();
  const MotionPresence = mod.default;
  const root = createRoot(document.getElementById('root'));
  const card = (title) => React.createElement('div', { className: 'scrim' },
    React.createElement('div', { role: 'dialog', 'aria-modal': 'true' }, title));
  const show = (open, title) => act(async () => root.render(
    React.createElement(MotionPresence, { open }, open ? card(title) : null),
  ));
  try {
    await show(false);
    assert.equal(document.querySelector('.scrim'), null, 'closed at first: nothing');
    await show(true, 'Rename');
    const scrim = () => document.querySelector('.scrim');
    assert.equal(scrim().hasAttribute('data-motion-state'), false);
    const sameNode = scrim();
    await show(false);
    assert.equal(scrim(), sameNode, 'the same DOM node plays the exit (no remount)');
    assert.equal(scrim().getAttribute('data-motion-state'), 'closing');
    assert.equal(scrim().getAttribute('aria-hidden'), 'true');
    assert.equal(scrim().hasAttribute('inert'), true);
    assert.equal(scrim().textContent, 'Rename', 'the last open text stays during the exit');
    // Re-opened during the exit: back to open at once.
    await show(true, 'Again');
    assert.equal(scrim().hasAttribute('data-motion-state'), false);
    assert.equal(scrim().textContent, 'Again');
    await show(false);
    await act(async () => { await wait(200); });
    assert.equal(scrim(), null, 'gone after the exit');
  } finally {
    await act(async () => root.unmount());
    await cleanup();
  }
});

test('MotionPresence under reduced motion closes at once', async () => {
  setupDom({ reduced: true });
  const { mod, cleanup } = await loadPresence();
  const MotionPresence = mod.default;
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(MotionPresence, { open: true }, React.createElement('div', { className: 'scrim' }))));
    assert.ok(document.querySelector('.scrim'));
    await act(async () => root.render(React.createElement(MotionPresence, { open: false }, null)));
    assert.equal(document.querySelector('.scrim'), null);
  } finally {
    await act(async () => root.unmount());
    await cleanup();
  }
});
