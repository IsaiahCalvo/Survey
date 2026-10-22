// KAL-65 (2026-10-13): the home hub, the tab strip and the drag grip use the
// app's shared tooltip chip, not the operating system's native title= tooltip.
//
// Mounted half: the self-hosted <TooltipProvider> really paints one chip on
// hover, clears it on leave, never raises it for a touch tap, and joins a
// control's own handlers instead of dropping them.
// Source half: those surfaces are inside a provider and carry no native title=.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { parse } from '@babel/parser';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const src = (rel) => path.join(repoRoot, rel);

async function loadTooltipModule() {
  const componentPath = src('src/components/Tooltip.jsx');
  const url = (p) => JSON.stringify(pathToFileURL(p).href);
  let source = await readFile(componentPath, 'utf8');
  source = source
    .replace(/from 'react';/, `from ${url(require.resolve('react'))};`)
    .replace(/from 'react-dom';/, `from ${url(require.resolve('react-dom'))};`)
    // viewerShared pulls in the whole viewer; the chip only needs the font name.
    .replace("import { FONT_FAMILY } from '../viewerShared.js';", "const FONT_FAMILY = 'Helvetica';")
    .replace("from '../utils/floatingUiGeometry.js';", `from ${url(src('src/utils/floatingUiGeometry.js'))};`)
    .replace("from '../utils/toolShortcuts.js';", `from ${url(src('src/utils/toolShortcuts.js'))};`);
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll(
    '"react/jsx-runtime"',
    JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href),
  );
  const tempDir = await mkdtemp(path.join(tmpdir(), 'hub-tooltip-test-'));
  const modulePath = path.join(tempDir, 'Tooltip.mjs');
  await writeFile(modulePath, executable);
  return {
    mod: await import(pathToFileURL(modulePath).href),
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

function installDom() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 100, y: 40, left: 100, top: 40, right: 128, bottom: 68, width: 28, height: 28 };
  };
  return dom;
}

const chip = () => document.querySelector('body > div[aria-hidden="true"]');

// React builds onMouseEnter/onMouseLeave from mouseover/mouseout.
const hover = (el) => el.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body }));
const unhover = (el) => el.dispatchEvent(new window.MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body }));
const pointerDown = (el) => el.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test('TooltipProvider paints one shared chip on hover and clears it on leave', async () => {
  installDom();
  const { mod, cleanup } = await loadTooltipModule();
  const { TooltipProvider, useTooltip, TOOLTIP_SURFACE, TOOLTIP_DELAY_MS, TOOLTIP_WARM_MS } = mod;
  let siblingRenders = 0;
  const Sibling = React.memo(() => { siblingRenders += 1; return null; });
  function MoreButton() {
    const tip = useTooltip();
    return React.createElement('button', { id: 'more', 'aria-label': 'More', ...tip('More') });
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(
      React.createElement(TooltipProvider, null, React.createElement(MoreButton), React.createElement(Sibling)),
    ));
    const button = document.getElementById('more');
    assert.equal(button.getAttribute('title'), null, 'no native title');
    assert.equal(button.getAttribute('aria-label'), 'More', 'accessible name kept');
    assert.equal(chip(), null);
    const rendersBefore = siblingRenders;

    // Wait once (owner 2026-10-22, docs/tooltips.md): a pointer just passing
    // over shows nothing; resting on the control shows the chip.
    await act(async () => { hover(button); });
    assert.equal(chip(), null, 'the first chip waits');
    await act(async () => { await wait(TOOLTIP_DELAY_MS + 40); });
    const shown = chip();
    assert.ok(shown, 'resting on the control shows the chip');
    assert.equal(shown.textContent, 'More');
    assert.equal(shown.parentElement, document.body, 'portalled to body so no overflow can clip it');
    assert.equal(shown.style.background, TOOLTIP_SURFACE.background, 'same surface as every other chip');
    assert.equal(siblingRenders, rendersBefore, 'a hover re-renders only the chip, not the wrapped hub');

    await act(async () => { unhover(button); });
    assert.equal(chip(), null, 'leaving clears it immediately');

    // ...then show the rest at once while the user is reading the controls.
    await act(async () => { hover(button); });
    assert.equal(chip()?.textContent, 'More', 'the next chip right after one hid shows with no wait');
    await act(async () => { unhover(button); });

    // Once the warm window has passed, the next chip waits again.
    await act(async () => { await wait(TOOLTIP_WARM_MS + 60); });
    await act(async () => { hover(button); });
    assert.equal(chip(), null, 'cold again after the warm window');
    await act(async () => { unhover(button); await wait(TOOLTIP_DELAY_MS + 40); });
    assert.equal(chip(), null, 'leaving before the wait ends cancels the chip');

    // Mid-drag (a button held): rows slide under the pointer; no chips.
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body, buttons: 1 }));
      await wait(TOOLTIP_DELAY_MS + 40);
    });
    assert.equal(chip(), null, 'no chip while a mouse button is held');
  } finally {
    await act(async () => root.unmount());
    await cleanup();
  }
});

