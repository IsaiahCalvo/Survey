// The Markups list on a phone (beta flag 'markup-list'): it is a tab in the
// Pages hub sheet, and the dock's hub button names it while it is open.
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

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }); test('the phone opens the Markups list from the Pages hub', async ({ page }) => {
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
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().tap();
    await page.waitForTimeout(1500);
    const open = page.getByRole('button', { name: 'Open file' });
    if (await open.isVisible().catch(() => false)) await open.tap();
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Open pages, search, and bookmarks' }).tap();
    await page.waitForTimeout(800);
    await page.getByRole('button', { name: 'Markups', exact: true }).filter({ visible: true }).first().tap();
    await page.waitForTimeout(1000);
    await expect(page.getByTestId('markups-panel')).toBeVisible();
    await expect(page.getByTestId('markups-panel')).toContainText('No markups yet');
    await expect(page.getByRole('button', { name: 'Open pages, search, and bookmarks' })).toContainText('Markups');
  } finally {
    await admin.from('documents').delete().eq('id', id);
    await admin.storage.from('documents').remove([`${user.id}/${id}.pdf`]);
  }
});
