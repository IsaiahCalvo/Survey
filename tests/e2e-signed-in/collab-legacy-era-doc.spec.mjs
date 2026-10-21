// A document whose marks exist only as legacy-era rows (document_annotations,
// no annotation doc yet), opened with the legacy-collab-retired flag off and
// on. Both must open it the same way, take new marks, and keep them after the
// document is closed and reopened. Seeds its own document; touches nothing
// the other specs use.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
async function seedLegacyDoc(admin, name, legacyRows = 3) {
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
  // Same shape annotationTypeSerializers.serializeFabricObjectToRow wrote
  // (Playwright cannot import src/ here: it loads it as CommonJS).
  const rows = Array.from({ length: legacyRows }, (_, i) => {
    const annotationId = `legacy-rect-${i}-${id.slice(0, 8)}`;
    const left = 60 + i * 90;
    const fabricObject = {
      type: 'rect', left, top: 300, width: 60, height: 40, stroke: '#d32f2f', strokeWidth: 2,
      fill: 'transparent', data: { id: annotationId }, meta: { authorId: userId },
    };
    return {
      document_id: id, user_id: userId, annotation_id: annotationId, annotation_type: 'square', page_number: 1,
      bounds: { x: left, y: 300, width: 60, height: 40, rotation: 0 },
      annotation_data: { fabricObject, pageNumber: 1, schemaVersion: 1, clientSessionId: null },
      color: '#d32f2f', opacity: null, stroke_width: 2, font_size: null, last_modified_by: userId,
    };
  });
  if (rows.length) {
    const ins = await admin.from('document_annotations').insert(rows);
    if (ins.error) throw ins.error;
  }
  return { id, filePath };
}

async function sealOf(admin, id) {
  const { data, error } = await admin.from('documents').select('cutover_completed_at').eq('id', id).single();
  if (error) throw error;
  return data.cutover_completed_at;
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

      // Cutover seal. Flag off: the old backfill copies the rows into the
      // collab doc and seals (unchanged). Flag on: these rows are not in the
      // annotation doc, so it must stay unsealed rather than drop them.
      if (flagOn) {
        await page.waitForTimeout(12_000); // past the seal check's delay
        expect(await sealOf(admin, seeded.id)).toBeNull();
      } else {
        await expect.poll(() => sealOf(admin, seeded.id), { timeout: 30_000 }).not.toBeNull();
      }
      expect(errors).toEqual([]);
    } finally {
      await admin.from('documents').delete().eq('id', seeded.id);
      await admin.storage.from('documents').remove([seeded.filePath]);
    }
  });
}

for (const flagOn of [false, true]) {
  const label = flagOn ? 'flag on' : 'flag off';

  test(`a document with no legacy rows is sealed on a writable open (${label})`, async ({ page }) => {
    const admin = adminClient();
    const name = `E2E Clean Seal ${flagOn ? 'on' : 'off'} ${Date.now()}.pdf`;
    const seeded = await seedLegacyDoc(admin, name, 0);
    try {
      expect(await sealOf(admin, seeded.id)).toBeNull();
      await setFlag(page, flagOn);
      await signIn(page, E2E_ACCOUNTS.owner);
      await openDoc(page, name);
      await expect.poll(() => sealOf(admin, seeded.id), { timeout: 30_000 }).not.toBeNull();
    } finally {
      await admin.from('documents').delete().eq('id', seeded.id);
      await admin.storage.from('documents').remove([seeded.filePath]);
    }
  });
}
