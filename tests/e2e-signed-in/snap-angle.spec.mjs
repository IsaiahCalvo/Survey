// Owner 2026-10-29: "what I want is the 15° snaps as well as settings ...
// allow users to switch between 15, 45, and 90". Shift snaps a line to 15°
// steps by default (it was 45°), and Settings > Annotations picks 15°, 45° or
// 90° for every Shift-snap. Also: the open document can be renamed on a phone,
// which has no tab strip to right-click.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, profileChip, signIn, test } from './helpers.mjs';

// Each test gets its own copy of the sample PDF, so lines left by a failed
// run never sit where the next run presses.
async function seedDocument(label) {
  const admin = adminClient();
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const bytes = fs.readFileSync(path.resolve('debug/fixtures/clickable-link-test.pdf'));
  const id = randomUUID();
  const filePath = `${ownerId}/${id}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const name = `E2E ${label} ${Date.now()}.pdf`;
  const doc = await admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  return {
    name,
    async remove() {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([filePath]);
    },
  };
}

async function openDocument(page, name) {
  await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByText('Type your name in the box:').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1500);
}

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';

/** Every <line> drawn on page 1, as "x1,y1,x2,y2" (page units). */
const pageLines = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id] line')]
  .map((l) => ['x1', 'y1', 'x2', 'y2'].map((k) => Number(l.getAttribute(k)).toFixed(2)).join(',')))]);

/** Unsigned angle in whole degrees (0..90) of an "x1,y1,x2,y2" line. */
const angleOf = (line) => {
  const [x1, y1, x2, y2] = line.split(',').map(Number);
  return Math.round((Math.atan2(Math.abs(y2 - y1), Math.abs(x2 - x1)) * 180) / Math.PI);
};

async function drawShiftLine(page, degrees, row = 0) {
  const box = await page.locator(PAGE).boundingBox();
  // Start in the empty lower-left of the sample page (a press on another mark
  // would pick it up instead of drawing) and draw up and to the right; each
  // line starts on its own row so no press lands on an earlier line's end.
  const from = { x: box.x + box.width * 0.08, y: box.y + box.height * (0.84 + row * 0.06) };
  const length = box.width * 0.4;
  const to = {
    x: from.x + Math.cos((degrees * Math.PI) / 180) * length,
    y: from.y + Math.sin((degrees * Math.PI) / 180) * length,
  };
  const before = new Set(await pageLines(page));
  await page.keyboard.press('l');
  await page.keyboard.down('Shift');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await pageLines(page)).filter((l) => !before.has(l)).length).toBe(1);
  const line = (await pageLines(page)).find((l) => !before.has(l));
  return { line, mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } };
}

async function openAnnotationSettings(page) {
  const tab = page.getByRole('tab', { name: 'Annotations' });
  // The hub can re-render while its library loads and shut the account menu
  // under the pointer, so open it until Settings is really up.
  await expect(async () => {
    if (!(await tab.isVisible())) {
      const item = page.getByRole('menuitem', { name: 'Settings' }).filter({ visible: true });
      if (!(await item.count())) await profileChip(page, E2E_ACCOUNTS.owner).click();
      await item.first().click({ timeout: 2_000 });
    }
    await expect(tab).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 45_000 });
  await tab.click();
}

async function pickSnapAngle(page, degrees) {
  await page.locator('.tab-bar').getByText('Home', { exact: true }).first().click();
  await openAnnotationSettings(page);
  const group = page.getByRole('radiogroup', { name: 'Shift snap angle' });
  await expect(group).toBeVisible();
  await group.getByRole('radio', { name: `${degrees} degrees` }).click();
  await expect(group.getByRole('radio', { name: `${degrees} degrees` })).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Escape');
}

test('Shift snaps lines to 15° by default, and Settings switches it to 45° or 90°', async ({ page }) => {
  test.setTimeout(150_000);
  const doc = await seedDocument('Snap');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    // Default before any choice: 15°.
    await openAnnotationSettings(page);
    await expect(page.getByRole('radiogroup', { name: 'Shift snap angle' }).getByRole('radio', { name: '15 degrees' })).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');

    await openDocument(page, doc.name);
    const docTab = page.locator('.tab-bar').getByText(doc.name, { exact: true }).first();
    // 35° lands on 30° with 15° steps (drawn upward; angles are measured unsigned).
    expect(angleOf((await drawShiftLine(page, -35)).line)).toBe(30);

    await pickSnapAngle(page, 45);
    expect(await page.evaluate(() => localStorage.getItem('survey:snap-angle'))).toBe('45');
    await docTab.click();
    await page.waitForTimeout(800);
    expect(angleOf((await drawShiftLine(page, -35, 1)).line)).toBe(45);

    await pickSnapAngle(page, 90);
    await docTab.click();
    await page.waitForTimeout(800);
    expect(angleOf((await drawShiftLine(page, -35, 2)).line)).toBe(0);
  } finally {
    await doc.remove();
  }
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  test('the open document can be renamed from the viewer\'s More menu', async ({ page }) => {
    test.setTimeout(120_000);
    const doc = await seedDocument('Phone Rename');
    try {
      const renamed = doc.name.replace('Phone Rename', 'Phone Renamed');
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(doc.name, { exact: true }).filter({ visible: true }).first().tap();
      const openFile = page.getByRole('button', { name: 'Open file' });
      if (await openFile.isVisible().catch(() => false)) await openFile.tap();
      const header = page.locator('[data-mobile-pdf-header="true"]').filter({ visible: true });
      await expect(header).toHaveAttribute('aria-label', doc.name, { timeout: 60_000 });
      await page.waitForTimeout(1200);

      await page.getByRole('button', { name: 'More document options' }).filter({ visible: true }).first().tap();
      await page.locator('[data-mobile-rename-document="true"]').filter({ visible: true }).tap();
      const dialog = page.getByRole('dialog').filter({ hasText: 'Rename document' });
      await expect(dialog).toBeVisible();
      const field = dialog.getByRole('textbox', { name: 'Name' });
      await expect(field).toHaveValue(doc.name);
      await field.fill(renamed);
      await dialog.getByRole('button', { name: 'Save' }).tap();
      await expect(dialog).toBeHidden();
      await expect(header).toHaveAttribute('aria-label', renamed);
      // And the server has it.
      const { data } = await adminClient().from('documents').select('name').eq('name', renamed);
      expect(data?.length).toBe(1);
    } finally {
      await doc.remove();
    }
  });
});
