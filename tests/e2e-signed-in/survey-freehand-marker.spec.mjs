// A freehand Survey Marker, drawn with a mouse and with a pen on the real
// Package 2 drawing set (owner report 2026-10-22): the stroke draws in the
// next entity's colour (there always is one: the last used, else the first),
// the new-marker card opens beside it right after the pen lifts (it took ~1 s,
// ~4 s on a slower CPU), a category row places it, and Undo takes it back.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const FIXTURE = 'debug/fixtures/package2-rev4.pdf';
const GC_RED = 'rgba(229, 57, 53, 0.4)';
const ELECTRICAL_GREEN = 'rgba(67, 160, 71, 0.4)';
// Before the fix: ~1,000 ms on this machine class. After: ~40 ms.
const CARD_OPEN_BUDGET_MS = 400;

async function seed(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const docId = randomUUID();
  const templateId = randomUUID();
  const templateName = `E2E Cameras ${Date.now()}`;
  const docName = `E2E Package 2 ${Date.now()}.pdf`;
  const bytes = fs.readFileSync(path.resolve(FIXTURE));
  const filePath = `${ownerId}/${docId}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const template = await admin.from('templates').insert({
    id: templateId, user_id: ownerId, name: templateName, description: 'survey-freehand-marker.spec',
    config: {
      modules: [
        { id: 'm-sec', name: 'Security', categories: [{ id: 'c-cam', name: 'Camera', checklist: [] }, { id: 'c-rdr', name: 'Card Reader', checklist: [] }] },
        { id: 'm-net', name: 'Network', categories: [{ id: 'c-ap', name: 'Access Point', checklist: [] }] },
      ],
      entities: [
        { id: 'e-gc', name: 'GC', color: '#E53935' },
        { id: 'e-el', name: 'Electrical', color: '#43A047' },
        { id: 'e-lv', name: 'Low Voltage', color: '#8E24AA' },
      ],
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

async function openSurvey(page, seeded) {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(seeded.docName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: new RegExp(seeded.templateName) }).click();
  await page.getByRole('button', { name: 'Freehand marker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Freehand marker', exact: true })).toHaveAttribute('aria-pressed', 'true');
}

// Times, inside the page, pointer up -> the card is in the DOM.
function watchCardOpen(page) {
  return page.evaluate(() => {
    window.__card = {};
    window.addEventListener('pointerup', () => { window.__card.up ??= performance.now(); }, { capture: true, once: true });
    const observer = new MutationObserver(() => {
      if (document.querySelector('[data-survey-marker-placement]')) {
        window.__card.open = performance.now();
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

async function drawStroke(page, pointerType, x, y) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, px, py, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x: px, y: py, button: 'left', buttons, clickCount: 1, pointerType, force: pointerType === 'pen' ? 0.5 : 0,
  });
  await send('mouseMoved', x, y, 0);
  await send('mousePressed', x, y, 1);
  for (let i = 1; i <= 24; i += 1) await send('mouseMoved', x + i * 6, y + Math.sin(i / 4) * 30, 1);
  const preview = await page.locator('.freehand-creation-preview').getAttribute('stroke');
  await send('mouseReleased', x + 144, y, 0);
  return preview;
}

for (const pointerType of ['mouse', 'pen']) {
  test(`a ${pointerType}-drawn freehand Survey Marker draws in its entity colour and its card opens at once`, async ({ page }) => {
    test.setTimeout(180_000);
    const admin = adminClient();
    const seeded = await seed(admin);
    try {
      await openSurvey(page, seeded);
      // No entity picked yet: the first one is the next marker's.
      await expect(page.getByRole('button', { name: 'Entity GC' })).toHaveAttribute('aria-pressed', 'true');

      const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
      await watchCardOpen(page);
      const preview = await drawStroke(page, pointerType, box.x + box.width * 0.35, box.y + box.height * 0.7);
      expect(preview, 'the stroke draws in the entity colour, not blue').toBe(GC_RED);

      const card = page.getByRole('dialog', { name: 'New Survey Marker' });
      await expect(card).toBeVisible();
      const ms = await page.evaluate(() => window.__card.open - window.__card.up);
      console.log(`[survey-freehand ${pointerType}] pointer up -> card ${Math.round(ms)} ms`);
      expect(ms).toBeLessThan(CARD_OPEN_BUDGET_MS);

      // Beside the marker, never over it; the drawn stroke is the entity colour.
      const marker = page.locator('[data-overlay-page="1"] [data-survey-marker-kind="stroke"]').last();
      await expect(marker.locator('[data-survey-marker-shape="stroke"]')).toHaveAttribute('stroke', GC_RED);
      const [m, c] = [await marker.boundingBox(), await card.boundingBox()];
      expect(c.x >= m.x + m.width || c.x + c.width <= m.x || c.y >= m.y + m.height).toBe(true);

      // Only the module in use is listed (owner 2026-10-22).
      await expect(card.getByRole('option', { name: /Access Point/ })).toHaveCount(0);
      // Another entity recolours the marker on the page at once, then a
      // category row places it.
      await card.getByRole('button', { name: 'Entity Electrical' }).click();
      await expect(marker.locator('[data-survey-marker-shape="stroke"]')).toHaveAttribute('stroke', ELECTRICAL_GREEN);
      await card.getByRole('option', { name: /Card Reader/ }).click();
      await expect(card).toBeHidden();
      // It opens in the rail with its name field focused.
      await expect.poll(() => page.evaluate(() => document.activeElement?.value)).toBe('Card Reader 1');
      await expect(marker.locator('[data-survey-marker-shape="stroke"]')).toHaveAttribute('stroke', ELECTRICAL_GREEN);
      // The bar now rings it for the next marker.
      await expect(page.getByRole('button', { name: 'Entity Electrical' }).first()).toHaveAttribute('aria-pressed', 'true');

      // Undo takes the placement back (its checkpoint skips the fingerprint).
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect(page.locator('[data-overlay-page="1"] [data-survey-marker-kind="stroke"]')).toHaveCount(0);
    } finally {
      await cleanup(admin, seeded);
    }
  });
}

test('Escape on the new-marker card takes the drawn marker back', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const seeded = await seed(admin);
  try {
    await openSurvey(page, seeded);
    const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
    await drawStroke(page, 'mouse', box.x + box.width * 0.35, box.y + box.height * 0.7);
    const card = page.getByRole('dialog', { name: 'New Survey Marker' });
    await expect(card).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(page.locator('[data-overlay-page="1"] [data-survey-marker-kind="stroke"]')).toHaveCount(0);
  } finally {
    await cleanup(admin, seeded);
  }
});
