import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { JSDOM } from 'jsdom';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFHexString } from 'pdf-lib';
import { getDocument, AnnotationLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as pageMutation from '../src/utils/pdfPageMutation.js';
import { applyFormFieldValuesToPdfDoc } from '../src/utils/pdfFormFieldExport.js';

const require = createRequire(import.meta.url);
const standardFontDataUrl = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts/');
const box = (y, x = 20) => ({ x, y, width: 100, height: 20 });
const mark = (y, x = 20) => ({ x, y, width: 16, height: 16 });

async function fixture() {
  const doc = await PDFDocument.create();
  const first = doc.addPage([500, 700]);
  const second = doc.addPage([500, 700]);
  const form = doc.getForm();
  const text = form.createTextField('text');
  text.setText('current source text'); text.addToPage(first, box(620));
  const shared = form.createTextField('shared');
  shared.setText('current shared value');
  shared.addToPage(first, box(570));
  shared.addToPage(second, box(570));
  shared.addToPage(first, box(570, 180));
  const checkbox = form.createCheckBox('checkbox');
  checkbox.addToPage(first, mark(520)); checkbox.addToPage(second, mark(520)); checkbox.check();
  const radio = form.createRadioGroup('radio');
  // The omitted page's option is in the MIDDLE of /Kids and /Opt.
  radio.addOptionToPage('A', first, mark(470));
  radio.addOptionToPage('C', second, mark(470));
  radio.addOptionToPage('B', first, mark(470, 60));
  radio.select('A');
  const dropdown = form.createDropdown('dropdown');
  dropdown.addOptions(['Alpha', 'Beta']); dropdown.select('Alpha'); dropdown.addToPage(first, box(420));
  const list = form.createOptionList('list');
  list.addOptions(['Red', 'Blue']); list.select('Red'); list.addToPage(first, box(370));
  return doc.save();
}

async function open(bytes) {
  const task = getDocument({ data: bytes.slice(), isEvalSupported: false, standardFontDataUrl });
  try { return { task, pdf: await task.promise }; }
  catch (error) { await task.destroy(); throw error; }
}

async function inspect(bytes) {
  const { task, pdf } = await open(bytes);
  try {
    const pages = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      pages.push((await (await pdf.getPage(n)).getAnnotations()).filter(a => a.subtype === 'Widget'));
    }
    return { pages, fields: await pdf.getFieldObjects() };
  } finally { await task.destroy(); }
}

async function copied(input = null) {
  assert.equal(typeof pageMutation.mutatePdfPagesWithIdentity, 'function', 'real page writer must return its copied widget identity receipt');
  const bytes = input || await fixture();
  const original = await inspect(bytes);
  const result = await pageMutation.mutatePdfPagesWithIdentity(bytes, { type: 'copy', source: 1, afterPage: 1 });
  assert.ok(result.bytes instanceof Uint8Array);
  assert.ok(Array.isArray(result.copiedWidgets));
  const after = await inspect(result.bytes);
  return { ...result, original, after };
}

function mappingFor(result, name, predicate = () => true) {
  const original = result.original.pages[0].find(a => a.fieldName === name && predicate(a));
  assert.ok(original, `source widget ${name}`);
  const receipt = result.copiedWidgets.find(row => row.sourcePage === 1 && row.targetPage === 2 && row.sourceFieldId === original.id);
  assert.ok(receipt, `mapped widget ${original.id}`);
  const target = result.after.pages[1].find(a => a.id === receipt.targetFieldId);
  assert.ok(target, 'target ID must resolve on the inserted page');
  assert.equal(receipt.targetFieldName, target.fieldName);
  return { original, receipt, target };
}

function setEntry(result, name, value, predicate) {
  const { target } = mappingFor(result, name, predicate);
  return { pageNumber: 2, fieldId: target.id, fieldName: target.fieldName, value };
}