test('a touch tap never raises the chip over the control it pressed', async () => {
  installDom();
  const { mod, cleanup } = await loadTooltipModule();
  const { TooltipProvider, useTooltip } = mod;
  function Close() {
    const tip = useTooltip();
    return React.createElement('button', { id: 'close', 'aria-label': 'Close', ...tip('Close') });
  }
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(TooltipProvider, null, React.createElement(Close))));
    const button = document.getElementById('close');
    // A tap: pointerdown first, then the browser's emulated mouseover/mousedown.
    await act(async () => {
      pointerDown(button);
      hover(button);
      await wait(mod.TOOLTIP_DELAY_MS + 40);
    });
    assert.equal(chip(), null, 'the emulated hover after a finger press shows nothing, not even a flash');
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    assert.equal(chip(), null, 'no stray chip after a tap');
  } finally {
    await act(async () => root.unmount());
    await cleanup();
  }
});

test('a disabled control still explains itself to a mouse, never to a finger', async () => {
  installDom();
  const { mod, cleanup } = await loadTooltipModule();
  const { TooltipProvider, useTooltip } = mod;
  function ProTab() {
    const tip = useTooltip();
    return React.createElement('button', { id: 'pro', disabled: true, ...tip('Templates is a Pro feature', 'right') }, 'Templates');
  }
  const pointerOver = (el, pointerType) => {
    const ev = new window.MouseEvent('pointerover', { bubbles: true, relatedTarget: document.body });
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    el.dispatchEvent(ev);
  };
  const pointerOut = (el, pointerType) => {
    const ev = new window.MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body });
    Object.defineProperty(ev, 'pointerType', { value: pointerType });
    el.dispatchEvent(ev);
  };
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(TooltipProvider, null, React.createElement(ProTab))));
    const button = document.getElementById('pro');
    // React swallows mouseenter on a disabled button - this used to be silent.
    await act(async () => { hover(button); });
    assert.equal(chip(), null, 'precondition: React drops mouseenter on disabled buttons');
    await act(async () => { pointerOver(button, 'touch'); await wait(mod.TOOLTIP_DELAY_MS + 40); });
    assert.equal(chip(), null, 'a finger never raises the chip');
    await act(async () => { pointerOver(button, 'mouse'); await wait(mod.TOOLTIP_DELAY_MS + 40); });
    assert.equal(chip()?.textContent, 'Templates is a Pro feature');
    await act(async () => { pointerOut(button, 'mouse'); });
    assert.equal(chip(), null);
  } finally {
    await act(async () => root.unmount());
    await cleanup();
  }
});

