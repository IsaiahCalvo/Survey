// The viewer tab's orange "unsaved" dot clears once cloud sync reports
// "Up to date", stays clear after a reload, and shows again while a new edit
// has not reached the cloud.
import { dragPage, tool } from '../../debug/scenarios/test-plan/tp-actions.mjs';
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { adminClient, expect, openSampleDocument, signIn, test } from './helpers.mjs';

const UNSAVED_DOT = 'Unsaved changes (Cmd/Ctrl+S to save)';

function unsavedDot(page) {
  return page.getByRole('img', { name: UNSAVED_DOT });
}

function upToDate(page) {
  return page.getByText('Up to date', { exact: true }).filter({ visible: true }).first();
}

async function updateIds(admin) {
  const { data, error } = await admin.from('annotation_updates').select('id').eq('document_id', E2E_DOCUMENT.id);
  if (error) throw new Error(`[E2E_SIGNED_IN] annotation_updates: ${error.message}`);
  return new Set((data || []).map((row) => row.id));
}

test('the tab unsaved dot clears when cloud sync is up to date', async ({ page }) => {
  const admin = adminClient();
  const before = await updateIds(admin);
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await openSampleDocument(page);

    // Draw, save, and wait for sync: the dot goes away.
    await tool(page, 'Shapes', 'Rectangle');
    await dragPage(page, 1, [[60, 80], [140, 120], [220, 160]]);
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+s');
    await expect(upToDate(page)).toBeVisible({ timeout: 30_000 });
    await expect(unsavedDot(page)).toHaveCount(0, { timeout: 15_000 });

    // Still gone after a reload (the tab reopens on desktop).
    await page.reload();
    const close = page.getByRole('button', { name: `Close ${E2E_DOCUMENT.name}` });
    if (!(await close.isVisible({ timeout: 30_000 }).catch(() => false))) await openSampleDocument(page);
    await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
    await expect(upToDate(page)).toBeVisible({ timeout: 30_000 });
    await expect(unsavedDot(page)).toHaveCount(0);

    // Hold sync back: a new edit shows the dot while it is not in the cloud,
    // then clears once sync catches up.
    const block = (route) => route.abort('failed');
    await page.route('**/rest/v1/annotation_updates**', block);
    await tool(page, 'Shapes', 'Rectangle');
    await dragPage(page, 1, [[260, 80], [300, 120], [340, 160]]);
    await page.keyboard.press('Escape');
    await expect(unsavedDot(page)).toBeVisible({ timeout: 15_000 });
    await page.unroute('**/rest/v1/annotation_updates**', block);
    await page.keyboard.press('ControlOrMeta+s');
    await expect(upToDate(page)).toBeVisible({ timeout: 60_000 });
    await expect(unsavedDot(page)).toHaveCount(0, { timeout: 15_000 });
  } finally {
    // Leave the shared seed document as it was.
    const added = [...(await updateIds(admin))].filter((id) => !before.has(id));
    if (added.length) await admin.from('annotation_updates').delete().in('id', added);
  }
});
