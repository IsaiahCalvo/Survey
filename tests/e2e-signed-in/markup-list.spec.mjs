// The Markups list (beta flag 'markup-list', Drawboard Projects + PDF Pro
// trial audit 2026-11-09): every mark in one list, grouped by kind. A row
// opens and picks its mark; the list follows edits; the list saves as CSV.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function twoPagePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText('Markups page one', { x: 72, y: 540, size: 24, font });
  pdf.addPage([792, 612]).drawText('Markups page two', { x: 72, y: 540, size: 24, font });
  return Buffer.from(await pdf.save());
}

test('the Markups list shows, opens, follows and saves the marks', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.markup-list', '1'));
  const owner = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const api = await apiClientFor(owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Markups sheet ${RUN}.pdf`;
  const id = crypto.randomUUID();
  const bytes = await twoPagePdf();
  await must('upload', admin.storage.from('documents').upload(`${user.id}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: `${user.id}/${id}.pdf`, file_size: bytes.length, page_count: 2,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));

  try {
    await signIn(page, owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Markups page one')).toBeVisible({ timeout: 60_000 });
    const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
    const box = await surface.boundingBox();

    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    for (const [x, y] of [[120, 160], [320, 260]]) {
      await page.mouse.move(box.x + x, box.y + y);
      await page.mouse.down();
      await page.mouse.move(box.x + x + 30, box.y + y + 20, { steps: 4 });
      await page.mouse.move(box.x + x + 60, box.y + y + 40, { steps: 4 });
      await page.mouse.up();
    }
    const marks = page.locator('.survey-pdfjs-page-div[data-page-number="1"] [data-svg-annotation-layer="1"] [data-annotation-index]');
    await expect(marks).toHaveCount(2);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Markups', exact: true }).filter({ visible: true }).first().click();
    await expect(page.getByRole('button', { name: 'Close Markups' }).filter({ visible: true })).toHaveCount(1);
    const panel = page.getByTestId('markups-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('.markups-panel__summary')).toContainText('2 markups');
    await expect(panel.getByRole('button', { name: /Rectangles\s*2/ })).toBeVisible();
    const rows = panel.locator('[data-markup-row]');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText('You');
    await expect(rows.first()).toContainText('p. 1');

    // Words narrow the list; "p2" finds nothing on this sheet.
    await panel.getByRole('searchbox', { name: 'Search markups' }).fill('p2');
    await expect(rows).toHaveCount(0);
    await expect(panel.locator('.markups-panel__summary')).toContainText('0 of 2 markups');
    await panel.getByRole('button', { name: 'Clear' }).click();
    await expect(rows).toHaveCount(2);

    // A row opens its mark and picks it.
    await rows.nth(1).click();
    await expect(page.locator('[data-resize-handle]').first()).toBeVisible({ timeout: 10_000 });

    // The list follows edits: deleting the picked mark drops its row.
    await page.keyboard.press('Delete');
    await expect(marks).toHaveCount(1);
    await expect(rows).toHaveCount(1);
    await expect(panel.locator('.markups-panel__summary')).toContainText('1 markup');

    // Save as CSV.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      panel.getByRole('button', { name: 'Save this list as CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/_markups\.csv$/);
    const text = await (await download.createReadStream()).toArray().then((parts) => Buffer.concat(parts).toString('utf8'));
    const lines = text.trim().split(/\r\n/);
    expect(lines[0]).toBe('Page,Kind,Text,Colour,Author,Created');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^1,Rectangle,,("[^"]*"|[^,]*),You,/);
  } finally {
    await admin.from('documents').delete().eq('id', id);
    await admin.storage.from('documents').remove([`${user.id}/${id}.pdf`]);
  }
});