test('withOwnHandlers keeps both the chip and the control handler; hoverOnly drops focus', async () => {
  installDom();
  const { mod, cleanup } = await loadTooltipModule();
  const { withOwnHandlers, hoverOnly } = mod;
  const calls = [];
  const bundle = { onPointerDown: () => calls.push('tip'), onFocus: () => {}, onBlur: () => {}, onMouseEnter: () => {} };
  const merged = withOwnHandlers(bundle, { onPointerDown: () => calls.push('own'), onKeyDown: () => calls.push('key'), onBlur: undefined });
  merged.onPointerDown({});
  merged.onKeyDown({});
  assert.deepEqual(calls, ['tip', 'own', 'key']);
  assert.equal(merged.onBlur, bundle.onBlur, 'an undefined own handler leaves the chip handler alone');
  const hoverBundle = hoverOnly(bundle);
  assert.equal(hoverBundle.onFocus, undefined);
  assert.equal(hoverBundle.onBlur, undefined);
  assert.equal(typeof hoverBundle.onMouseEnter, 'function');
  await cleanup();
});

// ---------------------------------------------------------------------------
// Source contracts.

const HUB_FILES = [
  'src/home/AccessManagementModal.jsx',
  'src/home/ArchiveScreen.jsx',
  'src/home/BulkModals.jsx',
  'src/home/CreateProjectModal.jsx',
  'src/home/DocumentsLedger.jsx',
  'src/home/HubShell.jsx',
  'src/home/ManageTeamModal.jsx',
  'src/home/ProjectsFolderTree.jsx',
  'src/home/ShareModal.jsx',
  'src/home/SurveyHub.jsx',
  'src/home/TemplatesEditor.jsx',
  'src/TabBar.jsx',
  'src/reorder/DragRearrangeHandle.jsx',
];

/** Every native (lower-case) JSX element in a file that still has `title=`. */
function nativeTitles(code) {
  const ast = parse(code, { sourceType: 'module', plugins: ['jsx'] });
  const found = [];
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'JSXOpeningElement' && node.name.type === 'JSXIdentifier' && /^[a-z]/.test(node.name.name)) {
      node.attributes.forEach((attr) => {
        if (attr.type === 'JSXAttribute' && attr.name.name === 'title') found.push(`${node.name.name}:${attr.loc.start.line}`);
      });
    }
    Object.keys(node).forEach((key) => {
      if (key === 'loc') return;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value.type === 'string') walk(value);
    });
  };
  walk(ast);
  return found;
}

test('hub, tab strip and drag grip carry no native title= tooltips', async () => {
  for (const rel of HUB_FILES) {
    const code = await readFile(src(rel), 'utf8');
    assert.deepEqual(nativeTitles(code), [], `${rel} still has a native title=`);
  }
});

test('the hub and the tab strip each sit inside a shared tooltip host', async () => {
  const appShell = await readFile(src('src/AppShell.jsx'), 'utf8');
  assert.match(appShell, /<TooltipProvider>\s*<MemoTabBar/);
  assert.match(appShell, /<TooltipProvider>\s*<MemoDashboard/);
  const preview = await readFile(src('src/home/HubPreview.jsx'), 'utf8');
  assert.match(preview, /<TooltipProvider>/);
});

test('CSS that used to find hub buttons by title= now finds them by aria-label', async () => {
  const hubCss = await readFile(src('src/home/hub.css'), 'utf8');
  assert.doesNotMatch(hubCss, /\[title="More"\]/);
  assert.doesNotMatch(hubCss, /\[title="Edit color"\]/);
  assert.match(hubCss, /button\[aria-label="More"\]:not\(:disabled\):hover/);
  const states = await readFile(src('src/styles/states.css'), 'utf8');
  assert.doesNotMatch(states, /\[title='More'\]/);
  const editor = await readFile(src('src/home/TemplatesEditor.jsx'), 'utf8');
  assert.match(editor, /closest\('button\[aria-label="Edit color"\]'\)/);
});

test('the drag grip joins dnd-kit listeners with the chip instead of replacing them', async () => {
  const grip = await readFile(src('src/reorder/DragRearrangeHandle.jsx'), 'utf8');
  assert.match(grip, /withOwnHandlers\(tipBundle, \{\s*onPointerDown,/);
  assert.match(grip, /\{\.\.\.rest\}\s*\{\.\.\.handlers\}/);
  assert.match(grip, /aria-label=\{hint\}/);
});
