import { test } from 'node:test';
import assert from 'node:assert/strict';
import React, { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { buildFormFieldObject, usePdfjsFormFieldPersistence } from '../usePdfjsFormFieldPersistence.js';

async function mountFields(t, initialProps = {}, strict = false) {
  const dom = new JSDOM('<div id="root"></div>');
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const commits = [], pages = { current: {} };
  let api, fail = false, unmounted = false;
  const save = (page, next) => {
    if (fail) throw new Error('save failed');
    commits.push([page, next]);
    pages.current = { ...pages.current, [page]: next };
  };
  function Probe({ duringLayout, ...props }) {
    api = usePdfjsFormFieldPersistence({ handleSaveAnnotations: save, annotationsByPageRef: pages,
      documentId: 'doc-a', userId: 'actor-a', ...props });
    useLayoutEffect(() => { duringLayout?.(); });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  const render = props => act(async () => root.render(strict
    ? React.createElement(React.StrictMode, null, React.createElement(Probe, props))
    : React.createElement(Probe, props)));
  const unmount = async () => { if (!unmounted) { unmounted = true; await act(async () => root.unmount()); } };
  t.after(async () => {
    await unmount(); dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  await render(initialProps);
  return { get api() { return api; }, commits, pages, render, unmount, setFail: value => { fail = value; } };
}

test('a new page generation fences pending and retained form callbacks before effect cleanup', async t => {
  const h = await mountFields(t, { documentGeneration: {} });
  const retired = h.api;
  retired.handlePdfjsFormFieldChange(1, { fieldId: 'a', value: 'old page' });
  let layoutFlush;
  await h.render({ documentGeneration: {}, duringLayout() {
    layoutFlush = retired.flushPendingFormFields();
    retired.handlePdfjsFormFieldBlur(1, { fieldId: 'a', value: 'old page', unchanged: true });
    retired.handlePdfjsFormFieldBlur(1, { fieldId: 'a', value: 'old blur' });
    retired.handlePdfjsFormFieldChange(1, { fieldId: 'a', value: 'old input' });
  } });
  assert.equal(layoutFlush, 0);
  assert.equal(h.api.flushPendingFormFields(), 0);
  await new Promise(resolve => setTimeout(resolve, 430));
  assert.deepEqual(h.commits, []);
  h.api.handlePdfjsFormFieldBlur(2, { fieldId: 'a', value: 'new page' });
  assert.equal(h.pages.current[2].objects[0].data.value, 'new page');
});

test('only explicit unchanged proof suppresses a new blur carrier', async t => {
  const h = await mountFields(t);
  h.api.handlePdfjsFormFieldBlur(1, { fieldId: 'a', value: '', unchanged: true });
  assert.deepEqual(h.commits, []);
  for (const unchanged of [undefined, false, 'true']) {
    h.api.handlePdfjsFormFieldBlur(1, { fieldId: 'a', value: '', unchanged });
  }
  assert.equal(h.commits.length, 3);
});

for (const strict of [false, true]) {
  test(`returning to the same generation never revives retired callbacks${strict ? ' in StrictMode' : ''}`, async t => {
    const first = {}, second = {};
    const h = await mountFields(t, { documentGeneration: first }, strict);
    const original = h.api;
    original.handlePdfjsFormFieldChange(1, { fieldId: 'a', value: 'stale A' });
    await h.render({ documentGeneration: second });
    const intermediate = h.api;
    intermediate.handlePdfjsFormFieldChange(1, { fieldId: 'a', value: 'stale B' });
    await h.render({ documentGeneration: first });
    for (const retired of [original, intermediate]) {
      retired.handlePdfjsFormFieldChange(1, { fieldId: 'a', value: 'retired change' });
      retired.handlePdfjsFormFieldBlur(1, { fieldId: 'a', value: 'retired blur' });
      assert.equal(retired.flushPendingFormFields(), 0);
    }
    assert.deepEqual(h.commits, []);
    h.api.handlePdfjsFormFieldChange(2, { fieldId: 'a', value: 'fresh A' });
    assert.equal(h.api.flushPendingFormFields(), 1);
    assert.equal(h.pages.current[2].objects[0].data.value, 'fresh A');
    const last = h.api;
    await h.unmount();
    last.handlePdfjsFormFieldBlur(2, { fieldId: 'a', value: 'unmounted' });
    assert.equal(last.flushPendingFormFields(), 0);
    assert.equal(h.commits.length, 1);
  });
}

test('a generation change cancels a pending timer without committing the old page', async t => {
  const h = await mountFields(t, { documentGeneration: {} });
  h.api.handlePdfjsFormFieldChange(1, { fieldId: 'a', value: 'stale timer' });
  await h.render({ documentGeneration: {} });
  await new Promise(resolve => setTimeout(resolve, 430));
  assert.deepEqual(h.commits, []);
  assert.equal(h.api.flushPendingFormFields(), 0);
});

for (const generation of [undefined, {}]) {
  test(`unchanged ${generation ? 'opaque generation' : 'omitted generation'} preserves pending edits and failed-flush retry`, async t => {
    const props = { documentGeneration: generation };
    const h = await mountFields(t, props);
    h.api.handlePdfjsFormFieldChange(1, { fieldId: 'a', value: 'captured before move' });
    await h.render(props);
    h.setFail(true);
    assert.throws(() => h.api.flushPendingFormFields(), /save failed/);
    assert.deepEqual(h.commits, []);
    // A caller must stop its page action on this exception and retain the
    // generation. A later retry can still capture the pending field.
    await h.render(props);
    h.setFail(false);
    assert.equal(h.api.flushPendingFormFields(), 1);
    assert.equal(h.pages.current[1].objects[0].data.value, 'captured before move');
    await h.render({ documentGeneration: {} });
    assert.equal(h.api.flushPendingFormFields(), 0);
    assert.equal(h.commits.length, 1);
  });
}

test('form-field carrier derives positive bounds from either rect direction', () => {
  const forward = buildFormFieldObject(2, { fieldId: 'f1', rect: [10, 20, 110, 70], value: 'x' }, null, 'u1');
  const reversed = buildFormFieldObject(2, { fieldId: 'f1', rect: [110, 70, 10, 20], value: 'x' }, null, 'u1');
  for (const object of [forward, reversed]) {
    assert.deepEqual([object.left, object.top, object.width, object.height], [10, 20, 100, 50]);
  }
});

test('form-field carrier keeps the original author and stable id', () => {
  const object = buildFormFieldObject(4, {
    fieldId: 'abc', fieldName: 'Name', fieldType: 'text', value: 'Bob', rect: [0, 0, 1, 1],
  }, 'alice', 'bob');
  assert.equal(object.data.id, 'form-field:4:abc');
  assert.equal(object.meta.authorId, 'alice');
  assert.equal(object.data.value, 'Bob');
});

test('form-field carrier defaults missing rect and metadata safely', () => {
  const object = buildFormFieldObject(1, { fieldId: 'f', value: 'v' }, null, null);
  assert.deepEqual([object.left, object.top, object.width, object.height], [0, 0, 0, 0]);
  assert.equal(object.data.rect, null);
  assert.equal(object.data.fieldName, null);
  assert.equal(object.data.fieldType, null);
  assert.equal(object.meta.authorId, null);
});
