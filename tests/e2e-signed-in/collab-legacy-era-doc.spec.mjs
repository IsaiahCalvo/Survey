// A document whose marks exist only as legacy-era rows (document_annotations,
// no annotation doc yet), opened with the legacy-collab-retired flag off and
// on. Both must open it the same way, take new marks, and keep them after the
// document is closed and reopened. Seeds its own document; touches nothing
// the other specs use.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { serializeFabricObjectToRow } from '../../src/services/annotationTypeSerializers.js';
import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const MARKS = '[data-overlay-page="1"] [data-annotation-id]';

async function setFlag(page, on) {
  await page.addInitScript((value) => {
    try { window.localStorage.setItem('survey.flag.legacy-collab-retired', value); } catch { /* ignore */ }
  }, on ? '1' : '0');
}

async function ownerId(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email);
  if (!user) throw new Error('owner account not seeded');
  return user.id;
}

// A fresh document with three legacy-era rectangles and nothing else.
async function seedLegacyDoc(admin, name) {
  const userId = await ownerId(admin);
  const id = randomUUID();
  const bytes = fs.readFileSync(path.resolve(E2E_DOCUMENT.fixture));
  const filePath = `${userId}/${id}.pdf`;
  const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), {
    contentType: 'application/pdf', upsert: true,
  });
  if (up.error) throw up.error;
  const doc = await admin.from('documents').insert({
    id, user_id: userId, project_id: E2E_PROJECT.id, name, file_path: filePath,
    file_size: bytes.length, page_count: 1,
  });
  if (doc.error) throw doc.error;
  const rows = [0, 1, 2].map((i) => serializeFabricObjectToRow({
    type: 'rect', left: 60 + i * 90, top: 300, width: 60, height: 40,
    stroke: '#d32f2f', strokeWidth: 2, fill: 'transparent', data: { id: `legacy-rect-${i}-${id.slice(0, 8)}` },
  }, { documentId: id, userId, pageNumber: 1 }));
  const ins = await admin.from('document_annotations').insert(rows);
  if (ins.error) throw ins.error;
  return { id, filePath };
}

async function openDoc(page, name) {
  await page.getByText(name, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByRole('button', { name: `Close ${name}` })).toBeVisible();
  await expect(page.getByText('Type your name in the box:')).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(2500);
}

async function drawRect(page) {
  const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  await page.keyboard.press('r');
  const x = box.x + box.width * 0.4;
  const y = box.y + box.height * 0.7;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 40, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

for (const flagOn of [false, true]) {
  const label = flagOn ? 'flag on' : 'flag off';

  test(`legacy-era document opens, takes a mark and keeps it after reopen (${label})`, async ({ page }) => {
    const admin = adminClient();
    const name = `E2E Legacy Era ${flagOn ? 'on' : 'off'} ${Date.now()}.pdf`;
    const seeded = await seedLegacyDoc(admin, name);
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    try {
      await setFlag(page, flagOn);
      await signIn(page, E2E_ACCOUNTS.owner);
      await openDoc(page, name);
      const opened = await page.locator(MARKS).count();
      console.log(`[legacy-era ${label}] marks on open: ${opened}`);

      await drawRect(page);
      await expect(page.locator(MARKS)).toHaveCount(opened + 1);
      await page.waitForTimeout(3000); // let the save land

      await page.getByRole('button', { name: `Close ${name}` }).click();
      await expect(page.getByRole('button', { name: `Close ${name}` })).toHaveCount(0);
      await openDoc(page, name);
      await expect(page.locator(MARKS)).toHaveCount(opened + 1, { timeout: 30_000 });

      // The legacy rows are only read, never deleted, by the open.
      const { count } = await admin.from('document_annotations')
        .select('id', { count: 'exact', head: true }).eq('document_id', seeded.id).like('annotation_id', 'legacy-rect-%');
      expect(count).toBe(3);
      expect(errors).toEqual([]);
    } finally {
      await admin.from('documents').delete().eq('id', seeded.id);
      await admin.storage.from('documents').remove([seeded.filePath]);
    }
  });
}
