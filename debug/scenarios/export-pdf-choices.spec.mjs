// Export PDF choices (Nightly flag 'export-modes', owner 2026-10-26): the
// "PDF…" row of the export menu opens a dialog with annotated / flattened /
// plain marks and every page / this page / pages with marks / typed pages.
// Each download is opened with pdf-lib and checked.
import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PDFDocument, PDFName } from 'pdf-lib';

const PDF_FILE = 'print-fidelity.pdf'; // 12 pages; markups on pages 1, 3, 7, 8, 10, 11, 12
const MARKUP = (subtype) => !['/Link', '/Widget', '/Popup'].includes(subtype);

async function markupCounts(path) {
  const doc = await PDFDocument.load(await readFile(path));
  return doc.getPages().map((page) => {
    const annots = page.node.Annots();
    if (!annots) return 0;
    return annots.asArray().filter((ref) => MARKUP(doc.context.lookup(ref).get(PDFName.of('Subtype'))?.toString())).length;
  });
}

async function exportWith(page, { mode, pages, custom }) {
  await page.getByRole('button', { name: 'More export options' }).click();
  await page.getByRole('menuitem', { name: 'PDF…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export PDF' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: new RegExp(`^${mode}`) }).click();
  await dialog.getByRole('radio', { name: pages }).click();
  if (custom) await dialog.getByRole('textbox', { name: 'Pages to export' }).fill(custom);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    dialog.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  await expect(dialog).toHaveCount(0);
  return { name: download.suggestedFilename(), path: await download.path() };
}

test('Export PDF choices: plain, flattened, annotated, and which pages', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.export-modes', '1'));
  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForTimeout(1500);

  // The dialog, for a look.
  await page.getByRole('button', { name: 'More export options' }).click();
  await page.getByRole('menuitem', { name: 'PDF…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export PDF' });
  await expect(dialog.getByRole('radio', { name: /^Annotated/ })).toHaveAttribute('aria-checked', 'true');
  await expect(dialog.getByRole('radio', { name: 'All 12 pages' })).toBeVisible();
  await dialog.getByRole('radio', { name: 'Choose pages' }).click();
  await dialog.getByRole('textbox', { name: 'Pages to export' }).fill('2-40');
  await expect(dialog.getByText('This PDF has pages 1 to 12.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Export', exact: true })).toBeDisabled();
  await dialog.screenshot({ path: 'test-results/export-pdf-dialog.png' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // Plain: every page, no markups at all.
  const plain = await exportWith(page, { mode: 'Plain', pages: 'All 12 pages' });
  expect(plain.name).toBe('print-fidelity-plain.pdf');
  const plainCounts = await markupCounts(plain.path);
  expect(plainCounts).toHaveLength(12);
  expect(plainCounts.every((n) => n === 0)).toBe(true);

  // Flattened, this page: one page, marks drawn into it, none left as markups.
  const flat = await exportWith(page, { mode: 'Flattened', pages: /^This page/ });
  expect(flat.name).toBe('print-fidelity-flattened-p1.pdf');
  expect(await markupCounts(flat.path)).toEqual([0]);
  const flatDoc = await PDFDocument.load(await readFile(flat.path));
  const plainDoc = await PDFDocument.load(await readFile(plain.path));
  const contentSize = (doc) => doc.getPage(0).node.normalizedEntries().Contents.asArray?.().length ?? 1;
  expect(contentSize(flatDoc)).toBeGreaterThan(contentSize(plainDoc));

  // Annotated, typed pages: two pages, marks still markups.
  const annotated = await exportWith(page, { mode: 'Annotated', pages: 'Choose pages', custom: '1, 3' });
  expect(annotated.name).toBe('print-fidelity-annotated-p1-3.pdf');
  const counts = await markupCounts(annotated.path);
  expect(counts).toHaveLength(2);
  expect(counts[0]).toBeGreaterThan(0);
  expect(counts[1]).toBeGreaterThan(0);

  // Pages with marks: only those pages, fewer than all 12.
  const marked = await exportWith(page, { mode: 'Annotated', pages: /^Pages with marks/ });
  const markedCounts = await markupCounts(marked.path);
  expect(markedCounts.length).toBeGreaterThan(0);
  expect(markedCounts.length).toBeLessThan(12);
});
