// Owner 2026-11-12: "When I open the spaces panel and click on a title, my
// cursor goes there, but I can't type or edit it. I have to put it in edit
// mode ... when I right-click on anything (a space, a region), I should be
// able to delete it or move and copy it ... That goes for all list things."
//
// One walk per layout (desktop, tablet, phone): a click on a space name or a
// region name types in it with Edit mode off; a right-click on a space or a
// region opens the shared row menu (Rename, Add pages, Move or copy, Remove,
// Delete) and each row does its job; Bookmarks rows get the same menu.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const LAYOUTS = {
  desktop: { viewport: { width: 1440, height: 900 } },
  tablet: { viewport: { width: 1024, height: 768 }, hasTouch: true },
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
};

const visible = (locator) => locator.filter({ visible: true }).first();
const button = (page, name) => visible(page.getByRole('button', { name, exact: true }));
const menu = (page) => page.getByRole('menu', { name: 'List item actions' });

for (const [layout, use] of Object.entries(LAYOUTS)) {
  test.describe(layout, () => {
    test.use(use);

    test(`${layout}: click a Spaces name to type; right-click spaces, regions and bookmarks`, async ({ page }) => {
      test.setTimeout(240_000);
      const phone = layout === 'phone';
      const sheet = await seedSheet(`Right click ${layout}`, { pages: 5 });
      try {
        await signIn(page, E2E_ACCOUNTS.owner);
        await visible(page.getByText(sheet.name, { exact: true })).click();
        const open = page.getByRole('button', { name: 'Open file' });
        await open.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
        if (await open.isVisible().catch(() => false)) await open.click();
        await expect(visible(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas'))).toBeVisible({ timeout: 60_000 });

        // Spaces: a new space is named in place, Edit mode stays off.
        await button(page, phone ? 'Open spaces' : 'Spaces').click();
        await button(page, 'Create space').click();
        await expect(page.locator('.space-card__name:focus')).toHaveCount(1);
        await expect(page.locator('.spaces-panel.is-edit-mode')).toHaveCount(0);
        await page.keyboard.type('North wing');
        await page.keyboard.press('Enter');
        const addPages = visible(page.getByRole('textbox', { name: 'Add pages (e.g. 3, 6-9, 12)' }));
        await expect(addPages).toBeFocused();
        await addPages.fill('2-3');
        await addPages.press('Enter');
        await expect(button(page, 'Draw a region on page 2')).toBeVisible();

        // 1. A click on the space's name types in it (Edit mode off).
        const name = visible(page.locator('.space-card__name'));
        await name.click();
        await expect(name).toBeFocused();
        await expect(name).not.toHaveAttribute('readonly', '');
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('East wing');
        await page.keyboard.press('Enter');
        await expect(name).toHaveValue('East wing');
        await expect(page.locator('.spaces-panel.is-edit-mode')).toHaveCount(0);

        // 2. A click on a region's name types in it too.
        await button(page, 'Rename Region 2').click();
        const regionField = visible(page.getByRole('textbox', { name: 'Region name' }));
        await expect(regionField).toBeFocused();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('Lobby');
        await page.keyboard.press('Enter');
        await expect(button(page, 'Rename Lobby')).toBeVisible();

        // 3. Right-click the space: its actions, Add pages adds pages.
        await visible(page.locator('.space-card__head')).click({ button: 'right', position: { x: 4, y: 8 } });
        await expect(menu(page)).toBeVisible();
        const spaceRows = await menu(page).getByRole('menuitem').allTextContents();
        expect(spaceRows).toEqual(['Rename', 'Add pages', 'Turn on space', 'Delete']);
        await page.screenshot({ path: test.info().outputPath(`${layout}-space-menu.png`) });
        await menu(page).getByRole('menuitem', { name: 'Add pages' }).click();
        await expect(menu(page)).toHaveCount(0);
        await expect(addPages).toBeFocused();
        await page.keyboard.type('5');
        await page.keyboard.press('Enter');
        await expect(button(page, 'Draw a region on page 5')).toBeVisible();

        // Rename from the menu picks the name.
        await visible(page.locator('.space-card__head')).click({ button: 'right', position: { x: 4, y: 8 } });
        await menu(page).getByRole('menuitem', { name: 'Rename' }).click();
        await expect(name).toBeFocused();
        await page.keyboard.type('West wing');
        await page.keyboard.press('Enter');
        await expect(name).toHaveValue('West wing');

        // 4. Right-click a region: its actions; Move or copy opens its card.
        const regionRow = (label) => visible(page.locator('.space-region-card').filter({ has: page.getByRole('button', { name: `Rename ${label}`, exact: true }) }));
        await regionRow('Lobby').click({ button: 'right', position: { x: 40, y: 8 } });
        const regionRows = await menu(page).getByRole('menuitem').allTextContents();
        expect(regionRows).toEqual(['Rename', 'Go to page 2', 'Draw areas', 'Move or copy', 'Remove']);
        await page.screenshot({ path: test.info().outputPath(`${layout}-region-menu.png`) });
        await menu(page).getByRole('menuitem', { name: 'Move or copy' }).click();
        await expect(visible(page.getByRole('dialog', { name: /^Move or copy/ }))).toBeVisible();
        // The phone card is its own small sheet: its backdrop closes it
        // (Esc there also closes the Spaces sheet under it).
        if (phone) await page.getByRole('button', { name: 'Close move or copy' }).click({ position: { x: 20, y: 20 } });
        else await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog', { name: /^Move or copy/ }).filter({ visible: true })).toHaveCount(0);

        // Rename from the region menu.
        await regionRow('Lobby').click({ button: 'right', position: { x: 40, y: 8 } });
        await menu(page).getByRole('menuitem', { name: 'Rename' }).click();
        await expect(regionField).toBeFocused();
        await page.keyboard.type('Hall');
        await page.keyboard.press('Enter');
        await expect(button(page, 'Rename Hall')).toBeVisible();

        // Remove from the region menu (act first, Undo toast).
        await regionRow('Region 3').click({ button: 'right', position: { x: 40, y: 8 } });
        await menu(page).getByRole('menuitem', { name: 'Remove' }).click();
        await expect(button(page, 'Rename Region 3')).toHaveCount(0);

        // Owner 2026-11-12: a right-click on the space's title (not being
        // typed in) is a right-click on the space - never the browser's menu,
        // and the name is not focused by it.
        await page.evaluate(() => {
          window.__lastContextMenu = null;
          // Captured first, read once the event is done (row menus stop it
          // from bubbling, so a late listener would never see it).
          window.addEventListener('contextmenu', (event) => {
            setTimeout(() => { window.__lastContextMenu = { prevented: event.defaultPrevented }; }, 0);
          }, true);
        });
        await name.click({ button: 'right' });
        await expect(menu(page)).toBeVisible();
        expect(await menu(page).getByRole('menuitem').allTextContents()).toEqual(['Rename', 'Add pages', 'Turn on space', 'Delete']);
        await expect(name).not.toBeFocused();
        expect(await page.evaluate(() => window.__lastContextMenu)).toEqual({ prevented: true });
        // (On the phone Escape would also close the Spaces sheet.)
        if (phone) {
          await menu(page).getByRole('menuitem', { name: 'Rename' }).click();
          await expect(name).toBeFocused();
          await name.press('Enter');
        } else {
          await page.keyboard.press('Escape');
        }
        await expect(menu(page)).toHaveCount(0);

        // A right-click inside a name being typed opens the app's own
        // Cut / Copy / Paste menu (no row menu, no browser menu), and the
        // field keeps its focus.
        const textMenu = page.getByRole('menu', { name: 'Text actions' });
        await name.click();
        await page.keyboard.press('ControlOrMeta+a');
        await name.click({ button: 'right' });
        await expect(menu(page)).toHaveCount(0);
        await expect(textMenu).toBeVisible();
        expect(await textMenu.getByRole('menuitem').allTextContents()).toEqual(['Cut', 'Copy', 'Paste', 'Select all']);
        await page.screenshot({ path: test.info().outputPath(`${layout}-text-menu.png`) });
        await expect(name).toBeFocused();
        expect(await page.evaluate(() => window.__lastContextMenu)).toEqual({ prevented: true });
        await textMenu.getByRole('menuitem', { name: 'Select all' }).click();
        await expect(textMenu).toHaveCount(0);
        await expect(name).toBeFocused();
        await page.keyboard.press('Enter');

        // 5. Delete the space from its menu.
        await visible(page.locator('.space-card__head')).click({ button: 'right', position: { x: 4, y: 8 } });
        await menu(page).getByRole('menuitem', { name: 'Delete' }).click();
        const confirm = page.getByRole('button', { name: /^Delete/ }).filter({ visible: true });
        // A space with regions may ask what to do with its marks first.
        if (await confirm.count()) await confirm.last().click().catch(() => {});
        await expect(page.locator('.space-card__name').filter({ visible: true })).toHaveCount(0, { timeout: 10_000 });

        // Empty space: no menu at all, and not the browser's either.
        await page.evaluate(() => { window.__lastContextMenu = null; });
        const panelBox = await visible(page.locator('.spaces-panel')).boundingBox();
        const viewportHeight = page.viewportSize().height;
        const emptyX = panelBox.x + panelBox.width / 2;
        const emptyY = Math.min(panelBox.y + panelBox.height, viewportHeight) - 40;
        expect(await page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest('.spaces-panel')), [emptyX, emptyY])).toBe(true);
        await page.mouse.click(emptyX, emptyY, { button: 'right' });
        await expect.poll(() => page.evaluate(() => window.__lastContextMenu)).toEqual({ prevented: true });
        await expect(page.getByRole('menu').filter({ visible: true })).toHaveCount(0);

        if (phone) return; // Phone bookmark rows: slide and the row's own controls.

        // 6. Bookmarks: right-click a bookmark for Rename / Go to page / Delete.
        await button(page, 'Bookmarks').click();
        await button(page, 'Add bookmark').click();
        await page.getByPlaceholder('Bookmark name').fill('Door schedule');
        await button(page, 'Current page').click();
        await button(page, 'Create').click();
        const bookmark = visible(page.locator('[data-bookmark-drag-row]').filter({ hasText: 'Door schedule' }));
        await expect(bookmark).toBeVisible();
        await bookmark.click({ button: 'right' });
        const bookmarkRows = await menu(page).getByRole('menuitem').allTextContents();
        expect(bookmarkRows[0]).toBe('Rename');
        expect(bookmarkRows.at(-1)).toBe('Delete');
        await page.screenshot({ path: test.info().outputPath(`${layout}-bookmark-menu.png`) });
        // Escape drops a typed name (it used to save it on the blur).
        await menu(page).getByRole('menuitem', { name: 'Rename' }).click();
        await expect(page.locator('[data-bookmark-drag-row] input').first()).toBeFocused();
        await page.keyboard.type('Not this');
        await page.keyboard.press('Escape');
        await expect(visible(page.locator('[data-bookmark-drag-row]').filter({ hasText: 'Door schedule' }))).toBeVisible();
        await expect(page.locator('[data-bookmark-drag-row]').filter({ hasText: 'Not this' })).toHaveCount(0);
        await bookmark.click({ button: 'right' });
        await menu(page).getByRole('menuitem', { name: 'Rename' }).click();
        // The name is in the field now (the row's text no longer matches).
        const bookmarkField = page.locator('[data-bookmark-drag-row] input').first();
        await expect(bookmarkField).toBeFocused();
        await page.keyboard.press('ControlOrMeta+a');
        await page.keyboard.type('Door list');
        await page.keyboard.press('Enter');
        await expect(visible(page.locator('[data-bookmark-drag-row]').filter({ hasText: 'Door list' }))).toBeVisible();
        await visible(page.locator('[data-bookmark-drag-row]').filter({ hasText: 'Door list' })).click({ button: 'right' });
        await menu(page).getByRole('menuitem', { name: 'Delete' }).click();
        await expect(page.locator('[data-bookmark-drag-row]').filter({ hasText: 'Door list' }).filter({ visible: true })).toHaveCount(0);
      } finally {
        await sheet.remove();
      }
    });
  });
}
