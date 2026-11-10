// Copy in one document, paste in another (beta flag 'paste-across-documents',
// Drawboard PDF Pro trial audit 2026-11-09): every open tab shares the
// clipboard.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function seedSheets(labels) {
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const sheets = [];
  for (const label of labels) {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage([792, 612]).drawText(`Paste test ${label}`, { x: 72, y: 560, size: 24, font });
    const bytes = Buffer.from(await pdf.save());
    const id = crypto.randomUUID();
    const name = `Paste ${label} ${RUN}.pdf`;
    await must('upload', admin.storage.from('documents').upload(`${user.id}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
    await must('row', admin.from('documents').insert({
      id, user_id: user.id, name, file_path: `${user.id}/${id}.pdf`, file_size: bytes.length, page_count: 1,
      content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }));
    sheets.push({ id, name, label, path: `${user.id}/${id}.pdf` });
  }
  return {
    sheets,
    remove: async () => {
      for (const s of sheets) {
        await admin.from('documents').delete().eq('id', s.id);
        await admin.storage.from('documents').remove([s.path]);
      }
    },
  };
}

test('a mark copied in one tab pastes in another', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.paste-across-documents', '1'));
  const seeded = await seedSheets(['one', 'two']);
  const [one, two] = seeded.sheets;
  const marks = '.survey-pdfjs-page-div[data-page-number="1"] [data-svg-annotation-layer="1"] [data-annotation-index]';
  const visibleMarks = () => page.locator(marks).filter({ visible: true });
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    const open = async (sheet) => {
      await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Open file' }).click();
      await expect(page.getByText(`Paste test ${sheet.label}`).filter({ visible: true })).toBeVisible({ timeout: 60_000 });
    };
    await open(one);
    const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first().boundingBox();
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 150, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 230, { steps: 4 });
    await page.mouse.move(box.x + 260, box.y + 260, { steps: 4 });
    await page.mouse.up();
    await expect(visibleMarks()).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.mouse.click(box.x + 205, box.y + 200);
    await expect(page.locator('[data-resize-handle]').first()).toBeVisible();
    await page.keyboard.press('Control+c');

    // Second document in its own tab.
    await page.getByText('Home', { exact: true }).first().click();
    await open(two);
    await expect(visibleMarks()).toHaveCount(0);
    const box2 = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first().boundingBox();
    await page.mouse.move(box2.x + 400, box2.y + 300);
    await page.keyboard.press('Control+v');
    await expect(visibleMarks()).toHaveCount(1);
  } finally {
    await seeded.remove();
  }
});
