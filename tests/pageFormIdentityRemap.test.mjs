import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import { PDFDocument } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { mutatePdfPages, mutatePdfPagesWithIdentity } from '../src/utils/pdfPageMutation.js';
import { transformPageState } from '../src/utils/pageAnnotationReindex.js';
import { buildFormFieldObject, usePdfjsFormFieldPersistence } from '../src/hooks/usePdfjsFormFieldPersistence.js';

async function fixture() {
  const pdf = await PDFDocument.create();
  for (let index = 0; index < 3; index++) {
    const page = pdf.addPage([200 + index * 10, 200]);
    const field = pdf.getForm().createTextField(`field-${index}`);
    field.setText(`pdf-value-${index}`);
    field.addToPage(page, { x: 10, y: 10, width: 80, height: 25 });
  }
  return pdf.save();
}

async function widgets(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const pdf = await task.promise;
    const result = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      for (const widget of await page.getAnnotations({ intent: 'display' })) {
        if (widget.subtype === 'Widget') result.push({ ...widget, pageNumber });
      }
    }
    return result;
  } finally { await task.destroy(); }
}

function modelFor(nativeWidgets) {
  const annotationsByPage = {};
  for (const widget of nativeWidgets) {
    const object = buildFormFieldObject(widget.pageNumber, {
      fieldId: widget.id, fieldName: widget.fieldName, fieldType: widget.fieldType,
      rect: widget.rect, value: `saved-${widget.fieldName}`,
    }, `author-${widget.fieldName}`, 'different-editor');
    (annotationsByPage[widget.pageNumber] ||= { objects: [] }).objects.push(object);
  }
  return { annotationsByPage };
}

const operations = [
  { type: 'move', from: 1, to: 3 },
  { type: 'insert', afterPage: 1 },
  { type: 'delete', page: 1 },
  { type: 'duplicate', page: 1 },
  { type: 'copy', source: 3, afterPage: 1 },
  { type: 'rotate', page: 2, delta: 90 },
];

for (const operation of operations) {
  test(`${operation.type}: surviving native widgets retain their IDs while app carrier IDs follow pages`, async () => {
    const bytes = await fixture();
    const before = await widgets(bytes);
    const input = modelFor(before);
    const untouched = structuredClone(input);
    const result = await mutatePdfPagesWithIdentity(bytes, operation);
    const after = await widgets(result.bytes);
    const transformed = transformPageState(input, operation, result);
    for (const original of before) {
      const native = after.find(widget => widget.id === original.id);
      if (!native) {
        assert.equal(operation.type, 'delete');
        assert.equal(Object.values(transformed.annotationsByPage).some(page =>
          page.objects.some(object => object.data.fieldId === original.id)), false);
        continue;
      }
      const object = transformed.annotationsByPage[native.pageNumber].objects.find(candidate => candidate.data.fieldId === original.id);
      assert.ok(object, 'surviving widget has its existing saved carrier');
      assert.equal(object.data.id, `form-field:${native.pageNumber}:${native.id}`);
      assert.equal(object.data.fieldId, original.id, 'native widget identity must not be guessed or rewritten');
      assert.equal(object.data.value, `saved-${original.fieldName}`);
      assert.equal(object.meta.authorId, `author-${original.fieldName}`);
      assert.equal(object.pageNumber, native.pageNumber);
      assert.equal(object.data.pageNumber, native.pageNumber);
    }
    assert.deepEqual(input, untouched, 'remapping must not mutate the original snapshot');
  });
}

