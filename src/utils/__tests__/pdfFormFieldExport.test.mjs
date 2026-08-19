/**
 * KAL-441 — unit cover for the AcroForm value writer: which stored objects it
 * picks up, how it resolves a widget back to its field, and what it does when a
 * value cannot be written.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import {
  applyFormFieldValuesToPdfDoc,
  collectFormFieldValues,
  isFormFieldObject,
} from '../pdfFormFieldExport.js';

const FIXTURE_BYTES = readFileSync(new URL('../../../debug/fixtures/kal441-form-fields.pdf', import.meta.url));

// Widget object references in the fixture, which is exactly what pdf.js hands
// the app as each field's annotation id ("<objectNumber>R").
const WIDGET = {
  name: '11R',
  date: '16R',
  notes: '19R',
  approved: '22R',
  conditionGood: '28R',
  conditionFair: '33R',
  conditionPoor: '38R',
  discipline: '44R',
};

const carrier = (fieldId, value, extra = {}) => ({
  type: 'form-field',
  data: { type: 'form-field', id: `form-field:1:${fieldId}`, fieldId, value, ...extra },
  pageNumber: 1,
});

test('isFormFieldObject only matches the persisted form-field carrier', () => {
  assert.equal(isFormFieldObject(carrier(WIDGET.name, 'x')), true);
  assert.equal(isFormFieldObject({ type: 'rect' }), false);
  assert.equal(isFormFieldObject(null), false);
});

test('collectFormFieldValues keeps the last value stored for a field', () => {
  const values = collectFormFieldValues({
    1: {
      objects: [
        carrier(WIDGET.name, 'first'),
        { type: 'circle' },
        carrier(WIDGET.name, 'second'),
      ],
    },
  });
  assert.equal(values.length, 1);
  assert.equal(values[0].value, 'second');
  assert.equal(values[0].pageNumber, 1);
});

test('a ticked radio option is resolved from the widget, not from the stored true/false', async () => {
  const doc = await PDFDocument.load(FIXTURE_BYTES);
  const diagnostics = applyFormFieldValuesToPdfDoc(doc, collectFormFieldValues({
    1: {
      objects: [
        carrier(WIDGET.conditionGood, false),
        carrier(WIDGET.conditionFair, false),
        carrier(WIDGET.conditionPoor, true),
      ],
    },
  }));
  assert.equal(diagnostics.formFieldValuesWritten, 3);
  assert.equal(doc.getForm().getRadioGroup('condition').getSelected(), 'Poor');
});

test('clearing a text field and unticking a checkbox are written too', async () => {
  const doc = await PDFDocument.load(FIXTURE_BYTES);
  const form = doc.getForm();
  form.getTextField('surveyor.name').setText('stale');
  form.getCheckBox('approved').check();

  applyFormFieldValuesToPdfDoc(doc, collectFormFieldValues({
    1: { objects: [carrier(WIDGET.name, ''), carrier(WIDGET.approved, false)] },
  }));

  assert.equal(form.getTextField('surveyor.name').getText(), undefined);
  assert.equal(form.getCheckBox('approved').isChecked(), false);
});

test('a value whose widget is not in this PDF is reported, never thrown', async () => {
  const doc = await PDFDocument.load(FIXTURE_BYTES);
  const diagnostics = applyFormFieldValuesToPdfDoc(doc, collectFormFieldValues({
    1: { objects: [carrier('9999R', 'ghost'), carrier('not-a-ref', 'ghost')] },
  }));
  assert.equal(diagnostics.formFieldValuesWritten, 0);
  assert.equal(diagnostics.formFieldValuesSkipped, 2);
  assert.equal(diagnostics.formFieldSkipReasons['widget-not-found-in-pdf'], 2);
});

test('a dropdown value the document does not offer still lands in the field', async () => {
  const doc = await PDFDocument.load(FIXTURE_BYTES);
  const diagnostics = applyFormFieldValuesToPdfDoc(doc, collectFormFieldValues({
    1: { objects: [carrier(WIDGET.discipline, 'Structural')] },
  }));
  assert.equal(diagnostics.formFieldValuesWritten, 1);
  assert.deepEqual(doc.getForm().getDropdown('discipline').getSelected(), ['Structural']);
});

test('a document with no form fields is left alone', async () => {
  const empty = await PDFDocument.create();
  empty.addPage([200, 200]);
  const diagnostics = applyFormFieldValuesToPdfDoc(empty, []);
  assert.equal(diagnostics.formFieldValuesConsidered, 0);
  assert.equal(diagnostics.formFieldValuesWritten, 0);
});
