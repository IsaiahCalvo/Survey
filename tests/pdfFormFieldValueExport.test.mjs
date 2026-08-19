/**
 * KAL-441 round trip — a value typed into the PDF's own form fields must come
 * back out of the exported (and printed) bytes.
 *
 * The trip is deliberately end-to-end and uses the REAL pieces at every step:
 *   pdf.js reads the fixture's widgets exactly as PdfjsFormLayer does (same
 *   annotation ids) → the persistence hook's own buildFormFieldObject stores
 *   the values → the real export writer produces bytes → those bytes are
 *   re-opened with both pdf-lib (what Acrobat/Preview read) and pdf.js (what
 *   the app reads on re-open).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import {
  savePDFWithAnnotationsPdfLib,
  savePDFWithFlattenedRegularAnnotationsForPrint,
  buildPdfExportAnnotationPlan,
  buildPrintableRegularAnnotationPayload,
} from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildFormFieldObject } from '../src/hooks/usePdfjsFormFieldPersistence.js';
import { collectFormFieldValues } from '../src/utils/pdfFormFieldExport.js';

const FIXTURE_URL = new URL('../debug/fixtures/kal441-form-fields.pdf', import.meta.url);
const FIXTURE_BYTES = readFileSync(FIXTURE_URL);
const PAGE_SIZES = { 1: { width: 480, height: 380 } };

const TYPED = {
  'surveyor.name': 'A. Calvo',
  'inspection.date': '2026-08-19',
  'surveyor.notes': 'Riser cupboard checked; two covers missing.',
};
const TICKED_CHECKBOX = 'approved';
const TICKED_RADIO_OPTION = 'Fair';
const CHOSEN_DROPDOWN = 'Electrical';

function fakePdfFile(bytes = FIXTURE_BYTES, name = 'kal441-form-fields.pdf') {
  return {
    name,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    },
  };
}

async function readWidgets(bytes) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  const annotations = await page.getAnnotations({ intent: 'display' });
  return annotations.filter((annotation) => annotation.subtype === 'Widget');
}

/**
 * Reproduce what a user does in the app: type/tick each widget, letting the
 * persistence hook build the stored carrier object for every edit.
 */
async function buildFilledAnnotationsByPage() {
  const widgets = await readWidgets(FIXTURE_BYTES);
  const objects = [];
  for (const widget of widgets) {
    let value;
    if (widget.fieldType === 'Tx') value = TYPED[widget.fieldName];
    else if (widget.checkBox) value = widget.fieldName === TICKED_CHECKBOX;
    else if (widget.radioButton) value = widget.buttonValue === TICKED_RADIO_OPTION;
    else if (widget.fieldType === 'Ch') value = CHOSEN_DROPDOWN;
    if (value === undefined) continue;
    objects.push(buildFormFieldObject(1, {
      fieldId: widget.id,
      fieldName: widget.fieldName,
      fieldType: widget.fieldType,
      value,
      rect: widget.rect,
    }, null, 'user-under-test'));
  }
  assert.equal(objects.length, 8, 'every widget in the fixture should have been filled');
  return { 1: { objects } };
}

async function exportedBytes(annotationsByPage) {
  return savePDFWithAnnotationsPdfLib(fakePdfFile(), annotationsByPage, PAGE_SIZES, null, {
    returnBytes: true,
    actionType: 'pdf-export',
    documentId: 'kal441-test',
  });
}

function readFormValues(doc) {
  const form = doc.getForm();
  return {
    name: form.getTextField('surveyor.name').getText(),
    date: form.getTextField('inspection.date').getText(),
    notes: form.getTextField('surveyor.notes').getText(),
    approved: form.getCheckBox('approved').isChecked(),
    condition: form.getRadioGroup('condition').getSelected(),
    discipline: form.getDropdown('discipline').getSelected(),
  };
}

test('the unmodified fixture starts with every form field empty', async () => {
  const doc = await PDFDocument.load(FIXTURE_BYTES);
  const values = readFormValues(doc);
  assert.equal(values.name, undefined);
  assert.equal(values.approved, false);
  assert.equal(values.condition, undefined);
  assert.deepEqual(values.discipline, []);
});

