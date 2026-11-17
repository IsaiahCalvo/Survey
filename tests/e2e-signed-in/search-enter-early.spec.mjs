// Type a word and press Enter at once: Survey goes to the first hit when the
// search comes back, as the PDF.js test page's Find does (KAL-371). Enter used
// to do nothing until the hits were in.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

test('Enter pressed before the hits come back goes to the first hit', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 12; i += 1) {
    const p = pdf.addPage([612, 792]);
    p.drawText(i === 9 ? 'Sheet nine has the riser' : `Sheet ${i}`, { x: 72, y: 700, size: 24, font });
  }
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  const path = `${user.id}/${id}.pdf`;
  const name = `Search Enter early ${RUN}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: path, file_size: bytes.length, page_count: 12,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Search text', exact: true }).first().click();
    const input = page.getByLabel('Search text in PDF');
    await input.fill('riser');
    await input.press('Enter');
    const row = page.locator('.search-text-result');
    await expect(row).toHaveCount(1, { timeout: 30_000 });
    await expect(row.first()).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="9"]')).toBeInViewport({ timeout: 15_000 });
  } finally {
    await admin.from('documents').delete().eq('id', id);
    await admin.storage.from('documents').remove([path]);
  }
});