test('copied form fields are registered, independently named, page-bound and retain source values/groups', async () => {
  const result = await copied();
  const oldIds = new Set(result.original.pages.flat().map(w => w.id));
  const registered = Object.values(result.after.fields || {}).flat();
  assert.equal(result.copiedWidgets.length, result.original.pages[0].length);
  assert.equal(new Set(result.copiedWidgets.map(row => row.targetFieldId)).size, result.copiedWidgets.length);
  for (const original of result.original.pages[0]) {
    const { target } = mappingFor(result, original.fieldName, a => a.id === original.id);
    assert.equal(oldIds.has(target.id), false);
    assert.notEqual(target.fieldName, original.fieldName);
    assert.deepEqual(target.fieldValue, original.fieldValue);
    assert.equal(target.fieldType, original.fieldType);
    assert.ok(registered.some(field => field.id === target.id && field.page === 1));
  }
  assert.deepEqual(result.after.pages[0].map(w => [w.id, w.fieldName, w.fieldValue]), result.original.pages[0].map(w => [w.id, w.fieldName, w.fieldValue]));
  assert.deepEqual(result.after.pages[2].map(w => [w.id, w.fieldName, w.fieldValue]), result.original.pages[1].map(w => [w.id, w.fieldName, w.fieldValue]));
  const doc = await PDFDocument.load(result.bytes);
  const copyPage = doc.getPage(1);
  const copyRefs = new Set(copyPage.node.Annots().asArray().map(String));
  for (const field of doc.getForm().getFields().filter(field => !['text', 'shared', 'checkbox', 'radio', 'dropdown', 'list'].includes(field.getName()))) {
    for (const widget of field.acroField.getWidgets()) {
      assert.equal(String(widget.P()), String(copyPage.ref), 'copied widget /P must be the actual inserted page');
      assert.ok(copyRefs.has(String(doc.context.getObjectRef(widget.dict))), 'no phantom sibling widgets');
    }
  }
  const sharedName = mappingFor(result, 'shared').target.fieldName;
  assert.equal(result.after.fields[sharedName].filter(field => field.page !== -1).length, 2);
  assert.equal(result.after.fields.shared.filter(field => field.page !== -1).length, 3);
  const radioName = mappingFor(result, 'radio').target.fieldName;
  assert.deepEqual(doc.getForm().getRadioGroup(radioName).getOptions(), ['A', 'B']);
  assert.deepEqual(doc.getForm().getRadioGroup('radio').getOptions(), ['A', 'C', 'B']);
});

test('actual export writer writes copied text, shared text, checkbox and choice fields without changing originals', async () => {
  const result = await copied();
  const doc = await PDFDocument.load(result.bytes);
  const entries = [setEntry(result, 'text', 'copy edit'), setEntry(result, 'shared', 'copy shared edit'), setEntry(result, 'checkbox', false), setEntry(result, 'dropdown', 'Beta'), setEntry(result, 'list', 'Blue')];
  const diagnostics = applyFormFieldValuesToPdfDoc(doc, entries);
  assert.equal(diagnostics.formFieldValuesWritten, 5);
  assert.equal(diagnostics.formFieldValuesSkipped, 0);
  const roundTrip = await inspect(await doc.save({ updateFieldAppearances: false }));
  for (const entry of entries) {
    const actual = roundTrip.pages[1].find(widget => widget.id === entry.fieldId);
    const expected = entry.value === false ? 'Off' : ['Beta', 'Blue'].includes(entry.value) ? [entry.value] : entry.value;
    assert.deepEqual(actual.fieldValue, expected);
  }
  for (const page of [0, 2]) {
    const sourcePage = page === 2 ? 1 : 0;
    assert.deepEqual(roundTrip.pages[page].map(w => [w.id, w.fieldValue]), result.original.pages[sourcePage].map(w => [w.id, w.fieldValue]));
  }
  const sharedName = mappingFor(result, 'shared').target.fieldName;
  assert.deepEqual(roundTrip.pages[1].filter(w => w.fieldName === sharedName).map(w => w.fieldValue), ['copy shared edit', 'copy shared edit']);
});

