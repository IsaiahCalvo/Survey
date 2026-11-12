// A measurement drawn in Drawboard / Bluebeam / Acrobat (/IT LineDimension
// + /Measure scale) opens in Survey as a Survey measurement that shows its
// reading, instead of a plain line (Linear KAL-539). Real app, real file.
import crypto from 'node:crypto';
import { PDFDocument, PDFName, PDFString, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function measuredSheet() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([612, 792]);
  page.drawText('Measured plan', { x: 72, y: 700, size: 24, font });
  const { context } = pdf;
  const fmt = (u, c) => context.obj({ Type: 'NumberFormat', U: PDFString.of(u), C: c, D: 100 });
  // 1 in = 10 ft; a 144 pt line is 2 in on paper = 20 ft.
  const line = context.register(context.obj({
    Type: 'Annot', Subtype: 'Line', NM: PDFString.of(`dim-${RUN}`), Rect: [150, 498, 294, 502], L: [150, 500, 294, 500],
    C: [0.9, 0.1, 0.1], Border: [0, 0, 2], IT: 'LineDimension', P: page.ref, Contents: PDFString.of("20' 0\""),
    Measure: context.obj({ Type: 'Measure', Subtype: 'RL', R: PDFString.of('1 in = 10 ft'), X: [fmt('ft', 10 / 72)], D: [fmt('ft', 1)], A: [fmt('sq ft', 1)] }),
  }));
  page.node.set(PDFName.of('Annots'), context.obj([line]));
  return Buffer.from(await pdf.save());
}

test('a measurement from another PDF app opens as a Survey measurement', async ({ page }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const ownerId = (await owner.auth.getUser()).data.user.id;
  const name = `Measured sheet ${RUN}.pdf`;
  const docId = crypto.randomUUID();
  const bytes = await measuredSheet();
  const path = `${ownerId}/${docId}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Measured plan', { exact: true })).toBeVisible({ timeout: 60_000 });
    // Survey draws its own reading pill for a measurement.
    await expect(page.locator('[data-overlay-page="1"]').getByText("20' 0\"", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.screenshot({ path: test.info().outputPath('native-measure-import.png') });
  } finally {
    await admin.from('document_annotations').delete().eq('document_id', docId);
    await admin.from('documents').delete().eq('id', docId);
    await admin.storage.from('documents').remove([path]);
  }
});
