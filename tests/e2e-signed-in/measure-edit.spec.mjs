// Edit measurement (beta flag 'measure-edit'; Drawboard deep test MS-19/20/21):
// a drawn measurement's name, depth and caption change later from its
// right-click menu (phone: long-press), with one Undo step, and they save.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const PTS = [[200, 200], [380, 200], [380, 290], [200, 290]];

async function seed(admin, userId, name) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText(`${name} page one`, { x: 72, y: 540, size: 24, font });
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  await must('upload', admin.storage.from('documents').upload(`${userId}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: userId, name: `${name}.pdf`, file_path: `${userId}/${id}.pdf`, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return id;
}

async function openDoc(page, name) {
  await page.getByText(`${name}.pdf`, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByText(`${name} page one`)).toBeVisible({ timeout: 60_000 });
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  return surface;
}

async function drawVolume(page, surface, depth) {
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.locator('[data-measure-tool="menu"]').click();
  await page.getByText('Page scale…').click();
  const scaleDialog = page.getByRole('dialog', { name: 'Set page scale' });
  await scaleDialog.locator('[data-measure-preset-option="1/4"]').click();
  await scaleDialog.locator('[data-measure-apply]').click();
  await expect(scaleDialog).toBeHidden();
  await page.locator('[data-measure-tool="menu"]').click();
  await page.locator('[data-measure-tool="volume"]').click();
  const depthDialog = page.getByRole('dialog', { name: 'Volume depth' });
  await depthDialog.locator('[data-measure-depth]').fill(String(depth));
  await depthDialog.locator('[data-measure-depth-apply]').click();
  await expect(depthDialog).toBeHidden();
  const box = await surface.boundingBox();
  for (const [x, y] of PTS) await page.mouse.click(box.x + x, box.y + y);
  await page.mouse.click(box.x + PTS[0][0], box.y + PTS[0][1]);
  await page.keyboard.press('Escape');
  return box;
}

const label = (page) => page.locator('.measure-labels .measure-label[data-measure-kind="volume"] text');
const cuFt = async (page) => Number((await label(page).textContent()).replace(/^.*·\s*/, '').replace(/[^\d.]/g, ''));

test('edit a drawn measurement: name on its caption, a new depth, caption off, Undo, saved', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.measure-depth', '1');
    localStorage.setItem('survey.flag.measure-edit', '1');
  });
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Measure edit ${RUN}`;
  const id = await seed(admin, user.id, name);
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    const surface = await openDoc(page, name);
    const box = await drawVolume(page, surface, 8);
    await expect(label(page)).toHaveText(/^[\d,]+\.\d\d cu ft$/, { timeout: 15_000 });
    const before = await cuFt(page);

    // Right-click the outline's top edge: Edit measurement…
    await page.mouse.click(5, 450);
    await page.mouse.click(box.x + 290, box.y + PTS[0][1], { button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit measurement…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit volume' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-measure-edit-depth]')).toHaveValue('8');
    await dialog.locator('[data-measure-edit-name]').fill('Room 101');
    await dialog.locator('[data-measure-edit-depth]').fill('10');
    await page.screenshot({ path: test.info().outputPath('measure-edit-dialog.png') });
    await dialog.locator('[data-measure-edit-apply]').click();
    await expect(dialog).toBeHidden();
    await expect(label(page)).toHaveText(/^Room 101 · [\d,]+\.\d\d cu ft$/);
    expect(Math.abs((await cuFt(page)) - before * 10 / 8)).toBeLessThan(0.05);
    await page.screenshot({ path: test.info().outputPath('measure-edit-named.png') });

    // One Undo step puts the old name and depth back; Redo brings them again.
    await page.mouse.click(5, 450);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(label(page)).toHaveText(/^[\d,]+\.\d\d cu ft$/);
    expect(Math.abs((await cuFt(page)) - before)).toBeLessThan(0.05);
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(label(page)).toHaveText(/^Room 101 · /);

    // Caption off: the pill goes, the measurement stays.
    await page.mouse.click(box.x + 290, box.y + PTS[0][1], { button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit measurement…' }).click();
    await dialog.locator('[data-measure-edit-caption]').uncheck();
    await dialog.locator('[data-measure-edit-apply]').click();
    await expect(page.locator('.measure-labels .measure-label')).toHaveCount(0);

    // Saved: after a reload the card shows the name, the new depth and caption off.
    await page.waitForTimeout(2500);
    await page.reload();
    // The open tab comes back by itself after a reload.
    const again = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
    await expect(page.getByText(`${name} page one`)).toBeVisible({ timeout: 60_000 });
    await expect(again.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    const box2 = await again.boundingBox();
    await expect(page.locator('.measure-labels .measure-label')).toHaveCount(0);
    await page.mouse.click(5, 450);
    await page.mouse.click(box2.x + 290, box2.y + PTS[0][1], { button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit measurement…' }).click();
    await expect(dialog.locator('[data-measure-edit-name]')).toHaveValue('Room 101');
    await expect(dialog.locator('[data-measure-edit-depth]')).toHaveValue('10');
    await expect(dialog.locator('[data-measure-edit-caption]')).not.toBeChecked();
  } finally {
    await admin.from('documents').delete().eq('id', id);
  }
});

test('a measurement without the flag has no Edit measurement item', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.measure-depth', '1'));
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Measure edit off ${RUN}`;
  const id = await seed(admin, user.id, name);
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    const surface = await openDoc(page, name);
    const box = await drawVolume(page, surface, 8);
    await expect(label(page)).toHaveCount(1, { timeout: 15_000 });
    await page.mouse.click(5, 450);
    await page.mouse.click(box.x + 290, box.y + PTS[0][1], { button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Edit measurement…' })).toHaveCount(0);
  } finally {
    await admin.from('documents').delete().eq('id', id);
  }
});

test('phone size: the mark menu has Edit measurement and the card fits the screen', async ({ page }) => {
  test.setTimeout(150_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.measure-depth', '1');
    localStorage.setItem('survey.flag.measure-edit', '1');
  });
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Measure edit phone ${RUN}`;
  const id = await seed(admin, user.id, name);
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    const surface = await openDoc(page, name);
    await drawVolume(page, surface, 8);
    await expect(label(page)).toHaveCount(1, { timeout: 15_000 });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1200);
    const edge = await page.locator('[data-overlay-page="1"] [data-annotation-id]').first().boundingBox();
    await page.mouse.click(edge.x + edge.width / 2, edge.y + 1, { button: 'right' });
    await page.getByRole('menuitem', { name: 'Edit measurement…' }).filter({ visible: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit volume' });
    await expect(dialog).toBeVisible();
    const card = await dialog.boundingBox();
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(390);
    await dialog.locator('[data-measure-edit-name]').fill('Hall');
    await page.screenshot({ path: test.info().outputPath('measure-edit-phone.png') });
    await dialog.locator('[data-measure-edit-apply]').click();
    await expect(label(page)).toHaveText(/^Hall · /);
  } finally {
    await admin.from('documents').delete().eq('id', id);
  }
});
