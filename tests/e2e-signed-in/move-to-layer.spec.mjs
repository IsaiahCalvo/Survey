// Move to layer (inside the 'layers' beta, Survey Nightly; Drawboard's
// "Change layer"): the mark menu's "Move to layer ▸" lists the document's
// layers; picking one moves the mark there (one Undo step), so hiding that
// layer hides the mark. A layer the mark is already on is greyed out.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const FIXTURE = 'debug/fixtures/clickable-link-test.pdf';
const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);

async function seedDocument(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const docId = randomUUID();
  const docName = `E2E Layer Move ${Date.now()}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const doc = await admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName, file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  return { docId, docName, filePath };
}

test('move to layer: a rectangle moves to Layer 1 and hides with it; Undo brings it back', async ({ page }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const seeded = await seedDocument(admin);
  try {
    await page.addInitScript(() => localStorage.setItem('survey.flag.layers', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(seeded.docName, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1000);

    // Add Layer 1, then draw on the Default layer.
    const layersButton = page.getByRole('button', { name: 'Layers', exact: true }).first();
    if ((await layersButton.getAttribute('aria-expanded')) !== 'true') await layersButton.click();
    const panel = page.getByTestId('layers-panel');
    await expect(panel).toBeVisible();
    // The + sits in the rail head since #1357 (inline in the panel on a phone).
    await page.locator('[data-layer-add]').filter({ visible: true }).first().click();
    await page.keyboard.press('Enter');
    await panel.locator('[data-layer-id="default"]').click();
    await expect(panel.locator('[data-layer-id="default"]')).toHaveAttribute('aria-checked', 'true');

    const box = await page.locator(PAGE).boundingBox();
    const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
    const before = new Set(await markIds(page));
    await page.mouse.click(5, 450);
    await page.keyboard.press('r');
    await page.mouse.move(at(0.5, 0.7).x, at(0.5, 0.7).y);
    await page.mouse.down();
    await page.mouse.move(at(0.62, 0.78).x, at(0.62, 0.78).y, { steps: 5 });
    await page.mouse.up();
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
    const [rectId] = (await markIds(page)).filter((id) => !before.has(id));
    const rect = page.locator(`[data-overlay-page="1"] [data-annotation-id="${rectId}"]`).first();

    // Right-click it: Move to layer ▸ lists both layers, Default greyed out.
    await page.keyboard.press('v');
    const r = await rect.boundingBox();
    await page.mouse.click(r.x + 2, r.y + r.height / 2, { button: 'right' });
    const row = page.locator('[data-annotation-context-menu] [data-menu-key="moveToLayer"]');
    await expect(row).toBeVisible();
    await row.hover();
    const sub = page.getByRole('menu', { name: 'Move to layer' });
    await expect(sub.locator('[data-submenu-key="moveToLayer:default"]')).toHaveAttribute('aria-disabled', 'true');
    const layer1 = sub.getByRole('menuitem', { name: 'Layer 1' });
    await expect(layer1).toBeVisible();
    await page.waitForTimeout(300);
    await page.screenshot({ path: test.info().outputPath('move-to-layer-menu.png') });
    await layer1.click();
    await expect(page.getByText('Moved 1 mark to Layer 1')).toBeVisible();

    // Hide Layer 1: the rectangle goes with it; show it again: it is back.
    await panel.getByRole('button', { name: 'Hide Layer 1' }).click();
    await expect.poll(async () => (await markIds(page)).includes(rectId)).toBe(false);
    await panel.getByRole('button', { name: 'Show Layer 1' }).click();
    await expect.poll(async () => (await markIds(page)).includes(rectId)).toBe(true);

    // One Undo puts it back on Default: hiding Layer 1 leaves it.
    await page.mouse.click(5, 450);
    await page.keyboard.press('Control+z');
    await panel.getByRole('button', { name: 'Hide Layer 1' }).click();
    await page.waitForTimeout(500);
    expect(await markIds(page)).toContain(rectId);
  } finally {
    await admin.from('documents').delete().eq('id', seeded.docId);
    await admin.storage.from('documents').remove([seeded.filePath]);
  }
});
