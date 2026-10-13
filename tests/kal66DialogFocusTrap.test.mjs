import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { transformWithOxc } from 'vite';

// KAL-66: the last two dialogs that let Tab wander onto the page behind them.
// PromptModal (the themed prompt()) now uses the same trap as ConfirmModal;
// AccessManagementModal uses the stacking trap its nested Invite dialog
// (ShareModal) already uses, so the two cannot fight over focus.

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const url = (rel) => pathToFileURL(path.join(repoRoot, rel)).href;

async function loadPromptModal() {
  const file = path.join(repoRoot, 'src/components/dialogPrompts.jsx');
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(file, 'utf8');
  const swap = (from, to) => {
    assert.ok(source.includes(from), `dialogPrompts.jsx still has: ${from}`);
    source = source.replace(from, to);
  };
  swap("import { useCallback, useEffect, useRef, useState } from 'react';",
    `import { useCallback, useEffect, useRef, useState } from ${JSON.stringify(reactUrl)};`);
  swap("import { useFocusTrap } from '../hooks/useFocusTrap';",
    `import { useFocusTrap } from ${JSON.stringify(url('src/hooks/useFocusTrap.js'))};`);
  swap("import { ConfirmModal } from '../home/BulkModals';", 'const ConfirmModal = () => null;');
  swap("import { closeButtonStyle } from '../home/hubControls';", 'const closeButtonStyle = () => ({});');
  swap("import { Icon } from '../home/HubShell';", 'const Icon = () => null;');
  swap("import { C } from '../uiPalette';", `import { C } from ${JSON.stringify(url('src/uiPalette.js'))};`);
  const out = await transformWithOxc(source, file, { lang: 'jsx' });
  const code = out.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  const dir = await mkdtemp(path.join(tmpdir(), 'kal66-prompt-'));
  const modulePath = path.join(dir, 'dialogPrompts.mjs');
  await writeFile(modulePath, code);
  return { mod: await import(pathToFileURL(modulePath).href), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no layout; the trap skips zero-size elements.
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetWidth', { configurable: true, get() { return 10; } });
  return dom;
}

const key = (k, opts = {}) => {
  const e = new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...opts });
  document.activeElement.dispatchEvent(e);
  return e;
};

// Tab as the browser would: the trap may move focus itself (and prevent
// default); otherwise focus goes to the next element in DOM order.
const tab = (shift = false) => {
  const e = key('Tab', { shiftKey: shift });
  if (e.defaultPrevented) return;
  const all = [...document.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')];
  const i = all.indexOf(document.activeElement);
  const next = all[(i + (shift ? -1 : 1) + all.length) % all.length];
  next?.focus();
};

test('PromptModal: field takes focus, Tab and Shift+Tab stay inside, Escape cancels, focus returns', async (t) => {
  setupDom();
  // react-dom decides how to watch text fields when it first loads, so it
  // must load after the DOM exists.
  const { createRoot } = await import('react-dom/client');
  const { mod, cleanup } = await loadPromptModal();
  t.after(cleanup);
  const events = [];
  function Host() {
    const [open, setOpen] = useState(false);
    return React.createElement(React.Fragment, null,
      React.createElement('button', { id: 'opener', onClick: () => setOpen(true) }, 'Rename'),
      React.createElement('button', { id: 'behind' }, 'Behind'),
      React.createElement(mod.PromptModal, {
        open, title: 'Rename', defaultValue: 'Tower A',
        onSubmit: (v) => { events.push(['submit', v]); setOpen(false); },
        onCancel: () => { events.push(['cancel']); setOpen(false); },
      }));
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(Host)));
    const opener = document.getElementById('opener');
    opener.focus();
    await act(async () => opener.click());
    const dialog = document.querySelector('[role="dialog"]');
    assert.ok(dialog, 'dialog is open');
    assert.equal(dialog.getAttribute('aria-label'), 'Rename');
    assert.equal(document.activeElement.tagName, 'INPUT', 'the text field takes focus');

    for (let i = 0; i < 9; i += 1) {
      await act(async () => tab(i % 2 === 1));
      assert.ok(dialog.contains(document.activeElement), `Tab ${i} stayed in the dialog`);
    }
    for (let i = 0; i < 6; i += 1) {
      await act(async () => tab(false));
      assert.ok(dialog.contains(document.activeElement), `forward Tab ${i} stayed in the dialog`);
    }
    for (let i = 0; i < 6; i += 1) {
      await act(async () => tab(true));
      assert.ok(dialog.contains(document.activeElement), `Shift+Tab ${i} stayed in the dialog`);
    }

    await act(async () => { key('Escape'); });
    assert.deepEqual(events, [['cancel']]);
    assert.equal(document.querySelector('[role="dialog"]'), null, 'Escape closes it');
    assert.equal(document.activeElement, opener, 'focus goes back to the opener');
  } finally {
    await act(async () => root.unmount());
  }
});

test('AccessManagementModal uses the stacking trap shared with its Invite dialog', () => {
  const src = readFileSync(new URL('../src/home/AccessManagementModal.jsx', import.meta.url), 'utf8');
  assert.match(src, /import useModalFocusTrap from '\.\/useModalFocusTrap';/);
  assert.match(src, /useModalFocusTrap\(\{\s*active: open,\s*containerRef: cardRef,\s*initialFocusRef: closeRef,\s*onClose,\s*\}\);/);
  assert.match(src, /<div ref=\{cardRef\} role="dialog" aria-modal="true"/);
  assert.match(src, /<button ref=\{closeRef\} onClick=\{onClose\}/);
  assert.doesNotMatch(src, /addEventListener\('keydown'/, 'no hand-rolled Escape listener left');
  const share = readFileSync(new URL('../src/home/ShareModal.jsx', import.meta.url), 'utf8');
  assert.match(share, /useModalFocusTrap\(\{/, 'the nested Invite dialog is on the same trap stack');
});
