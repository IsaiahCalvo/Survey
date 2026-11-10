// Home > New: Notebook paper in one tap and Other templates (Nightly flag
// home-templates), copied from Drawboard PDF's + menu > Create. On every
// layout (desktop, tablet, phone web on iPhone and Android sizes, the phone
// app on iOS and Android): New offers both; Notebook paper makes and opens a
// 10-page ruled document at once; Other templates shows Drawboard's three
// groups, and the picked template opens with the asked-for pages.
import crypto from 'node:crypto';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, expect, test } from './helpers.mjs';

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } }, phone: false, app: false },
  { name: 'tablet', use: { viewport: { width: 1024, height: 768 }, hasTouch: true }, phone: false, app: false },
  { name: 'phone web, 390px iPhone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone web, 360px Android', use: { viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone app, iOS 390px', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }, phone: true, app: true },
  { name: 'phone app, Android 412px', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }, phone: true, app: true },
];

async function signInAt(page, account, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill(account.email);
  await dialog.getByLabel('Password').fill(account.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function ownerId(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
}

async function removeRows(admin, rows) {
  for (const row of rows) {
    await admin.from('documents').delete().eq('id', row.id);
    if (row.file_path) await admin.storage.from('documents').remove([row.file_path]);
  }
}

const visible = (locator) => locator.filter({ visible: true }).first();
const press = (layout, locator) => (layout.use.hasTouch ? locator.tap() : locator.click());
const SHOTS = process.env.E2E_TEMPLATE_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);

async function openNew(page, layout, label) {
  await press(layout, visible(page.locator(`[data-home-new="${layout.phone ? 'phone' : 'desktop'}"]`)));
  const item = layout.phone
    ? page.locator('[data-home-new-sheet]').getByRole('menuitem', { name: label, exact: true })
    : visible(page.locator('.documents-row-menu').getByRole('menuitem', { name: label, exact: true }));
  await expect(item).toBeVisible();
  await press(layout, item);
}

for (const layout of LAYOUTS) {
  test.describe(`Home templates, ${layout.name}`, () => {
    test.use(layout.use);

    test('Notebook paper in one tap; Other templates opens the picked paper', async ({ page }) => {
      test.setTimeout(240_000);
      const admin = adminClient();
      const owner = await ownerId(admin);
      const started = new Date(Date.now() - 1000).toISOString();
      const name = `E2E tpl ${layout.name.replace(/[^a-z0-9]+/gi, '-')} ${crypto.randomUUID().slice(0, 6)}`;
      await page.addInitScript(() => localStorage.setItem('survey.flag.home-templates', '1'));
      const pages = page.locator('.survey-pdfjs-page-div[data-page-number]').filter({ visible: true });
      try {
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        await expect(visible(page.locator(`[data-home-new="${layout.phone ? 'phone' : 'desktop'}"]`))).toBeVisible({ timeout: 45_000 });

        // 1. New lists both; with only this flag on there is no Blank document.
        await press(layout, visible(page.locator(`[data-home-new="${layout.phone ? 'phone' : 'desktop'}"]`)));
        const menu = layout.phone ? page.locator('[data-home-new-sheet]') : visible(page.locator('.documents-row-menu'));
        await expect(menu.getByRole('menuitem', { name: 'Notebook paper', exact: true })).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Other templates', exact: true })).toBeVisible();
        await expect(menu.getByRole('menuitem', { name: 'Blank document', exact: true })).toHaveCount(0);
        if (layout.phone) await expect(menu.getByRole('menuitem', { name: 'Upload PDF', exact: true })).toBeVisible();
        await shot(page, layout, '1-new-menu');
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();

        // 2. Notebook paper: made, saved and opened at once, 10 pages.
        await openNew(page, layout, 'Notebook paper');
        await expect(pages).toHaveCount(10, { timeout: 60_000 });
        await expect.poll(async () => {
          const { data } = await admin.from('documents').select('name').eq('user_id', owner).ilike('name', 'Notebook paper%').gte('created_at', started);
          return data?.length || 0;
        }, { timeout: 30_000 }).toBe(1);
        await shot(page, layout, '2-notebook');

        // 3. Back home, Other templates: three groups, pick Cornell notes.
        // Desktop and tablet keep the document as a tab: go back by the Home tab.
        if (layout.phone) await page.goto(layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/', { waitUntil: 'domcontentloaded' });
        else await press(layout, visible(page.getByRole('button', { name: 'Home', exact: true })));
        await expect(visible(page.locator(`[data-home-new="${layout.phone ? 'phone' : 'desktop'}"]`))).toBeVisible({ timeout: 45_000 });
        await openNew(page, layout, 'Other templates');
        const dialog = page.locator('[data-paper-templates-dialog]');
        await expect(dialog).toBeVisible();
        for (const group of ['Notetaking', 'Grids and graphs', 'Music']) {
          await expect(dialog.getByRole('radiogroup', { name: group })).toBeVisible();
        }
        await expect(dialog.locator('[data-paper-template]')).toHaveCount(16);
        const r = await dialog.boundingBox();
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.x + r.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
        const cornell = dialog.locator('[data-paper-template="cornell"]');
        await cornell.scrollIntoViewIfNeeded();
        await press(layout, cornell);
        await expect(cornell).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.getByLabel('Name')).toHaveValue(/^Cornell notes/);
        await dialog.getByLabel('Name').fill(name);
        await dialog.getByLabel('Pages').fill('3');
        await shot(page, layout, '3-templates');
        await press(layout, dialog.getByRole('button', { name: 'Create' }));
        await expect(dialog).toHaveCount(0, { timeout: 60_000 });
        await expect(pages).toHaveCount(3, { timeout: 60_000 });
        await expect.poll(async () => {
          const { data } = await admin.from('documents').select('name').eq('user_id', owner).ilike('name', `${name}%`);
          return data?.length || 0;
        }, { timeout: 30_000 }).toBe(1);
        await shot(page, layout, '4-opened');
      } finally {
        const { data: made } = await admin.from('documents').select('id, file_path').eq('user_id', owner)
          .or(`name.ilike.Notebook paper%,name.ilike.${name}%`).gte('created_at', started);
        await removeRows(admin, made || []);
      }
    });
  });
}

test.describe('Home templates, flag off', () => {
  test.use(LAYOUTS[0].use);
  test('New keeps its old behaviour', async ({ page }) => {
    test.setTimeout(90_000);
    await page.addInitScript(() => localStorage.setItem('survey.flag.new-document', '1'));
    await signInAt(page, E2E_ACCOUNTS.owner, '/');
    const button = visible(page.locator('[data-home-new="desktop"]'));
    await expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    await button.click();
    await expect(page.locator('[data-new-document-dialog]')).toBeVisible();
    await expect(page.locator('.documents-row-menu')).toHaveCount(0);
  });
});
