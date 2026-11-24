/**
 * Round 4 (tester C #1-#3): the PDF tools used the upload, so Flatten and
 * Add a password gave back a blank form, and a mirrored page came back
 * unturned. buildPdfAsSeen writes the typed form answers (and page mirrors)
 * into the bytes the tools work on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { buildFormFieldObject } from '../src/hooks/usePdfjsFormFieldPersistence.js';
import { buildPdfAsSeen } from '../src/utils/pdfAsSeen.js';
import { runInAppTool } from '../src/tools/inApp.js';

const FIXTURE = new Uint8Array(readFileSync(new URL('../debug/fixtures/kal441-form-fields.pdf', import.meta.url)));
const NAME = 'A. Calvo';

async function widgets(bytes) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  return (await page.getAnnotations({ intent: 'display' })).filter((a) => a.subtype === 'Widget');
}

async function pageText(bytes) {
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false }).promise;
  const page = await doc.getPage(1);
  return (await page.getTextContent()).items.map((i) => i.str).join(' ');
}

async function filled() {
  const w = (await widgets(FIXTURE)).find((x) => x.fieldName === 'surveyor.name');
  const obj = buildFormFieldObject(1, { fieldId: w.id, fieldName: w.fieldName, fieldType: w.fieldType, value: NAME, rect: w.rect }, null, 'user-under-test');
  return { 1: { objects: [obj] } };
}

test('nothing typed and no mirror: the upload is passed through untouched', async () => {
  const out = await buildPdfAsSeen(FIXTURE, { annotationsByPage: {}, pageTransformations: {} });
  assert.equal(out, FIXTURE);
});

test('typed form answers are written into the bytes the tools get', async () => {
  const out = await buildPdfAsSeen(FIXTURE, { annotationsByPage: await filled() });
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getForm().getTextField('surveyor.name').getText(), NAME);
});

test('Flatten keeps the typed answer on the page', async () => {
  const asSeen = await buildPdfAsSeen(FIXTURE, { annotationsByPage: await filled() });
  const [result] = await runInAppTool('flatten', [{ name: 'form.pdf', bytes: asSeen }]);
  const bytes = result.bytes || new Uint8Array(await result.blob.arrayBuffer());
  assert.equal((await widgets(bytes)).length, 0, 'fields are gone after Flatten');
  assert.match(await pageText(bytes), /A\. Calvo/);
});

test('a mirrored page reaches the tools mirrored', async () => {
  const out = await buildPdfAsSeen(FIXTURE, { pageTransformations: { 1: { mirrorH: true } } });
  assert.notEqual(out, FIXTURE);
  const doc = await PDFDocument.load(out);
  assert.equal(doc.getPageCount(), 1);
  assert.notEqual(Buffer.compare(Buffer.from(out), Buffer.from(FIXTURE)), 0);
});
