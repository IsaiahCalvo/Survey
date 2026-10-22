// Smart fill (beta) on the real Schneider drawing set, Package 2 - Rev 4
// (owner report 2026-10-22: "it's not filling Schneider tags consistently").
// Tags that touch a wall, a leader line or the next tag used to leak or say
// "too big"; Smart fill now reads the drawing's own tag outlines. And when a
// tag is missed, "Teach a tag shape" boxes it, saves the shape in the survey
// template, and Find more finds every tag like it.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const FIXTURE = 'debug/fixtures/package2-rev4.pdf';
// Sheet SEC-B01E-P2 (page 7), page units. Each touches a wall or another tag.
const PAGE = 7;
const PAGE_WIDTH = 1224;
const TAGS = {
  'C95 (touches a wall)': [263.9, 513.2, 284.2, 533.4],
  'C27 (overlaps C26)': [82, 549.7, 102.2, 569.9],
  'C93 (touches C94)': [83.5, 496.4, 103.7, 516.7],
};
const R1224 = [294.7, 553.1, 314.9, 573.3];

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const docId = randomUUID();
  const templateId = randomUUID();
  const templateName = `E2E Smart fill ${Date.now()}`;
  const docName = `E2E Package 2 SF ${Date.now()}.pdf`;
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
    file_path: filePath, file_size: bytes.length, page_count: 36,
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
  return locator.evaluate((el) => {
    const b = el.getBBox();
    return { x0: b.x, y0: b.y, x1: b.x + b.width, y1: b.y + b.height };
  });
}

async function toScreen(sheet, [x0, y0, x1, y1]) {
  const box = await sheet.boundingBox();
  const k = box.width / PAGE_WIDTH;
  return { x0: box.x + x0 * k, y0: box.y + y0 * k, x1: box.x + x1 * k, y1: box.y + y1 * k, k };
}

test('a tap fills each touching Schneider tag exactly, then Apply makes it a Survey Marker', async ({ page }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    const sheet = await openSmartFill(page, seeded);
    for (const [name, tag] of Object.entries(TAGS)) {
      const s = await toScreen(sheet, tag);
      // Tap the tag's lower-left cell.
      await page.mouse.click(s.x0 + (s.x1 - s.x0) * 0.35, s.y0 + (s.y1 - s.y0) * 0.7);
      const preview = page.locator('[data-smart-fill-preview="true"]');
      await expect(preview, name).toBeVisible({ timeout: 10_000 });
      // The outline itself, in page units (the dashed stroke is drawn outside it).
      const b = await outlineBox(preview);
      expect(Math.abs(b.x0 - tag[0]), `${name} left`).toBeLessThan(1);
      expect(Math.abs(b.y0 - tag[1]), `${name} top`).toBeLessThan(1);
      expect(Math.abs(b.x1 - tag[2]), `${name} right`).toBeLessThan(1);
      expect(Math.abs(b.y1 - tag[3]), `${name} bottom`).toBeLessThan(1);
    }
    // The last one becomes a marker.
    await page.getByRole('button', { name: 'Apply' }).click();
    const card = page.getByRole('dialog', { name: 'New Survey Marker' });
    await expect(card).toBeVisible();
    await card.getByRole('option', { name: /Camera/ }).click();
    await expect(card).toBeHidden();
    await expect(page.locator(`[data-overlay-page="${PAGE}"] [data-survey-marker-kind="polygon"]`)).toHaveCount(1);
  } finally {
    await cleanup(admin, seeded);
  }
});

test('Teach a tag shape saves it in the template, and Find more finds every tag like it', async ({ page }) => {
  test.setTimeout(240_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    const sheet = await openSmartFill(page, seeded);
    await page.getByRole('button', { name: 'Teach a tag shape' }).click();
    await expect(page.getByRole('button', { name: 'Teach a tag shape' })).toHaveAttribute('aria-pressed', 'true');
    // Box the door tag with a little room around it.
    const s = await toScreen(sheet, [R1224[0] - 3, R1224[1] - 3, R1224[2] + 3, R1224[3] + 3]);
    await page.mouse.move(s.x0, s.y0);
    await page.mouse.down();
    await page.mouse.move((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, { steps: 4 });
    await page.mouse.move(s.x1, s.y1, { steps: 4 });
    await page.mouse.up();
    const preview = page.locator('[data-smart-fill-preview="true"]');
    await expect(preview).toBeVisible({ timeout: 10_000 });
    const b = await outlineBox(preview);
    expect(Math.abs(b.x0 - R1224[0])).toBeLessThan(1);
    expect(Math.abs(b.x1 - b.x0 - (R1224[2] - R1224[0]))).toBeLessThan(1);

    await page.getByRole('button', { name: 'Save shape' }).click();
    const card = page.getByRole('dialog', { name: 'New Survey Marker' });
    await expect(card).toBeVisible();
    await card.getByRole('option', { name: /Card Reader/ }).click();
    await expect(card).toBeHidden();
    await expect(page.getByRole('button', { name: 'Teach a tag shape' })).toHaveAttribute('aria-pressed', 'false');

    // Saved in the template row, for everyone who uses it.
    await expect.poll(async () => {
      const { data } = await admin.from('templates').select('config').eq('id', seeded.templateId).single();
      return data?.config?.smartFillShapes?.length || 0;
    }, { timeout: 20_000 }).toBe(1);
    const { data: row } = await admin.from('templates').select('config').eq('id', seeded.templateId).single();
    const shape = row.config.smartFillShapes[0];
    expect(Math.abs(shape.width - 20.2)).toBeLessThan(0.5);
    // Modules and entities are untouched.
    expect(row.config.modules[0].categories.map((c) => c.name)).toEqual(['Camera', 'Card Reader']);

    // Find more: every tag of that shape on the sheet is offered.
    await page.getByRole('button', { name: 'Find more' }).click();
    await expect.poll(() => page.locator(`[data-overlay-page="${PAGE}"] [data-smart-fill-match="true"]`).count(), { timeout: 30_000 })
      .toBeGreaterThan(40);
  } finally {
    await cleanup(admin, seeded);
  }
});
