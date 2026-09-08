import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { transformWithOxc } from 'vite';
import { usePdfjsFormFieldPersistence } from '../src/hooks/usePdfjsFormFieldPersistence.js';

const require = createRequire(import.meta.url);
const layerUrl = new URL('../src/components/PdfjsFormLayer.jsx', import.meta.url);
// Only pdf.js's external rendering boundary is synthetic. Run the complete
// production layer, its actual DOM listeners/hydration, and the real save hook.
async function loadLayer() {
  let source = await readFile(layerUrl, 'utf8');
  source = source.replace("import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';", `
    const pdfjsLib = { AnnotationLayer: class {
      constructor({ div, annotationStorage }) { this.div = div; this.annotationStorage = annotationStorage; }
      async render({ annotations }) {
        const annotationStorage = this.annotationStorage;
        for (const widget of annotations) {
          const section = document.createElement('section');
          section.setAttribute('data-annotation-id', widget.id);
          const input = document.createElement('input');
          input.type = widget.testInputType || 'text';
          const value = annotationStorage.values.get(widget.id)?.value ?? widget.fieldValue;
          if (input.type === 'checkbox') input.checked = !!value;
          else input.value = value == null ? '' : String(value);
          section.append(input); this.div.append(section);
        }
      }
    } };
  `).replace(/from '([^']+)'/g, (match, specifier) => {
    if (specifier === 'react') return `from ${JSON.stringify(pathToFileURL(require.resolve('react')).href)}`;
    if (specifier.startsWith('.')) return `from ${JSON.stringify(new URL(specifier, layerUrl).href)}`;
    return match;
  });
  const transformed = await transformWithOxc(source, layerUrl.pathname, { lang: 'jsx' });
  const code = transformed.code.replaceAll('"react/jsx-runtime"', JSON.stringify(pathToFileURL(require.resolve('react/jsx-runtime')).href));
  return (await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)).default;
}

