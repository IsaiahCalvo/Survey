// A click on empty space on one page drops a mark picked on another page
// (Drawboard PDF Pro trial audit 2026-11-09, slice 7: Survey kept the page-2
// mark picked after a click on empty page 1).
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function seedTwoPages() {
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const n of [1, 2]) pdf.addPage([792, 400]).drawText(`Cross page ${n}`, { x: 72, y: 340, size: 24, font });
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  const name = `Cross page ${RUN}.pdf`;
  const path = `${user.id}/${id}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: path, file_size: bytes.length, page_count: 2,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return {
    name,
    remove: async () => {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([path]);
    },
  };
}

for (const tool of ['v']) {
  test(`a click on empty page 1 drops the page-2 pick (Select)`, async ({ page }) => {
    test.setTimeout(150_000);
    const seeded = await seedTwoPages();
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(seeded.name, { exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Open file' }).click();
      const pageDiv = (n) => page.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`).filter({ visible: true }).first();
      await expect(page.getByText('Cross page 2').filter({ visible: true })).toBeVisible({ timeout: 60_000 });
      const b2 = await pageDiv(2).boundingBox();
      await page.keyboard.press('r');
      await page.mouse.move(b2.x + 150, b2.y + 80);
      await page.mouse.down();
      await page.mouse.move(b2.x + 220, b2.y + 120, { steps: 4 });
      await page.mouse.move(b2.x + 280, b2.y + 150, { steps: 4 });
      await page.mouse.up();
      await page.keyboard.press('Escape');
      await page.keyboard.press('v');
      await page.mouse.click(b2.x + 215, b2.y + 80);
      const handles = page.locator('[data-resize-handle]').filter({ visible: true });
      await expect(handles.first()).toBeVisible();

      const b1 = await pageDiv(1).boundingBox();
      await page.mouse.click(b1.x + b1.width - 120, b1.y + b1.height - 60);
      await expect(handles).toHaveCount(0, { timeout: 5_000 });
    } finally {
      await seeded.remove();
    }
  });
}
