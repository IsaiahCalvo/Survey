// Upload review (Nightly flag upload-review), copied from Drawboard
// Projects' "Review & Publish" grid: a picture of each title block beside
// what was read, a multi-page set turned into one drawing per page, a
// warning on a sheet number + revision already uploaded, Show Problems,
// rows picked for a bulk revision and discipline, a row removed, then
// Upload saves each page as its own drawing with what the grid says.
// Every layout: desktop, tablet, phone web on iPhone and Android sizes, the
// phone app on iOS and Android.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, expect, pickValue, test } from './helpers.mjs';

const FLAGS = ['upload-review'];

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } }, phone: false, app: false },
  { name: 'tablet', use: { viewport: { width: 1024, height: 768 }, hasTouch: true }, phone: false, app: false },
  { name: 'phone web, 390px iPhone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone web, 360px Android', use: { viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone app, iOS 390px', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }, phone: true, app: true },
  { name: 'phone app, Android 412px', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }, phone: true, app: true },
];

// A set: one title block per page (sheet number and revision bottom right).
async function sheetSet(sheets) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const { title, sheet, rev } of sheets) {
    const page = pdf.addPage([1224, 792]);
    page.drawText(title, { x: 80, y: 720, size: 18, font });
    page.drawRectangle({ x: 1040, y: 30, width: 170, height: 70, borderWidth: 1, borderColor: rgb(0, 0, 0) });
    page.drawText('SHEET NO.', { x: 1080, y: 80, size: 7, font });
    page.drawText(sheet, { x: 1080, y: 56, size: 18, font });
    page.drawText('REV', { x: 1170, y: 80, size: 7, font });
    page.drawText(rev, { x: 1170, y: 60, size: 10, font });
  }
  return Buffer.from(await pdf.save());
}

async function userIdOf(admin, account) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === account.email).id;
}

async function signInAt(page, account, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill(account.email);
  await dialog.getByLabel('Password').fill(account.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toBeHidden();
}

const press = (layout, locator) => (layout.use.hasTouch ? locator.tap() : locator.click());
const SHOTS = process.env.E2E_UPLOAD_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);
const BASE = (parseInt(crypto.createHash('sha1').update(String(RUN)).digest('hex').slice(0, 6), 16) % 600) + 100;

