import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import {
  PDFArray,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFString,
  StandardFonts,
  rgb,
} from 'pdf-lib';

const BASE_URL = process.env.MOBILE_EXPO_URL || 'http://localhost:8091';
const HEADLESS = process.env.HEADFUL ? false : true;
const OUTPUT_DIR = process.env.MOBILE_QA_OUT_DIR
  ? path.resolve(process.env.MOBILE_QA_OUT_DIR)
  : path.resolve('.playwright-mcp');
const timestamp = Date.now();

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pdfValueToPlain(value) {
  if (!value) return null;
  if (value instanceof PDFString || value instanceof PDFHexString) return value.decodeText();
  if (value instanceof PDFName) return value.decodeText();
  if (value instanceof PDFNumber) return value.asNumber();
  if (value instanceof PDFArray) {
    const values = [];
    for (let index = 0; index < value.size(); index += 1) values.push(pdfValueToPlain(value.get(index)));
    return values;
  }
  return String(value);
}

function pdfDictLookupPlain(dict, key) {
  if (!dict) return null;
  try {
    return pdfValueToPlain(dict.lookup(PDFName.of(key)));
  } catch {
    return null;
  }
}

async function createFixturePdf() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const filePath = path.join(OUTPUT_DIR, `mobile-annotations-fixture-${timestamp}.pdf`);
  const pdf = await PDFDocument.create();
  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const pageOne = pdf.addPage([612, 792]);
  pageOne.drawText('Mobile QA Alpha Beta Page One', {
    x: 72,
    y: 720,
    size: 24,
    font: helveticaBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  pageOne.drawText('Draw ink, rectangle, and counter here.', {
    x: 72,
    y: 680,
    size: 14,
    font: helvetica,
    color: rgb(0.2, 0.2, 0.2),
  });
  pageOne.drawRectangle({
    x: 72,
    y: 120,
    width: 468,
    height: 500,
    borderColor: rgb(0.72, 0.75, 0.8),
    borderWidth: 1,
  });

  const pageTwo = pdf.addPage([612, 792]);
  pageTwo.drawText('Mobile QA Page Two', {
    x: 72,
    y: 720,
    size: 24,
    font: helveticaBold,
    color: rgb(0.1, 0.1, 0.1),
  });

  fs.writeFileSync(filePath, await pdf.save());
  return filePath;
}

async function collectPdfAnnotations(filePath) {
  const bytes = fs.readFileSync(filePath);
  const pdf = await PDFDocument.load(bytes);
  const annotations = [];

  pdf.getPages().forEach((page, pageIndex) => {
    const annots = page.node.lookup(PDFName.of('Annots'));
    if (!annots) return;
    for (let index = 0; index < annots.size(); index += 1) {
      const annotation = pdf.context.lookup(annots.get(index));
      const borderStyle = annotation.lookup(PDFName.of('BS'));
      const borderEffect = annotation.lookup(PDFName.of('BE'));
      annotations.push({
        page: pageIndex + 1,
        subtype: pdfValueToPlain(annotation.lookup(PDFName.of('Subtype'))),
        contents: pdfValueToPlain(annotation.lookup(PDFName.of('Contents'))),
        title: pdfValueToPlain(annotation.lookup(PDFName.of('T'))),
        rect: pdfValueToPlain(annotation.lookup(PDFName.of('Rect'))),
        borderStyle: borderStyle ? {
          style: pdfDictLookupPlain(borderStyle, 'S'),
          width: pdfDictLookupPlain(borderStyle, 'W'),
          dashArray: pdfDictLookupPlain(borderStyle, 'D'),
        } : null,
        borderEffect: borderEffect ? {
          style: pdfDictLookupPlain(borderEffect, 'S'),
          intensity: pdfDictLookupPlain(borderEffect, 'I'),
        } : null,
      });
    }
  });

  return {
    header: bytes.slice(0, 8).toString('latin1'),
    pageCount: pdf.getPageCount(),
    annotations,
  };
}

async function clickButton(page, name) {
  await page.getByRole('button', { name, exact: true }).click();
}

async function importPdfThroughMobileHome(page, filePath) {
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    clickButton(page, 'Open PDF'),
  ]);
  await fileChooser.setFiles(filePath);
  const documentPage = page.locator('[data-testid="document-page"]');
  await documentPage.waitFor({ state: 'visible', timeout: 15000 });
  return documentPage;
}

