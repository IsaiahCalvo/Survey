import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const ACCEPTED_ICON_HASHES = {
  'pan-hand-closed.svg': 'fad3b440787ce0d89d718c2a849fb102ec48a584bc4392d04f8e221065f0a00e',
  'text-highlight.svg': 'bfe4a937890f2bd90e59aa3eb8d2f9e3e0224bd77c9c7a2f3e75919f21e6e932',
  'text-underline.svg': '55c5967c981f7ccaf9389884ccde723f1cd3334564424f10b83a8c12d89c9f88',
  'text-squiggle.svg': '5d758e7ceef171af4c6a20d10844dec95860144d93e6fa6a0225c95ba9fa6c40',
  'text-strikethrough.svg': 'b159301bb729612e95870d663bc2fbae256ee3022f94ff89354a923f93a173ba',
  'text-hyperlink.svg': 'bea3b7fc712ed3c0729016b565c9392769dd4a697a1eae63b1dc0418ba127020',
  'text-redact.svg': '6ac08792f31d89e479d91c603dbded96e383215de9a9bb1b7aa736dce1f6f4ac',
};

test('shared accepted icons stay byte-exact to the accepted icon lineup', async () => {
  for (const [fileName, expectedHash] of Object.entries(ACCEPTED_ICON_HASHES)) {
    const bytes = await readFile(path.join(repoRoot, 'src/assets/icons', fileName));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash, fileName);
  }
});

