// Align and space picked marks (beta flag 'align-marks', Drawboard PDF Pro
// trial audit 2026-11-09): the mark menu of a multi-selection lines marks up
// or spaces them evenly, one Undo step each.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

async function onePagePdf() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText('Align test page one', { x: 72, y: 540, size: 24, font });
  return Buffer.from(await pdf.save());
}

test('the mark menu aligns and spaces picked marks, one undo step each', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.align-marks', '1'));
  const owner = E2E_ACCOUNTS.owner;
  const admin = adminClient();
  const api = await apiClientFor(owner);
  const { data: { user } } = await api.auth.getUser();
  const name = `Align sheet ${RUN}.pdf`;
  const id = crypto.randomUUID();
  const bytes = await onePagePdf();
  await must('upload', admin.storage.from('documents').upload(`${user.id}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: user.id, name, file_path: `${user.id}/${id}.pdf`, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));

  try {
    await signIn(page, owner);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Align test page one')).toBeVisible({ timeout: 60_000 });
    const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
    const box = await surface.boundingBox();

    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    for (const [x, y, w, h] of [[120, 160, 60, 40], [300, 220, 90, 30], [200, 330, 40, 70]]) {
      await page.mouse.move(box.x + x, box.y + y);
      await page.mouse.down();
      await page.mouse.move(box.x + x + w / 2, box.y + y + h / 2, { steps: 4 });
      await page.mouse.move(box.x + x + w, box.y + y + h, { steps: 4 });
      await page.mouse.up();
    }
    const marks = page.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');
    await expect(marks).toHaveCount(3);
    const boxes = () => marks.evaluateAll((els) => els.map((g) => {
      const b = g.getBBox();
      return { x: b.x, y: b.y, w: b.width, h: b.height };
    }));
    const before = await boxes();

    // Pick all three with a marquee, then open the menu on the selection.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).filter({ visible: true }).first().click();
    await page.mouse.move(box.x + 100, box.y + 140);
    await page.mouse.down();
    await page.mouse.move(box.x + 300, box.y + 300, { steps: 6 });
    await page.mouse.move(box.x + 420, box.y + 420, { steps: 6 });
    await page.mouse.up();
    const openAlign = async () => {
      await page.mouse.click(box.x + 150, box.y + 180, { button: 'right' });
      const menu = page.locator('[data-annotation-context-menu]');
      await expect(menu).toBeVisible();
      await menu.locator('[data-menu-key="align"]').hover();
      await expect(page.locator('[data-submenu-key="alignLeft"]')).toBeVisible();
    };

    await openAlign();
    await page.locator('[data-submenu-key="alignLeft"]').click();
    await expect.poll(async () => {
      const xs = (await boxes()).map((b) => Math.round(b.x));
      return new Set(xs).size;
    }).toBe(1);
    const aligned = await boxes();
    const left = Math.min(...before.map((b) => b.x));
    for (const b of aligned) expect(Math.abs(b.x - left)).toBeLessThan(1);

    // Space evenly down: equal gaps; the top and bottom marks stay.
    await openAlign();
    await page.locator('[data-submenu-key="distributeVertical"]').click();
    await expect.poll(async () => {
      const sorted = (await boxes()).slice().sort((a, c) => a.y - c.y);
      const gaps = [sorted[1].y - (sorted[0].y + sorted[0].h), sorted[2].y - (sorted[1].y + sorted[1].h)];
      return Math.abs(gaps[0] - gaps[1]) < 1;
    }).toBe(true);

    // One Undo per command: back to aligned, then back to where they were drawn.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await boxes()).map((b) => Math.round(b.y)).join()).toBe(aligned.map((b) => Math.round(b.y)).join());
    await page.keyboard.press('Control+z');
    await expect.poll(async () => (await boxes()).map((b) => Math.round(b.x)).join()).toBe(before.map((b) => Math.round(b.x)).join());
  } finally {
    if (!process.env.KEEP) await admin.from('documents').delete().eq('id', id);
  }
});
