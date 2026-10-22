// Resize several marks at once (owner ask 2026-10-22). A multi-selection's
// frame shows eight resize grabbers; dragging one scales every mark in it,
// Drawboard style: text scales its font from a corner and the whole frame
// then keeps its proportions; one Undo puts every mark back. Mouse and pen
// drive the same grabber (a finger on the page pans, so it has no resize).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

const PAGE = '[data-overlay-page="1"]';
const MARKS = `${PAGE} [data-annotation-id]`;
const FRAME = `${PAGE} [data-group-selection-bbox]`;
const markIds = (page) => page.locator(MARKS).evaluateAll((nodes) => [...new Set(nodes.map((n) => n.getAttribute('data-annotation-id')))]);
const boxOf = (page, id) => page.evaluate((markId) => {
  const rects = [...document.querySelectorAll(`[data-overlay-page="1"] [data-annotation-id="${markId}"]`)]
    .map((n) => n.getBoundingClientRect()).filter((r) => r.width > 0 || r.height > 0);
  if (!rects.length) return null;
  const left = Math.min(...rects.map((r) => r.left));
  const top = Math.min(...rects.map((r) => r.top));
  return { left, top, width: Math.max(...rects.map((r) => r.right)) - left, height: Math.max(...rects.map((r) => r.bottom)) - top };
}, id);
const textFontSize = (page, id) => page.evaluate((markId) => {
  const node = document.querySelector(`[data-overlay-page="1"] [data-annotation-id="${markId}"] foreignObject div`);
  return node ? parseFloat(node.style.fontSize) : null;
}, id);

async function drawMark(page, key, from, to) {
  await page.keyboard.press(key);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

async function selectTool(page) {
  await page.mouse.click(5, 450); // off the page: nothing selected, no editor focused
  await page.keyboard.press('v');
  await expect(page.locator('[data-annotation-presentation="svg-edit"]').first()).toBeVisible();
}

async function newMarkId(page, before) {
  await expect.poll(async () => (await markIds(page)).filter((id) => !before.has(id)).length).toBe(1);
  const id = (await markIds(page)).find((m) => !before.has(m));
  before.add(id);
  return id;
}

async function dragWith(page, pointerType, from, to, { shift = false } = {}) {
  const cdp = await page.context().newCDPSession(page);
  const modifiers = shift ? 8 : 0;
  const send = (type, px, py, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x: px, y: py, button: 'left', buttons, clickCount: 1, modifiers, pointerType, force: pointerType === 'pen' ? 0.5 : 0,
  });
  await send('mouseMoved', from.x, from.y, 0);
  await send('mousePressed', from.x, from.y, 1);
  for (let i = 1; i <= 12; i += 1) {
    await send('mouseMoved', from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12, 1);
    await page.waitForTimeout(25);
  }
  await send('mouseReleased', to.x, to.y, 0);
  await cdp.detach();
}