test('copied radio exports one selected option with coherent appearances and leaves original group untouched', async () => {
  const result = await copied();
  const doc = await PDFDocument.load(result.bytes);
  const selected = setEntry(result, 'radio', true, widget => widget.buttonValue === 'B');
  assert.equal(applyFormFieldValuesToPdfDoc(doc, [selected]).formFieldValuesWritten, 1);
  const group = doc.getForm().getRadioGroup(selected.fieldName);
  assert.equal(group.getSelected(), 'B');
  assert.equal(doc.getForm().getRadioGroup('radio').getSelected(), 'A');
  const active = group.acroField.getWidgets().filter(w => String(w.dict.get(PDFName.of('AS'))) !== '/Off');
  assert.equal(active.length, 1, 'selecting B must clear prior A /AS, even without an explicit false carrier');
  const reopened = await inspect(await doc.save({ updateFieldAppearances: false }));
  assert.deepEqual(reopened.pages[1].filter(w => w.fieldName === selected.fieldName).map(w => [w.buttonValue, w.fieldValue]), [['A', 'B'], ['B', 'B']]);
  assert.equal(reopened.pages[0].find(w => w.fieldName === 'radio').fieldValue, 'A');
  assert.equal(applyFormFieldValuesToPdfDoc(doc, [{ ...selected, value: false }]).formFieldValuesWritten, 1);
  assert.equal(group.getSelected(), undefined, 'false clears the selected export option, not its numeric appearance name');
  assert.ok(group.acroField.getWidgets().every(w => String(w.dict.get(PDFName.of('AS'))) === '/Off'));
});

test('old duplicate-name orphan widgets cannot make export write the original field', async () => {
  const doc = await PDFDocument.load(await fixture());
  // Deliberately reproduce the former copyPages-only structure, independent
  // of the new writer: same names, new widgets, unregistered parent fields.
  const [orphanPage] = await doc.copyPages(doc, [0]); doc.insertPage(1, orphanPage);
  const bytes = await doc.save(); const view = await inspect(bytes);
  const reload = await PDFDocument.load(bytes);
  const target = view.pages[1].find(w => w.fieldName === 'text');
  const diagnostic = applyFormFieldValuesToPdfDoc(reload, [{ pageNumber: 2, fieldId: target.id, fieldName: 'text', value: 'must not hit original' }]);
  assert.equal(reload.getForm().getTextField('text').getText(), 'current source text');
  assert.equal(diagnostic.formFieldValuesWritten, 0);
  assert.equal(diagnostic.formFieldSkipReasons['widget-field-mismatch'], 1);
});

test('duplicate radio export labels still select and clear the exact widget on-state', async () => {
  const doc = await PDFDocument.create(), page = doc.addPage();
  const group = doc.getForm().createRadioGroup('duplicate-options');
  group.addOptionToPage('A', page, mark(400));
  group.addOptionToPage('B', page, mark(400, 60));
  group.select('B');
  group.acroField.dict.set(PDFName.of('Opt'), doc.context.obj([PDFHexString.fromText('Same'), PDFHexString.fromText('Same')]));
  const entry = index => ({ pageNumber: 1, fieldId: `${page.node.Annots().get(index).objectNumber}R`, fieldName: 'duplicate-options', value: true });
  const firstOn = group.acroField.getWidgets()[0].getOnValue();
  assert.equal(applyFormFieldValuesToPdfDoc(doc, [entry(0)]).formFieldValuesWritten, 1);
  assert.equal(group.acroField.getValue(), firstOn, 'the second Same label must not steal the first widget selection');
  assert.equal(applyFormFieldValuesToPdfDoc(doc, [{ ...entry(1), value: false }]).formFieldValuesWritten, 1);
  assert.equal(group.acroField.getValue(), firstOn, 'false on a different widget cannot clear the selected widget');
  assert.equal(group.acroField.getWidgets().filter(w => String(w.dict.get(PDFName.of('AS'))) !== '/Off').length, 1);
  assert.equal(applyFormFieldValuesToPdfDoc(doc, [{ ...entry(0), value: false }]).formFieldValuesWritten, 1);
  assert.equal(group.getSelected(), undefined);
  assert.ok(group.acroField.getWidgets().every(w => String(w.dict.get(PDFName.of('AS'))) === '/Off'));
  assert.deepEqual(group.getOptions(), ['Same', 'Same']);
});

