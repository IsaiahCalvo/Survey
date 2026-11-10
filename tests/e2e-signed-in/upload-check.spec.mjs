// Upload check (beta flag 'upload-check', Drawboard Projects round 2): after
// the file pick, one card shows the name, sheet number and revision read
// from the title block, to fix before the file uploads. Cancel uploads
// nothing; Upload saves what the card says.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function titledSheet(heading, sheet, rev) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([1224, 792]);
  page.drawText(heading, { x: 80, y: 720, size: 18, font });
  page.drawText('SHEET NO.', { x: 1080, y: 80, size: 7, font });
  page.drawText(sheet, { x: 1080, y: 56, size: 18, font });
  page.drawText('REV', { x: 1170, y: 80, size: 7, font });
  page.drawText(rev, { x: 1170, y: 60, size: 10, font });
  return Buffer.from(await pdf.save());
}

test('upload check: shows the title block reading, Cancel uploads nothing, edits are saved', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.upload-check', '1'));
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const sheet = `K-${(parseInt(crypto.createHash('sha1').update(String(RUN)).digest('hex').slice(0, 6), 16) % 900) + 100}`;
  const fileName = `Scan 0042 ${RUN}.pdf`;
  const finalName = `Kitchen plan ${RUN}`;
  const bytes = await titledSheet('Upload check sheet', sheet, 'C');
  const input = page.locator('input[type="file"][accept="application/pdf"]:not([multiple])').first();
  const rowsNamed = async (names) => (await admin.from('documents').select('name, sheet_number, sheet_revision').eq('user_id', user.id).in('name', names)).data || [];

  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await expect(page.getByRole('button', { name: /upload/i }).first()).toBeVisible({ timeout: 30_000 });

    // Cancel: nothing is uploaded.
    await input.setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: bytes });
    let card = page.getByRole('dialog', { name: 'Check the sheet before upload' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    const row = card.locator(`[data-upload-check-row="${fileName}"]`);
    await expect(row.getByLabel('Sheet number')).toHaveValue(sheet, { timeout: 20_000 });
    await expect(row.getByLabel('Revision')).toHaveValue('C');
    await expect(row.getByLabel('Name')).toHaveValue(fileName.replace(/\.pdf$/, ''));
    await expect(row).toContainText('Read from the title block');
    await page.screenshot({ path: test.info().outputPath('upload-check-card.png') });
    await card.getByRole('button', { name: 'Cancel' }).click();
    await expect(card).toBeHidden();
    await page.waitForTimeout(1500);
    expect(await rowsNamed([fileName])).toEqual([]);

    // Fix the name and revision, then Upload.
    await input.setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: bytes });
    card = page.getByRole('dialog', { name: 'Check the sheet before upload' });
    await expect(card.getByLabel('Sheet number')).toHaveValue(sheet, { timeout: 20_000 });
    // An empty name stops Upload.
    await card.getByLabel('Name').fill('  ');
    await expect(card.getByRole('button', { name: 'Upload', exact: true })).toBeDisabled();
    await expect(card).toContainText('Give it a name.');
    await card.getByLabel('Name').fill(finalName);
    await card.getByLabel('Revision').fill('D');
    await card.getByRole('button', { name: 'Upload', exact: true }).click();
    await expect(card).toBeHidden();
    await expect(page.getByText('Upload check sheet')).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => rowsNamed([`${finalName}.pdf`, fileName]), { timeout: 20_000 }).toEqual([
      { name: `${finalName}.pdf`, sheet_number: sheet.replace('-', ''), sheet_revision: 'D' },
    ]);

    // Phone width: the card fits and the fields stay usable.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(800);
    await page.goto('/');
    await input.setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: bytes });
    card = page.getByRole('dialog', { name: 'Check the sheet before upload' });
    await expect(card.getByLabel('Sheet number')).toHaveValue(sheet, { timeout: 20_000 });
    const box = await card.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: test.info().outputPath('upload-check-phone.png') });
    await card.getByRole('button', { name: 'Cancel' }).click();
  } finally {
    if (!process.env.KEEP) await admin.from('documents').delete().eq('user_id', user.id).in('name', [fileName, `${finalName}.pdf`]);
  }
});
