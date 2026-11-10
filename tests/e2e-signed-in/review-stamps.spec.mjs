// Review stamps (beta flag 'review-stamps', Survey Nightly; Drawboard Projects
// round 2): the Library panel's Stamps tab holds twelve ready-made review
// stamps. A click on one, then a click on the page, places it there with the
// placer's name and today's date filled in, as one Undo step; "Copy to
// personal" puts an editable copy in your own library.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const FIXTURE = 'debug/fixtures/clickable-link-test.pdf';
const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const MARKS = '[data-overlay-page="1"] [data-annotation-id]';
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);
const pageTexts = (page) => page.locator('[data-overlay-page="1"] foreignObject div').allInnerTexts();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

async function seedDocument(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const docId = randomUUID();
  const docName = `E2E Stamps ${Date.now()}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  if (up.error) throw up.error;
  const doc = await admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName, file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  return { docId, docName, filePath, ownerId };
}

test('review stamps: place Approved with my name and the date, undo it, copy one to my library', async ({ page }) => {
  test.setTimeout(150_000);
  const admin = adminClient();
  const seeded = await seedDocument(admin);
  await admin.from('mark_library_items').delete().eq('created_by', seeded.ownerId);
  try {
    await page.addInitScript(() => {
      localStorage.setItem('survey.flag.mark-library', '1');
      localStorage.setItem('survey.flag.review-stamps', '1');
    });
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(seeded.docName, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1000);

    const libraryButton = page.getByRole('button', { name: 'Library', exact: true }).first();
    if ((await libraryButton.getAttribute('aria-expanded')) !== 'true') await libraryButton.click();
    await expect(page.getByTestId('mark-library-panel')).toBeVisible();
    await page.getByRole('tab', { name: 'Stamps' }).click();
    const tiles = page.locator('[data-mark-library-item^="review-stamp:"]');
    await expect(tiles).toHaveCount(12);
    // The search box narrows them.
    await page.getByLabel('Search the library').fill('construction');
    await expect(tiles).toHaveCount(2);
    await page.getByLabel('Search the library').fill('');
    await page.screenshot({ path: test.info().outputPath('review-stamps-panel.png') });

    // Click Approved, then the page.
    const box = await page.locator(PAGE).boundingBox();
    const target = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.7 };
    const before = new Set(await markIds(page));
    const approved = page.locator('[data-mark-library-item="review-stamp:approved"]');
    await approved.click();
    await expect(approved).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.move(target.x, target.y, { steps: 4 });
    await expect(page.locator('[data-mark-library-ghost]')).toBeVisible();
    await page.mouse.click(target.x, target.y);
    await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
    const now = new Date();
    const today = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
    await expect.poll(() => pageTexts(page)).toContain(`APPROVED\n${E2E_ACCOUNTS.owner.label} · ${today}`);
    await page.screenshot({ path: test.info().outputPath('review-stamps-placed.png') });

    // One Undo takes it away.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(0);

    // Copy to personal: an editable copy in my own library.
    await page.locator('[data-mark-library-item="review-stamp:rejected"]').click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Copy to personal' }).click();
    await expect.poll(async () => {
      const { data } = await admin.from('mark_library_items').select('name, library, tags').eq('created_by', seeded.ownerId);
      return data || [];
    }, { timeout: 20_000 }).toEqual([{ name: 'Rejected', library: 'personal', tags: ['Review'] }]);
    await page.getByRole('tab', { name: 'Personal' }).click();
    await expect(page.locator('[data-mark-library-item]').filter({ hasText: 'Rejected' })).toHaveCount(1);
  } finally {
    await admin.from('mark_library_items').delete().eq('created_by', seeded.ownerId);
    await admin.from('documents').delete().eq('id', seeded.docId);
    await admin.storage.from('documents').remove([seeded.filePath]);
  }
});