test('exported PDF carries the values typed into the document form fields', async () => {
  const annotationsByPage = await buildFilledAnnotationsByPage();
  const bytes = await exportedBytes(annotationsByPage);
  const doc = await PDFDocument.load(bytes);
  const values = readFormValues(doc);

  assert.equal(values.name, TYPED['surveyor.name']);
  assert.equal(values.date, TYPED['inspection.date']);
  assert.equal(values.notes, TYPED['surveyor.notes']);
  assert.equal(values.approved, true);
  assert.equal(values.condition, TICKED_RADIO_OPTION);
  assert.deepEqual(values.discipline, [CHOSEN_DROPDOWN]);
});

test('exported form fields stay editable and paint their value for Acrobat and Preview', async () => {
  const annotationsByPage = await buildFilledAnnotationsByPage();
  const bytes = await exportedBytes(annotationsByPage);
  const doc = await PDFDocument.load(bytes);

  // Still real, live form fields — the export is not flattened.
  const widget = doc.getForm().getTextField('surveyor.name').acroField.getWidgets()[0];
  const appearance = doc.context.lookup(widget.dict.get(PDFName.of('AP')));
  const normal = doc.context.lookup(appearance.get(PDFName.of('N')));
  const painted = new TextDecoder().decode(decodePDFRawStream(normal).decode());
  // pdf-lib writes the show-text operand as a hex string, so compare against
  // the hex encoding of the typed value rather than the plain characters.
  const hex = [...TYPED['surveyor.name']]
    .map((character) => character.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase())
    .join('');
  assert.match(painted, /\/Tx BMC/, 'the field must carry a generated text appearance');
  assert.ok(painted.includes(hex), 'the typed text must be baked into the field appearance stream');
});

test('re-opening the exported bytes in the pdf.js engine shows the values the user typed', async () => {
  const annotationsByPage = await buildFilledAnnotationsByPage();
  const bytes = await exportedBytes(annotationsByPage);
  const widgets = await readWidgets(bytes);
  const byName = new Map();
  for (const widget of widgets) {
    if (widget.radioButton) {
      if (widget.fieldValue && widget.fieldValue !== 'Off') byName.set('condition', widget.fieldValue);
      continue;
    }
    byName.set(widget.fieldName, widget.fieldValue);
  }
  assert.equal(byName.get('surveyor.name'), TYPED['surveyor.name']);
  assert.equal(byName.get('inspection.date'), TYPED['inspection.date']);
  assert.equal(byName.get('surveyor.notes'), TYPED['surveyor.notes']);
  assert.equal(byName.get('condition'), TICKED_RADIO_OPTION);
  assert.deepEqual(byName.get('discipline'), [CHOSEN_DROPDOWN]);
  const approved = widgets.find((widget) => widget.fieldName === 'approved');
  assert.notEqual(approved.fieldValue, 'Off');
});

test('form values are written into the print-with-markup bytes too', async () => {
  const annotationsByPage = await buildFilledAnnotationsByPage();
  const printable = buildPrintableRegularAnnotationPayload({ annotationsByPage, callouts: [], surveyMarkers: {} });
  const bytes = await savePDFWithFlattenedRegularAnnotationsForPrint(
    fakePdfFile(),
    printable.annotationsByPage,
    PAGE_SIZES,
    { returnBytes: true, documentId: 'kal441-test', callouts: [] },
  );
  const values = readFormValues(await PDFDocument.load(bytes));
  assert.equal(values.name, TYPED['surveyor.name']);
  assert.equal(values.condition, TICKED_RADIO_OPTION);
});

test('form-field carriers are not also drawn as app annotations', async () => {
  const annotationsByPage = await buildFilledAnnotationsByPage();
  const plan = buildPdfExportAnnotationPlan({ annotationsByPage, pageSizes: PAGE_SIZES });
  assert.equal(plan.items.length, 0);
  assert.equal(plan.diagnostics.skippedByReason['form-field-value-written-to-acroform'], 8);

  const sourceAnnots = (await PDFDocument.load(FIXTURE_BYTES)).getPage(0).node.Annots().size();
  const bytes = await exportedBytes(annotationsByPage);
  const exportedAnnots = (await PDFDocument.load(bytes)).getPage(0).node.Annots().size();
  assert.equal(exportedAnnots, sourceAnnots, 'writing form values must not add stray annotations');
});

test('collectFormFieldValues reads exactly the persisted form-field carriers', async () => {
  const annotationsByPage = await buildFilledAnnotationsByPage();
  annotationsByPage[1].objects.push({ type: 'rect', left: 1, top: 1, width: 10, height: 10 });
  const values = collectFormFieldValues(annotationsByPage);
  assert.equal(values.length, 8);
  assert.ok(values.every((value) => value.pageNumber === 1 && typeof value.fieldId === 'string'));
});