test('a mounted form persistence hook edits a moved widget once and preserves its original author', async t => {
  const bytes = await fixture();
  const before = await widgets(bytes);
  const operation = { type: 'move', from: 1, to: 3 };
  const after = await widgets(await mutatePdfPages(bytes, operation));
  const moved = after.find(widget => widget.id === before[0].id);
  const pages = { current: transformPageState(modelFor(before), operation).annotationsByPage };
  const dom = new JSDOM('<div id="root"></div>');
  const originals = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  let api;
  function Probe() {
    api = usePdfjsFormFieldPersistence({ documentId: 'same-document', userId: 'new-editor', annotationsByPageRef: pages,
      handleSaveAnnotations: (page, next) => { pages.current = { ...pages.current, [page]: next }; } });
    return null;
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  await act(async () => root.render(React.createElement(Probe)));
  await act(async () => api.handlePdfjsFormFieldBlur(moved.pageNumber, {
    fieldId: moved.id, fieldName: moved.fieldName, fieldType: moved.fieldType, rect: moved.rect, value: 'edited-after-move',
  }));
  assert.equal(pages.current[moved.pageNumber].objects.length, 1, 'edit replaces the existing carrier, not a second object');
  assert.equal(pages.current[moved.pageNumber].objects[0].meta.authorId, 'author-field-0');
  assert.equal(pages.current[moved.pageNumber].objects[0].data.value, 'edited-after-move');
});

for (const operation of [{ type: 'duplicate', page: 1 }, { type: 'copy', source: 3, afterPage: 1 }]) {
  test(`${operation.type}: saved copied values use the writer's real widget IDs and unique field names`, async () => {
    const bytes = await fixture();
    const before = await widgets(bytes);
    const result = await mutatePdfPagesWithIdentity(bytes, operation);
    const after = await widgets(result.bytes);
    const clone = after.find(widget => !before.some(original => original.id === widget.id));
    assert.ok(clone, 'actual pdf-lib copy emits a new PDF.js widget ID');
    const source = before.find(widget => widget.pageNumber === (operation.page || operation.source));
    assert.notEqual(clone.fieldName, source.fieldName, 'copy has its own registered field');
    const output = transformPageState(modelFor(before), operation, result);
    const carrier = output.annotationsByPage[clone.pageNumber].objects[0];
    assert.equal(carrier.data.fieldId, clone.id);
    assert.equal(carrier.data.fieldName, clone.fieldName);
    assert.equal(carrier.data.id, `form-field:${clone.pageNumber}:${clone.id}`);
    assert.equal(carrier.data.value, `saved-${source.fieldName}`);
    assert.equal(carrier.meta.authorId, `author-${source.fieldName}`);
  });
}

test('copy fails closed when a saved field has no proven native identity, leaving input intact', () => {
  const model = { annotationsByPage: { 1: { objects: [buildFormFieldObject(1, { fieldId: '9R', value: '' }, 'author', 'editor')] } } };
  const before = structuredClone(model);
  assert.throws(() => transformPageState(model, { type: 'duplicate', page: 1 }), /could not be matched/);
  assert.deepEqual(model, before);
});

test('copied form map rejects wrong pages, aliases and conflicts; repeated identical entries remain one field', () => {
  const object = buildFormFieldObject(1, { fieldId: '9R', value: false }, 'author', 'editor');
  Object.assign(object, { id: 'custom', annotationId: 'custom' });
  object.data.id = 'custom';
  const model = { annotationsByPage: { 1: { objects: [object] } } };
  const op = { type: 'duplicate', page: 1 };
  const entry = { sourcePage: 1, targetPage: 2, sourceFieldId: '9R', targetFieldId: '99R', targetFieldName: 'copied' };
  for (const copiedWidgets of [
    [{ ...entry, targetPage: 3 }], [{ ...entry, targetFieldId: '9R' }],
    [entry, { ...entry, targetFieldId: '100R' }],
    [entry, { ...entry, sourceFieldId: '10R' }],
  ]) assert.throws(() => transformPageState(model, op, { copiedWidgets }), /identity/);
  const result = transformPageState(model, op, { copiedWidgets: [entry, { ...entry }] });
  const carrier = result.annotationsByPage[2].objects[0];
  assert.equal(carrier.id, 'form-field:2:99R');
  assert.equal(carrier.annotationId, 'form-field:2:99R');
  assert.equal(carrier.data.id, 'form-field:2:99R');
  assert.equal(carrier.data.value, false);
  assert.equal(result.annotationsByPage[2].objects.length, 1);
  assert.equal(model.annotationsByPage[1].objects[0].data.id, 'custom');
});

test('non-form identities and native field IDs are not rewritten by spelling alone', () => {
  const object = { type: 'rect', pageNumber: 1, data: { type: 'rect', id: 'form-field:1:9R', fieldId: '9R', pageNumber: 1 } };
  const transformed = transformPageState({ annotationsByPage: { 1: { objects: [object] } } }, { type: 'move', from: 1, to: 2 });
  assert.equal(transformed.annotationsByPage[2].objects[0].data.id, object.data.id);
});

test('custom form carrier identities remain unchanged', () => {
  const object = buildFormFieldObject(1, { fieldId: '9R', value: 'saved' }, 'author', 'editor');
  object.data.id = 'custom-identity';
  const transformed = transformPageState({ annotationsByPage: { 1: { objects: [object] } } }, { type: 'move', from: 1, to: 2 });
  assert.equal(transformed.annotationsByPage[2].objects[0].data.id, 'custom-identity');
  assert.equal(transformed.annotationsByPage[2].objects[0].data.fieldId, '9R');
});