async function exportCurrentPdf(page, filePath) {
  const exportButton = page.getByRole('button', { name: 'Export PDF', exact: true });
  if (!(await exportButton.isVisible().catch(() => false))) {
    await clickButton(page, 'More document options');
    await exportButton.waitFor({ state: 'visible', timeout: 5000 });
  }
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    exportButton.click(),
  ]);
  await download.saveAs(filePath);
  await page.waitForTimeout(500);
  return page.locator('text=/native annotations/').last().textContent().catch(() => '');
}

async function renderedAnnotationLabels(page) {
  return page.locator('[aria-label*="annotation"]').evaluateAll((elements) => (
    elements.map((element) => element.getAttribute('aria-label')).filter(Boolean)
  ));
}

function countLabels(labels, value) {
  return labels.filter((label) => label === value).length;
}

function hasAnnotationLabel(labels, value) {
  return labels.some((label) => label === value || label === `Selected ${value}`);
}

function firstAnnotationBySubtype(result, subtype) {
  return result.annotations.find((annotation) => annotation.subtype === subtype) ?? null;
}

function contentsBySubtype(result, subtype) {
  return result.annotations
    .filter((annotation) => annotation.subtype === subtype)
    .map((annotation) => annotation.contents);
}

function countSubtype(result, subtype) {
  return result.annotations.filter((annotation) => annotation.subtype === subtype).length;
}

function rectCenter(rect) {
  assert(Array.isArray(rect) && rect.length >= 4, `invalid annotation rect: ${JSON.stringify(rect)}`);
  return {
    x: (rect[0] + rect[2]) / 2,
    y: (rect[1] + rect[3]) / 2,
  };
}

async function dragAnnotation(page, label, dx, dy) {
  const annotation = page.getByRole('button', { name: label, exact: true });
  await annotation.waitFor({ state: 'visible', timeout: 5000 });
  const box = await annotation.boundingBox();
  assert(box, `missing bounding box for annotation: ${label}`);
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(startX + (dx * step) / 8, startY + (dy * step) / 8);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.waitForTimeout(600);
}

