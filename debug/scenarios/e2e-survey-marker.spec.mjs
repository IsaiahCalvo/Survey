import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';

// Live-prove survey-marker on Vite ?testPdf=. Wave 9 covered 10 drawables but
// not this tool. Do not replay wave9, leftover 18, or official npm test.

const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const FIXTURE = new URL('../../debug/fixtures/clickable-link-test.pdf', import.meta.url);

async function openEditor(page) {
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });
  await page.goto(SURVEY_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

async function markerIds(page) {
  return page.locator('[data-survey-marker-id]').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-survey-marker-id')).filter(Boolean),
  );
}

async function userAnnoIds(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean)
  ));
}

async function enterSurveyWalls(page) {
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();
}

async function armWalls(page) {
  const walls = page.getByRole('button', { name: 'Walls', exact: true });
  await expect(walls).toBeVisible();
  await walls.click();
}

async function dragOnLayer(page, { x0, y0, x1, y1 }) {
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  expect(box, 'annotation layer geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
  return box;
}

async function clickOnLayer(page, { xf, yf }) {
  const layer = page.locator('[data-svg-annotation-layer="1"]');
  const box = await layer.boundingBox();
  expect(box, 'annotation layer geometry').toBeTruthy();
  await page.mouse.click(box.x + box.width * xf, box.y + box.height * yf);
}

async function finishMarkerName(page, name) {
  const field = page.getByPlaceholder('Enter name');
  await expect(field).toBeVisible({ timeout: 8_000 });
  await field.fill(name);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(field).toHaveCount(0, { timeout: 8_000 });
}

async function placeMarker(page, name, coords) {
  const before = new Set(await markerIds(page));
  await armWalls(page);
  await dragOnLayer(page, coords);
  await finishMarkerName(page, name);
  let created = null;
  await expect.poll(async () => {
    const ids = await markerIds(page);
    created = ids.find((id) => !before.has(id)) || null;
    return created;
  }, { message: `expected committed survey-marker ${name}` }).not.toBeNull();
  return created;
}

function decodePdfText(value) {
  if (!value) return '';
  if (typeof value.decodeText === 'function') return value.decodeText();
  if (typeof value.asString === 'function') return value.asString();
  return String(value);
}

async function exportedAnnots(bytes, pageIndex = 0) {
  const pdf = await PDFDocument.load(bytes);
  const page = pdf.getPage(pageIndex);
  const annots = page.node.Annots();
  const rows = [];
  if (!annots) return { rows };
  for (const ref of annots.asArray()) {
    const dict = page.doc.context.lookup(ref);
    const subtype = String(dict.get(page.doc.context.obj('Subtype')) || '');
    rows.push({
      subtype,
      contents: decodePdfText(dict.get(page.doc.context.obj('Contents'))),
      isSquare: /^\/Square$/i.test(subtype),
      isHighlight: /^\/Highlight$/i.test(subtype),
      isSurveyMarker: /^\/SurveyMarker$/i.test(subtype),
    });
  }
  return { rows };
}

function countWhere(rows, predicate) {
  return rows.filter(predicate).length;
}

async function exportAnnotatedPdf(page) {
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  const path = await download.path();
  expect(path, 'exported PDF path').toBeTruthy();
  const fs = await import('node:fs/promises');
  return fs.readFile(path);
}

function parsePrintDiagnostics(logs) {
  const line = [...logs].reverse().find((text) => text.includes('diagnostics='));
  if (!line) return null;
  const raw = line.slice(line.indexOf('diagnostics=') + 'diagnostics='.length);
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pdfLatin1(bytes) {
  return new TextDecoder('latin1').decode(bytes);
}

test('survey-marker: intended persist + export/print exclusion, break no-commit, edge undo + rect', async ({ page }) => {
  const printLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[PrintPanel]')) printLogs.push(text);
  });

  await openEditor(page);
  await enterSurveyWalls(page);

  const baseline = await exportedAnnots(readFileSync(FIXTURE));
  const beforeBreak = await markerIds(page);

  // Break: click with no drag must not commit (create requires w>2 && h>2).
  await clickOnLayer(page, { xf: 0.14, yf: 0.16 });
  await page.waitForTimeout(280);
  expect(await page.getByPlaceholder('Enter name').count(), 'click-no-drag must not open name prompt').toBe(0);
  expect(await markerIds(page), 'click-no-drag must not place a marker').toEqual(beforeBreak);

  // Break: cancel placement — Escape back to Selection, then click is a no-op.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Selection mode', exact: true }).first().click();
  await clickOnLayer(page, { xf: 0.18, yf: 0.20 });
  await page.waitForTimeout(220);
  expect(await page.getByPlaceholder('Enter name').count(), 'select-mode click must not open name prompt').toBe(0);
  expect(await markerIds(page), 'cancel / select click must not place a marker').toEqual(beforeBreak);

  // Intended: place a marker; it persists on the page.
  const first = await placeMarker(page, 'e2e-sm-one', { x0: 0.22, y0: 0.26, x1: 0.40, y1: 0.40 });
  expect(first, 'first survey-marker id').toBeTruthy();
  await expect(page.locator(`[data-survey-marker-id="${first}"]`)).toHaveCount(1);

  // Intended: export excludes survey-markers from PDF annots (product contract).
  const exportBytes = await exportAnnotatedPdf(page);
  const exported = await exportedAnnots(exportBytes);
  expect(
    countWhere(exported.rows, (row) => row.isSurveyMarker),
    'export must not write /SurveyMarker annots',
  ).toBe(0);
  expect(
    countWhere(exported.rows, (row) => row.isHighlight),
    'export must not add /Highlight for survey-markers',
  ).toBe(countWhere(baseline.rows, (row) => row.isHighlight));
  expect(
    countWhere(exported.rows, (row) => row.isSquare),
    'export must not add /Square for survey-markers',
  ).toBe(countWhere(baseline.rows, (row) => row.isSquare));
  expect(exported.rows.length, 'export annot count stays at fixture natives').toBe(baseline.rows.length);
  expect(pdfLatin1(exportBytes).includes('/SurveyMarker'), 'no SurveyMarker subtype in export bytes').toBeFalsy();

  // Intended: regular print flatten excludes survey-markers (same contract as D-02).
  await page.keyboard.press('Escape');
  printLogs.length = 0;
  await page.keyboard.press('Control+Shift+p');
  if (!printLogs.some((line) => /OPEN requested/i.test(line))) {
    await page.keyboard.press('Meta+Shift+p');
  }
  await expect.poll(() => printLogs.some((line) => /withMarkup=true|regular annotations/i.test(line))).toBeTruthy();
  await expect.poll(() => printLogs.some((line) => line.includes('diagnostics=')), { timeout: 90_000 }).toBeTruthy();
  const diagnostics = parsePrintDiagnostics(printLogs);
  expect(diagnostics, 'print flatten diagnostics').toBeTruthy();
  expect(diagnostics.excluded.surveyMarkers, 'survey-markers stay print-excluded').toBeGreaterThanOrEqual(1);

  // Edge: two markers; undo one; draw a rect without wiping markers.
  const second = await placeMarker(page, 'e2e-sm-two', { x0: 0.50, y0: 0.28, x1: 0.68, y1: 0.44 });
  expect(second, 'second survey-marker id').toBeTruthy();
  expect(second).not.toBe(first);
  await expect.poll(async () => (await markerIds(page)).length).toBeGreaterThanOrEqual(2);
  expect(await markerIds(page)).toEqual(expect.arrayContaining([first, second]));

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(async () => (await markerIds(page)).includes(second)).toBeFalsy();
  expect((await markerIds(page)).includes(first), 'undo second must keep first marker').toBeTruthy();

  const beforeRect = new Set(await userAnnoIds(page));
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  const rectBtn = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true });
  await expect(rectBtn).toBeVisible();
  await rectBtn.click();
  await dragOnLayer(page, { x0: 0.20, y0: 0.56, x1: 0.38, y1: 0.72 });
  let rectId = null;
  await expect.poll(async () => {
    const ids = await userAnnoIds(page);
    rectId = ids.find((id) => !beforeRect.has(id)) || null;
    return rectId;
  }, { message: 'expected a rect sibling' }).not.toBeNull();

  expect((await markerIds(page)).includes(first), 'drawing a rect must not wipe the remaining marker').toBeTruthy();
  await expect(page.locator(`[data-survey-marker-id="${first}"]`)).toHaveCount(1);
  expect((await markerIds(page)).includes(second), 'undone marker stays gone after rect').toBeFalsy();

  await assertNoErrorBoundary(page);
  console.log('E2E_SURVEY_MARKER', JSON.stringify({
    first,
    second,
    rectId,
    afterUndoMarkers: await markerIds(page),
    exportAnnots: exported.rows.map((row) => row.subtype),
    baselineAnnots: baseline.rows.map((row) => row.subtype),
    printExcludedSurveyMarkers: diagnostics.excluded.surveyMarkers,
    leftover18: 'unchanged',
  }));
});
