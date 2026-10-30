// Smart fill (beta) on Schneider-style tags (owner report 2026-10-22: "it's
// not filling Schneider tags consistently"). Tags that touch a wall, a leader
// line or the next tag used to leak or say "too big"; Smart fill now reads the
// drawing's own tag outlines. Owner 2026-10-27: a tap places the Survey
// Marker at once, the same as a drawn box (no Apply step), and the tag
// teaching tools (Teach a tag shape, Smart fill shapes, Find more) are on
// hold, so the tool bar does not offer them. The sheet is a small made-up one
// (debug/smart-fill/make-tag-sheet.mjs) that copies what makes Schneider tags
// hard, so the test stays fast.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

// Tag boxes in page units, from the script that draws the sheet.
const FIXTURE = 'debug/fixtures/tag-sheet.pdf';
const PAGE = 1;
const PAGE_WIDTH = 1224;
const TAGS = {
  'touches a wall': [289.9, 509.9, 310.1, 530.1],
  'overlaps the next tag': [89.9, 549.9, 110.1, 570.1],
  'touches the next tag': [89.9, 496.4, 110.1, 516.6],
};
// A revision cloud drawn as separate arcs (its scallops reach 4 past the box
// it is drawn round), with a tag inside it.
const CLOUD = [636, 636, 1004, 744];
const CLOUD_TAG = [689.9, 679.9, 710.1, 700.1];

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const docId = randomUUID();
  const templateId = randomUUID();
  const templateName = `E2E Smart fill ${Date.now()}`;
  const docName = `E2E Tag sheet SF ${Date.now()}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const template = await admin.from('templates').insert({
    id: templateId, user_id: ownerId, name: templateName, description: 'survey-smart-fill.spec',
    config: {
      modules: [{ id: 'm-sec', name: 'Security', categories: [{ id: 'c-cam', name: 'Camera', checklist: [] }, { id: 'c-rdr', name: 'Card Reader', checklist: [] }] }],
      entities: [{ id: 'e-gc', name: 'GC', color: '#E53935' }, { id: 'e-el', name: 'Electrical', color: '#43A047' }],
    },
  });
  if (template.error) throw template.error;
  const doc = await admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name: docName,
    file_path: filePath, file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  return { docId, docName, filePath, templateId, templateName };
}

async function cleanup(admin, seeded) {
  await admin.from('documents').delete().eq('id', seeded.docId);
  await admin.storage.from('documents').remove([seeded.filePath]);
  await admin.from('templates').delete().eq('id', seeded.templateId);
}

async function openSmartFill(page, seeded) {
  await page.addInitScript(() => { try { localStorage.setItem('survey.flag.smart-fill', '1'); } catch { /* none */ } });
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(seeded.docName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(seeded.templateName) }).click();
  await page.getByRole('button', { name: 'Smart fill (beta)' }).click();
  await expect(page.getByRole('button', { name: 'Smart fill (beta)' })).toHaveAttribute('aria-pressed', 'true');
  const sheet = page.locator(`.survey-pdfjs-page-div[data-page-number="${PAGE}"]`);
  await sheet.scrollIntoViewIfNeeded();
  await expect(sheet.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  return sheet;
}

// Page units -> screen px on the sheet as it sits now.
async function outlineBox(locator) {
  // A marker's outline is its hit path; getBBox leaves the stroke out.
  return locator.evaluate((el) => {
    const b = el.getBBox();
    return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
  });
}

// Scroll the viewer until a page-unit box is on screen, then map it.
async function onScreen(page, sheet, area) {
  const view = page.viewportSize();
  for (let i = 0; i < 6; i += 1) {
    const s = await toScreen(sheet, area);
    const below = s.y1 - (view.height - 60);
    const above = 60 - s.y0;
    if (below <= 0 && above <= 0) return s;
    await page.mouse.move(view.width / 2, view.height / 2);
    await page.mouse.wheel(0, below > 0 ? below : -above);
    await page.waitForTimeout(300);
  }
  return toScreen(sheet, area);
}

async function toScreen(sheet, [x0, y0, x1, y1]) {
  const box = await sheet.boundingBox();
  const k = box.width / PAGE_WIDTH;
  return { x0: box.x + x0 * k, y0: box.y + y0 * k, x1: box.x + x1 * k, y1: box.y + y1 * k, k };
}

test('a tap fills each touching Schneider tag exactly and places it as a Survey Marker, with no Apply step', async ({ page }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    const sheet = await openSmartFill(page, seeded);
    // The tag teaching tools are on hold (owner 2026-10-27).
    await expect(page.getByRole('button', { name: 'Teach a tag shape' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Smart fill shapes', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Find tags like your Smart fill shapes' })).toHaveCount(0);
    const markers = page.locator(`[data-overlay-page="${PAGE}"] [data-survey-marker-kind="polygon"]`);
    const card = page.getByRole('dialog', { name: 'New Survey Marker' });
    const taps = [
      ...Object.entries(TAGS).map(([name, tag]) => [name, tag, [0.35, 0.7]]),
      // Inside a revision cloud: a tap off the tag fills the cloud, a tap on
      // the tag still fills just the tag.
      ['cloud', CLOUD, [0.75, 0.6]],
      ['tag in the cloud', CLOUD_TAG, [0.35, 0.7]],
    ];
    for (const [i, [name, want, at]] of taps.entries()) {
      const s = await onScreen(page, sheet, want);
      await page.mouse.click(s.x0 + (s.x1 - s.x0) * at[0], s.y0 + (s.y1 - s.y0) * at[1]);
      // The marker is on the page at once with the same card a drawn box opens.
      await expect(markers, name).toHaveCount(i + 1, { timeout: 10_000 });
      await expect(card, name).toBeVisible();
      await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(0);
      await expect(page.locator('[data-smart-fill-preview="true"]')).toHaveCount(0);
      const b = await outlineBox(markers.nth(i).locator('[data-survey-marker-hit-target="true"]'));
      for (const [k, side] of [[0, 'x0'], [1, 'y0'], [2, 'x1'], [3, 'y1']]) {
        expect(Math.abs(b[side] - want[k]), `${name} ${side}`).toBeLessThan(1);
      }
      await card.getByRole('option', { name: /Camera/ }).click();
      await expect(card).toBeHidden();
    }
    await expect(markers).toHaveCount(taps.length);
    await page.screenshot({ path: 'test-results/smart-fill-placed.png' });
  } finally {
    await cleanup(admin, seeded);
  }
});
