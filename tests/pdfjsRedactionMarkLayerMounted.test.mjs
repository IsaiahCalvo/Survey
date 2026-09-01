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

async function loadLayer() {
  const componentPath = path.join(repoRoot, 'src/components/PdfjsRedactionMarkLayer.jsx');
  const overlayUrl = pathToFileURL(
    path.join(repoRoot, 'src/utils/importedRedactionOverlay.js'),
  ).href;
  const appearanceUrl = pathToFileURL(
    path.join(repoRoot, 'src/utils/pdfRedactionAppearance.js'),
  ).href;
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  let source = await readFile(componentPath, 'utf8');
  source = source
    .replace(
      "from 'react'",
      `from ${JSON.stringify(reactUrl)}`,
    )
    .replace(
      "from '../utils/importedRedactionOverlay.js'",
      `from ${JSON.stringify(overlayUrl)}`,
    )
    .replace(
      "from '../utils/pdfRedactionAppearance.js'",
      `from ${JSON.stringify(appearanceUrl)}`,
    );
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll(
    '"react/jsx-runtime"',
    JSON.stringify(jsxRuntimeUrl),
  );
  const tempDir = await mkdtemp(path.join(tmpdir(), 'redaction-layer-test-'));
  const modulePath = path.join(tempDir, 'PdfjsRedactionMarkLayer.mjs');
  await writeFile(modulePath, executable);
  return {
    Layer: (await import(pathToFileURL(modulePath).href)).default,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

async function mountLayer({ coarse = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', {
    pretendToBeVisual: true,
    url: 'http://localhost/',
  });
  const mediaListeners = new Set();
  Object.defineProperty(dom.window, 'matchMedia', {
    configurable: true,
    value: (query) => ({
      media: query,
      matches: query === '(pointer: coarse)' && coarse,
      addEventListener(_type, listener) { mediaListeners.add(listener); },
      removeEventListener(_type, listener) { mediaListeners.delete(listener); },
    }),
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Node = dom.window.Node;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;

  const { Layer, cleanup } = await loadLayer();
  const pdf = {
    async getPage() {
      return {
        rotate: 0,
        getViewport: () => ({
          width: 200,
          height: 100,
          convertToViewportPoint: (x, y) => [x, 100 - y],
        }),
        getAnnotations: async () => [
          { id: 'redact-1', subtype: 'Redact', rect: [20, 40, 120, 60] },
        ],
      };
    },
  };
  const host = document.getElementById('root');
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(Layer, { pdf, pageNumber: 1 }));
    await Promise.resolve();
    await Promise.resolve();
  });

  return {
    dom,
    root,
    host,
    mark: () => host.querySelector('[role="img"]'),
    teardown: async () => {
      await act(async () => root.unmount());
      await cleanup();
      dom.window.close();
      delete globalThis.window;
      delete globalThis.document;
      delete globalThis.HTMLElement;
      delete globalThis.Node;
      delete globalThis.MouseEvent;
      delete globalThis.IS_REACT_ACT_ENVIRONMENT;
    },
  };
}

test('pending mark is a thin red outline with no hatch or visible badge', async () => {
  const mounted = await mountLayer();
  try {
    const mark = mounted.mark();
    assert.equal(mark.getAttribute('aria-label'), 'Marked for redaction. Covered text is still readable.');
    assert.equal(mark.style.border, '1px solid rgb(208, 2, 27)');
    assert.equal(mark.style.backgroundColor, 'transparent');
    assert.equal(mark.textContent, '');
    assert.doesNotMatch(mark.getAttribute('style'), /gradient/i);
  } finally {
    await mounted.teardown();
  }
});

test('fine-pointer hover previews the applied solid black fill', async () => {
  const mounted = await mountLayer();
  try {
    await act(async () => mounted.mark().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    assert.equal(mounted.mark().style.backgroundColor, 'rgb(0, 0, 0)');
    await act(async () => mounted.mark().dispatchEvent(new MouseEvent('mouseout', { bubbles: true })));
    assert.equal(mounted.mark().style.backgroundColor, 'transparent');
  } finally {
    await mounted.teardown();
  }
});

test('coarse pointers use tap preview and tapping elsewhere clears it', async () => {
  const mounted = await mountLayer({ coarse: true });
  try {
    const tapMark = async () => {
      await act(async () => mounted.mark().dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
      await act(async () => mounted.mark().dispatchEvent(new MouseEvent('click', { bubbles: true })));
    };
    await act(async () => mounted.mark().dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    assert.equal(mounted.mark().style.backgroundColor, 'transparent');

    await tapMark();
    assert.equal(mounted.mark().style.backgroundColor, 'rgb(0, 0, 0)');
    await tapMark();
    assert.equal(mounted.mark().style.backgroundColor, 'transparent');

    await tapMark();
    await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
    assert.equal(mounted.mark().style.backgroundColor, 'transparent');
  } finally {
    await mounted.teardown();
  }
});
