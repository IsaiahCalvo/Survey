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

async function loadLinkLayer() {
  const componentPath = path.join(repoRoot, 'src/components/TextMarkupLinkLayer.jsx');
  const jsxRuntimeUrl = pathToFileURL(require.resolve('react/jsx-runtime')).href;
  const markupUrl = pathToFileURL(path.join(repoRoot, 'src/utils/pdfTextMarkup.js')).href;
  const platformUrl = pathToFileURL(path.join(repoRoot, 'src/utils/accountPlatform.js')).href;
  let source = await readFile(componentPath, 'utf8');
  source = source
    .replace("'../utils/pdfTextMarkup.js'", JSON.stringify(markupUrl))
    .replace("'../utils/accountPlatform.js'", JSON.stringify(platformUrl));
  const transformed = await transformWithOxc(source, componentPath, { lang: 'jsx' });
  const executable = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(jsxRuntimeUrl));
  const tempDir = await mkdtemp(path.join(tmpdir(), 'text-link-layer-test-'));
  const modulePath = path.join(tempDir, 'TextMarkupLinkLayer.mjs');
  await writeFile(modulePath, executable);
  return {
    LinkLayer: (await import(pathToFileURL(modulePath).href)).default,
    cleanup: () => rm(tempDir, { recursive: true, force: true }),
  };
}

const annotation = (link) => ({
  id: link.id,
  data: {
    id: link.id,
    type: 'text-markup',
    markupType: 'link',
    quads: [{ x1: 10, y1: 20, x2: 50, y2: 20, x3: 10, y3: 30, x4: 50, y4: 30 }],
    ...(link.url ? { linkUrl: link.url } : {}),
    ...(link.pageNumber ? { linkPageNumber: link.pageNumber } : {}),
  },
});

test('text link layer opens in Pan, selects in Select, and opens with a clear Select gesture', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const opened = [];
  const selected = [];
  const navigated = [];
  dom.window.open = (...args) => { opened.push(args); return {}; };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  const { LinkLayer, cleanup } = await loadLinkLayer();
  const root = createRoot(document.getElementById('root'));
  const webLink = annotation({ id: 'web-link', url: 'https://example.com/docs' });
  try {
    await act(async () => root.render(React.createElement(LinkLayer, {
      annotations: [webLink],
      pageSize: { width: 100, height: 100 },
      interactionMode: 'open',
      onPageNavigate: (pageNumber) => navigated.push(pageNumber),
      onSelectLink: (region) => selected.push(region.annotationId),
    })));
    const panButton = document.querySelector('[data-text-markup-link="web-link"]');
    await act(async () => {
      panButton.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, detail: 1, button: 0 }));
      panButton.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, cancelable: true, detail: 1, button: 0 }));
    });
    assert.deepEqual(opened, [['https://example.com/docs', '_blank', 'noopener,noreferrer']]);

    await act(async () => root.render(React.createElement(LinkLayer, {
      annotations: [{ ...webLink }],
      pageSize: { width: 100, height: 100 },
      interactionMode: 'select',
      onPageNavigate: (pageNumber) => navigated.push(pageNumber),
      onSelectLink: (region) => selected.push(region.annotationId),
    })));
    const selectButton = document.querySelector('[data-text-markup-link="web-link"]');
    assert.equal(selectButton, panButton, 'the hit target must survive a mode re-render');
    await act(async () => {
      selectButton.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, detail: 1, button: 0 }));
      selectButton.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, cancelable: true, detail: 1, button: 0 }));
    });
    assert.deepEqual(selected, ['web-link']);
    assert.equal(opened.length, 1);
    await act(async () => {
      selectButton.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, detail: 1, button: 0, ctrlKey: true }));
      selectButton.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, cancelable: true, detail: 1, button: 0, ctrlKey: true }));
    });
    assert.equal(opened.length, 2);

    const pageLink = annotation({ id: 'page-link', pageNumber: 5 });
    await act(async () => root.render(React.createElement(LinkLayer, {
      annotations: [pageLink],
      pageSize: { width: 100, height: 100 },
      interactionMode: 'open',
      onPageNavigate: (pageNumber) => navigated.push(pageNumber),
    })));
    const pageButton = document.querySelector('[data-text-markup-link="page-link"]');
    await act(async () => {
      pageButton.dispatchEvent(new dom.window.MouseEvent('pointerdown', { bubbles: true, cancelable: true, detail: 1, button: 0 }));
      pageButton.dispatchEvent(new dom.window.MouseEvent('pointerup', { bubbles: true, cancelable: true, detail: 1, button: 0 }));
    });
    assert.deepEqual(navigated, [5]);
  } finally {
    await act(async () => root.unmount());
    await cleanup();
    dom.window.close();
    for (const key of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[key];
  }
});
