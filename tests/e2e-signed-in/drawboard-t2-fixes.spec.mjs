// Drawboard PDF Pro trial bugs (t2-tools-deep.md, 2026-11-10): Ctrl+D keeps
// the copy on the page, an arrow's head stops at the page edge, a callout
// made at the edge stays on the page, and dragging it or a box select across
// it leaves no highlighted words. Behind Nightly flags: a text box widened
// from its side fits its words both ways ('text-fit-height'), and with a mark
// picked Polyline's first click is a point ('poly-click-starts').
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function open(page, label, flags = []) {
  await page.addInitScript((keys) => {
    for (const key of ['text-fit-height', 'poly-click-starts']) localStorage.removeItem(`survey.flag.${key}`);
    for (const key of keys) localStorage.setItem(`survey.flag.${key}`, '1');
  }, flags);
  const sheet = await seedSheet(label);
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  return { sheet, pageDiv, box: await pageDiv.boundingBox(), marks: pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]') };
}

async function drag(page, box, x, y, x2, y2) {
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + (x + x2) / 2, box.y + (y + y2) / 2, { steps: 4 });
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 4 });
  await page.mouse.up();
}

async function slowDrag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 16; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / 16, from.y + ((to.y - from.y) * i) / 16);
    await page.waitForTimeout(20);
  }
  await page.mouse.up();
}

// Each mark's box in page units (the layer's viewBox is the page: 612 x 792).
const pageBoxes = (marks) => marks.evaluateAll((els) => els.map((g) => {
  const b = g.getBBox();
  return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
}));

test('Ctrl+D in the corner, an arrow past the edge and a callout at the edge all stay on the page; a callout drag leaves no highlight', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, box, marks } = await open(page, 'T2 edges');
  try {
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drag(page, box, box.width - 60, box.height - 40, box.width - 4, box.height - 4);
    await expect(marks).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Rectangle Select', exact: true }).filter({ visible: true }).first().click();
    await drag(page, box, box.width - 80, box.height - 60, box.width - 1, box.height - 1);
    await page.keyboard.press('ControlOrMeta+d');
    await expect(marks).toHaveCount(2);
    const [rect, copy] = await pageBoxes(marks);
    expect(copy.right).toBeLessThanOrEqual(612.5);
    expect(copy.bottom).toBeLessThanOrEqual(792.5);
    // It still steps 16 pt away (up and left, where there is room).
    expect(Math.round(rect.left - copy.left)).toBe(16);
    expect(Math.round(rect.top - copy.top)).toBe(16);

    await page.keyboard.press('Escape');
    await page.keyboard.press('a');
    await drag(page, box, box.width / 2, 300, box.width + 40, 300);
    await expect(marks).toHaveCount(3);
    const arrow = (await pageBoxes(marks))[2];
    expect(arrow.right).toBeLessThanOrEqual(612.5);
    expect(arrow.right).toBeGreaterThan(605);

    await page.keyboard.press('Escape');
    await page.keyboard.press('q');
    await expect(page.locator('[aria-label="Callout"][aria-pressed="true"], .is-active[aria-label="Callout"]').first()).toBeVisible();
    await drag(page, box, 300, 450, box.width - 5, 400);
    await expect.poll(() => page.evaluate(() => document.activeElement?.isContentEditable === true)).toBe(true);
    const editor = await page.evaluate(() => document.activeElement.getBoundingClientRect().right);
    expect(editor).toBeLessThanOrEqual(box.x + box.width + 1);
    await page.keyboard.type('hi there');
    await page.keyboard.press('Escape');
    const words = page.locator('[data-svg-annotation-layer="1"] foreignObject').filter({ hasText: 'hi there' }).last();
    await expect(words).toBeVisible();
    const wb = await words.boundingBox();
    expect(wb.x + wb.width).toBeLessThanOrEqual(box.x + box.width + 1);

    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    const at = { x: wb.x + wb.width / 2, y: wb.y + wb.height / 2 };
    await page.mouse.click(at.x, at.y);
    await slowDrag(page, at, { x: at.x - 150, y: at.y + 80 });
    await expect.poll(async () => Math.round((await words.boundingBox()).x)).toBeLessThan(Math.round(wb.x) - 100);
    expect(await page.evaluate(() => String(window.getSelection()))).toBe('');
    // A box select dragged across the callout picks it without highlighting
    // its words (it did: "hi there" stayed selected).
    await page.mouse.click(box.x + 300, box.y + 700);
    const moved = await words.boundingBox();
    await slowDrag(page, { x: moved.x - 60, y: moved.y - 30 }, { x: moved.x + moved.width + 20, y: moved.y + moved.height + 20 });
    expect(await page.evaluate(() => String(window.getSelection()))).toBe('');
  } finally {
    await sheet.remove();
  }
});

