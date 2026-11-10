// Dark pages (beta flag 'dark-pages', Drawboard phone apps): a View switch on
// the desktop rail and in the phone zoom menu shows the PDF page light-on-dark.
// Only the page image is inverted; a red mark stays red. Remembered per device.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as Y from 'yjs';
import { bytesToPgHex } from '../../supabase/functions/_shared/pgBytea.js';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function seedDoc(admin, owner, label) {
  const ownerId = (await owner.auth.getUser()).data.user.id;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(`${label} drawing`, { x: 72, y: 700, size: 24, font });
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  const path = `${ownerId}/${id}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  const name = `${label} ${RUN}.pdf`;
  await must('row', admin.from('documents').insert({
    id, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  const source = new Y.Doc();
  source.transact(() => {
    const entry = new Y.Map();
    source.getMap('marks').set(`dark-${RUN}`, entry);
    entry.set('p', 1);
    const fields = new Y.Map();
    entry.set('o', fields);
    for (const [k, v] of Object.entries({ type: 'rect', id: `dark-${RUN}`, left: 120, top: 220, width: 200, height: 120, stroke: '#e53935', strokeWidth: 4, fill: 'transparent' })) fields.set(k, v);
  });
  await must('seed mark', owner.rpc('append_annotation_update', {
    p_document_id: id, p_client_id: `seed-${RUN}-${label}`, p_client_seq: 1, p_data: bytesToPgHex(Y.encodeStateAsUpdate(source)),
  }));
  return { id, name, path };
}

const pageCanvas = (page) => page.locator('.survey-pdfjs-page-div[data-page-number="1"] .survey-pdfjs-page-canvas').first();
const filterOf = (locator) => locator.evaluate((el) => getComputedStyle(el).filter);
const darkAttr = (page) => page.evaluate(() => document.documentElement.getAttribute('data-dark-pages'));

async function openDoc(page, doc) {
  const row = page.locator(`.documents-ledger-row[data-document-id="${doc.id}"]`).filter({ visible: true }).first();
  if (await row.count()) {
    await row.dblclick();
  } else {
    await page.getByText(doc.name, { exact: true }).filter({ visible: true }).first().click();
    const open = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
    if (await open.isVisible().catch(() => false)) await open.click();
  }
  await expect(pageCanvas(page)).toBeVisible({ timeout: 60_000 });
}

test('dark pages: desktop rail switch inverts only the page, and is remembered', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const doc = await seedDoc(admin, owner, 'Dark desk');
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem('survey.flag.dark-pages', '1');
      localStorage.removeItem('survey.darkPages.v1');
    }, undefined);
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDoc(page, doc);
    const toggle = page.locator('[data-dark-pages-toggle]').filter({ visible: true }).first();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await filterOf(pageCanvas(page))).toBe('none');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(await darkAttr(page)).toBe('on');
    expect(await filterOf(pageCanvas(page))).toContain('invert(0.9)');
    // The mark is not inside the inverted element, so it keeps its own red.
    const mark = page.locator('.survey-pdfjs-page-div[data-page-number="1"] svg [stroke="#e53935"]').first();
    await expect(mark).toBeVisible({ timeout: 20_000 });
    expect(await mark.evaluate((el) => {
      for (let n = el; n; n = n.parentElement) if (getComputedStyle(n).filter !== 'none') return getComputedStyle(n).filter;
      return 'none';
    })).toBe('none');
    await page.waitForTimeout(600);
    await page.screenshot({ path: test.info().outputPath('dark-pages-desktop.png') });
    // Remembered after a reload (the init script only clears it on a fresh page).
    await page.evaluate(() => localStorage.setItem('survey.darkPages.v1', '1'));
  } finally {
    await admin.from('documents').delete().eq('id', doc.id);
    await admin.storage.from('documents').remove([doc.path]);
  }
});

test('dark pages: phone zoom menu row, kept on while the menu is closed', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const doc = await seedDoc(admin, owner, 'Dark phone');
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(() => {
      localStorage.setItem('survey.flag.dark-pages', '1');
      localStorage.setItem('survey.darkPages.v1', '1');
    });
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDoc(page, doc);
    // Saved as on: applied before anyone opens the menu.
    await expect.poll(() => darkAttr(page), { timeout: 20_000 }).toBe('on');
    expect(await filterOf(pageCanvas(page))).toContain('invert(0.9)');
    await page.waitForTimeout(600);
    await page.screenshot({ path: test.info().outputPath('dark-pages-phone.png') });
    await page.getByRole('button', { name: 'Zoom and fit options' }).click();
    const row = page.locator('[data-dark-pages-toggle]').filter({ visible: true }).first();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    expect(await darkAttr(page)).toBe(null);
    expect(await filterOf(pageCanvas(page))).toBe('none');
    expect(await page.evaluate(() => localStorage.getItem('survey.darkPages.v1'))).toBe('0');
  } finally {
    await admin.from('documents').delete().eq('id', doc.id);
    await admin.storage.from('documents').remove([doc.path]);
  }
});

test('dark pages: with the flag off there is no switch and a saved "on" does nothing', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const doc = await seedDoc(admin, owner, 'Dark off');
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.addInitScript(() => localStorage.setItem('survey.darkPages.v1', '1'));
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDoc(page, doc);
    await expect(page.locator('[data-snapping-toggle]').filter({ visible: true }).first()).toBeVisible();
    await expect(page.locator('[data-dark-pages-toggle]')).toHaveCount(0);
    expect(await darkAttr(page)).toBe(null);
  } finally {
    await admin.from('documents').delete().eq('id', doc.id);
    await admin.storage.from('documents').remove([doc.path]);
  }
});