for (const pointerType of ['mouse', 'pen']) {
  test(`a ${pointerType} drag on a multi-selection corner resizes every mark, and one Undo restores them`, async ({ page }) => {
    await signIn(page, E2E_ACCOUNTS.owner);
    await openSampleDocument(page);
    await page.waitForTimeout(1500);
    const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
    const at = (fx, fy) => ({ x: pageBox.x + pageBox.width * fx, y: pageBox.y + pageBox.height * fy });

    const before = new Set(await markIds(page));
    await drawMark(page, 'r', at(0.2, 0.62), at(0.3, 0.7));
    const rectId = await newMarkId(page, before);
    await drawMark(page, 'o', at(0.36, 0.62), at(0.46, 0.72));
    const ellipseId = await newMarkId(page, before);

    await page.keyboard.press('t');
    await page.mouse.click(at(0.22, 0.78).x, at(0.22, 0.78).y);
    await page.keyboard.type('Door 12');
    await page.keyboard.press('Escape');
    const textId = await newMarkId(page, before);
    await page.waitForTimeout(1200);

    // Marquee every new mark from empty page space.
    await selectTool(page);
    await page.mouse.move(at(0.14, 0.56).x, at(0.14, 0.56).y);
    await page.mouse.down();
    await page.mouse.move(at(0.6, 0.9).x, at(0.6, 0.9).y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(FRAME)).toHaveCount(1);
    const grabbers = page.locator(`${FRAME} [data-resize-handle]`);
    await expect(grabbers).toHaveCount(8);
    await expect(page.locator(`${FRAME} [data-rotation-handle]`)).toHaveCount(0);

    const start = {
      rect: await boxOf(page, rectId),
      ellipse: await boxOf(page, ellipseId),
      text: await boxOf(page, textId),
      font: await textFontSize(page, textId),
    };
    expect(start.font).toBeGreaterThan(0);

    const br = await page.locator(`${FRAME} [data-resize-handle="br"]`).boundingBox();
    const frame = await page.locator(`${FRAME} [data-group-selection-hitbox]`).boundingBox();
    const grab = { x: br.x + br.width / 2, y: br.y + br.height / 2 };
    // Drag the corner by half the frame's width (only along x: text in the
    // selection keeps the proportions, so the frame grows 1.5x both ways).
    await dragWith(page, pointerType, grab, { x: grab.x + frame.width * 0.5, y: grab.y });
    await page.waitForTimeout(500);

    const after = {
      rect: await boxOf(page, rectId),
      ellipse: await boxOf(page, ellipseId),
      text: await boxOf(page, textId),
      font: await textFontSize(page, textId),
    };
    const near = (a, b, tol = 0.06) => Math.abs(a - b) <= Math.abs(b) * tol + 2;
    expect(near(after.rect.width, start.rect.width * 1.5), `rect width ${start.rect.width} -> ${after.rect.width}`).toBe(true);
    expect(near(after.rect.height, start.rect.height * 1.5), `rect height ${start.rect.height} -> ${after.rect.height}`).toBe(true);
    expect(near(after.ellipse.width, start.ellipse.width * 1.5)).toBe(true);
    expect(near(after.font, start.font * 1.5, 0.03), `font ${start.font} -> ${after.font}`).toBe(true);
    // The fixed corner (top-left of the frame) stays put.
    expect(near(after.rect.left, start.rect.left, 0.01)).toBe(true);
    expect(near(after.rect.top, start.rect.top, 0.01)).toBe(true);
    // The marks spread apart with the frame.
    expect(after.ellipse.left - after.rect.left).toBeGreaterThan((start.ellipse.left - start.rect.left) * 1.4);

    // One Undo puts every mark back.
    await page.keyboard.press('Control+z');
    await expect.poll(async () => Math.round((await boxOf(page, rectId)).width)).toBe(Math.round(start.rect.width));
    expect(near((await boxOf(page, ellipseId)).width, start.ellipse.width, 0.01)).toBe(true);
    expect(await textFontSize(page, textId)).toBe(start.font);

    // Clean up.
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    await page.keyboard.press('Delete');
    for (const id of [rectId, ellipseId, textId]) {
      await expect(page.locator(`${PAGE} [data-annotation-id="${id}"]`)).toHaveCount(0);
    }
    await page.waitForTimeout(2500);
  });
}

test('an edge stretches shapes on one axis; Shift keeps the proportions', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  const at = (fx, fy) => ({ x: pageBox.x + pageBox.width * fx, y: pageBox.y + pageBox.height * fy });

  const before = new Set(await markIds(page));
  await drawMark(page, 'r', at(0.2, 0.62), at(0.3, 0.7));
  const a = await newMarkId(page, before);
  await drawMark(page, 'r', at(0.36, 0.62), at(0.44, 0.74));
  const b = await newMarkId(page, before);
  await page.waitForTimeout(1200);

  await selectTool(page);
  await page.mouse.move(at(0.14, 0.56).x, at(0.14, 0.56).y);
  await page.mouse.down();
  await page.mouse.move(at(0.6, 0.86).x, at(0.6, 0.86).y, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator(`${FRAME} [data-resize-handle]`)).toHaveCount(8);

  const startA = await boxOf(page, a);
  const startB = await boxOf(page, b);
  const frame = await page.locator(`${FRAME} [data-group-selection-hitbox]`).boundingBox();
  const mr = await page.locator(`${FRAME} [data-resize-handle="mr"]`).boundingBox();
  const grab = { x: mr.x + mr.width / 2, y: mr.y + mr.height / 2 };
  await dragWith(page, 'mouse', grab, { x: grab.x + frame.width, y: grab.y });
  await page.waitForTimeout(500);
  const midA = await boxOf(page, a);
  const near = (x, y, tol = 0.06) => Math.abs(x - y) <= Math.abs(y) * tol + 2;
  expect(near(midA.width, startA.width * 2), `edge doubles width ${startA.width} -> ${midA.width}`).toBe(true);
  expect(near(midA.height, startA.height), 'edge keeps height').toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.round((await boxOf(page, a)).width)).toBe(Math.round(startA.width));

  // Shift on the corner: both axes follow the bigger move.
  const br = await page.locator(`${FRAME} [data-resize-handle="br"]`).boundingBox();
  const grab2 = { x: br.x + br.width / 2, y: br.y + br.height / 2 };
  await dragWith(page, 'mouse', grab2, { x: grab2.x + frame.width * 0.5, y: grab2.y + 4 }, { shift: true });
  await page.waitForTimeout(500);
  const endB = await boxOf(page, b);
  expect(near(endB.width / startB.width, endB.height / startB.height, 0.05), 'proportions kept').toBe(true);
  expect(endB.width / startB.width).toBeGreaterThan(1.35);

  await page.keyboard.press('Delete');
  for (const id of [a, b]) await expect(page.locator(`${PAGE} [data-annotation-id="${id}"]`)).toHaveCount(0);
  await page.waitForTimeout(2500);
});

