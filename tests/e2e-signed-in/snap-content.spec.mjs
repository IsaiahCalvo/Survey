// Snap to content (beta flag 'snap-content', Drawboard PDF Pro trial audit
// 2026-11-10): a Line drawn a few pixels off the PDF's own line ends lands
// exactly on them; the rail's Snapping button opens Marks / Drawing switches,
// and Drawing off (or the flag off) leaves the ends where they were drawn.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, signIn, test } from './helpers.mjs';
import { seedSheet } from './seedSheet.mjs';

const SIZE = [792, 612];
const WALL_A = { x1: 100, y1: 150, x2: 500, y2: 150 };
const WALL_B = { x1: 100, y1: 330, x2: 500, y2: 330 };

/** Every <line> mark on page 1, as [x1, y1, x2, y2] (page units). */
const pageLines = (page) => page.evaluate(() => {
  const byMark = new Map();
  for (const l of document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id] line')) {
    const id = l.closest('[data-annotation-id]').getAttribute('data-annotation-id');
    if (!byMark.has(id)) byMark.set(id, ['x1', 'y1', 'x2', 'y2'].map((k) => Number(l.getAttribute(k))));
  }
  return [...byMark.values()];
});

async function openSheet(page, flag) {
  await page.addInitScript((value) => localStorage.setItem('survey.flag.snap-content', value), flag);
  const sheet = await seedSheet('Snap content', { size: SIZE, lines: [WALL_A, WALL_B] });
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  return { sheet, pageDiv };
}

/** Draw a Line from 3-4 screen px off `wall`'s ends; returns the new mark's ends. */
async function drawNear(page, pageDiv, wall, { hoverCheck = false } = {}) {
  const box = await pageDiv.boundingBox();
  const s = box.width / SIZE[0];
  const at = (x, y) => ({ x: box.x + x * s, y: box.y + y * s });
  const a = at(wall.x1, wall.y1);
  const b = at(wall.x2, wall.y2);
  const before = (await pageLines(page)).length;
  await page.keyboard.press('l');
  await page.mouse.move(a.x + 3, a.y - 3);
  await page.mouse.move(a.x + 3.5, a.y - 3, { steps: 2 });
  if (hoverCheck) await expect(page.locator('[data-overlay-page="1"] [data-snap-content="end"]')).toBeVisible();
  await page.mouse.down();
  await page.mouse.move(b.x - 4, b.y + 3, { steps: 12 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await pageLines(page)).length).toBe(before + 1);
  return (await pageLines(page))[before];
}

const near = (got, want, eps) => got.every((v, i) => Math.abs(v - want[i]) <= eps);

test('Drawing snap: Line ends land on the PDF line ends; the menu has Marks and Drawing, and Drawing off stops it', async ({ page }) => {
  test.setTimeout(150_000);
  const { sheet, pageDiv } = await openSheet(page, '1');
  try {
    const snapped = await drawNear(page, pageDiv, WALL_A, { hoverCheck: true });
    expect(near(snapped, [WALL_A.x1, WALL_A.y1, WALL_A.x2, WALL_A.y2], 0.01), `snapped ${snapped}`).toBe(true);

    const button = page.locator('[data-snapping-toggle="true"]').filter({ visible: true });
    await button.click();
    const menu = page.getByRole('dialog', { name: 'Snapping' });
    await expect(menu).toBeVisible();
    const marks = menu.getByRole('switch', { name: 'Marks' });
    const drawing = menu.getByRole('switch', { name: 'Drawing' });
    await expect(marks).toHaveAttribute('aria-checked', 'true');
    await expect(drawing).toHaveAttribute('aria-checked', 'true');
    await drawing.click();
    await expect(drawing).toHaveAttribute('aria-checked', 'false');
    expect(await page.evaluate(() => localStorage.getItem('survey:snap-content'))).toBe('off');
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();

    const free = await drawNear(page, pageDiv, WALL_B);
    expect(near(free, [WALL_B.x1, WALL_B.y1, WALL_B.x2, WALL_B.y2], 0.5), `free ${free}`).toBe(false);
    expect(Math.abs(free[0] - WALL_B.x1)).toBeGreaterThan(0.5);
    expect(Math.abs(free[2] - WALL_B.x2)).toBeGreaterThan(0.5);
  } finally {
    await sheet.remove();
  }
});

test('flag off: the Snapping button is the plain toggle and Line ends do not snap to the PDF', async ({ page }) => {
  test.setTimeout(150_000);
  const { sheet, pageDiv } = await openSheet(page, '0');
  try {
    const button = page.locator('[data-snapping-toggle="true"]').filter({ visible: true });
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const free = await drawNear(page, pageDiv, WALL_A);
    expect(Math.abs(free[0] - WALL_A.x1)).toBeGreaterThan(0.5);
    expect(Math.abs(free[2] - WALL_A.x2)).toBeGreaterThan(0.5);
    await expect(page.locator('[data-snap-content]')).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});
