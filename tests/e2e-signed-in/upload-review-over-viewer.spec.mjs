// Round 4 audit (r4d #1): a PDF dropped on an open document opened "Review
// the sheet before upload", but the home under the viewer is inert, and so
// was the card: every click went through to the drawing and only Escape got
// out. The upload cards now sit at the screen root and take clicks.
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';
import { seedSheet } from './seedSheet.mjs';

test('the upload review over an open document takes clicks', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.upload-review', '1'));
  const sheet = await seedSheet('Drop over viewer', { size: [792, 612], pages: 1 });
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
    const openFile = page.getByRole('button', { name: 'Open file' });
    if (await openFile.isVisible().catch(() => false)) await openFile.click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });

    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([792, 612]).drawText(`Dropped ${Date.now()}`, { x: 60, y: 540, size: 18, font });
    const b64 = Buffer.from(await pdf.save()).toString('base64');
    const dt = await page.evaluateHandle((data) => {
      const bin = atob(data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'dropped-over-viewer.pdf', { type: 'application/pdf' }));
      return transfer;
    }, b64);
    await pageDiv.dispatchEvent('dragenter', { dataTransfer: dt });
    await pageDiv.dispatchEvent('dragover', { dataTransfer: dt });
    await pageDiv.dispatchEvent('drop', { dataTransfer: dt });

    const card = page.locator('[data-upload-review]');
    await expect(card).toBeVisible({ timeout: 30_000 });
    // A real click (Playwright checks nothing else takes it), not Escape.
    await card.getByRole('button', { name: 'Cancel' }).click({ timeout: 10_000 });
    await expect(card).toBeHidden();
  } finally {
    await sheet.remove();
  }
});
