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
  source = source
    .replace("import Icon from '../Icons';", 'const Icon = ({ name, size }) => <svg data-icon-name={name} width={size} height={size} />;')
    .replace("import { computeTextSelectionActionBarPosition } from '../utils/pdfTextMarkup.js';", 'const computeTextSelectionActionBarPosition = () => ({ left: 100, top: 100 });')
    .replace("import highlightIconSvg from '../assets/text-markup-highlight.svg';", "const highlightIconSvg = 'highlight.svg';")
    .replace("import squiggleIconSvg from '../assets/text-markup-squiggle.svg';", "const squiggleIconSvg = 'squiggle.svg';");
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  const tempDir = await mkdtemp(path.join(tmpdir(), 'text-action-bar-test-'));
  const modulePath = path.join(tempDir, 'TextSelectionActionBar.mjs');
  await writeFile(modulePath, executable);
  return {
    ActionBar: (await import(pathToFileURL(modulePath).href)).default,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

test('mounted overlap select receives pointer input, changes mode, and keeps the action bar mounted', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const { ActionBar, cleanup } = await loadActionBar();
  const changes = [];
  const selection = { pages: [{ pageNumber: 1 }], anchor: { left: 100, top: 100 } };
  const root = createRoot(document.getElementById('root'));
  function Harness() {
    const [mode, setMode] = useState('layered');
    return React.createElement(ActionBar, {
      selection,
      color: '#ffff00',
      opacity: 0.3,
      overlapMode: mode,
      activeMarkupTypes: ['highlight', 'strikeout'],
      onAction: () => {},
      onColorClick: () => {},
      onOverlapModeChange: (nextMode) => {
        changes.push(nextMode);
        setMode(nextMode);
      },
    });
  }

  try {
    await act(async () => root.render(React.createElement(Harness)));
    const select = document.querySelector('select[aria-label="Highlight overlap mode"]');
    const selectPointerDown = new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    select.dispatchEvent(selectPointerDown);
    assert.equal(selectPointerDown.defaultPrevented, false, 'the native select press must not be blocked');

    select.value = 'uniform';
    await act(async () => select.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
    assert.deepEqual(changes, ['uniform']);
    assert.equal(document.querySelector('select[aria-label="Highlight overlap mode"]').value, 'uniform');
    assert.ok(document.querySelector('[data-text-selection-action-bar="true"]'));

    assert.equal(document.querySelector('button[aria-label="Highlight"]').getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelector('button[aria-label="Underline"]').getAttribute('aria-pressed'), 'false');
    assert.equal(document.querySelector('button[aria-label="Strikeout"]').getAttribute('aria-pressed'), 'true');
    assert.equal(document.querySelectorAll('[data-text-selection-action-icon="true"]').length, 5);
    assert.ok(document.querySelector('button[aria-label="Underline"] svg[data-icon-name="underline"]'));
    assert.ok(document.querySelector('button[aria-label="Strikeout"] svg[data-icon-name="strikeout"]'));

    const copyButton = document.querySelector('button[aria-label="Copy"]');
    const buttonPointerDown = new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true });
    copyButton.dispatchEvent(buttonPointerDown);
    assert.equal(buttonPointerDown.defaultPrevented, true, 'markup buttons must keep the PDF text range active');
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.HTMLElement;
    delete globalThis.Node;
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  }
});
