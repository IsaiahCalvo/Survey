// Markups panel (Nightly, flag 'markup-list'; Drawboard deep test gap):
// every mark in one list with search, filters, measurement totals and a CSV.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function sheetPdf(label) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText(`${label} page 1`, { x: 72, y: 540, size: 24, font });
  return Buffer.from(await pdf.save());
}

async function seed(admin, userId, name) {
  const id = crypto.randomUUID();
  const bytes = await sheetPdf(name.replace(/\.pdf$/, ''));
  await must('upload', admin.storage.from('documents').upload(`${userId}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: userId, name, file_path: `${userId}/${id}.pdf`, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return id;
}

async function drawRect(page, box, x, y) {
  await page.mouse.click(5, 450);
  await page.keyboard.press('r');
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + 80, box.y + y + 50, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

test('markups: list, totals, search, filters, CSV, and a row goes to its mark', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Markup list ${RUN}.pdf`;
  const id = await seed(admin, user.id, name);
  try {
    await page.addInitScript(() => localStorage.setItem('survey.flag.markup-list', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Markup list').first()).toBeVisible({ timeout: 60_000 });
    const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
    await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    const box = await surface.boundingBox();

    // 1/4" = 1', then a perimeter and two rectangles.
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.locator('[data-measure-tool="menu"]').click();
    await page.getByText('Page scale…').click();
    const dialog = page.getByRole('dialog', { name: 'Set page scale' });
    await dialog.locator('[data-measure-preset-option="1/4"]').click();
    await dialog.locator('[data-measure-apply]').click();
    await expect(dialog).toBeHidden();
    await page.locator('[data-measure-tool="menu"]').click();
    await page.locator('[data-measure-tool="perimeter"]').click();
    const pts = [[200, 200], [380, 200], [380, 290], [200, 290]];
    for (const [x, y] of pts) await page.mouse.click(box.x + x, box.y + y);
    await page.mouse.click(box.x + pts[0][0], box.y + pts[0][1]);
    await expect(page.locator('.measure-labels .measure-label[data-measure-kind="perimeter"]')).toHaveCount(1, { timeout: 15_000 });
    await page.keyboard.press('Escape');
    await drawRect(page, box, 450, 120);
    await drawRect(page, box, 450, 330);

    await page.getByRole('button', { name: 'Markups', exact: true }).first().click();
    const panel = page.getByTestId('markups-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('[data-markups-count]')).toHaveText('3 markups', { timeout: 10_000 });
    await expect(panel.locator('[data-markups-total="perimeter"]')).toContainText(/Perimeter\s*[\d.]+ ft/);
    await expect(panel.locator('.markups-page__head')).toHaveText(['Page 1']);
    await page.screenshot({ path: test.info().outputPath('markups-panel.png') });

    // Search.
    await panel.locator('[data-markups-search]').fill('perimeter');
    await expect(panel.locator('[data-markups-count]')).toHaveText('1 of 3 markups');
    await panel.locator('[data-markups-search]').fill('');

    // Filter by type.
    await panel.locator('[data-markups-filter-toggle]').click();
    await panel.locator('[data-markups-filter="type"]').getByRole('button', { name: /Rectangle/ }).click();
    await expect(panel.locator('[data-markups-count]')).toHaveText('2 of 3 markups');
    await expect(panel.locator('[data-markups-totals]')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('markups-filtered.png') });

    // CSV of what is shown.
    const download = page.waitForEvent('download');
    await page.locator('[data-markups-csv]').filter({ visible: true }).first().click();
    const file = await download;
    expect(file.suggestedFilename()).toBe(`Markup list ${RUN} markups.csv`);
    const csv = fs.readFileSync(await file.path(), 'utf8');
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('Document,Page,Type,Text,Measurement,Quantity,Unit,Author,Layer,Color');
    expect(lines).toHaveLength(3);
    expect(lines.slice(1).every((l) => l.includes(',Rectangle,'))).toBe(true);

    // A new mark shows up while the panel is open.
    await panel.getByRole('button', { name: 'Clear filters' }).click();
    await drawRect(page, box, 600, 220);
    await expect(panel.locator('[data-markups-count]')).toHaveText('4 markups', { timeout: 10_000 });

    // A row picks its mark.
    await panel.locator('.markups-row').first().click();
    await expect(page.locator('[data-selection-quick-bar][data-visible="true"]')).toBeVisible({ timeout: 10_000 });
  } finally {
    await admin.from('documents').delete().eq('id', id);
  }
});

test('markups on a phone: a hub tab, finger-sized rows', async ({ page }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Markup phone ${RUN}.pdf`;
  const id = await seed(admin, user.id, name);
  try {
    await page.addInitScript(() => localStorage.setItem('survey.flag.markup-list', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
    await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(800);
    const box = await surface.boundingBox();
    await drawRect(page, box, 300, 200);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Open pages, search, and bookmarks' }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Markups', exact: true }).filter({ visible: true }).first().click();
    const panel = page.getByTestId('markups-panel');
    await expect(panel).toBeVisible();
    // Its glyph shows in the hub row (it draws as a masked span, not an svg).
    const glyph = page.locator('.mobile-pdf-hub-tab[aria-label="Markups"] > span').first();
    expect((await glyph.boundingBox())?.width).toBeGreaterThan(10);
    await expect(panel.locator('[data-markups-count]')).toHaveText('1 markup', { timeout: 10_000 });
    const row = panel.locator('.markups-row').first();
    expect((await row.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(500);
    await page.screenshot({ path: test.info().outputPath('markups-phone.png') });
    await row.click();
    // The sheet steps down so the mark is in view.
    await expect(panel).toBeHidden({ timeout: 10_000 });
  } finally {
    await admin.from('documents').delete().eq('id', id);
  }
});