async function narrowThenWiden(page, box, marks) {
  await page.keyboard.press('t');
  await drag(page, box, 100, 200, 300, 200);
  await page.keyboard.type('please confirm the valve position');
  await page.keyboard.press('Escape');
  await expect(marks).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('v');
  const start = await marks.first().boundingBox();
  await page.mouse.click(start.x + start.width / 2, start.y + start.height / 2);
  const side = async () => {
    const h = await page.locator('[data-resize-handle="mr"]:not([data-handle-hit-pad])').first().boundingBox();
    return { x: h.x + h.width / 2, y: h.y + h.height / 2 };
  };
  const mr = await side();
  await slowDrag(page, mr, { x: start.x + 70, y: mr.y });
  await page.waitForTimeout(600);
  const narrow = await marks.first().boundingBox();
  const mr2 = await side();
  await slowDrag(page, mr2, { x: start.x + 420, y: mr2.y });
  await page.waitForTimeout(600);
  const wide = await marks.first().boundingBox();
  return { start, narrow, wide };
}

test('text-fit-height: a text box narrowed then widened comes back down; without the flag it stays tall', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, box, marks } = await open(page, 'T2 fit on', ['text-fit-height']);
  try {
    const { start, narrow, wide } = await narrowThenWiden(page, box, marks);
    expect(narrow.height).toBeGreaterThan(start.height * 1.5);
    expect(wide.height).toBeLessThan(start.height + 4);
  } finally {
    await sheet.remove();
  }
});

test('without text-fit-height the box only grows', async ({ page }) => {
  test.setTimeout(180_000);
  const { sheet, box, marks } = await open(page, 'T2 fit off');
  try {
    const { start, narrow, wide } = await narrowThenWiden(page, box, marks);
    expect(narrow.height).toBeGreaterThan(start.height * 1.5);
    expect(Math.abs(wide.height - narrow.height)).toBeLessThan(2);
  } finally {
    await sheet.remove();
  }
});

async function twoPolylines(page, box, marks) {
  await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  await page.getByRole('button', { name: 'Polyline', exact: true }).filter({ visible: true }).first().click();
  for (const [x, y] of [[100, 300], [150, 350], [200, 300]]) await page.mouse.click(box.x + x, box.y + y);
  await page.keyboard.press('Enter');
  await expect(marks).toHaveCount(1);
  for (const [x, y] of [[100, 450], [150, 500], [200, 450]]) await page.mouse.click(box.x + x, box.y + y);
  await page.keyboard.press('Enter');
  await expect(marks).toHaveCount(2);
  const second = await marks.nth(1).boundingBox();
  return second.x - box.x;
}

test('poly-click-starts: the first click after a finished polyline is its first point; without the flag it only drops the pick', async ({ page }) => {
  test.setTimeout(180_000);
  const on = await open(page, 'T2 poly on', ['poly-click-starts']);
  try {
    expect(Math.abs((await twoPolylines(page, on.box, on.marks)) - 100)).toBeLessThan(6);
  } finally {
    await on.sheet.remove();
  }
});

test('without poly-click-starts the second polyline starts at the second click', async ({ page }) => {
  test.setTimeout(180_000);
  const off = await open(page, 'T2 poly off');
  try {
    expect(Math.abs((await twoPolylines(page, off.box, off.marks)) - 150)).toBeLessThan(6);
  } finally {
    await off.sheet.remove();
  }
});
