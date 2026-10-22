// A text box narrowed from its side rewraps its words; the box grows
// downward so no line is cut off (Drawboard). Alone and in a group.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

const PAGE = '[data-overlay-page="1"]';
const MARKS = `${PAGE} [data-annotation-id]`;
const FRAME = `${PAGE} [data-group-selection-bbox]`;
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);
// The text's own box (foreignObject) and whether its words overflow it.
const textBox = (page, id) => page.evaluate((markId) => {
  const fo = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"] foreignObject`);
  const div = fo?.querySelector('div');
  if (!fo || !div) return null;
  const r = fo.getBoundingClientRect();
  return { width: r.width, height: r.height, clipped: div.scrollHeight > div.clientHeight + 1 };
}, id);

async function newMarkId(page, before) {
  await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  const id = (await markIds(page)).find((m) => !before.has(m));
  before.add(id);
  return id;
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
}

async function selectTool(page) {
  await page.mouse.click(5, 450);
  await page.keyboard.press('v');
  await expect(page.locator('[data-annotation-presentation="svg-edit"]').first()).toBeVisible();
}

test('a text box narrowed from its side grows to fit, alone and in a group', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  const at = (fx, fy) => ({ x: pageBox.x + pageBox.width * fx, y: pageBox.y + pageBox.height * fy });

  const before = new Set(await markIds(page));
  await page.keyboard.press('t');
  await page.mouse.click(at(0.2, 0.78).x, at(0.2, 0.78).y);
  await page.keyboard.type('Fire door needs a new closer');
  await page.keyboard.press('Escape');
  const textId = await newMarkId(page, before);
  await page.keyboard.press('r');
  await drag(page, at(0.2, 0.86), at(0.3, 0.92));
  await page.keyboard.press('Escape');
  const rectId = await newMarkId(page, before);
  await page.waitForTimeout(1200);

  // Alone: select the text, pull its right side in to a third.
  await selectTool(page);
  const start = await textBox(page, textId);
  expect(start.clipped).toBe(false);
  const textRect = await page.locator(`${PAGE} [data-annotation-id="${textId}"] foreignObject`).boundingBox();
  await page.mouse.click(textRect.x + textRect.width / 2, textRect.y + textRect.height / 2);
  const mr = await page.locator(`${PAGE} [data-resize-handle="mr"]`).first().boundingBox();
  const grab = { x: mr.x + mr.width / 2, y: mr.y + mr.height / 2 };
  await drag(page, grab, { x: grab.x - start.width * 0.6, y: grab.y });
  await page.waitForTimeout(600);
  const narrowed = await textBox(page, textId);
  expect(narrowed.width).toBeLessThan(start.width * 0.6);
  expect(narrowed.height, `height ${start.height} -> ${narrowed.height}`).toBeGreaterThan(start.height * 1.5);
  expect(narrowed.clipped, 'no line cut off').toBe(false);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.round((await textBox(page, textId)).height)).toBe(Math.round(start.height));

  // In a group: marquee text + rect, pull the frame's right side in.
  await page.mouse.click(at(0.9, 0.97).x, at(0.9, 0.97).y);
  await drag(page, at(0.12, 0.72), at(0.8, 0.96));
  await expect(page.locator(`${FRAME} [data-resize-handle]`)).toHaveCount(8);
  const frame = await page.locator(`${FRAME} [data-group-selection-hitbox]`).boundingBox();
  const gmr = await page.locator(`${FRAME} [data-resize-handle="mr"]`).boundingBox();
  const ggrab = { x: gmr.x + gmr.width / 2, y: gmr.y + gmr.height / 2 };
  await drag(page, ggrab, { x: ggrab.x - frame.width * 0.6, y: ggrab.y });
  await page.waitForTimeout(600);
  const grouped = await textBox(page, textId);
  expect(grouped.width).toBeLessThan(start.width * 0.6);
  expect(grouped.height, `group height ${start.height} -> ${grouped.height}`).toBeGreaterThan(start.height * 1.5);
  expect(grouped.clipped, 'no line cut off in a group').toBe(false);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.round((await textBox(page, textId)).height)).toBe(Math.round(start.height));

  await page.keyboard.press('Control+Shift+z');
  await page.waitForTimeout(300);
  await page.keyboard.press('Delete');
  for (const id of [textId, rectId]) await expect(page.locator(`${PAGE} [data-annotation-id="${id}"]`)).toHaveCount(0);
  await page.waitForTimeout(2500);
});
