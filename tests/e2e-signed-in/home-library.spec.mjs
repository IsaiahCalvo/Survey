// Home extras copied from Drawboard PDF's Home (Nightly flags home-tags,
// home-shared-views, home-columns; src/home/homeLibrary.js). On every layout
// (desktop, tablet, phone web on iPhone and Android sizes, the phone app):
// Shared by me / Shared with me, tags added from the row menu and found again
// by the Tags list and by search, Last opened stamped when a document opens,
// and the list sizes.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, expect, test } from './helpers.mjs';

const FLAGS = ['home-tags', 'home-shared-views', 'home-columns'];

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
  pdf.addPage([612, 792]).drawText(label, { x: 72, y: 700, size: 20, font });
  return Buffer.from(await pdf.save());
}

async function userIdOf(admin, account) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === account.email).id;
}

async function addDoc(admin, ownerId, name) {
  const id = crypto.randomUUID();
  const bytes = await onePagePdf(name);
  await must('upload', admin.storage.from('documents').upload(`${ownerId}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: ownerId, project_id: null, name, file_path: `${ownerId}/${id}.pdf`, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return id;
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
// E2E_HOME_SHOTS=<folder> saves a picture at each step (for a look by eye).
const SHOTS = process.env.E2E_HOME_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);
const press = (layout, locator) => (layout.use.hasTouch ? locator.tap() : locator.click());

for (const layout of LAYOUTS) {
  test.describe(`Home extras, ${layout.name}`, () => {
    test.use(layout.use);

    test('shared views, tags, last opened and list sizes', async ({ page }) => {
      test.setTimeout(240_000);
      const admin = adminClient();
      const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
      const editorId = await userIdOf(admin, E2E_ACCOUNTS.editor);
      const tag = `site-${RUN}`.slice(0, 30);
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const names = {
        shared: `HL shared ${slug} ${RUN}.pdf`,
        mine: `HL mine ${slug} ${RUN}.pdf`,
        theirs: `HL theirs ${slug} ${RUN}.pdf`,
      };
      const sharedId = await addDoc(admin, ownerId, names.shared);
      const mineId = await addDoc(admin, ownerId, names.mine);
      const theirsId = await addDoc(admin, editorId, names.theirs);
      await must('share out', admin.from('document_collaborators').insert({ document_id: sharedId, user_id: editorId, role: 'viewer', status: 'active' }));
      await must('share in', admin.from('document_collaborators').insert({ document_id: theirsId, user_id: ownerId, role: 'editor', status: 'active' }));

      await page.addInitScript((flags) => { for (const f of flags) localStorage.setItem(`survey.flag.${f}`, '1'); }, FLAGS);
      try {
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        await expect(visible(page.getByText(names.mine, { exact: true }))).toBeVisible({ timeout: 45_000 });

        // 1. Shared by me / Shared with me.
        const viewButton = (label) => (layout.phone
          ? visible(page.locator('[data-home-chips] button', { hasText: label }))
          : visible(page.locator('[data-home-nav] button', { hasText: label })));
        await press(layout, viewButton('Shared by me'));
        await expect(visible(page.getByText(names.shared, { exact: true }))).toBeVisible();
        await expect(page.getByText(names.mine, { exact: true }).filter({ visible: true })).toHaveCount(0);
        await expect(page.getByText(names.theirs, { exact: true }).filter({ visible: true })).toHaveCount(0);
        await press(layout, viewButton('Shared with me'));
        await expect(visible(page.getByText(names.theirs, { exact: true }))).toBeVisible();
        await expect(page.getByText(names.shared, { exact: true }).filter({ visible: true })).toHaveCount(0);
        await press(layout, viewButton(layout.phone ? 'All' : 'All files'));
        await expect(visible(page.getByText(names.mine, { exact: true }))).toBeVisible();

        // 2. A tag from the row's More menu.
        const row = layout.phone
          ? visible(page.locator('.mobile-doc-card', { hasText: names.mine }))
          : visible(page.locator('.documents-ledger-row', { hasText: names.mine }));
        await press(layout, row.getByRole('button', { name: 'More' }));
        await press(layout, visible(page.getByRole('menuitem', { name: 'Add tag…' })));
        const popover = page.locator('[data-home-tag-popover]');
        await expect(popover).toBeVisible();
        await expect(popover).toContainText(names.mine);
        await popover.getByLabel('New tags').fill(`${tag}, Level 2`);
        await popover.getByLabel('New tags').press('Enter');
        await expect(popover.getByRole('button', { name: tag, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(popover.getByRole('button', { name: 'Level 2', exact: true })).toHaveAttribute('aria-pressed', 'true');
        await shot(page, layout, '1-tag-popover');
        // Pressing a chip takes the tag off again; pressing it again puts it back.
        await press(layout, popover.getByRole('button', { name: 'Level 2', exact: true }));
        await expect(popover.getByRole('button', { name: 'Level 2', exact: true })).toHaveAttribute('aria-pressed', 'false');
        await page.keyboard.press('Escape');
        await expect(popover).toBeHidden();
        await expect.poll(async () => (await admin.from('document_tags').select('tag').eq('user_id', ownerId).eq('document_id', mineId)).data?.map((r) => r.tag).sort())
          .toEqual([tag]);
        await expect(row.locator('.home-tag-chip', { hasText: tag })).toBeVisible();

        // The Tags list (side bar, or a phone chip) filters to it; search finds it too.
        const tagButton = layout.phone
          ? visible(page.locator('[data-home-chips] button', { hasText: tag }))
          : visible(page.locator('[data-home-nav] button', { hasText: tag }));
        await press(layout, tagButton);
        await expect(visible(page.getByText(names.mine, { exact: true }))).toBeVisible();
        await shot(page, layout, '2-tag-filter');
        await expect(page.getByText(names.shared, { exact: true }).filter({ visible: true })).toHaveCount(0);
        await press(layout, tagButton);
        const search = visible(page.getByPlaceholder('Search documents and tags...'));
        await search.fill(tag);
        await expect(visible(page.getByText(names.mine, { exact: true }))).toBeVisible();
        await expect(page.getByText(names.shared, { exact: true }).filter({ visible: true })).toHaveCount(0);
        await search.fill('');
        // Leave the field first: while you type, the first press elsewhere
        // only ends the typing (the dismiss rules).
        await search.evaluate((el) => el.blur());

        // 3. Opening a document stamps Last opened ("Just now").
        if (layout.phone) {
          await press(layout, visible(page.locator('.mobile-doc-card', { hasText: names.shared }).locator('.mobile-card-title')));
          await expect(visible(page.getByRole('button', { name: 'Back to documents' }))).toBeVisible({ timeout: 60_000 });
        } else {
          const sharedRow = visible(page.locator('.documents-ledger-row', { hasText: names.shared }));
          if (layout.use.hasTouch) await sharedRow.tap(); else await sharedRow.dblclick();
          await expect(visible(page.getByRole('button', { name: `Close ${names.shared}` }))).toBeVisible({ timeout: 60_000 });
        }
        await expect.poll(async () => (await admin.from('document_opens').select('opened_at').eq('user_id', ownerId).eq('document_id', sharedId)).data?.length || 0, { timeout: 30_000 })
          .toBe(1);
        if (layout.phone) await press(layout, visible(page.getByRole('button', { name: 'Back to documents' })));
        else await press(layout, visible(page.getByRole('button', { name: `Close ${names.shared}` })));
        await expect(visible(page.getByText(names.mine, { exact: true }))).toBeVisible({ timeout: 30_000 });

        if (layout.phone) {
          // Sort by Last opened: the opened one comes first and says so.
          await press(layout, visible(page.locator('.documents-mobile-filter').first()));
          await press(layout, visible(page.getByRole('menuitem', { name: /Last opened/ })));
          await expect(visible(page.locator('.mobile-doc-card', { hasText: names.shared }).locator('.mobile-card-meta'))).toContainText('Opened just now');
          await shot(page, layout, '3-last-opened');
        } else {
          const cell = visible(page.locator('.documents-ledger-row', { hasText: names.shared }).locator('[data-home-opened]'));
          await expect(cell).toHaveText('Just now');
          await shot(page, layout, '3-last-opened');
          await expect(visible(page.locator('[data-home-col="opened"]'))).toBeVisible();
        }

        // 4. List sizes: Tiles, then back to Medium. The phone keeps them in
        // its sort menu; desktop has the view button at the header's end.
        const viewMenu = () => press(layout, layout.phone
          ? visible(page.locator('.documents-mobile-filter').first())
          : visible(page.locator('[data-home-view-button]')));
        await viewMenu();
        await press(layout, visible(page.getByRole('menuitemradio', { name: 'Tiles' })));
        await expect(visible(page.locator('[data-home-tiles] .home-tile', { hasText: names.mine }))).toBeVisible();
        await shot(page, layout, '4-tiles');
        if (!layout.phone) {
          await viewMenu();
          await press(layout, visible(page.getByRole('menuitemradio', { name: 'Compact list' })));
          await expect(visible(page.locator('.documents-ledger-row.is-density-compact', { hasText: names.mine }))).toBeVisible();
          await shot(page, layout, '5-compact');
        }
        await viewMenu();
        await press(layout, visible(page.getByRole('menuitemradio', { name: 'Medium list' })));
        await expect(page.locator('[data-home-tiles]').filter({ visible: true })).toHaveCount(0);

        // Nothing spills off the side of the screen.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      } finally {
        if (!process.env.KEEP) {
          await admin.from('document_tags').delete().eq('user_id', ownerId).in('document_id', [sharedId, mineId, theirsId]);
          await admin.from('document_collaborators').delete().in('document_id', [sharedId, theirsId]);
          await admin.from('documents').delete().in('id', [sharedId, mineId, theirsId]);
        }
      }
    });
  });
}