for (const [i, layout] of LAYOUTS.entries()) {
  test.describe(`Upload review, ${layout.name}`, () => {
    test.use(layout.use);

    test('pictures, one document per page, warning, bulk edits, remove, upload', async ({ page }) => {
      test.setTimeout(240_000);
      const admin = adminClient();
      const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
      const n = BASE + i * 10;
      const sheets = [
        { title: `Ground floor ${RUN}`, sheet: `A-${n}`, rev: 'B' },
        { title: `First floor ${RUN}`, sheet: `A-${n + 1}`, rev: 'B' },
        { title: `Framing ${RUN}`, sheet: `S-${n + 2}`, rev: '1' },
      ];
      const fileName = `Set ${RUN} ${i}.pdf`;
      const base = fileName.replace(/\.pdf$/, '');
      const names = [1, 2, 3].map((p) => `${base} - p${p}.pdf`);
      // Already uploaded: the first sheet at revision B.
      const oldId = crypto.randomUUID();
      const oldName = `Old A-${n} ${RUN} ${i}.pdf`;
      await must('old sheet', admin.from('documents').insert({
        id: oldId, user_id: ownerId, project_id: null, name: oldName, file_path: `${ownerId}/${oldId}.pdf`, file_size: 10, page_count: 1,
        sheet_number: `A${n}`, sheet_revision: 'B',
      }));
      const uploaded = async () => (await admin.from('documents').select('id, name, sheet_number, sheet_revision, page_count').eq('user_id', ownerId).in('name', [...names, fileName])).data || [];

      await page.addInitScript((flags) => { for (const f of flags) localStorage.setItem(`survey.flag.${f}`, '1'); }, FLAGS);
      try {
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        await expect(page.getByRole('button', { name: /upload|new/i }).filter({ visible: true }).first()).toBeVisible({ timeout: 45_000 });
        const input = page.locator('input[type="file"]:not([multiple])').first();
        await input.setInputFiles({ name: fileName, mimeType: 'application/pdf', buffer: await sheetSet(sheets) });

        const card = page.locator('[data-upload-review]');
        await expect(card).toBeVisible({ timeout: 20_000 });
        await expect(card.getByText('Review the sheet before upload')).toBeVisible();
        const rows = card.locator('[data-upload-review-row]');
        await expect(rows).toHaveCount(1);
        // 1. The first page's title block, read and pictured; the set has 3 pages.
        await expect(rows.first().getByLabel('Sheet number')).toHaveValue(`A-${n}`, { timeout: 20_000 });
        await expect(rows.first().locator('[data-upload-review-crop="yes"] img')).toBeVisible({ timeout: 20_000 });
        await expect(rows.first()).toContainText('3 pages');

        // 2. One document per page: a row per page, each read from its own page.
        await press(layout, card.locator('[data-upload-review-split]').first());
        await expect(rows).toHaveCount(3);
        for (const [k, s] of sheets.entries()) {
          const row = card.locator(`[data-upload-review-page="${k + 1}"]`);
          await expect(row.getByLabel('Sheet number')).toHaveValue(s.sheet, { timeout: 20_000 });
          await expect(row.getByLabel('Revision')).toHaveValue(s.rev);
          await expect(row.getByLabel('Name')).toHaveValue(`${base} - p${k + 1}`);
          await expect(row.locator('[data-upload-review-crop="yes"] img')).toBeVisible({ timeout: 20_000 });
        }
        const p1 = card.locator('[data-upload-review-page="1"]');
        const p2 = card.locator('[data-upload-review-page="2"]');
        const p3 = card.locator('[data-upload-review-page="3"]');
        await shot(page, layout, '1-split');

        // 3. A-n revision B is already uploaded: a warning, and Show Problems finds it.
        await expect(p1.locator('[data-upload-review-note="warning"]')).toContainText('already uploaded', { timeout: 20_000 });
        await press(layout, card.locator('[data-upload-review-show="problems"]'));
        await expect(rows).toHaveCount(1);
        await expect(p1).toBeVisible();
        await press(layout, card.locator('[data-upload-review-show="all"]'));
        await expect(rows).toHaveCount(3);

        // 4. Pick pages 1 and 2: revision C and Interiors for both.
        await press(layout, p1.getByRole('checkbox', { name: /^Pick / }));
        await press(layout, p2.getByRole('checkbox', { name: /^Pick / }));
        const bulk = card.locator('[data-upload-review-bulk]');
        await expect(bulk).toBeVisible();
        await bulk.getByLabel('Revision for the picked rows').fill('C');
        await press(layout, bulk.locator('[data-upload-review-bulk-rev]'));
        await expect(p1.getByLabel('Revision')).toHaveValue('C');
        await expect(p2.getByLabel('Revision')).toHaveValue('C');
        await expect(p1.locator('[data-upload-review-note="warning"]')).toHaveCount(0);
        if (layout.phone) await bulk.locator('select[aria-label="Discipline for the picked rows"]').selectOption('Interiors');
        else await pickValue(page, bulk, 'Discipline for the picked rows', 'Interiors');
        if (layout.phone) {
          await expect(p1.locator(`select[aria-label="Discipline of ${base} - p1"]`)).toHaveValue('Interiors');
        } else {
          await expect(p1.getByRole('button', { name: `Discipline of ${base} - p1`, exact: true })).toContainText('Interiors');
        }

        // 5. Remove page 3.
        await press(layout, p3.locator('[data-upload-review-remove]'));
        await expect(rows).toHaveCount(2);
        await shot(page, layout, '2-ready');
        const box = await card.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(layout.use.viewport.width + 1);

        // 6. Upload 2: two one-page drawings with the grid's values.
        await press(layout, card.getByRole('button', { name: 'Upload 2', exact: true }));
        await expect(card).toBeHidden();
        await expect.poll(async () => (await uploaded()).map((d) => [d.name, d.sheet_number, d.sheet_revision, d.page_count]).sort((a, b) => a[0].localeCompare(b[0])), { timeout: 60_000 })
          .toEqual([
            [names[0], `A${n}`, 'C', 1],
            [names[1], `A${n + 1}`, 'C', 1],
          ]);
        const ids = (await uploaded()).map((d) => d.id);
        await expect.poll(async () => ((await admin.from('document_reviews').select('discipline').in('document_id', ids)).data || []).map((r) => r.discipline), { timeout: 20_000 })
          .toEqual(['Interiors', 'Interiors']);
      } finally {
        if (!process.env.KEEP) {
          const docs = await uploaded();
          await admin.from('documents').delete().in('id', [oldId, ...docs.map((d) => d.id)]);
        }
      }
    });
  });
}
