import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFHexString, PDFName, PDFRef } from 'pdf-lib';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as writer from '../src/utils/pdfPageMutation.js';
import { applyFormFieldValuesToPdfDoc } from '../src/utils/pdfFormFieldExport.js';

async function read(bytes) {
  const task = pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true });
  try {
    const doc = await task.promise, pages = [];
    for (let n = 1; n <= doc.numPages; n++) pages.push(await (await doc.getPage(n)).getAnnotations());
    return { pages, fields: await doc.getFieldObjects() };
  } finally { await task.destroy(); }
}
async function fixture(kind = 'text') {
  const pdf = await PDFDocument.create(), a = pdf.addPage([200, 200]), b = pdf.addPage([200, 200]);
  const form = pdf.getForm();
  let field;
  const box = { x: 10, y: 10, width: 80, height: 20 };
  if (kind === 'text') { field = form.createTextField('original'); field.setText('before'); field.addToPage(a, box); }
  if (kind === 'checkbox') { field = form.createCheckBox('original'); field.addToPage(a, box); field.check(); }
  if (kind === 'choice') { field = form.createDropdown('original'); field.addOptions(['one', 'two']); field.select('one'); field.addToPage(a, box); }
  if (kind === 'radio') {
    field = form.createRadioGroup('original');
    field.addOptionToPage('A', a, box);
    field.addOptionToPage('B', a, { ...box, y: 40 });
    field.addOptionToPage('C', b, box); field.select('B');
  }
  return { pdf, a, b, field };
}
for (const kind of ['text', 'checkbox', 'choice', 'radio']) {
  test(`${kind}: copied widgets belong to a unique registered field on the actual page`, async () => {
    const { pdf } = await fixture(kind);
    const input = await pdf.save(), original = await read(input);
    const { bytes, copiedWidgets } = await writer.mutatePdfPagesWithIdentity(input, { type: 'duplicate', page: 1 });
    const after = await read(bytes), loaded = await PDFDocument.load(bytes);
    assert.equal(copiedWidgets.length, original.pages[0].length);
    assert.equal(new Set(copiedWidgets.map(row => row.targetFieldName)).size, 1);
    const copiedField = loaded.getForm().getField(copiedWidgets[0].targetFieldName);
    assert.notEqual(copiedField.getName(), 'original');
    for (const row of copiedWidgets) {
      assert.equal(row.sourcePage, 1); assert.equal(row.targetPage, 2);
      assert.ok(original.pages[0].some(widget => widget.id === row.sourceFieldId));
      const target = after.pages[1].find(widget => widget.id === row.targetFieldId);
      assert.ok(target); assert.equal(target.fieldName, row.targetFieldName);
      assert.ok(after.fields[row.targetFieldName].some(field => field.id === row.targetFieldId && field.page === 1));
      const match = /^(\d+)R(\d*)$/.exec(row.targetFieldId);
      const dict = loaded.context.lookup(PDFRef.of(Number(match[1]), Number(match[2] || 0)));
      assert.equal(String(dict.get(PDFName.of('P'))), String(loaded.getPage(1).ref));
      assert.equal(String(dict.get(PDFName.of('Parent'))), String(copiedField.ref));
    }
    if (kind === 'radio') {
      assert.deepEqual(copiedField.getOptions(), ['A', 'B']);
      assert.equal(copiedField.getSelected(), 'B');
      assert.deepEqual(loaded.getForm().getRadioGroup('original').getOptions(), ['A', 'B', 'C']);
    }
  });
}
test('editing and exporting a copied text widget changes the clone only', async () => {
  const { pdf } = await fixture();
  const result = await writer.mutatePdfPagesWithIdentity(await pdf.save(), { type: 'copy', source: 1, afterPage: 2 });
  const row = result.copiedWidgets[0], loaded = await PDFDocument.load(result.bytes);
  const diagnostics = applyFormFieldValuesToPdfDoc(loaded, [{ pageNumber: 3, fieldId: row.targetFieldId, fieldName: row.targetFieldName, value: 'clone edit' }]);
  assert.equal(diagnostics.formFieldValuesWritten, 1);
  const after = await read(await loaded.save({ updateFieldAppearances: false }));
  assert.equal(after.pages[0][0].fieldValue, 'before'); assert.equal(after.pages[2][0].fieldValue, 'clone edit');
});
test('missing Annots works and the bytes-only wrapper stays compatible', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage();
  const input = await pdf.save();
  const result = await writer.mutatePdfPagesWithIdentity(input, { type: 'duplicate', page: 1 });
  assert.deepEqual(result.copiedWidgets, []);
  assert.equal((await PDFDocument.load(await writer.mutatePdfPages(input, { type: 'duplicate', page: 1 }))).getPageCount(), 2);
});
test('nonzero source generations and repeated identical refs have one exact map entry', async () => {
  const { pdf, a, field } = await fixture();
  const dict = pdf.context.lookup(a.node.Annots().get(0)), ref = PDFRef.of(500, 7);
  pdf.context.assign(ref, dict); a.node.Annots().set(0, ref); a.node.Annots().push(ref); field.acroField.Kids().set(0, ref);
  const result = await writer.mutatePdfPagesWithIdentity(await pdf.save({ useObjectStreams: false }), { type: 'duplicate', page: 1 });
  assert.equal(result.copiedWidgets.length, 1); assert.equal(result.copiedWidgets[0].sourceFieldId, '500R7');
  assert.equal((await read(result.bytes)).pages[1].length, 1);
});
for (const operation of [{ type: 'duplicate', page: 1 }, { type: 'insert', afterPage: 1 }, { type: 'move', from: 1, to: 2 }, { type: 'delete', page: 2 }]) {
  test(`${operation.type}: direct widget identity fails before any byte publication`, async () => {
    const { pdf, a } = await fixture();
    a.node.Annots().set(0, pdf.context.lookup(a.node.Annots().get(0)));
    const input = await pdf.save(), snapshot = new Uint8Array(input);
    await assert.rejects(writer.mutatePdfPagesWithIdentity(input, operation), /direct.*widget|widget.*identity/i);
    assert.deepEqual(input, snapshot);
  });
}

