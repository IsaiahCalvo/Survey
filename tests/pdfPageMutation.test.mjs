import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
} from 'pdf-lib';
import { mutatePdfPages } from '../src/utils/pdfPageMutation.js';

async function fixture() {
  const pdf = await PDFDocument.create();
  pdf.addPage([100, 200]);
  pdf.addPage([200, 300]);
  pdf.addPage([300, 400]);
  return pdf.save();
}

async function sizes(bytes) {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPages().map((page) => [page.getWidth(), page.getHeight()]);
}

test('insert creates a blank physical page using its reference page dimensions', async () => {
  assert.deepEqual(await sizes(await mutatePdfPages(await fixture(), { type: 'insert', afterPage: 1 })), [
    [100, 200], [100, 200], [200, 300], [300, 400],
  ]);
});

test('delete removes the physical page and refuses to delete the final page', async () => {
  assert.deepEqual(await sizes(await mutatePdfPages(await fixture(), { type: 'delete', page: 2 })), [
    [100, 200], [300, 400],
  ]);
  let one = await PDFDocument.create();
  one.addPage([10, 10]);
  await assert.rejects(mutatePdfPages(await one.save(), { type: 'delete', page: 1 }), /keep at least one page/);
});

test('duplicate and copy insert exact physical page copies after the requested target', async () => {
  assert.deepEqual(await sizes(await mutatePdfPages(await fixture(), { type: 'duplicate', page: 2 })), [
    [100, 200], [200, 300], [200, 300], [300, 400],
  ]);
  assert.deepEqual(await sizes(await mutatePdfPages(await fixture(), { type: 'copy', source: 3, afterPage: 1 })), [
    [100, 200], [300, 400], [200, 300], [300, 400],
  ]);
});

test('move/cut rewrites the physical page order in both directions', async () => {
  assert.deepEqual(await sizes(await mutatePdfPages(await fixture(), { type: 'move', from: 1, to: 3 })), [
    [200, 300], [300, 400], [100, 200],
  ]);
  assert.deepEqual(await sizes(await mutatePdfPages(await fixture(), { type: 'move', from: 3, to: 1 })), [
    [300, 400], [100, 200], [200, 300],
  ]);
});

async function structuredFixture() {
  const pdf = await PDFDocument.create();
  const first = pdf.addPage([101, 201]);
  const second = pdf.addPage([202, 302]);
  const third = pdf.addPage([303, 403]);
  const form = pdf.getForm();
  const firstField = form.createTextField('first-page-field');
  firstField.setText('first');
  firstField.addToPage(first, { x: 10, y: 10, width: 60, height: 20 });
  const secondField = form.createTextField('second-page-field');
  secondField.setText('second');
  secondField.addToPage(second, { x: 10, y: 10, width: 60, height: 20 });

  const firstPageDestination = pdf.context.obj([first.ref, PDFName.of('Fit')]);
  const destinationTree = pdf.context.obj({
    Names: [PDFHexString.fromText('First page'), firstPageDestination],
  });
  pdf.catalog.set(PDFName.of('Names'), pdf.context.obj({ Dests: destinationTree }));
  const link = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [0, 0, 20, 20],
    Border: [0, 0, 0],
    Dest: firstPageDestination,
  });
  third.node.addAnnot(pdf.context.register(link));
  return pdf.save();
}

function structuredIdentity(pdf) {
  const pages = pdf.getPages();
  const pageRefsByWidth = Object.fromEntries(pages.map((page) => [page.getWidth(), page.ref.toString()]));
  const widgetPageRefs = Object.fromEntries(pdf.getForm().getFields().map((field) => [
    field.getName(),
    field.acroField.getWidgets().map((widget) => widget.P()?.toString()),
  ]));
  const names = pdf.catalog.lookup(PDFName.of('Names'), PDFDict);
  const destinations = names.lookup(PDFName.of('Dests'), PDFDict);
  const destinationEntries = destinations.lookup(PDFName.of('Names'), PDFArray);
  const namedDestinationRef = destinationEntries.lookup(1, PDFArray).get(0).toString();
  const thirdPage = pages.find((page) => page.getWidth() === 303);
  const annotations = thirdPage.node.Annots();
  const internalDestinationRef = annotations
    .lookup(annotations.size() - 1, PDFDict)
    .lookup(PDFName.of('Dest'), PDFArray)
    .get(0)
    .toString();
  return { pageRefsByWidth, widgetPageRefs, namedDestinationRef, internalDestinationRef };
}

test('move preserves AcroForm widget ownership and named/internal page destinations', async () => {
  const source = await structuredFixture();
  const before = structuredIdentity(await PDFDocument.load(source));
  const movedBytes = await mutatePdfPages(source, { type: 'move', from: 1, to: 3 });
  const moved = await PDFDocument.load(movedBytes);
  const after = structuredIdentity(moved);

  assert.deepEqual(moved.getPages().map((page) => page.getWidth()), [202, 303, 101]);
  assert.deepEqual(after.pageRefsByWidth, before.pageRefsByWidth);
  assert.deepEqual(after.widgetPageRefs, before.widgetPageRefs);
  assert.equal(after.namedDestinationRef, before.pageRefsByWidth[101]);
  assert.equal(after.internalDestinationRef, before.pageRefsByWidth[101]);
});

test('cut-paste move preserves AcroForm widgets and internal destinations in the opposite direction', async () => {
  const source = await structuredFixture();
  const before = structuredIdentity(await PDFDocument.load(source));
  const movedBytes = await mutatePdfPages(source, { type: 'move', from: 3, to: 1 });
  const moved = await PDFDocument.load(movedBytes);
  const after = structuredIdentity(moved);

  assert.deepEqual(moved.getPages().map((page) => page.getWidth()), [303, 101, 202]);
  assert.deepEqual(after.pageRefsByWidth, before.pageRefsByWidth);
  assert.deepEqual(after.widgetPageRefs, before.widgetPageRefs);
  assert.equal(after.namedDestinationRef, before.pageRefsByWidth[101]);
  assert.equal(after.internalDestinationRef, before.pageRefsByWidth[101]);
});

test('rotate persists page rotation without changing page order', async () => {
  const bytes = await mutatePdfPages(await fixture(), { type: 'rotate', page: 2, delta: -90 });
  const pdf = await PDFDocument.load(bytes);
  assert.deepEqual(pdf.getPages().map((page) => page.getRotation().angle), [0, 270, 0]);
  assert.deepEqual(pdf.getPages().map((page) => [page.getWidth(), page.getHeight()]), [
    [100, 200], [200, 300], [300, 400],
  ]);
});
