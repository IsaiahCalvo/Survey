// Nightly 'properties-panel' (Drawboard PDF's "Expand menu", checked live
// 2026-11-10): a card on the right with typed X Y W H R for the picked marks,
// plus their stroke, border and fill. Desktop only.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function open(page, label, flagOn) {
  await page.addInitScript((on) => {
    if (on) localStorage.setItem('survey.flag.properties-panel', '1');
    else localStorage.removeItem('survey.flag.properties-panel');
    localStorage.removeItem('survey.propertiesPanel.open');
  }, flagOn);
  const sheet = await seedSheet(label);
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  return { sheet, pageDiv, marks: pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]') };
}

async function drawRect(page, box, x, y, w, h) {
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + w / 2, box.y + y + h / 2, { steps: 4 });
  await page.mouse.move(box.x + x + w, box.y + y + h, { steps: 4 });
  await page.mouse.up();
}

async function marquee(page, box, from, to) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Rectangle Select', exact: true }).filter({ visible: true }).first().click();
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 6 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
}

const panel = (page) => page.locator('[data-properties-panel]');
const field = (page, name) => panel(page).locator(`input[data-props-field="${name}"]`);

async function typeInto(page, name, value) {
  const input = field(page, name);
  await input.click();
  await input.fill(String(value));
  await input.press('Enter');
}

test('Expand menu opens the panel; typed X, W and R move, size and turn the rectangle; Undo steps back; Collapse closes it', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, pageDiv, marks } = await open(page, 'Props panel', true);
  try {
    const box = await pageDiv.boundingBox();
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 150, 200, 120, 60);
    await expect(marks).toHaveCount(1);
    await marquee(page, box, [120, 170], [320, 300]);

    const expand = page.locator('[data-selection-quick-expand]');
    await expect(expand).toBeVisible();
    await expand.click();
    await expect(panel(page)).toBeVisible();
    await expect(expand).toHaveCount(0);
    await expect(panel(page).locator('[data-props-count]')).toHaveText('1 annotation selected');
    await expect(panel(page).locator('[data-props-kind]')).toHaveText('Rectangle');
    await expect(panel(page).getByText('You', { exact: false }).first()).toBeVisible();
    // The bar's style buttons moved into the panel.
    await expect(page.locator('[data-selection-quick-line]')).toHaveCount(0);
    await expect(panel(page).locator('[data-props-section="stroke"]')).toBeVisible();
    await expect(panel(page).locator('[data-props-section="border"]')).toBeVisible();

    const rectBox = () => marks.first().evaluate((g) => {
      const b = g.getBBox();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
    });
    const start = await rectBox();

    await typeInto(page, 'X', 100);
    await expect.poll(async () => (await rectBox()).x).toBeLessThan(start.x - 5);
    await expect(field(page, 'X')).toHaveValue('100');
    await expect(field(page, 'Y')).not.toHaveValue('');
    // Enter hands focus back to the page.
    expect(await page.evaluate(() => document.activeElement?.dataset?.propsField || null)).toBeNull();

    await typeInto(page, 'W', 200);
    await expect(field(page, 'W')).toHaveValue('200');
    await expect.poll(async () => (await rectBox()).w).toBeGreaterThan(start.w + 50);

    // Up steps 1 and applies at once.
    const hBefore = Number(await field(page, 'H').inputValue());
    await field(page, 'H').click();
    await field(page, 'H').press('ArrowUp');
    await expect(field(page, 'H')).toHaveValue(String(Math.round((hBefore + 1) * 100) / 100));
    await field(page, 'H').press('Enter');

    await typeInto(page, 'R', 400);
    await expect(field(page, 'R')).toHaveValue('40');
    await expect.poll(() => marks.first().evaluate((g) => g.outerHTML.includes('rotate('))).toBe(true);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(field(page, 'R')).toHaveValue('0');

    await panel(page).getByRole('button', { name: 'Collapse menu' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.locator('[data-selection-quick-expand]')).toBeVisible();
  } finally {
    await sheet.remove();
  }
});

test('two marks: the group box, R reads their shared turn and only X and Y can be typed; it stays open across picks', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, pageDiv, marks } = await open(page, 'Props panel two', true);
  try {
    const box = await pageDiv.boundingBox();
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 150, 200, 80, 40);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 300, 260, 60, 50);
    await expect(marks).toHaveCount(2);
    await marquee(page, box, [120, 170], [400, 340]);
    await page.locator('[data-selection-quick-expand]').click();
    await expect(panel(page).locator('[data-props-count]')).toHaveText('2 annotations selected');
    await expect(field(page, 'W')).toBeDisabled();
    await expect(field(page, 'R')).toBeDisabled();
    const x0 = Number(await field(page, 'X').inputValue());
    await typeInto(page, 'X', Math.round(x0 + 30));
    await expect(field(page, 'X')).toHaveValue(String(Math.round(x0 + 30)));
    // A fresh pick: the panel is back with the new pick.
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await marquee(page, box, [120, 170], [260, 260]);
    await expect(panel(page).locator('[data-props-count]')).toHaveText('1 annotation selected');
  } finally {
    await sheet.remove();
  }
});

test('without the flag there is no Expand menu', async ({ page }) => {
  test.setTimeout(120_000);
  const { sheet, pageDiv, marks } = await open(page, 'Props panel off', false);
  try {
    const box = await pageDiv.boundingBox();
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 150, 200, 120, 60);
    await expect(marks).toHaveCount(1);
    await marquee(page, box, [120, 170], [320, 300]);
    await expect(page.locator('[data-selection-quick-bar][data-visible="true"]')).toBeVisible();
    await expect(page.locator('[data-selection-quick-expand]')).toHaveCount(0);
    await expect(panel(page)).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});
