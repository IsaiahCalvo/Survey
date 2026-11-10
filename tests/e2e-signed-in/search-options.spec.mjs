// Search: Match case and Whole word (beta flag 'search-options', Drawboard
// PDF Pro trial audit 2026-11-09).
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

test('Match case and Whole word narrow the hits', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.search-options', '1'));
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const p = pdf.addPage([612, 792]);
  ['Door 1 swings out', 'door 2 is fire rated', 'DOOR 3 has a closer', 'Outdoor bench'].forEach((line, i) => {
    p.drawText(line, { x: 72, y: 700 - i * 40, size: 18, font });
  });
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  const path = `${user.id}/${id}.pdf`;
  const name = `Search options ${RUN}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Search text', exact: true }).first().click();
    await page.getByLabel('Search text in PDF').fill('door');
    const rows = page.locator('.search-text-result');
    await expect(rows).toHaveCount(4, { timeout: 30_000 });

    await page.locator('[data-search-option="word"]').click();
    await expect(rows).toHaveCount(3, { timeout: 30_000 });
    await page.locator('[data-search-option="case"]').click();
    await expect(rows).toHaveCount(1, { timeout: 30_000 });
    await page.locator('[data-search-option="word"]').click();
    await expect(rows).toHaveCount(2, { timeout: 30_000 });
    await page.locator('[data-search-option="case"]').click();
    await expect(rows).toHaveCount(4, { timeout: 30_000 });
  } finally {
    await admin.from('documents').delete().eq('id', id);
    await admin.storage.from('documents').remove([path]);
  }
});