test('pan icon uses the approved closed-wrist asset at its full requested size', async () => {
  const iconsSource = await readFile(path.join(repoRoot, 'src/Icons.jsx'), 'utf8');
  assert.match(iconsSource, /import panHandUrl from '.\/assets\/icons\/pan-hand-closed\.svg'/);
  assert.doesNotMatch(iconsSource, /import panHandUrl from '.\/assets\/icons\/pan-hand\.svg'/);
  assert.match(
    iconsSource,
    /formatPan:\s*\(size, color, style, className\)\s*=>\s*renderMaskIcon\(panHandUrl, size, color, style, className\)/,
  );
  assert.doesNotMatch(iconsSource, /renderMaskIcon\(panHandUrl,[^\n]*size \* 0\.88/);
});

async function loadActionBar() {
  const componentPath = path.join(repoRoot, 'src/components/TextSelectionActionBar.jsx');
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(componentPath, 'utf8');
  source = source.replace(
    "import Icon from '../Icons';",
    "const Icon = ({ name, color, size, style }) => <span data-icon-name={name} data-icon-color={color} data-icon-size={size} style={style} />;",
  );
  source = source.replace("import './TextSelectionActionBar.css';", '');
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  const tempDir = await mkdtemp(path.join(tmpdir(), 'text-action-bar-test-'));
  const modulePath = path.join(tempDir, 'TextSelectionActionBar.mjs');
  await writeFile(modulePath, executable);
  return { ActionBar: (await import(pathToFileURL(modulePath).href)).default, cleanup: () => rm(tempDir, { recursive: true, force: true }) };
}

test('mounted text markup strip stacks marks, focuses paint, and opens both link modes', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  const { ActionBar, cleanup } = await loadActionBar();
  const actions = [];
  const focused = [];
  const openedLinks = [];
  const removedLinks = [];
  const root = createRoot(document.getElementById('root'));
  function Harness() {
    const [active, setActive] = useState(['highlight', 'strikeout']);
    const [focus, setFocus] = useState('highlight');
    const [linkOpen, setLinkOpen] = useState(false);
    const [mode, setMode] = useState('web');
    const [value, setValue] = useState('');
    return React.createElement(ActionBar, {
      selection: { pages: [{ pageNumber: 1 }] },
      activeMarkupTypes: active,
      focusedPaintMark: focus,
      paintByMark: {
        highlight: { color: '#f5c229', opacity: 40 }, underline: { color: '#ef3029', opacity: 100 },
        squiggly: { color: '#15803d', opacity: 100 }, strikeout: { color: '#3d63dc', opacity: 100 },
      },
      linkEditorOpen: linkOpen,
      linkMode: mode,
      linkValue: value,
      onAction: (action) => {
        actions.push(action);
        if (action === 'link') {
          setActive((current) => current.includes('link') ? current : [...current, 'link']);
          return setLinkOpen((open) => !open);
        }
        setActive((current) => current.includes(action) ? current.filter((type) => type !== action) : [...current, action]);
      },
      onFocusPaint: (mark) => { focused.push(mark); setFocus(mark); },
      onLinkModeChange: setMode,
      onLinkValueChange: setValue,
      onLinkSubmit: () => setLinkOpen(false),
      onLinkOpen: () => openedLinks.push('open'),
      onLinkRemove: () => removedLinks.push('remove'),
      onLinkCancel: () => setLinkOpen(false),
    });
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    const toolbar = document.querySelector('[role="toolbar"][aria-label="Text markup toolbar"]');
    assert.ok(toolbar);
    assert.equal(toolbar.className, 'text-selection-action-bar__toolbar');
    assert.equal(toolbar.getAttribute('aria-orientation'), 'horizontal');
    assert.equal(toolbar.querySelector('.text-selection-action-bar__tools')?.children.length, 6);
    assert.equal(toolbar.querySelector('button[aria-label="Copy"]'), null);
    const highlightControl = document.querySelector('[data-text-mark-control="highlight"]');
    assert.equal(highlightControl.className, 'text-selection-action-bar__mark');
    assert.equal(highlightControl.getAttribute('data-focused'), 'true');
    assert.ok(document.querySelector('button[aria-label="Set Highlight color"]').classList.contains('text-selection-action-bar__button'));
    for (const [label, iconName] of [['Remove Highlight', 'formatHighlight'], ['Apply Underline', 'formatUnderline'], ['Apply Squiggle', 'formatSquiggle'], ['Remove Strike Through', 'formatStrikethrough'], ['Add Hyperlink', 'formatHyperlink'], ['Apply Redact', 'formatRedact']]) {
      assert.equal(document.querySelector(`button[aria-label="${label}"] [data-icon-name]`)?.getAttribute('data-icon-name'), iconName);
    }
    const highlightSwatch = document.querySelector('button[aria-label="Set Highlight color"] span');
    assert.equal(highlightSwatch.style.background, 'rgb(245, 194, 41)');
    assert.equal(highlightSwatch.style.opacity, '1');
    assert.deepEqual(actions, []);
    assert.equal(document.querySelector('button[aria-label="Remove Highlight"] [data-icon-color]')?.getAttribute('data-icon-color'), '#e5ad18');
    assert.equal(document.querySelector('button[aria-label="Apply Underline"] [data-icon-color]')?.getAttribute('data-icon-color'), '#e8e2d4');
    assert.equal(document.querySelector('button[aria-label="Apply Underline"] [data-icon-name]')?.style.opacity, '1');
    await act(async () => document.querySelector('button[aria-label="Remove Highlight"]').click());
    assert.equal(document.querySelector('button[aria-label="Apply Highlight"] [data-icon-color]')?.getAttribute('data-icon-color'), '#e8e2d4');
    await act(async () => document.querySelector('button[aria-label="Apply Highlight"]').click());
    assert.equal(document.querySelector('button[aria-label="Remove Highlight"] [data-icon-color]')?.getAttribute('data-icon-color'), '#e5ad18');
    for (const icon of document.querySelectorAll('[data-icon-name]:not([data-icon-name="formatRedact"])')) {
      assert.equal(icon.getAttribute('data-icon-size'), '18');
    }
    assert.equal(document.querySelector('[data-icon-name="formatRedact"]').getAttribute('data-icon-size'), '21');
    assert.equal(document.querySelector('button[aria-label*="redaction"][aria-label*="permanently"]'), null);
    const underline = document.querySelector('button[aria-label="Apply Underline"]');
    await act(async () => underline.click());
    assert.deepEqual(actions, ['highlight', 'highlight', 'underline']);
    assert.equal(document.querySelector('button[aria-label="Remove Underline"]').getAttribute('aria-pressed'), 'true');
    const squiggleTouch = new dom.window.Event('touchend', { bubbles: true, cancelable: true });
    await act(async () => document.querySelector('button[aria-label="Apply Squiggle"]').dispatchEvent(squiggleTouch));
    assert.equal(squiggleTouch.defaultPrevented, true);
    assert.deepEqual(actions, ['highlight', 'highlight', 'underline', 'squiggly']);
    assert.equal(document.querySelector('button[aria-label="Remove Squiggle"]').getAttribute('aria-pressed'), 'true');
    const squigglePaintTouch = new dom.window.Event('touchend', { bubbles: true, cancelable: true });
    await act(async () => document.querySelector('button[aria-label="Set Squiggle color"]').dispatchEvent(squigglePaintTouch));
    assert.equal(squigglePaintTouch.defaultPrevented, true);
    assert.deepEqual(focused, ['squiggly']);
    await act(async () => document.querySelector('button[aria-label="Set Underline color"]').click());
    assert.deepEqual(focused, ['squiggly', 'underline']);
    assert.equal(document.querySelector('[data-text-mark-control="underline"]').getAttribute('data-focused'), 'true');
    const firstToolbarButton = document.querySelector('button[aria-label="Remove Highlight"]');
    firstToolbarButton.focus();
    await act(async () => toolbar.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Set Highlight color');
    await act(async () => document.querySelector('button[aria-label="Add Hyperlink"]').click());
    const linkForm = document.querySelector('form[aria-label="Hyperlink controls"]');
    assert.ok(linkForm);
    assert.equal(linkForm.className, 'text-selection-action-bar__link-form');
    assert.equal(document.querySelector('input[aria-label="Web address"]').className, 'text-selection-action-bar__link-input');
    assert.ok(document.querySelector('[data-text-link-actions="true"]'));
    assert.ok(document.querySelector('button[aria-label="Open link"]'));
    assert.ok(document.querySelector('button[aria-label="Remove link"]'));
    await act(async () => document.querySelector('button[aria-label="Open link"]').click());
    await act(async () => document.querySelector('button[aria-label="Remove link"]').click());
    assert.deepEqual(openedLinks, ['open']);
    assert.deepEqual(removedLinks, ['remove']);
    await act(async () => document.querySelector('form[aria-label="Hyperlink controls"] button[aria-pressed="false"]').click());
    assert.equal(document.querySelector('input[aria-label="Page number"]')?.getAttribute('inputmode'), 'numeric');
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  }
});

test('the text markup strip is hidden after text selection is dismissed and has no separate Apply Redactions button', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  const { ActionBar, cleanup } = await loadActionBar();
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(ActionBar, {
      selection: null,
      pendingRedactionCount: 1,
      onApplyRedactions: () => {},
    })));
    assert.equal(document.querySelector('[data-text-selection-action-bar="true"]'), null);
    assert.equal(document.querySelector('button[aria-label*="redaction"][aria-label*="permanently"]'), null);
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  }
});

test('mounted link editor shows its existing address and cancel does not submit it', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLElement.prototype.attachEvent = () => {};
  dom.window.HTMLElement.prototype.detachEvent = () => {};
  const { ActionBar, cleanup } = await loadActionBar();
  const calls = [];
  const root = createRoot(document.getElementById('root'));
  try {
    await act(async () => root.render(React.createElement(ActionBar, {
      selection: { pages: [{ pageNumber: 1 }] },
      activeMarkupTypes: ['link'],
      linkEditorOpen: true,
      linkMode: 'web',
      linkValue: 'https://example.com/docs',
      onLinkSubmit: () => calls.push('submit'),
      onLinkCancel: () => calls.push('cancel'),
      onAction: () => {},
      onFocusPaint: () => {},
    })));
    assert.equal(document.querySelector('input[aria-label="Web address"]').value, 'https://example.com/docs');
    await act(async () => document.querySelector('button[aria-label="Cancel hyperlink"]').click());
    assert.deepEqual(calls, ['cancel']);
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  }
});
