// Pinned tools on phone and desktop (beta flag 'pinned-tools', Drawboard
// favourites toolbar): the "Pin a tool" picker has a search (Enter pins the
// first match), and on a phone the dock steps aside while a sheet is open
// instead of painting over it (Drawboard test T1 bug 5).
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
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
  return { id, name, path };
}

async function openDoc(page, doc) {
  const row = page.locator(`.documents-ledger-row[data-document-id="${doc.id}"]`).filter({ visible: true }).first();
  if (await row.count()) {
    await row.dblclick();
  } else {
    await page.getByText(doc.name, { exact: true }).filter({ visible: true }).first().click();
    const open = page.getByRole('button', { name: 'Open file' }).filter({ visible: true }).first();
    if (await open.isVisible().catch(() => false)) await open.click();
  }
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"] .survey-pdfjs-page-canvas').first()).toBeVisible({ timeout: 60_000 });
}

const fresh = () => {
  localStorage.setItem('survey.flag.pinned-tools', '1');
  localStorage.setItem('survey:pinned-tools.v1', JSON.stringify({ pins: [], visible: true, placement: 'bottom' }));
};

test('pin search (desktop): typing narrows the picker and Enter pins the first match', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const doc = await seedDoc(admin, owner, 'Pin search desk');
  try {
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.addInitScript(fresh);
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDoc(page, doc);
    await page.locator('[data-pinned-tools-add]').filter({ visible: true }).first().click();
    const picker = page.locator('[data-pinned-tools-picker]');
    const search = picker.locator('[data-pin-search]');
    await expect(search).toBeFocused();
    await expect(picker.locator('[data-pin-kind]')).toHaveCount(13);
    await search.fill('circle');
    await expect(picker.locator('[data-pin-kind]')).toHaveCount(1);
    await expect(picker.locator('[data-pin-kind="ellipse"]')).toBeVisible();
    await search.fill('zzz');
    await expect(picker.locator('[data-pin-search-empty]')).toHaveText('No tool matches “zzz”.');
    await search.fill('cloud');
    await page.screenshot({ path: test.info().outputPath('pin-search-desktop.png') });
    await search.press('Enter');
    await expect(page.locator('[data-pinned-tools-dock] [data-pin-slot]')).toHaveCount(1, { timeout: 10_000 });
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('survey:pinned-tools.v1')).pins.map((p) => p.kind));
    expect(saved).toEqual(['cloud']);
  } finally {
    await admin.from('documents').delete().eq('id', doc.id);
    await admin.storage.from('documents').remove([doc.path]);
  }
});

test('pinned tools (phone): search without a pop-up keyboard, and the dock steps aside for sheets', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const doc = await seedDoc(admin, owner, 'Pin search phone');
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(fresh);
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDoc(page, doc);
    const shell = page.locator('.pinned-dock-shell.is-phone');
    await expect(shell).toBeVisible({ timeout: 20_000 });
    const shown = () => shell.evaluate((el) => getComputedStyle(el).visibility);

    // Search on the phone: not focused on open (no keyboard), still works.
    await shell.locator('[data-pinned-tools-add]').click();
    const picker = page.locator('[data-pinned-tools-picker]');
    await expect(picker).toBeVisible();
    await expect(picker.locator('[data-pin-search]')).not.toBeFocused();
    const box = await picker.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await picker.locator('[data-pin-search]').fill('square');
    await picker.locator('[data-pin-kind="rect"]').click();
    await expect(shell.locator('[data-pin-slot]')).toHaveCount(1, { timeout: 10_000 });

    // A sheet open: the dock steps aside; shut: it is back.
    expect(await shown()).toBe('visible');
    await page.getByRole('button', { name: 'Open pages, search, and bookmarks' }).click();
    await expect(page.locator('.mobile-pdf-sheet:not(.is-collapsed)').first()).toBeVisible({ timeout: 10_000 });
    await expect.poll(shown).toBe('hidden');
    await page.screenshot({ path: test.info().outputPath('pin-dock-pages-sheet.png') });
    await page.getByRole('button', { name: 'Open pages, search, and bookmarks' }).click();
    await expect.poll(shown, { timeout: 10_000 }).toBe('visible');
  } finally {
    await admin.from('documents').delete().eq('id', doc.id);
    await admin.storage.from('documents').remove([doc.path]);
  }
});
