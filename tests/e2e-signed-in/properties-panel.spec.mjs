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

test('Selected colors: a swatch recolours every use of that colour in the pick, one Undo step', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, pageDiv, marks } = await open(page, 'Props panel recolour', true);
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
    const swatches = panel(page).locator('[data-props-colour]');
    await expect(swatches.first()).toBeVisible();
    const from = await swatches.first().getAttribute('data-props-colour');
    const strokes = () => marks.evaluateAll((els) => els.map((g) => {
      const shape = g.querySelector('rect, path, polygon, ellipse');
      return (shape?.getAttribute('stroke') || '').toLowerCase();
    }));
    expect(await strokes()).toEqual([from.toLowerCase(), from.toLowerCase()]);
    await swatches.first().click();
    const row = panel(page).locator(`[data-props-recolour]`);
    await expect(row).toBeVisible();
    const presets = row.locator('[data-quick-colour-preset]');
    const all = await presets.evaluateAll((els) => els.map((el) => el.getAttribute('data-quick-colour-preset')));
    const to = all.find((c) => c.toLowerCase() !== from.toLowerCase());
    await row.locator(`[data-quick-colour-preset="${to}"]`).click();
    await expect(row).toHaveCount(0);
    await expect.poll(strokes).toEqual([to.toLowerCase(), to.toLowerCase()]);
    await expect(panel(page).locator(`[data-props-colour="${to}"]`)).toBeVisible();
    // One Undo puts both back.
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect.poll(strokes).toEqual([from.toLowerCase(), from.toLowerCase()]);
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

// Nightly 'turn-scale-keys' (Drawboard Projects KS-01 / KS-02), read back
// through the panel's R and W boxes. Desktop only: the keys need a keyboard.
test('Ctrl / Cmd + Left / Right turn the picked mark, Up / Down scale it, each one Undo step', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => localStorage.setItem('survey.flag.turn-scale-keys', '1'));
  const { sheet, pageDiv, marks } = await open(page, 'Turn keys', true);
  try {
    const box = await pageDiv.boundingBox();
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 150, 200, 120, 60);
    await expect(marks).toHaveCount(1);
    await marquee(page, box, [120, 170], [320, 300]);
    await page.locator('[data-selection-quick-expand]').click();
    await expect(field(page, 'R')).toHaveValue('0');
    const w0 = Number(await field(page, 'W').inputValue());

    for (let i = 0; i < 3; i += 1) await page.keyboard.press('ControlOrMeta+ArrowRight');
    await expect(field(page, 'R')).toHaveValue('3');
    await page.keyboard.press('ControlOrMeta+Shift+ArrowLeft');
    await expect(field(page, 'R')).toHaveValue('358');
    await page.keyboard.press('ControlOrMeta+ArrowUp');
    await expect.poll(async () => Number(await field(page, 'W').inputValue())).toBeCloseTo(w0 * 1.1, 0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect.poll(async () => Number(await field(page, 'W').inputValue())).toBeCloseTo(w0, 0);
    await expect(field(page, 'R')).toHaveValue('358');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(field(page, 'R')).toHaveValue('3');
  } finally {
    await sheet.remove();
  }
});

test('Text: a picked text box shows Color, Opacity and Size, and each one changes the words', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, pageDiv, marks } = await open(page, 'Props panel text', true);
  try {
    const box = await pageDiv.boundingBox();
    await page.waitForTimeout(800);
    await page.keyboard.press('t');
    await page.mouse.move(box.x + 120, box.y + 220);
    await page.mouse.down();
    await page.mouse.move(box.x + 360, box.y + 220, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.type('panel text', { delay: 20 });
    await page.keyboard.press('Escape');
    await expect(marks).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    const mark = marks.first();
    const mbox = await mark.boundingBox();
    await page.mouse.click(mbox.x + mbox.width / 2, mbox.y + mbox.height / 2);
    await page.locator('[data-selection-quick-expand]').click();
    const text = panel(page).locator('[data-props-section="text"]');
    await expect(text).toBeVisible();
    await expect(text.locator('[data-props-value="Size"]')).toHaveText('16 pt');
    const words = () => mark.evaluate((g) => {
      const t = g.querySelector('text, tspan, foreignObject div, foreignObject span');
      const cs = t ? getComputedStyle(t) : null;
      return { fill: (t?.getAttribute('fill') || cs?.color || '').toLowerCase(), size: t ? parseFloat(t.getAttribute('font-size') || cs.fontSize) : null };
    });
    const before = await words();
    // Color: a preset dot.
    const dots = text.locator('[data-props-text-colour] [data-quick-colour-preset]');
    const all = await dots.evaluateAll((els) => els.map((el) => el.getAttribute('data-quick-colour-preset')));
    const to = all.find((c) => !before.fill.includes(c.toLowerCase())) || all[0];
    await text.locator(`[data-props-text-colour] [data-quick-colour-preset="${to}"]`).click();
    await expect.poll(async () => (await words()).fill).not.toBe(before.fill);
    // Size: the slider, from the keyboard (one step up, saved on key up).
    const size = text.getByRole('slider', { name: 'Size' });
    await size.focus();
    await page.keyboard.press('ArrowRight');
    await expect(text.locator('[data-props-value="Size"]')).toHaveText('17 pt');
    await expect.poll(async () => (await words()).size).toBeGreaterThan(before.size);
    // Opacity: down a step keeps the colour and lowers its strength.
    const opacity = text.getByRole('slider', { name: 'Text opacity' });
    await opacity.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(text.locator('[data-props-value="Text opacity"]')).toHaveText('99%');
  } finally {
    await sheet.remove();
  }
});