async function mountForm(t, { initial = '', type = 'text', persisted = [] } = {}) {
  const dom = new JSDOM('<div id="root"></div><button id="undo">Undo</button>', { pretendToBeVisual: true, url: 'http://localhost/' });
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const Layer = await loadLayer();
  const commits = [], blurs = [], errors = [], pages = { current: {} };
  let api, fail = false;
  dom.window.addEventListener('error', event => { errors.push(event.error); event.preventDefault(); });
  const widget = { id: 'date', subtype: 'Widget', fieldName: 'inspection.date', fieldType: 'Tx',
    fieldValue: initial, testInputType: type, rect: [0, 0, 100, 20] };
  const pdf = { annotationStorage: { values: new Map(), setValue(id, value) { this.values.set(id, value); } },
    async getPage() { return { rotate: 0, getAnnotations: async () => [widget], getViewport: () => ({ width: 100, height: 100 }) }; } };
  function Probe({ seed }) {
    api = usePdfjsFormFieldPersistence({ documentId: 'doc', userId: 'actor', documentGeneration: pdf,
      annotationsByPageRef: pages, handleSaveAnnotations(page, next) {
        if (fail) throw new Error('save failed');
        commits.push([page, next]); pages.current = { ...pages.current, [page]: next };
      } });
    return React.createElement(Layer, { pdf, pageNumber: 1, persistedValues: seed,
      onFieldChange: payload => api.handlePdfjsFormFieldChange(1, payload),
      onFieldBlur: payload => { blurs.push(payload); api.handlePdfjsFormFieldBlur(1, payload); } });
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  const render = async seed => { await act(async () => { root.render(React.createElement(Probe, { seed })); }); };
  await render(persisted);
  assert.equal(document.querySelector('.pdfjsFormLayer')?.dataset.persistenceReady, 'true');
  const input = document.querySelector('input');
  return { input, commits, blurs, errors, pages, render, get api() { return api; },
    setFail(value) { fail = value; },
    focus: () => input.focus(), blur: () => document.getElementById('undo').focus(),
    event: name => input.dispatchEvent(new dom.window.Event(name, { bubbles: true })) };
}

test('focusing an untouched blank PDF field then Undo does not save or add history', async t => {
  const h = await mountForm(t);
  h.focus(); h.blur();
  assert.equal(h.blurs.length, 1, 'blur notification still reaches its caller');
  assert.equal(h.blurs[0].unchanged, true);
  assert.equal(h.api.flushPendingFormFields(), 0);
  assert.deepEqual(h.commits, []);
});

test('untouched native nonempty text and late hydrated app values also do not save', async t => {
  const h = await mountForm(t, { initial: 'Original PDF value' });
  h.focus(); h.blur();
  assert.deepEqual(h.commits, []);
  await h.render([{ fieldId: 'date', value: 'Saved app value' }]);
  assert.equal(h.input.value, 'Saved app value');
  h.focus(); h.blur();
  assert.equal(h.blurs.at(-1).unchanged, true);
  assert.deepEqual(h.commits, []);
});

test('explicitly clearing original nonempty text commits the empty value on quick blur', async t => {
  const h = await mountForm(t, { initial: 'Original PDF value' });
  h.focus(); h.input.value = ''; h.event('input'); h.blur();
  assert.equal(h.blurs.at(-1).unchanged, undefined);
  assert.equal(h.pages.current[1].objects[0].data.value, '');
  assert.equal(h.api.flushPendingFormFields(), 0);
  assert.equal(h.commits.length, 1);
});

test('quick typing and change-only edits still flush the latest field value', async t => {
  const h = await mountForm(t);
  h.focus(); h.input.value = 'quick'; h.event('input'); h.blur();
  assert.equal(h.pages.current[1].objects[0].data.value, 'quick');
  h.focus(); h.input.value = 'change only'; h.event('change'); h.blur();
  assert.equal(h.pages.current[1].objects[0].data.value, 'change only');
  assert.equal(h.commits.length, 2);
});

test('untouched checked values do not save while explicit unchecking does', async t => {
  const h = await mountForm(t, { type: 'checkbox', persisted: [{ fieldId: 'date', value: true }] });
  assert.equal(h.input.checked, true);
  h.focus(); h.blur();
  assert.deepEqual(h.commits, []);
  h.focus(); h.input.checked = false; h.event('input'); h.event('change'); h.blur();
  assert.equal(h.pages.current[1].objects[0].data.value, false);
  assert.equal(h.commits.length, 1);
});

test('a failed blur commit remains retryable even after a later untouched focus/blur', async t => {
  const h = await mountForm(t);
  h.setFail(true);
  h.focus(); h.input.value = 'keep me'; h.event('input'); h.blur();
  assert.match(h.errors[0]?.message, /save failed/);
  assert.deepEqual(h.commits, []);
  h.setFail(false);
  h.focus(); h.blur();
  assert.equal(h.blurs.at(-1).unchanged, true);
  assert.equal(h.pages.current[1].objects[0].data.value, 'keep me');
  assert.equal(h.api.flushPendingFormFields(), 0);
  assert.equal(h.commits.length, 1);
});

test('DOM changes without edit events and blur without observed focus stay conservative', async t => {
  const h = await mountForm(t, { initial: 'native' });
  h.focus(); h.input.value = 'changed DOM'; h.blur();
  assert.equal(h.blurs.at(-1).unchanged, undefined);
  assert.equal(h.pages.current[1].objects[0].data.value, 'changed DOM');
  h.input.value = 'no focus'; h.event('blur');
  assert.equal(h.blurs.at(-1).unchanged, undefined);
  assert.equal(h.pages.current[1].objects[0].data.value, 'no focus');
});

test('typing back to the focus baseline still replaces a newer pending payload', async t => {
  const h = await mountForm(t, { initial: 'original' });
  h.focus(); h.input.value = 'temporary'; h.event('input');
  h.input.value = 'original'; h.event('input'); h.blur();
  assert.equal(h.blurs.at(-1).unchanged, undefined);
  assert.equal(h.pages.current[1].objects[0].data.value, 'original');
  assert.equal(h.api.flushPendingFormFields(), 0);
});