// A mark turned a right angle stretches along the page's axis (its own axes
// swap); a mark tilted any other way would shear, so the frame keeps its
// proportions instead (tldraw's rule).
async function rotateSelected(page, id, degrees, blank) {
  await page.mouse.click(blank.x, blank.y); // empty page: drop the selection
  const box = await boxOf(page, id);
  const centre = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  await page.mouse.click(centre.x, box.top + 1); // a hollow rect takes a click on its border
  const handle = await page.locator(`${PAGE} [data-rotation-handle="mtr"]`).first().boundingBox();
  const grab = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
  const r = Math.hypot(grab.x - centre.x, grab.y - centre.y);
  const a = (-90 + degrees) * (Math.PI / 180);
  await dragWith(page, 'mouse', grab, { x: centre.x + r * Math.cos(a), y: centre.y + r * Math.sin(a) });
  await page.waitForTimeout(400);
  await page.mouse.click(blank.x, blank.y);
}

test('a sideways mark stretches along the page; a tilted one keeps the frame square', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);
  await page.waitForTimeout(1500);
  const pageBox = await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').boundingBox();
  const at = (fx, fy) => ({ x: pageBox.x + pageBox.width * fx, y: pageBox.y + pageBox.height * fy });
  const near = (x, y, tol = 0.06) => Math.abs(x - y) <= Math.abs(y) * tol + 2;

  const before = new Set(await markIds(page));
  await drawMark(page, 'r', at(0.12, 0.8), at(0.26, 0.84));
  const wide = await newMarkId(page, before);
  await drawMark(page, 'r', at(0.4, 0.8), at(0.46, 0.88));
  const other = await newMarkId(page, before);
  await page.waitForTimeout(1200);

  await selectTool(page);
  await rotateSelected(page, wide, 90, at(0.9, 0.97));
  const turned = await boxOf(page, wide);
  expect(turned.height, 'turned sideways').toBeGreaterThan(turned.width * 2);

  const marquee = async () => {
    await page.mouse.click(at(0.9, 0.97).x, at(0.9, 0.97).y);
    await page.mouse.move(at(0.04, 0.74).x, at(0.04, 0.74).y);
    await page.mouse.down();
    await page.mouse.move(at(0.6, 0.97).x, at(0.6, 0.97).y, { steps: 8 });
    await page.mouse.up();
    await expect(page.locator(`${FRAME} [data-resize-handle]`)).toHaveCount(8);
  };
  await marquee();
  let frame = await page.locator(`${FRAME} [data-group-selection-hitbox]`).boundingBox();
  let mr = await page.locator(`${FRAME} [data-resize-handle="mr"]`).boundingBox();
  let grab = { x: mr.x + mr.width / 2, y: mr.y + mr.height / 2 };
  await dragWith(page, 'mouse', grab, { x: grab.x + frame.width * 0.5, y: grab.y });
  await page.waitForTimeout(500);
  const stretched = await boxOf(page, wide);
  expect(near(stretched.width, turned.width * 1.5), `sideways width ${turned.width} -> ${stretched.width}`).toBe(true);
  expect(near(stretched.height, turned.height), `sideways height ${turned.height} -> ${stretched.height}`).toBe(true);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => Math.round((await boxOf(page, wide)).width)).toBe(Math.round(turned.width));

  // Tilt it 30° more: now an edge drag scales both axes alike.
  await rotateSelected(page, wide, 30, at(0.9, 0.97));
  const tilted = await boxOf(page, wide);
  const otherStart = await boxOf(page, other);
  await marquee();
  frame = await page.locator(`${FRAME} [data-group-selection-hitbox]`).boundingBox();
  mr = await page.locator(`${FRAME} [data-resize-handle="mr"]`).boundingBox();
  grab = { x: mr.x + mr.width / 2, y: mr.y + mr.height / 2 };
  await dragWith(page, 'mouse', grab, { x: grab.x + frame.width * 0.5, y: grab.y });
  await page.waitForTimeout(500);
  const otherEnd = await boxOf(page, other);
  const tiltedEnd = await boxOf(page, wide);
  expect(near(otherEnd.width / otherStart.width, otherEnd.height / otherStart.height, 0.05), 'frame kept its proportions').toBe(true);
  expect(otherEnd.width / otherStart.width).toBeGreaterThan(1.35);
  expect(near(tiltedEnd.width / tilted.width, tiltedEnd.height / tilted.height, 0.05), 'tilted mark not sheared').toBe(true);

  await page.keyboard.press('Delete');
  for (const id of [wide, other]) await expect(page.locator(`${PAGE} [data-annotation-id="${id}"]`)).toHaveCount(0);
  await page.waitForTimeout(2500);
});