test('merged field/widget dictionary splits into one new registered parent and widget', async () => {
  const { pdf, a, field } = await fixture();
  const ref = a.node.Annots().get(0), widget = pdf.context.lookup(ref);
  for (const [key, value] of field.acroField.dict.entries()) if (key !== PDFName.of('Kids')) widget.set(key, value);
  widget.delete(PDFName.of('Parent'));
  pdf.catalog.getAcroForm().dict.set(PDFName.of('Fields'), pdf.context.obj([ref]));
  const result = await writer.mutatePdfPagesWithIdentity(await pdf.save(), { type: 'duplicate', page: 1 });
  const after = await read(result.bytes), row = result.copiedWidgets[0];
  assert.equal(after.pages[0][0].fieldValue, 'before');
  assert.equal(after.pages[1][0].fieldValue, 'before');
  assert.ok(after.fields[row.targetFieldName].some(entry => entry.id === row.targetFieldId));
});

test('inherited field defaults and flags survive a new top-level field', async () => {
  const { pdf, field } = await fixture();
  field.enableReadOnly(); field.setMaxLength(33);
  const parent = pdf.context.obj({ T: PDFHexString.fromText('parent'), Kids: [field.ref] });
  for (const key of ['FT', 'Ff', 'V', 'DV', 'DA', 'Q', 'MaxLen']) {
    const value = field.acroField.dict.get(PDFName.of(key));
    if (value) { parent.set(PDFName.of(key), value); field.acroField.dict.delete(PDFName.of(key)); }
  }
  const parentRef = pdf.context.register(parent);
  field.acroField.dict.set(PDFName.of('Parent'), parentRef);
  pdf.catalog.getAcroForm().dict.set(PDFName.of('Fields'), pdf.context.obj([parentRef]));
  const result = await writer.mutatePdfPagesWithIdentity(await pdf.save(), { type: 'duplicate', page: 1 });
  const loaded = await PDFDocument.load(result.bytes), copy = loaded.getForm().getTextField(result.copiedWidgets[0].targetFieldName);
  assert.equal(copy.getText(), 'before'); assert.equal(copy.isReadOnly(), true); assert.equal(copy.getMaxLength(), 33);
});

