// Sheet revisions (beta flag 'sheet-revisions', Drawboard Projects trial
// audit 2026-11-09): an upload whose title block reads the same sheet number
// as an open document is offered as that sheet's new version, even under a
// different file name.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
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

test('a new upload of the same sheet number is offered as a new version', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.sheet-revisions', '1');
    localStorage.setItem('survey.flag.document-versions', '1');
  });
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  // A sheet number of its own per run, so old runs' rows never match.
  const sheet = `Q-${(parseInt(crypto.createHash('sha1').update(String(RUN)).digest('hex').slice(0, 6), 16) % 900) + 100}`;
  const oldName = `${sheet} Floor Plan ${RUN}.pdf`;
  const newName = `Ground floor issue ${RUN}.pdf`;
  const oldId = crypto.randomUUID();
  const oldBytes = await titledSheet('Sheet rev A', sheet, 'A');
  await must('upload', admin.storage.from('documents').upload(`${user.id}/${oldId}.pdf`, new Blob([oldBytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id: oldId, user_id: user.id, project_id: null, name: oldName, file_path: `${user.id}/${oldId}.pdf`, file_size: oldBytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(oldBytes).digest('hex'),
  }));

  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await expect(page.getByText(oldName, { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    // The old row has no saved reading: its file name gives the sheet.
    await page.locator('input[type="file"][accept="application/pdf"]:not([multiple])').first().setInputFiles({
      name: newName,
      mimeType: 'application/pdf',
      buffer: await titledSheet('Sheet rev B', sheet, 'B'),
    });
    const ask = page.getByRole('dialog', { name: `New revision of sheet ${sheet}?` });
    await expect(ask).toBeVisible({ timeout: 30_000 });
    await expect(ask).toContainText(`“${newName}” reads as sheet ${sheet}, revision B.`);
    await expect(ask).toContainText(`“${oldName}” is the same sheet.`);
    await ask.getByRole('button', { name: 'Upload as new version' }).click();
    await expect(page.getByText('Sheet rev B')).toBeVisible({ timeout: 60_000 });

    const { data: fresh } = await admin.from('documents').select('id, sheet_number, sheet_revision').eq('user_id', user.id).eq('name', newName).single();
    expect(fresh).toMatchObject({ sheet_number: sheet.replace('-', ''), sheet_revision: 'B' });
    await expect.poll(async () => (await admin.from('documents').select('superseded_by').eq('id', oldId).single()).data?.superseded_by, { timeout: 60_000 })
      .toBe(fresh.id);
  } finally {
    if (!process.env.KEEP) {
      await admin.from('documents').update({ superseded_by: null }).eq('id', oldId);
      await admin.from('documents').delete().eq('user_id', user.id).in('name', [oldName, newName]);
    }
  }
});
