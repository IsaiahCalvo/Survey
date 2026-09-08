import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { usePdfjsFormFieldPersistence } from '../src/hooks/usePdfjsFormFieldPersistence.js';

async function mount(t) {
  const dom = new JSDOM('<div id="root"></div><input id="focused">');
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const commits = [];
  const pages = { current: {} };
  let api;
  let fail = false;
  const save = (page, next) => { if (fail) throw new Error('commit failed'); commits.push([page, next]); pages.current = { ...pages.current, [page]: next }; };
  function Probe({ documentId = 'doc-a', userId = 'actor-a' }) {
    api = usePdfjsFormFieldPersistence({ handleSaveAnnotations: save, annotationsByPageRef: pages, documentId, userId });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  const render = props => act(async () => root.render(React.createElement(Probe, props)));
  await render({});
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return { get api() { return api; }, commits, pages, render, setFail: value => { fail = value; } };
}

test('one immediate flush commits the latest field payload and keeps focus', async t => {
  const h = await mount(t);
  const focused = document.getElementById('focused'); focused.focus();
  h.api.handlePdfjsFormFieldChange(1, { fieldId: 'siteRef', value: 'first' });
  h.api.handlePdfjsFormFieldChange(1, { fieldId: 'siteRef', value: 'latest' });
  assert.equal(h.commits.length, 0, 'input remains debounced until Save or blur');
  assert.equal(h.api.flushPendingFormFields(), 1);
  assert.equal(h.pages.current[1].objects[0].data.value, 'latest');
  assert.equal(document.activeElement, focused);
  assert.equal(h.api.flushPendingFormFields(), 0, 'canceled debounce cannot create a later duplicate edit');
  await new Promise(resolve => setTimeout(resolve, 430));
  assert.equal(h.commits.length, 1);
});

test('flush merges multiple fields and pages through the current snapshot ref', async t => {
  const h = await mount(t);
  for (const [page, fieldId] of [[1, 'a'], [1, 'b'], [2, 'a']]) {
    h.api.handlePdfjsFormFieldChange(page, { fieldId, value: `${page}-${fieldId}` });
  }
  assert.equal(h.api.flushPendingFormFields(), 3);
  assert.equal(h.pages.current[1].objects.length, 2);
  assert.equal(h.pages.current[2].objects.length, 1);
});

test('blur commits its newest value and removes the pending Save payload', async t => {
  const h = await mount(t);
  h.api.handlePdfjsFormFieldChange(1, { fieldId: 'a', value: 'input' });
  h.api.handlePdfjsFormFieldBlur(1, { fieldId: 'a', value: 'blur' });
  assert.equal(h.pages.current[1].objects[0].data.value, 'blur');
  assert.equal(h.api.flushPendingFormFields(), 0);
});

for (const changed of [{ documentId: 'doc-b' }, { userId: 'actor-b' }]) {
  test(`queued fields and retired callbacks cannot cross ${Object.keys(changed)[0]}`, async t => {
    const h = await mount(t);
    const retired = h.api;
    retired.handlePdfjsFormFieldChange(1, { fieldId: 'a', value: 'old scope' });
    await h.render(changed);
    assert.equal(retired.flushPendingFormFields(), 0);
    retired.handlePdfjsFormFieldBlur(1, { fieldId: 'a', value: 'retired blur' });
    assert.equal(h.api.flushPendingFormFields(), 0);
    assert.equal(h.commits.length, 0);
    h.api.handlePdfjsFormFieldChange(1, { fieldId: 'a', value: 'new scope' });
    assert.equal(h.api.flushPendingFormFields(), 1);
    assert.equal(h.pages.current[1].objects[0].data.value, 'new scope');
  });
}

test('a failed synchronous commit remains queued for explicit retry', async t => {
  const h = await mount(t);
  h.api.handlePdfjsFormFieldChange(1, { fieldId: 'a', value: 'retry' });
  h.setFail(true);
  assert.throws(() => h.api.flushPendingFormFields(), /commit failed/);
  h.setFail(false);
  assert.equal(h.api.flushPendingFormFields(), 1);
  assert.equal(h.pages.current[1].objects[0].data.value, 'retry');
});
