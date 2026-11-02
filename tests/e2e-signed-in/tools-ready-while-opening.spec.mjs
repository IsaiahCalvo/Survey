// Owner 2026-11-02: "The annotation tools need to be available as soon as the
// PDF loads ... I should be able to annotate, select, pan, and scroll
// instantaneously." While the document's saved marks were still loading from
// the cloud, the toolbar was dimmed (read-only) and an invisible cover held
// input off page one. This walk slows the cloud reads down on purpose, draws
// a line the moment the page shows, and checks the toolbar is live, the line
// stays when the saved marks land (next to the line saved before) and it is
// still there after a reload.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const CLOUD_READ_DELAY_MS = 6_000;

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
    id,
    name,
    async remove() {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([filePath]);
    },
  };
}

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';

const pageLines = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id] line')]
  .map((l) => ['x1', 'y1', 'x2', 'y2'].map((k) => Number(l.getAttribute(k)).toFixed(1)).join(',')))]);

async function openDocument(page, name) {
  await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByText('Type your name in the box:').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
}

// A reload brings the open document back by itself.
async function reloadDocument(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Type your name in the box:').filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
}

async function drawLine(page, row) {
  const box = await page.locator(PAGE).boundingBox();
  const from = { x: box.x + box.width * 0.1, y: box.y + box.height * (0.8 + row * 0.07) };
  const to = { x: from.x + box.width * 0.35, y: from.y };
  await page.keyboard.press('l');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

test('tools work the moment the PDF shows; a mark drawn while the saved marks load is kept', async ({ page, context }) => {
  test.setTimeout(180_000);
  const seeded = await seedDocument('tools ready');
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDocument(page, seeded.name);
    await page.waitForTimeout(1_500);
    await drawLine(page, 0);
    await expect.poll(() => pageLines(page)).toHaveLength(1);
    // The first line is in the cloud before the slow reopen.
    const admin = adminClient();
    await expect.poll(async () => {
      const { count } = await admin.from('annotation_updates').select('*', { count: 'exact', head: true }).eq('document_id', seeded.id);
      return count || 0;
    }, { timeout: 30_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(1_000);

    const savedRows = async () => {
      const { count } = await admin.from('annotation_updates').select('*', { count: 'exact', head: true }).eq('document_id', seeded.id);
      return count || 0;
    };
    const rowsBefore = await savedRows();

    // From now on every cloud read of the saved marks takes 6 s.
    let slowReads = true;
    let releasedReads = 0;
    await context.route(/\/rest\/v1\/annotation_(updates|snapshots)/, async (route) => {
      if (!slowReads || route.request().method() !== 'GET') return route.fallback();
      await new Promise((resolve) => setTimeout(resolve, CLOUD_READ_DELAY_MS));
      releasedReads += 1;
      return route.fallback();
    });

    await reloadDocument(page);
    const shownAt = Date.now();

    // The saved marks are still loading, yet nothing is locked.
    expect(releasedReads, 'the cloud reads are still held back').toBe(0);
    expect(await page.evaluate(() => document.body.getAttribute('data-readonly'))).toBeNull();
    expect(await page.locator('[aria-busy="true"][style*="progress"]').count()).toBe(0);

    await drawLine(page, 1);
    await expect.poll(() => pageLines(page), { timeout: 3_000 }).toHaveLength(2);
    expect(Date.now() - shownAt, 'drawn well inside the slow window').toBeLessThan(CLOUD_READ_DELAY_MS);
    expect(releasedReads, 'drawn before the saved marks arrived').toBe(0);

    // The saved marks land: both lines stay (the old one from the cloud, the
    // new one on top), and the new one is saved.
    await expect.poll(() => releasedReads, { timeout: 30_000 }).toBeGreaterThan(0);
    // The line drawn while opening reaches the cloud once the store is open.
    await expect.poll(savedRows, { timeout: 60_000 }).toBeGreaterThan(rowsBefore);
    expect(await pageLines(page)).toHaveLength(2);

    slowReads = false;
    await reloadDocument(page);
    await expect.poll(() => pageLines(page), { timeout: 20_000 }).toHaveLength(2);
  } finally {
    await seeded.remove();
  }
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('nothing is locked on a phone while the saved marks load', async ({ page, context }) => {
    test.setTimeout(150_000);
    const seeded = await seedDocument('tools ready phone');
    try {
      await signIn(page, E2E_ACCOUNTS.owner);
      let releasedReads = 0;
      await context.route(/\/rest\/v1\/annotation_(updates|snapshots)/, async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        await new Promise((resolve) => setTimeout(resolve, CLOUD_READ_DELAY_MS));
        releasedReads += 1;
        return route.fallback();
      });
      await page.getByText(seeded.name, { exact: true }).filter({ visible: true }).first().tap();
      const openFile = page.getByRole('button', { name: 'Open file' });
      if (await openFile.isVisible().catch(() => false)) await openFile.tap();
      await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
      expect(releasedReads, 'the cloud reads are still held back').toBe(0);
      expect(await page.evaluate(() => document.body.getAttribute('data-readonly'))).toBeNull();
      expect(await page.locator('[aria-busy="true"][style*="progress"]').count()).toBe(0);
    } finally {
      await seeded.remove();
    }
  });
});