async function run() {
  const fixturePath = await createFixturePdf();
  const exportPath = path.join(OUTPUT_DIR, `mobile-annotations-export-${timestamp}.pdf`);
  const undoExportPath = path.join(OUTPUT_DIR, `mobile-annotations-undo-export-${timestamp}.pdf`);
  const reexportPath = path.join(OUTPUT_DIR, `mobile-annotations-reexport-${timestamp}.pdf`);
  const deletedExportPath = path.join(OUTPUT_DIR, `mobile-annotations-deleted-export-${timestamp}.pdf`);
  const restoredExportPath = path.join(OUTPUT_DIR, `mobile-annotations-restored-export-${timestamp}.pdf`);
  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const consoleProblems = [];

  page.on('console', (message) => {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    consoleProblems.push(`pageerror: ${error.message}`);
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 60000 });
  } catch (error) {
    throw new Error(`Could not open ${BASE_URL}. Start mobile Expo web first, for example: cd mobile-expo-go && npm run web -- --port 8091. ${error.message}`);
  }

  const documentPage = await importPdfThroughMobileHome(page, fixturePath);

  const firstTextBlock = page.locator('[data-testid^="pdf-text-block-"]').first();
  await firstTextBlock.waitFor({ state: 'visible', timeout: 15000 });
  await firstTextBlock.click();
  await page.getByText('Highlight Text', { exact: true }).click();

  await clickButton(page, 'Shapes');
  await clickButton(page, 'Rectangle');
  await clickButton(page, 'Solid');
  await clickButton(page, 'Dashed');
  await documentPage.click({ position: { x: 160, y: 230 } });

  await clickButton(page, 'Counter');
  await documentPage.click({ position: { x: 250, y: 300 } });

  await clickButton(page, 'Line');
  await documentPage.click({ position: { x: 305, y: 230 } });

  await clickButton(page, 'Arrow');
  await documentPage.click({ position: { x: 96, y: 330 } });

  await clickButton(page, 'Text');
  await documentPage.click({ position: { x: 82, y: 454 } });
  await page.getByLabel('Annotation text').fill('Mobile text note A');
  await clickButton(page, 'Save text edit');
  await page.waitForTimeout(500);

  await clickButton(page, 'Callout');
  await documentPage.click({ position: { x: 296, y: 444 } });
  await page.getByLabel('Annotation text').fill('Mobile callout note C');
  await clickButton(page, 'Save text edit');
  await page.waitForTimeout(500);

  await clickButton(page, 'Draw');
  await clickButton(page, 'Pen');
  const box = await documentPage.boundingBox();
  assert(box, 'document-page bounding box missing');
  await page.mouse.move(box.x + 140, box.y + 360);
  await page.mouse.down();
  for (let step = 1; step <= 8; step += 1) {
    await page.mouse.move(box.x + 140 + step * 18, box.y + 360 + Math.sin(step) * 18);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);

  await clickButton(page, 'Eraser');
  await page.mouse.move(box.x + 220, box.y + 316);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) {
    await page.mouse.move(box.x + 220, box.y + 316 + step * 14);
    await page.waitForTimeout(25);
  }
  await page.mouse.up();
  await page.waitForTimeout(800);

  const renderedLabels = await renderedAnnotationLabels(page);
  const partialErasedPenCount = countLabels(renderedLabels, 'Pen annotation') + countLabels(renderedLabels, 'Selected Pen annotation');
  assert(partialErasedPenCount >= 2, `partial eraser should split the pen stroke, labels: ${renderedLabels.join(', ')}`);
  for (const expectedLabel of ['Text Highlight annotation', 'Rectangle annotation', 'Counter annotation', 'Line annotation', 'Arrow annotation', 'Text annotation', 'Callout annotation']) {
    assert(renderedLabels.includes(expectedLabel), `missing rendered annotation label: ${expectedLabel}`);
  }

  const statusText = await exportCurrentPdf(page, exportPath);

  const exported = await collectPdfAnnotations(exportPath);
  const subtypes = exported.annotations.map((annotation) => annotation.subtype);
  const requiredSubtypes = ['Highlight', 'Square', 'Line', 'FreeText', 'Ink'];
  const squareBeforeMove = firstAnnotationBySubtype(exported, 'Square');
  const freeTextBeforeEdit = contentsBySubtype(exported, 'FreeText');

  assert(exported.header === '%PDF-1.7', `unexpected PDF header: ${exported.header}`);
  assert(exported.pageCount === 2, `expected 2 pages, got ${exported.pageCount}`);
  assert(squareBeforeMove, 'exported PDF missing Square annotation before move');
  assert(squareBeforeMove.borderStyle?.style === 'D', `exported dashed rectangle missing /BS /D: ${JSON.stringify(squareBeforeMove.borderStyle)}`);
  assert(Array.isArray(squareBeforeMove.borderStyle?.dashArray) && squareBeforeMove.borderStyle.dashArray.length >= 2, `exported dashed rectangle missing dash array: ${JSON.stringify(squareBeforeMove.borderStyle)}`);
  assert(freeTextBeforeEdit.includes('Mobile text note A'), `exported PDF missing initial text annotation contents: ${freeTextBeforeEdit.join(', ')}`);
  assert(freeTextBeforeEdit.includes('Mobile callout note C'), `exported PDF missing callout contents: ${freeTextBeforeEdit.join(', ')}`);
  assert(countSubtype(exported, 'Line') === 2, `expected native line + arrow Line annotations, got ${countSubtype(exported, 'Line')}`);
  assert(countSubtype(exported, 'Ink') >= 2, `partial-erased pen stroke should export as split Ink annotations, got ${countSubtype(exported, 'Ink')}`);
  for (const subtype of requiredSubtypes) {
    assert(subtypes.includes(subtype), `missing native PDF annotation subtype: ${subtype}`);
  }
  assert(/9\/9 native annotations/.test(statusText || ''), `unexpected export status: ${statusText || '(missing)'}`);

  await clickButton(page, 'Back to home');
  await importPdfThroughMobileHome(page, exportPath);
  await page.waitForTimeout(1200);
  const importedLabels = await renderedAnnotationLabels(page);
  for (const expectedLabel of ['Text Highlight annotation', 'Rectangle annotation', 'Counter annotation', 'Line annotation', 'Arrow annotation', 'Text annotation', 'Callout annotation']) {
    assert(importedLabels.includes(expectedLabel), `missing imported native annotation label: ${expectedLabel}`);
  }
  assert(countLabels(importedLabels, 'Pen annotation') >= 2, `reimported partial-erased pen stroke should remain split, labels: ${importedLabels.join(', ')}`);

  await clickButton(page, 'Text annotation');
  await clickButton(page, 'Edit selected annotation text');
  await page.getByLabel('Annotation text').fill('Imported text note B');
  await clickButton(page, 'Save text edit');
  await page.waitForTimeout(500);

  await clickButton(page, 'Undo');
  await page.waitForTimeout(500);
  const undoStatusText = await exportCurrentPdf(page, undoExportPath);
  const undoExported = await collectPdfAnnotations(undoExportPath);
  const freeTextAfterUndo = contentsBySubtype(undoExported, 'FreeText');
  assert(freeTextAfterUndo.includes('Mobile text note A'), `undo export missing restored text contents: ${freeTextAfterUndo.join(', ')}`);
  assert(!freeTextAfterUndo.includes('Imported text note B'), 'undo export still contains redone text contents before redo');
  assert(/9\/9 native annotations/.test(undoStatusText || ''), `unexpected undo export status: ${undoStatusText || '(missing)'}`);

  await clickButton(page, 'Redo');
  await page.waitForTimeout(500);

  await dragAnnotation(page, 'Rectangle annotation', 80, 16);
  const movedLabels = await renderedAnnotationLabels(page);
  assert(movedLabels.includes('Selected Rectangle annotation'), 'dragging imported rectangle should select it');

  await page.getByRole('button', { name: 'Selected Rectangle annotation', exact: true }).click({ delay: 600 });
  await page.getByRole('button', { name: 'Duplicate', exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  await page.getByRole('button', { name: 'Delete', exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  await clickButton(page, 'Duplicate');
  await page.waitForTimeout(500);
  const duplicatedLabels = await renderedAnnotationLabels(page);
  assert(countLabels(duplicatedLabels, 'Rectangle annotation') === 1, 'expected one unselected rectangle after duplicate');
  assert(countLabels(duplicatedLabels, 'Selected Rectangle annotation') === 1, 'expected one selected duplicate rectangle');

  await page.getByRole('button', { name: 'Selected Rectangle annotation', exact: true }).click({ delay: 600 });
  await page.getByRole('button', { name: 'Delete', exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  await clickButton(page, 'Delete');
  await page.waitForTimeout(500);
  const deletedLabels = await renderedAnnotationLabels(page);
  assert(countLabels(deletedLabels, 'Rectangle annotation') === 1, 'expected one rectangle after deleting duplicate');
  assert(!deletedLabels.includes('Selected Rectangle annotation'), 'duplicate rectangle should no longer be selected/rendered after delete');

  const reexportStatusText = await exportCurrentPdf(page, reexportPath);
  const reexported = await collectPdfAnnotations(reexportPath);
  const reexportedSubtypes = reexported.annotations.map((annotation) => annotation.subtype);
  const squareAfterMove = firstAnnotationBySubtype(reexported, 'Square');
  const freeTextAfterEdit = contentsBySubtype(reexported, 'FreeText');
  assert(reexported.annotations.length === 9, `expected 9 annotations after re-export, got ${reexported.annotations.length}`);
  assert(squareAfterMove, 're-exported PDF missing Square annotation after move');
  assert(squareAfterMove.borderStyle?.style === 'D', `re-exported imported dashed rectangle missing /BS /D: ${JSON.stringify(squareAfterMove.borderStyle)}`);
  assert(Array.isArray(squareAfterMove.borderStyle?.dashArray) && squareAfterMove.borderStyle.dashArray.length >= 2, `re-exported imported dashed rectangle missing dash array: ${JSON.stringify(squareAfterMove.borderStyle)}`);
  assert(freeTextAfterEdit.includes('Imported text note B'), `re-exported PDF missing edited text annotation contents: ${freeTextAfterEdit.join(', ')}`);
  assert(freeTextAfterEdit.includes('Mobile callout note C'), `re-exported PDF missing imported callout contents: ${freeTextAfterEdit.join(', ')}`);
  assert(!freeTextAfterEdit.includes('Mobile text note A'), 're-exported PDF still contains stale initial text annotation contents');
  assert(countSubtype(reexported, 'Line') === 2, `expected re-exported native line + arrow Line annotations, got ${countSubtype(reexported, 'Line')}`);
  const beforeCenter = rectCenter(squareBeforeMove.rect);
  const afterCenter = rectCenter(squareAfterMove.rect);
  assert(afterCenter.x - beforeCenter.x > 35, `expected moved Square x center to increase; before=${beforeCenter.x}, after=${afterCenter.x}`);
  assert(Math.abs(afterCenter.y - beforeCenter.y) > 3, `expected moved Square y center to change; before=${beforeCenter.y}, after=${afterCenter.y}`);
  for (const subtype of requiredSubtypes) {
    assert(reexportedSubtypes.includes(subtype), `re-export missing native PDF annotation subtype: ${subtype}`);
  }
  assert(/9\/9 native annotations/.test(reexportStatusText || ''), `unexpected re-export status: ${reexportStatusText || '(missing)'}`);

  await page.getByRole('button', { name: 'Counter annotation', exact: true }).click({ delay: 600 });
  await page.getByRole('button', { name: 'Delete', exact: true }).waitFor({ state: 'visible', timeout: 5000 });
  await clickButton(page, 'Delete');
  await page.waitForTimeout(500);
  const labelsAfterCounterDelete = await renderedAnnotationLabels(page);
  assert(!hasAnnotationLabel(labelsAfterCounterDelete, 'Counter annotation'), 'counter should be gone after deleting imported original');

  const deletedStatusText = await exportCurrentPdf(page, deletedExportPath);
  const deletedExported = await collectPdfAnnotations(deletedExportPath);
  const freeTextAfterCounterDelete = contentsBySubtype(deletedExported, 'FreeText');
  assert(deletedExported.annotations.length === 8, `expected 8 annotations after deleting imported counter, got ${deletedExported.annotations.length}`);
  assert(!freeTextAfterCounterDelete.includes('1'), `deleted counter resurrected in export: ${freeTextAfterCounterDelete.join(', ')}`);
  assert(freeTextAfterCounterDelete.includes('Imported text note B'), `deleted-counter export missing edited text contents: ${freeTextAfterCounterDelete.join(', ')}`);
  assert(freeTextAfterCounterDelete.includes('Mobile callout note C'), `deleted-counter export missing callout contents: ${freeTextAfterCounterDelete.join(', ')}`);
  assert(/8\/8 native annotations/.test(deletedStatusText || ''), `unexpected deleted export status: ${deletedStatusText || '(missing)'}`);

  await clickButton(page, 'Undo');
  await page.waitForTimeout(500);
  const labelsAfterCounterRestore = await renderedAnnotationLabels(page);
  assert(hasAnnotationLabel(labelsAfterCounterRestore, 'Counter annotation'), 'undo should restore deleted imported counter');

  const restoredStatusText = await exportCurrentPdf(page, restoredExportPath);
  await browser.close();
  const restoredExported = await collectPdfAnnotations(restoredExportPath);
  const freeTextAfterCounterRestore = contentsBySubtype(restoredExported, 'FreeText');
  assert(restoredExported.annotations.length === 9, `expected 9 annotations after undoing counter delete, got ${restoredExported.annotations.length}`);
  assert(freeTextAfterCounterRestore.includes('1'), `restored counter missing from export: ${freeTextAfterCounterRestore.join(', ')}`);
  assert(freeTextAfterCounterRestore.includes('Imported text note B'), `restored export missing edited text contents: ${freeTextAfterCounterRestore.join(', ')}`);
  assert(freeTextAfterCounterRestore.includes('Mobile callout note C'), `restored export missing callout contents: ${freeTextAfterCounterRestore.join(', ')}`);
  assert(/9\/9 native annotations/.test(restoredStatusText || ''), `unexpected restored export status: ${restoredStatusText || '(missing)'}`);

  assert(consoleProblems.length === 0, `browser console problems:\n${consoleProblems.join('\n')}`);

  console.log('RESULT: PASS');
  console.log(`url: ${BASE_URL}`);
  console.log(`fixture: ${fixturePath}`);
  console.log(`export: ${exportPath}`);
  console.log(`undo export: ${undoExportPath}`);
  console.log(`reexport: ${reexportPath}`);
  console.log(`deleted export: ${deletedExportPath}`);
  console.log(`restored export: ${restoredExportPath}`);
  console.log(`status: ${statusText}`);
  console.log(`undo status: ${undoStatusText}`);
  console.log(`reimport status: ${reexportStatusText}`);
  console.log(`deleted status: ${deletedStatusText}`);
  console.log(`restored status: ${restoredStatusText}`);
  console.log(`subtypes: ${subtypes.join(', ')}`);
  console.log(`partial eraser pen labels: ${partialErasedPenCount}`);
  console.log(`square border style: ${JSON.stringify(squareBeforeMove.borderStyle)} -> ${JSON.stringify(squareAfterMove.borderStyle)}`);
  console.log(`reimported labels: ${importedLabels.join(', ')}`);
  console.log(`free text contents: ${freeTextBeforeEdit.join(', ')} -> undo ${freeTextAfterUndo.join(', ')} -> redo ${freeTextAfterEdit.join(', ')}`);
  console.log(`delete/undo FreeText contents: ${freeTextAfterCounterDelete.join(', ')} -> ${freeTextAfterCounterRestore.join(', ')}`);
  console.log(`moved square center: ${beforeCenter.x.toFixed(2)},${beforeCenter.y.toFixed(2)} -> ${afterCenter.x.toFixed(2)},${afterCenter.y.toFixed(2)}`);
  console.log(`context menu labels after duplicate/delete: ${deletedLabels.join(', ')}`);
}

run().catch((error) => {
  console.error('RESULT: FAIL');
  console.error(error.stack || error.message);
  process.exit(1);
});
