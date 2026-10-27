// A stamp another app saved with no appearance stream (Acrobat's standard
// "Approved" stamp) is drawn on the page from its /Name, not hidden behind the
// "some annotations aren't displayed" notice (Drawboard Projects audit).
import crypto from 'node:crypto';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function stampedPdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText('Stamped sheet', { x: 72, y: 720, size: 24, font });
  const stamp = pdf.context.obj({
    Type: 'Annot',
    Subtype: 'Stamp',
    Name: 'Approved',
    Rect: [300, 600, 480, 660],
    F: 4,
    NM: `stamp-${RUN}`,
  });
  page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(stamp)]));
  return Buffer.from(await pdf.save());
}

test('a stamp with no appearance is drawn from its name', async ({ page }) => {
  test.setTimeout(150_000);
  const owner = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const api = await apiClientFor(owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Stamped sheet ${RUN}.pdf`;
  const id = crypto.randomUUID();
  const bytes = await stampedPdf();
  await must('upload', admin.storage.from('documents').upload(`${user.id}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: `${user.id}/${id}.pdf`, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  try {
    await signIn(page, owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Stamped sheet', { exact: true })).toBeVisible({ timeout: 60_000 });
    const stamp = page.locator('.survey-pdfjs-page-div[data-page-number="1"] svg image[href^="data:image/png"]');
    await expect(stamp).toHaveCount(1, { timeout: 30_000 });
    // 180 x 60 pt on the page, at the stamp's spot (top-right of the title).
    const box = await stamp.boundingBox();
    const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
    const k = pageBox.width / 612;
    expect(Math.abs(box.width - 180 * k)).toBeLessThan(3);
    expect(Math.abs(box.height - 60 * k)).toBeLessThan(3);
    expect(Math.abs(box.x - pageBox.x - 300 * k)).toBeLessThan(3);
    expect(Math.abs(box.y - pageBox.y - (792 - 660) * k)).toBeLessThan(3);
    await expect(page.getByText('Some annotations aren’t displayed')).toHaveCount(0);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  } finally {
    await admin.from('documents').delete().eq('id', id);
  }
});
