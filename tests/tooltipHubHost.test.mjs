// KAL-65 (hub): the shared tooltip chip reaches the hub, the tab bar and the
// drag-rearrange grip, and nothing there falls back to the native OS tooltip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
const src = (rel) => readFile(path.join(repoRoot, 'src', rel), 'utf8');
const fileUrl = (rel) => JSON.stringify(pathToFileURL(path.join(repoRoot, 'src', rel)).href);

async function loadTooltip() {
  const componentPath = path.join(repoRoot, 'src/components/Tooltip.jsx');
  const source = (await src('components/Tooltip.jsx'))
    .replace(/from 'react';/, `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)};`)
    .replace(/from 'react-dom';/, `from ${JSON.stringify(pathToFileURL(require.resolve('react-dom')).href)};`)
    .replace("import { FONT_FAMILY } from '../viewerShared.js';", "const FONT_FAMILY = 'Helvetica';")
    .replace("'../utils/floatingUiGeometry.js'", fileUrl('utils/floatingUiGeometry.js'))
    .replace("'../utils/toolShortcuts.js'", fileUrl('utils/toolShortcuts.js'));
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const code = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  const dir = await mkdtemp(path.join(tmpdir(), 'tooltip-hub-test-'));
  const file = path.join(dir, 'Tooltip.mjs');
  await writeFile(file, code);
  return { mod: await import(pathToFileURL(file).href), cleanup: () => rm(dir, { recursive: true, force: true }) };
}

const GLOBALS = ['window', 'document', 'HTMLElement', 'Node', 'MouseEvent', 'KeyboardEvent', 'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT'];
async function mount(render) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  for (const key of GLOBALS.slice(0, -1)) globalThis[key] = dom.window[key];
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const { mod, cleanup } = await loadTooltip();
  const root = createRoot(document.getElementById('root'));
  await act(async () => root.render(render(mod)));
  return {
    chip: () => [...document.body.children].find((el) => el.getAttribute('aria-hidden') === 'true' && el.style.position === 'fixed') || null,
    fire: (el, type, init = {}) => act(async () => {
      const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, ...init });
      if (init.pointerType) Object.defineProperty(event, 'pointerType', { value: init.pointerType });
      el.dispatchEvent(event);
    }),
    key: (k) => act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true })); }),
    teardown: async () => {
      await act(async () => root.unmount());
      await cleanup();
      dom.window.close();
      for (const key of GLOBALS) delete globalThis[key];
    },
  };
}

function Probe({ useTooltip, label = 'More', placement = 'below', opts, disabled = false }) {
  return React.createElement('button', { id: 'probe', disabled, ...useTooltip()(label, placement, opts) }, 'x');
}

test('with no host above it, useTooltip keeps the native title instead of dropping the hint', async () => {
  const m = await mount(({ useTooltip }) => React.createElement(Probe, { useTooltip }));
  try {
    assert.equal(document.getElementById('probe').getAttribute('title'), 'More');
  } finally { await m.teardown(); }
});

test('TooltipHost shows the shared chip on hover, never a native title, and hides it on leave and Esc', async () => {
  const m = await mount(({ TooltipHost, useTooltip }) => React.createElement(TooltipHost, null, React.createElement(Probe, { useTooltip })));
  try {
    const probe = document.getElementById('probe');
    assert.equal(probe.hasAttribute('title'), false);
    await m.fire(probe, 'mouseover');
    assert.equal(m.chip()?.textContent, 'More');
    await m.fire(probe, 'mouseout');
    assert.equal(m.chip(), null);
    await m.fire(probe, 'mouseover');
    await m.key('Escape');
    assert.equal(m.chip(), null);
  } finally { await m.teardown(); }
});

test('a disabled control still shows its reason, through pointerenter', async () => {
  const m = await mount(({ TooltipHost, useTooltip }) => React.createElement(TooltipHost, null,
    React.createElement(Probe, { useTooltip, label: 'Nothing to select', disabled: true })));
  try {
    const probe = document.getElementById('probe');
    await m.fire(probe, 'pointerover', { pointerType: 'mouse' });
    assert.equal(m.chip()?.textContent, 'Nothing to select');
    await m.fire(probe, 'pointerout', { pointerType: 'mouse' });
    assert.equal(m.chip(), null);
    await m.fire(probe, 'pointerover', { pointerType: 'touch' });
    assert.equal(m.chip(), null, 'a finger on a disabled control shows nothing');
  } finally { await m.teardown(); }
});

test('moving from a control onto a disabled neighbour keeps the neighbour\'s reason up', async () => {
  const Pair = ({ useTooltip }) => {
    const tip = useTooltip();
    return React.createElement('div', null,
      React.createElement('button', { id: 'all', ...tip('Select all') }, 'All'),
      React.createElement('button', { id: 'del', disabled: true, ...tip('Select something to delete') }, 'Delete'));
  };
  const m = await mount(({ TooltipHost, useTooltip }) => React.createElement(TooltipHost, null, React.createElement(Pair, { useTooltip })));
  try {
    const all = document.getElementById('all');
    const del = document.getElementById('del');
    await m.fire(all, 'mouseover');
    // Browser order: pointer events on the new control, THEN mouse leave on the old.
    await m.fire(all, 'pointerout', { pointerType: 'mouse', relatedTarget: del });
    await m.fire(del, 'pointerover', { pointerType: 'mouse', relatedTarget: all });
    await m.fire(all, 'mouseout', { relatedTarget: del });
    assert.equal(m.chip()?.textContent, 'Select something to delete');
  } finally { await m.teardown(); }
});

test('no chip while a button is held (mid-drag), and typed names never grow a key badge', async () => {
  const m = await mount(({ TooltipHost, useTooltip }) => React.createElement(TooltipHost, null,
    React.createElement(Probe, { useTooltip, label: 'Rectangle', opts: { name: true } })));
  try {
    const probe = document.getElementById('probe');
    await m.fire(probe, 'mouseover', { buttons: 1 });
    assert.equal(m.chip(), null);
    await m.fire(probe, 'mouseover');
    assert.equal(m.chip()?.textContent, 'Rectangle');
  } finally { await m.teardown(); }
});

// Every lowercase (DOM) JSX tag in the hub, the tab bar and the grip: no
// native title= left. Component props named `title` (HubShell, dialogs) are fine.
test('the hub, tab bar and drag grip carry no native title= on DOM elements', async () => {
  const files = ['TabBar.jsx', 'reorder/DragRearrangeHandle.jsx', 'components/SectionIconButton.jsx',
    ...(await readdir(path.join(repoRoot, 'src/home'))).filter((f) => f.endsWith('.jsx')).map((f) => `home/${f}`)];
  const offenders = [];
  for (const rel of files) {
    const text = await src(rel);
    for (const match of text.matchAll(/(?<![\w.-])title=/g)) {
      const open = text.lastIndexOf('<', match.index);
      const tag = /^<([A-Za-z][\w.]*)/.exec(text.slice(open))?.[1] || '';
      if (/^[a-z]/.test(tag)) offenders.push(`${rel}: <${tag} ... title=`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the shell hosts a chip of its own for the hub and tab bar', async () => {
  const shell = await src('AppShell.jsx');
  assert.match(shell, /makeTooltipBinding\(viewerSetTooltip \|\| setShellTooltip\)/);
  assert.match(shell, /<FloatingTooltip tooltip=\{shellTooltip\} \/>/);
});
