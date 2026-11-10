// Drawboard keys (Nightly flag drawboard-keys), from Drawboard Projects'
// keyboard sheet: Shift+Up / Down go to the previous / next page (unless a
// picked mark takes Shift+arrows to nudge), and Alt+O / Alt+U open the next /
// previous version. Keyboard layouts only: desktop, and a tablet with touch
// and a keyboard; phones have no keyboard to press.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { seedSheet } from './seedSheet.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } } },
  { name: 'tablet', use: { viewport: { width: 1024, height: 768 }, hasTouch: true } },
];

async function versionPdf(label) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(`${label} page 1`, { x: 72, y: 700, size: 24, font });
  return Buffer.from(await pdf.save());
}

async function addVersion(admin, userId, name, bytes) {
  const id = crypto.randomUUID();
  const path = `${userId}/${id}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: userId, project_id: null, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return { id, path };
}

// The page drawing, not its words: a touch screen has no text layer.
const pageDiv = (page, n) => page.locator(`.survey-pdfjs-page-div[data-page-number="${n}"]`).filter({ visible: true }).first();

async function openByName(page, name) {
  await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(pageDiv(page, 1)).toBeVisible({ timeout: 60_000 });
}

for (const layout of LAYOUTS) {
  test.describe(`Drawboard keys, ${layout.name}`, () => {
    test.use(layout.use);

    test('Shift+Down / Up turn the page', async ({ page }) => {
      test.setTimeout(120_000);
      const sheet = await seedSheet('Keys pages', { pages: 3 });
      await page.addInitScript(() => localStorage.setItem('survey.flag.drawboard-keys', '1'));
      try {
        await signIn(page, E2E_ACCOUNTS.owner);
        await openByName(page, sheet.name);
        const pageText = (n) => pageDiv(page, n);
        await pageDiv(page, 1).click({ position: { x: 300, y: 400 } });
        await page.keyboard.press('Shift+ArrowDown');
        await expect(pageText(2)).toBeInViewport({ ratio: 0.6, timeout: 10_000 });
        await expect(pageText(1)).not.toBeInViewport({ ratio: 0.2 });
        await page.keyboard.press('Shift+ArrowDown');
        await expect(pageText(3)).toBeInViewport({ ratio: 0.6, timeout: 10_000 });
        await page.keyboard.press('Shift+ArrowUp');
        await expect(pageText(2)).toBeInViewport({ ratio: 0.6, timeout: 10_000 });
        await expect(pageText(3)).not.toBeInViewport({ ratio: 0.2 });
      } finally {
        await sheet.remove();
      }
    });

    test('Alt+U / Alt+O open the previous / next version', async ({ page }) => {
      test.setTimeout(150_000);
      const admin = adminClient();
      const api = await apiClientFor(E2E_ACCOUNTS.owner);
      const { data: { user } } = await api.auth.getUser();
      const name = `Keys versions ${layout.name} ${RUN}.pdf`;
      const v1 = await addVersion(admin, user.id, name, await versionPdf('Rev A'));
      const v2 = await addVersion(admin, user.id, name, await versionPdf('Rev B'));
      await must('supersede', api.rpc('supersede_document', { p_old_document_id: v1.id, p_new_document_id: v2.id }));
      await page.addInitScript(() => {
        localStorage.setItem('survey.flag.drawboard-keys', '1');
        localStorage.setItem('survey.flag.document-versions', '1');
      });
      try {
        await signIn(page, E2E_ACCOUNTS.owner);
        await openByName(page, name);
        const button = page.locator('[data-document-versions-button]');
        await expect(button).toHaveText('v2', { timeout: 30_000 });
        // Alt+O on the newest version goes nowhere.
        await page.keyboard.press('Alt+KeyO');
        await expect(button).toHaveText('v2');
        await page.keyboard.press('Alt+KeyU');
        const shown = page.locator('[data-document-versions-button]').filter({ visible: true });
        await expect(shown).toHaveText('v1', { timeout: 60_000 });
        await expect(pageDiv(page, 1)).toBeVisible({ timeout: 60_000 });
        await page.keyboard.press('Alt+KeyO');
        await expect(shown).toHaveText('v2', { timeout: 60_000 });
      } finally {
        await admin.from('documents').delete().in('id', [v1.id, v2.id]);
        await admin.storage.from('documents').remove([v1.path, v2.path]);
      }
    });
  });
}

test.describe('Drawboard keys, flag off', () => {
  test.use(LAYOUTS[0].use);
  test('Shift+Down does not turn the page', async ({ page }) => {
    test.setTimeout(120_000);
    const sheet = await seedSheet('Keys off', { pages: 3 });
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      await openByName(page, sheet.name);
      await pageDiv(page, 1).click({ position: { x: 300, y: 400 } });
      await page.keyboard.press('Shift+ArrowDown');
      await page.waitForTimeout(800);
      await expect(pageDiv(page, 1)).toBeInViewport({ ratio: 0.5 });
    } finally {
      await sheet.remove();
    }
  });
});
