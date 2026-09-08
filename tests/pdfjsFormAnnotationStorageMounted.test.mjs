import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { transformWithOxc } from 'vite';

const require = createRequire(import.meta.url);
const layerUrl = new URL('../src/components/PdfjsFormLayer.jsx', import.meta.url);
async function loadLayer() {
  const source = (await readFile(layerUrl, 'utf8')).replace(/from '([^']+)'/g, (_match, specifier) => (
    `from ${JSON.stringify(specifier.startsWith('.') ? new URL(specifier, layerUrl).href
      : pathToFileURL(require.resolve(specifier)).href)}`
  ));
  const transformed = await transformWithOxc(source, layerUrl.pathname, { lang: 'jsx' });
  const code = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
}

async function fixture(t) {
  const dom = new JSDOM('<div id="root"></div><button id="outside">Outside</button>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    HTMLElement: dom.window.HTMLElement, HTMLInputElement: dom.window.HTMLInputElement,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const source = await PDFDocument.create();
  for (let page = 1; page <= 2; page++) {
    const field = source.getForm().createTextField(`page${page}`);
    field.setText(`native ${page}`);
    field.addToPage(source.addPage([300, 200]), { x: 10, y: 10, width: 150, height: 20 });
  }
  const bytes = await source.save();
  const tasks = [];
  const open = async () => {
    const task = pdfjs.getDocument({ data: bytes.slice(), useSystemFonts: false });
    tasks.push(task);
    const pdf = await task.promise;
    const ids = [];
    for (let page = 1; page <= 2; page++) {
      ids.push((await (await pdf.getPage(page)).getAnnotations({ intent: 'display' })).find(w => w.subtype === 'Widget').id);
    }
    return { pdf, ids };
  };
  const Layer = await loadLayer();
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    for (const task of tasks) await task.destroy();
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const render = async (pdf, pages = [1, 2], persistedByPage = {}) => {
    await act(async () => {
      root.render(React.createElement(React.Fragment, null, pages.map(pageNumber => (
        React.createElement(Layer, { key: pageNumber, pdf, pageNumber, persistedValues: persistedByPage[pageNumber] })
      ))));
      await new Promise(resolve => setTimeout(resolve, 30));
    });
    // PDF page reads/rendering are async after React's passive effects start.
    for (let attempt = 0; attempt < 40 && document.querySelectorAll('[data-persistence-ready="true"]').length !== pages.length; attempt++) {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    }
    assert.equal(document.querySelectorAll('[data-persistence-ready="true"]').length, pages.length);
  };
  const input = page => document.querySelector(`[data-pdfjs-form-layer="${page}"] input`);
  const type = (page, value) => {
    const el = input(page); el.focus(); el.value = value;
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    document.getElementById('outside').focus();
  };
  return { open, render, input, type };
}

test('actual PDF.js widget input writes through the document AnnotationStorage shared by both pages', async t => {
  const h = await fixture(t);
  const { pdf, ids } = await h.open();
  await h.render(pdf);
  h.type(1, 'edited first');
  assert.equal(pdf.annotationStorage.getValue(ids[0], {}).value, 'edited first');
  h.type(2, 'edited second');
  assert.equal(pdf.annotationStorage.getValue(ids[1], {}).value, 'edited second');
  assert.equal(pdf.annotationStorage.getValue(ids[0], {}).value, 'edited first');
});

test('disposing and remounting page layers retains edits in the same PDF document store', async t => {
  const h = await fixture(t);
  const { pdf, ids } = await h.open();
  await h.render(pdf);
  h.type(1, 'kept first'); h.type(2, 'kept second');
  await h.render(pdf, []);
  assert.equal(pdf.annotationStorage.getValue(ids[0], {}).value, 'kept first');
  assert.equal(pdf.annotationStorage.getValue(ids[1], {}).value, 'kept second');
  // The app echoes its saved carriers on remount. PDF.js may otherwise paint
  // original formatted appearance text even while its stored value is newer.
  await h.render(pdf, [1, 2], {
    1: [{ fieldId: ids[0], value: 'kept first' }],
    2: [{ fieldId: ids[1], value: 'kept second' }],
  });
  assert.equal(h.input(1).value, 'kept first');
  assert.equal(h.input(2).value, 'kept second');
});

test('reopening original bytes uses a fresh document store even when widget IDs are identical', async t => {
  const h = await fixture(t);
  const first = await h.open();
  await h.render(first.pdf);
  h.type(1, 'first document only');
  const second = await h.open();
  assert.deepEqual(second.ids, first.ids, 'fixture exercises exact widget ID reuse');
  await h.render(second.pdf);
  assert.equal(h.input(1).value, 'native 1');
  assert.equal(second.pdf.annotationStorage.getValue(second.ids[0], {}).value, undefined);
  h.type(1, 'second document only');
  assert.equal(second.pdf.annotationStorage.getValue(second.ids[0], {}).value, 'second document only');
  assert.equal(first.pdf.annotationStorage.getValue(first.ids[0], {}).value, 'first document only');
});

test('actual PDF.js saveDocument serializes values entered through both mounted form layers', async t => {
  const h = await fixture(t);
  const { pdf } = await h.open();
  await h.render(pdf);
  h.type(1, 'saved first'); h.type(2, '');
  const saved = await PDFDocument.load(await pdf.saveDocument());
  assert.equal(saved.getForm().getTextField('page1').getText(), 'saved first');
  assert.equal(saved.getForm().getTextField('page2').getText() || '', '');
});