test('repeated widgets retain one selected-page group and copies receive fresh names', async () => {
  const { pdf, a, b, field } = await fixture();
  field.addToPage(a, { x: 10, y: 60, width: 80, height: 20 });
  field.addToPage(b, { x: 10, y: 10, width: 80, height: 20 });
  const first = await writer.mutatePdfPagesWithIdentity(await pdf.save(), { type: 'duplicate', page: 1 });
  assert.equal(first.copiedWidgets.length, 2);
  const second = await writer.mutatePdfPagesWithIdentity(first.bytes, { type: 'duplicate', page: 2 });
  const loaded = await PDFDocument.load(second.bytes);
  const names = loaded.getForm().getFields().map(field => field.getName());
  assert.equal(new Set(names).size, 3);
  assert.equal(loaded.getForm().getField('original').acroField.Kids().size(), 3);
  for (const name of names.filter(name => name !== 'original')) assert.equal(loaded.getForm().getField(name).acroField.Kids().size(), 2);
});

test('an off-page selected radio option is not a selected option in the cloned group', async () => {
  const { pdf, field } = await fixture('radio'); field.select('C');
  const result = await writer.mutatePdfPagesWithIdentity(await pdf.save(), { type: 'duplicate', page: 1 });
  const loaded = await PDFDocument.load(result.bytes);
  assert.equal(loaded.getForm().getRadioGroup('original').getSelected(), 'C');
  assert.equal(loaded.getForm().getRadioGroup(result.copiedWidgets[0].targetFieldName).getSelected(), undefined);
  assert.equal((await read(result.bytes)).pages[1].every(widget => widget.fieldValue === 'Off'), true);
});

test('widget P does not recursively copy the other pages or their objects', async () => {
  const { pdf } = await fixture();
  for (let n = 0; n < 140; n++) pdf.addPage();
  const input = await pdf.save(), before = await PDFDocument.load(input);
  const result = await writer.mutatePdfPagesWithIdentity(input, { type: 'duplicate', page: 1 });
  const after = await PDFDocument.load(result.bytes);
  assert.equal(after.getPageCount(), before.getPageCount() + 1);
  assert.ok(after.context.enumerateIndirectObjects().length - before.context.enumerateIndirectObjects().length < 20);
});

test('unsupported widget actions reject without modifying caller bytes', async () => {
  const { pdf, a } = await fixture();
  pdf.context.lookup(a.node.Annots().get(0)).set(PDFName.of('AA'), pdf.context.obj({}));
  const input = await pdf.save(), snapshot = new Uint8Array(input);
  await assert.rejects(writer.mutatePdfPagesWithIdentity(input, { type: 'duplicate', page: 1 }), /actions/);
  assert.deepEqual(input, snapshot);
});

test('cyclic widget containers reject instead of producing unserializable direct cycles', async () => {
  const { pdf, a } = await fixture();
  const container = pdf.context.obj({}), ref = pdf.context.register(container);
  container.set(PDFName.of('loop'), ref);
  pdf.context.lookup(a.node.Annots().get(0)).set(PDFName.of('MK'), ref);
  await assert.rejects(writer.mutatePdfPagesWithIdentity(await pdf.save(), { type: 'duplicate', page: 1 }), /cyclic/);
});
