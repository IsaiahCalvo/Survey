// A project's sheets as one set (Nightly flag sheet-set-view), copied from
// Drawboard Projects: "Open all" opens the first sheet with the List view;
// Grid shows 4 to 8 a row (2 on a phone); a sheet opens in the single view;
// the bar's arrows, Shift+Left / Right and the picker step through the set in
// the open sheet's tab. Every layout: desktop, tablet, phone web on iPhone
// and Android sizes, the phone app on iOS and Android.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, expect, test } from './helpers.mjs';

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } }, phone: false, app: false },
  { name: 'tablet', use: { viewport: { width: 1024, height: 768 }, hasTouch: true }, phone: false, app: false },
  { name: 'phone web, 390px iPhone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone web, 360px Android', use: { viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone app, iOS 390px', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }, phone: true, app: true },
  { name: 'phone app, Android 412px', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }, phone: true, app: true },
];

async function onePagePdf(label) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText(label, { x: 72, y: 500, size: 40, font });
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

const visible = (locator) => locator.filter({ visible: true }).first();
const press = (layout, locator) => (layout.use.hasTouch ? locator.tap() : locator.click());
const SHOTS = process.env.E2E_SHEET_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);

async function seedProject(admin, ownerId, slug, names) {
  const projectId = crypto.randomUUID();
  await must('project', admin.from('projects').insert({ id: projectId, user_id: ownerId, name: `SS ${slug} ${RUN}`.slice(0, 60) }));
  const ids = [];
  for (const name of names) {
    const id = crypto.randomUUID();
    const bytes = await onePagePdf(name);
    await must('upload', admin.storage.from('documents').upload(`${ownerId}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
    await must('doc', admin.from('documents').insert({
      id, user_id: ownerId, project_id: projectId, name, file_path: `${ownerId}/${id}.pdf`, file_size: bytes.length, page_count: 1,
      content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }));
    ids.push(id);
  }
  return {
    projectId,
    ids,
    remove: async () => {
      await admin.from('documents').delete().eq('project_id', projectId);
      await admin.storage.from('documents').remove(ids.map((id) => `${ownerId}/${id}.pdf`));
      await admin.from('projects').delete().eq('id', projectId);
    },
  };
}

async function openProject(page, layout, projectId, anyDocName) {
  if (layout.phone && !layout.app) {
    // Phone web: the title is the menu of hub sections.
    await expect(visible(page.getByText(anyDocName, { exact: true }))).toBeVisible({ timeout: 45_000 });
    const sectionMenu = visible(page.locator('.hub-title-switch'));
    await expect(async () => {
      if ((await sectionMenu.getAttribute('aria-expanded')) !== 'true') await press(layout, sectionMenu);
      await expect(sectionMenu).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await press(layout, visible(page.locator('.hub-section-menu').getByRole('menuitem', { name: 'Projects' })));
  } else {
    await visible(page.getByRole('button', { name: 'Projects', exact: true }).or(page.getByRole('tab', { name: 'Projects' }))).click();
  }
  const projectRow = visible(page.locator(`[data-project-id="${projectId}"]`));
  await expect(projectRow).toBeVisible({ timeout: 45_000 });
  await press(layout, projectRow);
}

for (const layout of LAYOUTS) {
  test.describe(`Sheet set view, ${layout.name}`, () => {
    test.use(layout.use);

    test('Open all, List and Grid, then step through the sheets in one tab', async ({ page }) => {
      test.setTimeout(240_000);
      const admin = adminClient();
      const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      // Made out of order: the set reads A-1, A-2, A-10.
      const names = [`A-10 ${slug}.pdf`, `A-1 ${slug}.pdf`, `A-2 ${slug}.pdf`];
      const label = (n) => `A-${n} ${slug}`;
      const seed = await seedProject(admin, ownerId, slug, names);
      await page.addInitScript(() => localStorage.setItem('survey.flag.sheet-set-view', '1'));
      try {
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        await openProject(page, layout, seed.projectId, names[0]);

        // 1. Open all: the first sheet, with every sheet in the List view.
        await press(layout, visible(page.locator('[data-open-all-sheets]')));
        const listView = page.locator('[data-sheet-set-view="list"]');
        await expect(listView).toBeVisible({ timeout: 60_000 });
        const cards = listView.locator('[data-sheet-card]');
        await expect(cards).toHaveCount(3);
        await expect(cards).toHaveText([label(1), label(2), label(10)]);
        const bar = visible(page.locator('[data-sheet-set-bar]'));
        await expect(bar.locator('[data-sheet-count]')).toHaveText('1 / 3');
        await expect(bar.locator('[data-sheet-view="list"]')).toHaveAttribute('aria-checked', 'true');
        await expect(cards.first()).toHaveAttribute('aria-current', 'page');
        // Each sheet shows its first page.
        await expect(cards.first().locator('img')).toBeVisible({ timeout: 45_000 });
        await shot(page, layout, '1-list');

        // 2. Grid: 4 to 8 a row on a wide screen, 2 on a phone.
        await press(layout, bar.locator('[data-sheet-view="grid"]'));
        const gridView = page.locator('[data-sheet-set-view="grid"]');
        await expect(gridView).toBeVisible();
        const columns = () => gridView.locator('.sheet-set-view__scroll').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
        if (layout.phone) {
          await expect(gridView.locator('[data-sheet-columns]')).toHaveCount(0);
          await expect.poll(columns).toBe(2);
        } else {
          await expect.poll(columns).toBe(4);
          await press(layout, gridView.locator('[data-sheet-columns="6"]'));
          await expect.poll(columns).toBe(6);
        }
        await expect(gridView.locator('[data-sheet-card] img')).toHaveCount(3, { timeout: 45_000 });
        await shot(page, layout, '2-grid');

        // 3. A sheet opens in the single view, in the same tab.
        await press(layout, gridView.locator(`[data-sheet-card="${seed.ids[2]}"]`));
        await expect(gridView).toHaveCount(0);
        await expect(bar.locator('[data-sheet-count]')).toHaveText('2 / 3');
        await expect(bar.locator('[data-sheet-view="single"]')).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator('[data-viewer-tab]')).toHaveCount(1);
        await expect(visible(page.locator('.survey-pdfjs-page-div[data-page-number]'))).toBeVisible({ timeout: 60_000 });

        // 4. Next to the last sheet; the arrow stops there.
        await press(layout, bar.locator('[data-sheet-step="next"]'));
        await expect(bar.locator('[data-sheet-count]')).toHaveText('3 / 3');
        await expect(bar.locator('[data-sheet-step="next"]')).toBeDisabled();
        await expect(page.locator('[data-viewer-tab]')).toHaveCount(1);
        await shot(page, layout, '3-single');

        // 5. Shift+Left steps back (a keyboard: desktop and tablet).
        if (!layout.phone) {
          await expect(visible(page.locator('.survey-pdfjs-page-div[data-page-number]'))).toBeVisible({ timeout: 60_000 });
          await page.keyboard.press('Shift+ArrowLeft');
          await expect(bar.locator('[data-sheet-count]')).toHaveText('2 / 3');
        }

        // 6. The picker: search by number, pick the first sheet.
        await press(layout, bar.locator('[data-sheet-picker-button]'));
        const picker = bar.locator('[data-sheet-picker]');
        await expect(picker.getByRole('option')).toHaveCount(3);
        await picker.getByLabel('Search sheets').fill('a-1');
        await expect(picker.getByRole('option')).toHaveText([label(1), label(10)]);
        await shot(page, layout, '4-picker');
        await press(layout, picker.locator(`[data-sheet-option="${seed.ids[1]}"]`));
        await expect(picker).toHaveCount(0);
        await expect(bar.locator('[data-sheet-count]')).toHaveText('1 / 3');
        await expect(bar.locator('[data-sheet-step="prev"]')).toBeDisabled();
        await expect(page.locator('[data-viewer-tab]')).toHaveCount(1);
      } finally {
        await seed.remove();
      }
    });
  });
}

test.describe('Sheet set view, flag off', () => {
  test.use(LAYOUTS[0].use);
  test('no Open all, no sheet bar', async ({ page }) => {
    test.setTimeout(120_000);
    const admin = adminClient();
    const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
    const names = ['B-1 off.pdf', 'B-2 off.pdf'];
    const seed = await seedProject(admin, ownerId, 'off', names);
    try {
      await signInAt(page, E2E_ACCOUNTS.owner, '/');
      await openProject(page, LAYOUTS[0], seed.projectId, names[0]);
      await expect(visible(page.getByText('B-1 off', { exact: false }))).toBeVisible();
      await expect(page.locator('[data-open-all-sheets]')).toHaveCount(0);
      await visible(page.getByText('B-1 off', { exact: false })).dblclick();
      await expect(visible(page.locator('.survey-pdfjs-page-div[data-page-number]'))).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('[data-sheet-set-bar]')).toHaveCount(0);
    } finally {
      await seed.remove();
    }
  });
});
