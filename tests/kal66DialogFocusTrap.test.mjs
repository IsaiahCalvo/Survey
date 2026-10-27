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

// Compile one source file for node: swap its imports (each must still be
// there) and point react at the real package.
async function compile(rel, dir, swaps) {
  const file = path.join(repoRoot, rel);
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(file, 'utf8');
  for (const [from, to] of [[/from 'react';/, `from ${JSON.stringify(reactUrl)};`], ...swaps]) {
    assert.ok(typeof from === 'string' ? source.includes(from) : from.test(source), `${rel} still has: ${from}`);
    source = source.replace(from, to);
  }
  const out = await transformWithOxc(source, file, { lang: 'jsx' });
  const target = path.join(dir, path.basename(rel).replace(/\.jsx$/, '.mjs'));
  await writeFile(target, out.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl)));
  return pathToFileURL(target).href;
}

// The prompt sits on DialogCard (2026-10-27), so both are compiled; the trap
// under test is the real useFocusTrap that DialogCard uses.
async function loadPromptModal() {
  const dir = await mkdtemp(path.join(tmpdir(), 'kal66-prompt-'));
  const cardUrl = await compile('src/components/DialogCard.jsx', dir, [
    ["import { Icon } from '../home/HubShell';", 'const Icon = () => null;'],
    ["import { C } from '../uiPalette';", `import { C } from ${JSON.stringify(url('src/uiPalette.js'))};`],
    ["import { useFocusTrap } from '../hooks/useFocusTrap';", `import { useFocusTrap } from ${JSON.stringify(url('src/hooks/useFocusTrap.js'))};`],
    ["import MotionPresence from './MotionPresence.jsx';", 'const MotionPresence = ({ open, children }) => (open ? children : null);'],
    ["import { useTooltip } from './Tooltip';", 'const useTooltip = () => () => ({});'],
  ]);
  const promptUrl = await compile('src/components/dialogPrompts.jsx', dir, [
    ["import { ConfirmModal } from '../home/BulkModals';", 'const ConfirmModal = () => null;'],
    [/from '\.\/DialogCard\.jsx';/g, `from ${JSON.stringify(cardUrl)};`],
  ]);
  return { mod: await import(promptUrl), cleanup: () => rm(dir, { recursive: true, force: true }) };
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

test('AccessManagementModal uses the shared stacking trap its Invite dialog also uses', () => {
  const src = readFileSync(new URL('../src/home/AccessManagementModal.jsx', import.meta.url), 'utf8');
  assert.match(src, /import \{ useFocusTrap \} from '\.\.\/hooks\/useFocusTrap';/);
  // Escape closes an open row More menu first, then the dialog (2026-10-27).
  assert.match(src, /useFocusTrap\(cardRef, Boolean\(open\), \{ onEscape: \(\) => \(openMenu \? setOpenMenu\(null\) : onClose\?\.\(\)\) \}\);/);
  assert.match(src, /<div ref=\{cardRef\} role="dialog" aria-modal="true"/);
  assert.doesNotMatch(src, /addEventListener\('keydown'/, 'no hand-rolled Escape listener left');
  const share = readFileSync(new URL('../src/home/ShareModal.jsx', import.meta.url), 'utf8');
  assert.match(share, /useModalFocusTrap\(\{/, 'Invite dialog uses its trap');
  const stack = readFileSync(new URL('../src/home/useModalFocusTrap.js', import.meta.url), 'utf8');
  assert.match(stack, /openModalStack/, 'both traps share one open-dialog stack (src/hooks/modalStack.js)');
});
