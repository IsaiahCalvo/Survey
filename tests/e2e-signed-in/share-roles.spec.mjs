// Share and roles, signed in, on a desktop and a tablet viewport.
//
// Project menu: Share, Delete and Add member are enabled for the owner and
// greyed (aria-disabled, with the "Only the project owner can do this" reason)
// for an editor or viewer of the shared project — canManageProject in
// src/home/projectFilePermissions.js (PRs #1071, #1093). The server side of the
// same rule is project-owner-actions.spec.mjs.
//
// Document: on the seeded shared drawing an editor's markup reaches the cloud;
// a viewer's never does (the UI is read-only and RLS refuses the write).
//
// Seeding (scripts/e2e-local-supabase.mjs): owner owns E2E_PROJECT and
// E2E_DOCUMENT; editor/viewer are active collaborators on both.
import { dragPage, tool } from '../../debug/scenarios/test-plan/tp-actions.mjs';
import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, openSampleDocument, signIn, test } from './helpers.mjs';

const OWNER_ONLY = ['Share', 'Delete', 'Add member'];

const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 800 } },
  tablet: { viewport: { width: 1024, height: 768 }, hasTouch: true },
};

async function openProjects(page) {
  await page.getByRole('button', { name: 'Projects', exact: true })
    .or(page.getByRole('tab', { name: 'Projects' }))
    .filter({ visible: true }).first().click();
}

/** Open the per-project menu of the seeded project (its More button, else a right-click on the row). */
async function openProjectMenu(page) {
  const row = page.locator(`[data-project-id="${E2E_PROJECT.id}"]`).filter({ visible: true }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await expect(row.getByText(E2E_PROJECT.name).first()).toBeVisible();
  const more = row.getByRole('button', { name: 'More', exact: true });
  if (await more.count()) {
    await more.first().click();
  } else {
    await row.click({ button: 'right' });
  }
  const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: 'Add member' }) });
  await expect(menu).toBeVisible();
  return menu;
}

// Touch on the canvas only pans, so the markup checks draw with a mouse even
// at the tablet size. A first tap can leave the Documents list showing; a
// second (double) click opens the document.
async function openDocument(page) {
  await openSampleDocument(page).catch(async () => {
    await page.getByText(E2E_DOCUMENT.name, { exact: true }).first().dblclick();
    await expect(page.getByText('Type your name in the box:')).toBeVisible({ timeout: 60_000 });
  });
}

async function updateSeqs(admin) {
  const { data, error } = await admin.from('annotation_updates').select('seq').eq('document_id', E2E_DOCUMENT.id);
  if (error) throw new Error(`[E2E_SIGNED_IN] annotation_updates: ${error.message}`);
  return new Set((data || []).map((row) => row.seq));
}

async function removeNewUpdates(admin, before) {
  const added = [...(await updateSeqs(admin))].filter((seq) => !before.has(seq));
  if (added.length) await admin.from('annotation_updates').delete().in('seq', added);
}

for (const [device, use] of Object.entries(VIEWPORTS)) {
  test.describe(`share and roles on ${device}`, () => {
    test.use(use);

    for (const key of ['owner', 'editor', 'viewer']) {
      const owner = key === 'owner';
      test(`${key}: project Share/Delete/Add member are ${owner ? 'enabled' : 'disabled'}`, async ({ page }) => {
        await signIn(page, E2E_ACCOUNTS[key]);
        await openProjects(page);
        const menu = await openProjectMenu(page);
        for (const label of OWNER_ONLY) {
          const item = menu.getByRole('menuitem', { name: label, exact: true });
          await expect(item).toBeVisible();
          if (owner) {
            await expect(item).toBeEnabled();
            await expect(item).not.toHaveAttribute('aria-disabled', 'true');
          } else {
            await expect(item).toHaveAttribute('aria-disabled', 'true');
          }
        }
        // Read-only items stay available to everyone.
        await expect(menu.getByRole('menuitem', { name: 'Get link to project' })).toBeVisible();
        await page.keyboard.press('Escape');
      });
    }

    test.describe('markup', () => {
    test.use({ hasTouch: false });
    test.setTimeout(180_000);
    test('editor can add a markup to the shared document', async ({ page }) => {
      const admin = adminClient();
      const before = await updateSeqs(admin);
      try {
        await signIn(page, E2E_ACCOUNTS.editor);
        await openDocument(page);
        await expect(page.getByText('View-only access', { exact: true })).toHaveCount(0);
        await tool(page, 'Shapes', 'Rectangle');
        await dragPage(page, 1, [[60, 80], [140, 120], [220, 160]]);
        await page.keyboard.press('Escape');
        await page.keyboard.press('ControlOrMeta+s');
        await expect.poll(async () => [...(await updateSeqs(admin))].some((seq) => !before.has(seq)), { timeout: 30_000 }).toBe(true);
      } finally {
        await removeNewUpdates(admin, before);
      }
    });

    test('viewer cannot add a markup to the shared document', async ({ page }) => {
      const admin = adminClient();
      const before = await updateSeqs(admin);
      try {
        await signIn(page, E2E_ACCOUNTS.viewer);
        await openDocument(page);
        await expect(page.getByText('View-only access', { exact: true }).first()).toBeVisible();
        // Whatever the toolbar offers a viewer, a drag on the page must not
        // reach the cloud.
        await page.getByRole('button', { name: 'Shapes', exact: true }).first().click({ timeout: 5_000 }).catch(() => {});
        await page.getByRole('button', { name: 'Rectangle', exact: true }).first().click({ timeout: 5_000 }).catch(() => {});
        await dragPage(page, 1, [[60, 80], [140, 120], [220, 160]]).catch(() => {});
        await page.keyboard.press('Escape');
        await page.keyboard.press('ControlOrMeta+s');
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        expect([...(await updateSeqs(admin))].filter((seq) => !before.has(seq))).toEqual([]);
      } finally {
        await removeNewUpdates(admin, before);
      }
    });
    });
  });
}