test('real PDF.js controls keep copied fields independent while original and copied multi-widget groups still work', async t => {
  const result = await copied();
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const previous = new Map();
  for (const [name, value] of Object.entries({ window: dom.window, document: dom.window.document })) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const { task, pdf } = await open(result.bytes);
  t.after(async () => {
    await task.destroy(); dom.window.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  for (let pageNumber = 1; pageNumber <= 3; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const div = document.createElement('div'); document.body.append(div);
    // Correct installed SDK constructor contract. The app's render-only
    // annotationStorage mismatch is tracked separately, not hidden here.
    const layer = new AnnotationLayer({ div, page, viewport: page.getViewport({ scale: 1 }).clone({ dontFlip: true }), annotationStorage: pdf.annotationStorage });
    await layer.render({ annotations: (await page.getAnnotations()).filter(a => a.subtype === 'Widget'), renderForms: true, enableScripting: false, hasJSActions: false });
  }
  const element = id => document.querySelector(`[data-element-id="${id}"]`);
  const copiedText = mappingFor(result, 'text');
  element(copiedText.target.id).value = 'typed copy';
  element(copiedText.target.id).dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.equal(element(copiedText.original.id).value, 'current source text');
  const shared = mappingFor(result, 'shared');
  element(shared.target.id).value = 'new shared copy';
  element(shared.target.id).dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual([...document.getElementsByName(shared.target.fieldName)].map(el => el.value), ['new shared copy', 'new shared copy']);
  assert.deepEqual([...document.getElementsByName('shared')].map(el => el.value), ['current shared value', 'current shared value', 'current shared value']);
  element(shared.original.id).value = 'new original shared';
  element(shared.original.id).dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual([...document.getElementsByName('shared')].map(el => el.value), ['new original shared', 'new original shared', 'new original shared']);
  assert.deepEqual([...document.getElementsByName(shared.target.fieldName)].map(el => el.value), ['new shared copy', 'new shared copy']);
  const checkbox = mappingFor(result, 'checkbox');
  element(checkbox.target.id).checked = false;
  element(checkbox.target.id).dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.ok([...document.getElementsByName('checkbox')].every(el => el.checked));
  const radio = mappingFor(result, 'radio', w => w.buttonValue === 'B');
  element(radio.target.id).checked = true;
  element(radio.target.id).dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(element(mappingFor(result, 'radio', w => w.buttonValue === 'A').original.id).checked, true);
  assert.equal([...document.getElementsByName(radio.target.fieldName)].filter(el => el.checked).length, 1);
  const originalC = result.original.pages[1].find(w => w.fieldName === 'radio' && w.buttonValue === 'C');
  element(originalC.id).checked = true;
  element(originalC.id).dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal([...document.getElementsByName('radio')].filter(el => el.checked).length, 1);
  assert.equal(element(mappingFor(result, 'radio', w => w.buttonValue === 'A').original.id).checked, false);
  assert.equal(element(radio.target.id).checked, true, 'original cross-page radio group cannot uncheck copied B');
  assert.equal(pdf.annotationStorage.getRawValue(copiedText.target.id).value, 'typed copy');
  const reopened = await inspect(await pdf.saveDocument());
  assert.equal(reopened.pages[1].find(w => w.id === copiedText.target.id).fieldValue, 'typed copy');
  assert.equal(reopened.pages[0].find(w => w.id === copiedText.original.id).fieldValue, 'current source text');
  assert.equal(reopened.pages[1].find(w => w.id === radio.target.id).fieldValue, 'B');
  assert.equal(reopened.pages[2].find(w => w.id === originalC.id).fieldValue, 'C');
  assert.ok(Object.values(reopened.fields).flat().some(w => w.id === copiedText.target.id));
});

test('merged field/widget copies remain indexed, editable and independent after export', async () => {
  const doc = await PDFDocument.create(); const page = doc.addPage([300, 300]); const form = doc.getForm();
  const field = form.createTextField('merged'); field.setText('merged source'); field.addToPage(page, box(200));
  form.updateFieldAppearances();
  const widgetRef = page.node.Annots().get(0);
  const widget = doc.context.lookup(widgetRef, PDFDict);
  for (const [key, value] of field.acroField.dict.entries()) if (String(key) !== '/Kids') widget.set(key, value);
  widget.delete(PDFName.of('Parent'));
  const roots = doc.catalog.getOrCreateAcroForm().dict.lookup(PDFName.of('Fields'), PDFArray);
  roots.set(0, widgetRef);
  const result = await copied(await doc.save({ updateFieldAppearances: false }));
  const { target, original } = mappingFor(result, 'merged');
  const exportDoc = await PDFDocument.load(result.bytes);
  assert.equal(applyFormFieldValuesToPdfDoc(exportDoc, [{ pageNumber: 2, fieldId: target.id, fieldName: target.fieldName, value: 'merged copy' }]).formFieldValuesWritten, 1);
  const reopened = await inspect(await exportDoc.save({ updateFieldAppearances: false }));
  assert.equal(reopened.pages[0].find(w => w.id === original.id).fieldValue, 'merged source');
  assert.equal(reopened.pages[1].find(w => w.id === target.id).fieldValue, 'merged copy');
  assert.ok(Object.values(reopened.fields).flat().some(w => w.id === target.id && w.page === 1));
});

test('copied nested field keeps inherited type, flags, alignment and value without altering original ancestors', async () => {
  const doc = await PDFDocument.create(); const page = doc.addPage([300, 300]); const form = doc.getForm();
  const field = form.createTextField('section.inherited'); field.enableMultiline(); field.setAlignment(2); field.setText('inherited source'); field.addToPage(page, box(200));
  form.updateFieldAppearances();
  const parent = doc.context.lookup(field.acroField.dict.get(PDFName.of('Parent')), PDFDict);
  for (const name of ['FT', 'Ff', 'DA', 'Q', 'V']) {
    const key = PDFName.of(name); const value = field.acroField.dict.get(key);
    if (value) { parent.set(key, value); field.acroField.dict.delete(key); }
  }
  const parentBefore = parent.toString();
  const result = await copied(await doc.save({ updateFieldAppearances: false }));
  const { original, target } = mappingFor(result, 'section.inherited');
  assert.equal(target.fieldType, original.fieldType);
  assert.equal(target.multiLine, true);
  assert.equal(target.textAlignment, 2);
  assert.equal(target.fieldValue, 'inherited source');
  const reload = await PDFDocument.load(result.bytes);
  assert.equal(reload.context.lookup(field.acroField.dict.get(PDFName.of('Parent')), PDFDict).toString(), parentBefore);
  const parsed = reload.getForm().getTextField(target.fieldName);
  assert.equal(parsed.isMultiline(), true);
  assert.equal(parsed.getAlignment(), 2);
});

for (const selection of ['B', 'C']) {
  test(`copy preserves only included radio V and DV when original selects ${selection}`, async () => {
    const sourceDoc = await PDFDocument.load(await fixture());
    const original = sourceDoc.getForm().getRadioGroup('radio');
    original.select(selection);
    original.acroField.dict.set(PDFName.of('DV'), original.acroField.getValue());
    const originalValue = String(original.acroField.getValue());
    const result = await copied(await sourceDoc.save());
    const copyName = mappingFor(result, 'radio').target.fieldName;
    const doc = await PDFDocument.load(result.bytes);
    const copy = doc.getForm().getRadioGroup(copyName);
    assert.equal(copy.getSelected(), selection === 'B' ? 'B' : undefined);
    assert.equal(String(copy.acroField.dict.get(PDFName.of('DV'))), selection === 'B' ? originalValue : '/Off');
    assert.equal(doc.getForm().getRadioGroup('radio').getSelected(), selection);
    assert.equal(String(doc.getForm().getRadioGroup('radio').acroField.dict.get(PDFName.of('DV'))), originalValue);
    const on = copy.acroField.getWidgets().filter(widget => String(widget.dict.get(PDFName.of('AS'))) !== '/Off');
    assert.equal(on.length, selection === 'B' ? 1 : 0);
  });
}

test('merged widget under a nonterminal field group remains supported and independent', async () => {
  const doc = await PDFDocument.create(); const page = doc.addPage([300, 300]); const form = doc.getForm();
  const field = form.createTextField('section.merged'); field.setText('nested merged source'); field.addToPage(page, box(200));
  form.updateFieldAppearances();
  const widgetRef = page.node.Annots().get(0), widget = doc.context.lookup(widgetRef, PDFDict);
  const ancestorRef = field.acroField.dict.get(PDFName.of('Parent'));
  const ancestor = doc.context.lookup(ancestorRef, PDFDict);
  for (const [key, value] of field.acroField.dict.entries()) if (String(key) !== '/Kids') widget.set(key, value);
  widget.set(PDFName.of('Parent'), ancestorRef);
  ancestor.lookup(PDFName.of('Kids'), PDFArray).set(0, widgetRef);
  const result = await copied(await doc.save({ updateFieldAppearances: false }));
  const { target } = mappingFor(result, 'section.merged');
  assert.equal(target.fieldValue, 'nested merged source');
  assert.ok(Object.values(result.after.fields).flat().some(field => field.id === target.id && field.page === 1));
});
