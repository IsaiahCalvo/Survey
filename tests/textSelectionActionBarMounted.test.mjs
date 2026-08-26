import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function loadActionBar() {
  const componentPath = path.join(repoRoot, 'src/components/TextSelectionActionBar.jsx');
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(componentPath, 'utf8');
  for (const name of ['highlight', 'underline', 'squiggle', 'strike', 'link', 'redact']) {
    source = source.replace(
      new RegExp(`import (\\w+) from '\\.\\./assets/text-markup-${name}\\.svg';`),
      (_match, binding) => `const ${binding} = '${name}.svg';`,
    );
  }
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
        highlight: { color: '#f5c229', opacity: 30 }, underline: { color: '#ef3029', opacity: 100 },
        squiggly: { color: '#f0f1f4', opacity: 100 }, strikeout: { color: '#3d63dc', opacity: 100 },
      },
      linkEditorOpen: linkOpen,
      linkMode: mode,
      linkValue: value,
      onAction: (action) => {
        actions.push(action);
        if (action === 'link') return setLinkOpen((open) => !open);
        setActive((current) => current.includes(action) ? current.filter((type) => type !== action) : [...current, action]);
      },
      onFocusPaint: (mark) => { focused.push(mark); setFocus(mark); },
      onLinkModeChange: setMode,
      onLinkValueChange: setValue,
      onLinkSubmit: () => setLinkOpen(false),
      onLinkCancel: () => setLinkOpen(false),
    });
  }
  try {
    await act(async () => root.render(React.createElement(Harness)));
    assert.ok(document.querySelector('[role="toolbar"][aria-label="Text markup toolbar"]'));
    for (const [label, asset] of [['Remove Highlight', 'highlight.svg'], ['Apply Underline', 'underline.svg'], ['Apply Squiggle', 'squiggle.svg'], ['Remove Strike Through', 'strike.svg'], ['Apply Hyperlink', 'link.svg'], ['Apply Redact', 'redact.svg']]) {
      assert.equal(document.querySelector(`button[aria-label="${label}"] img`)?.getAttribute('src'), asset);
    }
    const underline = document.querySelector('button[aria-label="Apply Underline"]');
    await act(async () => underline.click());
    assert.deepEqual(actions, ['underline']);
    assert.equal(document.querySelector('button[aria-label="Remove Underline"]').getAttribute('aria-pressed'), 'true');
    await act(async () => document.querySelector('button[aria-label="Set Underline color"]').click());
    assert.deepEqual(focused, ['underline']);
    assert.equal(document.querySelector('[data-text-mark-control="underline"]').style.borderColor, 'rgb(229, 173, 24)');
    await act(async () => document.querySelector('button[aria-label="Apply Hyperlink"]').click());
    assert.ok(document.querySelector('form[aria-label="Hyperlink controls"]'));
    await act(async () => document.querySelector('form[aria-label="Hyperlink controls"] button[aria-pressed="false"]').click());
    assert.equal(document.querySelector('input[aria-label="Page number"]')?.getAttribute('inputmode'), 'numeric');
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  }
});