test('Pin to side panel docks the panel beside the page, keeps it with nothing picked and across a reload; unpin floats it again', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, pageDiv, marks } = await open(page, 'Props panel pin', true);
  try {
    const box = await pageDiv.boundingBox();
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 150, 200, 80, 40);
    await expect(marks).toHaveCount(1);
    await page.locator('[data-selection-quick-expand]').click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Collapse menu' })).toBeVisible();
    const viewer = page.locator('#chrome-right-host');
    const railBefore = await viewer.boundingBox();
    const before = await pageDiv.boundingBox();
    await panel(page).locator('[data-props-pin]').click();
    const dock = page.locator('[data-properties-dock]');
    await expect(dock.locator('[data-properties-panel]')).toBeVisible();
    await expect(panel(page).locator('[data-props-pin]')).toHaveAttribute('aria-pressed', 'true');
    await expect(panel(page).getByRole('button', { name: 'Collapse menu' })).toHaveCount(0);
    const dockBox = await dock.boundingBox();
    expect(Math.round(dockBox.width)).toBe(260);
    // The dock sits left of the right rail, full height, and the page moves left.
    expect(Math.round(dockBox.x + dockBox.width)).toBe(Math.round(railBefore.x));
    await expect.poll(async () => (await pageDiv.boundingBox()).x).toBeLessThan(before.x - 60);
    await expect(panel(page).locator('[data-props-section="transform"]')).toBeVisible();
    // Nothing picked: it stays, titled "Select".
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(panel(page).locator('[data-props-count]')).toHaveText('Select');
    await expect(panel(page).locator('[data-props-empty]')).toBeVisible();
    // A reload keeps it pinned.
    await page.reload();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await expect(dock.locator('[data-properties-panel]')).toBeVisible();
    // Unpin with a mark picked (no floating frame yet after the reload): the
    // panel floats at once (Bugbot on #1387). Unpinned with nothing picked, it goes.
    await page.keyboard.press('v');
    const mbox = await marks.first().boundingBox();
    await page.mouse.click(mbox.x + mbox.width / 2, mbox.y + 1);
    await expect(panel(page).locator('[data-props-section="transform"]')).toBeVisible();
    await panel(page).locator('[data-props-pin]').click();
    await expect(dock).toHaveCount(0);
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).not.toHaveAttribute('data-properties-panel-docked', 'true');
    await panel(page).getByRole('button', { name: 'Collapse menu' }).click();
    await expect(panel(page)).toHaveCount(0);
    await expect.poll(async () => Math.abs((await pageDiv.boundingBox()).x - before.x)).toBeLessThan(4);
  } finally {
    await sheet.remove();
  }
});

test('Fill: "none", white and the presets set the picked shape\'s fill; a colour on no fill comes in at full strength', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, pageDiv, marks } = await open(page, 'Props panel fill', true);
  try {
    const box = await pageDiv.boundingBox();
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 150, 200, 80, 40);
    await expect(marks).toHaveCount(1);
    await page.locator('[data-selection-quick-expand]').click();
    const fill = panel(page).locator('[data-props-section="fill"]');
    const row = fill.locator('[data-props-fill-colour]');
    await expect(row).toBeVisible();
    const paintOf = () => marks.first().evaluate((g) => {
      const shape = g.querySelector('rect, path, polygon');
      return { fill: (shape?.getAttribute('fill') || '').toLowerCase(), opacity: Number(shape?.getAttribute('fill-opacity') ?? 1) };
    });
    await expect(fill.locator('[data-props-value="Fill opacity"]')).toHaveText('0%');
    await expect(row.locator('[data-props-fill-none]')).toHaveAttribute('aria-pressed', 'true');
    await row.locator('[data-quick-colour-preset="#0000FF"]').click();
    await expect(fill.locator('[data-props-value="Fill opacity"]')).toHaveText('100%');
    await expect.poll(async () => (await paintOf()).fill).toMatch(/#0000ff|rgba?\(0, 0, 255(, 1)?\)/);
    await row.locator('[data-quick-colour-preset="#FFFFFF"]').click();
    await expect.poll(async () => (await paintOf()).fill).toMatch(/#ffffff|white|rgba?\(255, 255, 255(, 1)?\)/);
    await row.locator('[data-props-fill-none]').click();
    await expect(fill.locator('[data-props-value="Fill opacity"]')).toHaveText('0%');
    await expect(row.locator('[data-props-fill-none]')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await sheet.remove();
  }
});
