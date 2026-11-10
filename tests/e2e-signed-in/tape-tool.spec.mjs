// Tape (beta flag 'tape-tool', Drawboard PDF's Free-form > Tape): a freehand
// opaque pastel band with a soft shadow that covers part of the page. A tap
// under Pan shows it as an outline so what is under it shows; another tap
// covers it again. The eraser takes it whole, never a bite. It saves.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const TAPE = '[data-overlay-page="1"] path[data-tape]';

async function seed(name) {
  const admin = adminClient();
  const api = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await api.auth.getUser();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText(`${name} answer under the tape`, { x: 72, y: 400, size: 24, font });
  const bytes = Buffer.from(await pdf.save());
  const id = crypto.randomUUID();
  const filePath = `${user.id}/${id}.pdf`;
  await must('upload', admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name: `${name}.pdf`, file_path: filePath, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return {
    id,
    remove: async () => {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([filePath]);
    },
  };
}

async function openDoc(page, name) {
  await page.getByText(`${name}.pdf`, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByText(`${name} answer under the tape`)).toBeVisible({ timeout: 60_000 });
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(800);
  return surface;
}

async function dragAcross(page, box, from, to) {
  await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 10 });
  await page.mouse.up();
}

const flagOn = (page, on = true) => page.addInitScript((value) => {
  if (value) localStorage.setItem('survey.flag.tape-tool', '1');
}, on);

test('tape covers the page, a Pan tap reveals and covers again, the eraser takes it whole, and it saves', async ({ page }) => {
  test.setTimeout(180_000);
  await flagOn(page);
  const name = `Tape ${RUN}`;
  const doc = await seed(name);
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    const surface = await openDoc(page, name);
    await page.keyboard.press('h');
    const tapeButton = page.getByRole('button', { name: 'Tape', exact: true }).filter({ visible: true });
    await expect(tapeButton).toBeVisible();
    await tapeButton.click();
    await expect(tapeButton).toHaveAttribute('aria-pressed', 'true');
    const box = await surface.boundingBox();
    // Across the line of text (y 400 of 612 from the bottom = 0.35 down).
    await dragAcross(page, box, [0.08, 0.35], [0.6, 0.35]);
    const tape = page.locator(TAPE);
    await expect(tape).toHaveCount(1);
    await expect(tape).toHaveAttribute('data-tape', 'covered');
    // Opaque lilac with a shadow, at full strength.
    await expect(tape).toHaveAttribute('fill', '#c9b6ec');
    expect(await tape.evaluate((el) => getComputedStyle(el).filter)).toContain('drop-shadow');
    expect(await tape.evaluate((el) => Number(getComputedStyle(el).opacity))).toBe(1);
    // Its band is about 20 pt tall.
    const band = await tape.evaluate((el) => el.getBBox().height);
    expect(band).toBeGreaterThan(17);
    expect(band).toBeLessThan(26);
    await page.screenshot({ path: test.info().outputPath('tape-covered.png') });

    // Pan: a tap reveals (outline in its colour), another covers.
    await page.keyboard.press('Escape');
    await page.keyboard.press('m');
    const tapAt = { x: box.x + box.width * 0.3, y: box.y + box.height * 0.35 };
    await page.mouse.click(tapAt.x, tapAt.y);
    await expect(tape).toHaveAttribute('data-tape', 'revealed');
    await expect(tape).toHaveAttribute('fill', 'none');
    await expect(tape).toHaveAttribute('stroke', '#c9b6ec');
    await page.screenshot({ path: test.info().outputPath('tape-revealed.png') });
    await page.mouse.click(tapAt.x, tapAt.y);
    await expect(tape).toHaveAttribute('data-tape', 'covered');
    // The tap did not pick it.
    await expect(page.locator('[data-resize-handle]')).toHaveCount(0);

    // Saved: back after a reload, covered.
    await page.waitForTimeout(2500);
    await page.reload();
    await expect(page.getByText(`${name} answer under the tape`)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator(TAPE)).toHaveCount(1, { timeout: 30_000 });
    await expect(page.locator(TAPE)).toHaveAttribute('data-tape', 'covered');

    // The partial eraser takes the whole band (no bite); Undo brings it back.
    const box2 = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
    await page.keyboard.press('Shift+E');
    await dragAcross(page, box2, [0.3, 0.3], [0.3, 0.4]);
    await expect(page.locator(TAPE)).toHaveCount(0);
    await page.mouse.click(5, 450);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(page.locator(TAPE)).toHaveCount(1);
  } finally {
    await doc.remove();
  }
});

test('without the flag there is no Tape tool', async ({ page }) => {
  test.setTimeout(120_000);
  const name = `Tape off ${RUN}`;
  const doc = await seed(name);
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDoc(page, name);
    await page.keyboard.press('h');
    await expect(page.getByRole('button', { name: 'Highlighter', exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tape', exact: true }).filter({ visible: true })).toHaveCount(0);
  } finally {
    await doc.remove();
  }
});

test('phone size: Tape is in the Draw tools and draws a band', async ({ page }) => {
  test.setTimeout(150_000);
  await flagOn(page);
  const name = `Tape phone ${RUN}`;
  const doc = await seed(name);
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await openDoc(page, name);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: 'Draw', exact: true }).filter({ visible: true }).first().click();
    const tapeTool = page.getByRole('button', { name: 'Tape', exact: true }).filter({ visible: true });
    await expect(tapeTool).toBeVisible();
    await tapeTool.click();
    const box = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).boundingBox();
    await dragAcross(page, box, [0.1, 0.35], [0.7, 0.35]);
    await expect(page.locator(TAPE)).toHaveCount(1);
    await expect(page.locator(TAPE)).toHaveAttribute('data-tape', 'covered');
    await page.screenshot({ path: test.info().outputPath('tape-phone.png') });
  } finally {
    await doc.remove();
  }
});
