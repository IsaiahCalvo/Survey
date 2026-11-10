// Alt+Shift+] / [ steps through the open documents (beta flag 'tab-keys',
// Drawboard PDF Pro trial audit 2026-11-09).
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

test('Alt+Shift+] and [ switch between open documents', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.tab-keys', '1'));
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const sheets = [];
  for (const label of ['one', 'two']) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([792, 612]).drawText(`Tab keys ${label}`, { x: 72, y: 560, size: 24, font });
    const bytes = Buffer.from(await pdf.save());
    const id = crypto.randomUUID();
    const path = `${user.id}/${id}.pdf`;
    await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
    await must('row', admin.from('documents').insert({
      id, user_id: user.id, name: `Tab keys ${label} ${RUN}.pdf`, file_path: path, file_size: bytes.length, page_count: 1,
      content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }));
    sheets.push({ id, path, label, name: `Tab keys ${label} ${RUN}.pdf` });
  }
  const shows = (label) => page.getByText(`Tab keys ${label}`, { exact: true }).filter({ visible: true });
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    for (const sheet of sheets) {
      await page.getByText('Home', { exact: true }).first().click();
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Open file' }).click();
      await expect(shows(sheet.label)).toBeVisible({ timeout: 60_000 });
    }
    await page.keyboard.press('Alt+Shift+BracketRight');
    await expect(shows('one')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Alt+Shift+BracketLeft');
    await expect(shows('two')).toBeVisible({ timeout: 10_000 });
    await page.keyboard.press('Alt+Shift+BracketLeft');
    await expect(shows('one')).toBeVisible({ timeout: 10_000 });
  } finally {
    for (const s of sheets) {
      await admin.from('documents').delete().eq('id', s.id);
      await admin.storage.from('documents').remove([s.path]);
    }
  }
});
