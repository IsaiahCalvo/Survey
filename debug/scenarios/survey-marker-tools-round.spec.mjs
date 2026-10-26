// Survey marker round (owner 2026-10-22): the new-marker card lists only the
// module in use (a Module button switches it) and recolours the marker as an
// entity is picked; a freehand tap places a dot; the freehand width is on the
// survey bar; Pan picks Survey Markers like any mark, and a picked marker
// brings up the survey bar (its width can change there). Mouse and pen.
import { test, expect } from '@playwright/test';

const templates = [{ id: 'work', name: 'Work Survey', entities: [
  { id: 'existing', name: 'Existing', color: '#2563eb' },
  { id: 'new', name: 'New', color: '#ef4444' },
], modules: [
  { id: 'module', name: 'Existing', categories: [{ id: 'walls', name: 'Walls', checklist: [] }, { id: 'floors', name: 'Floors', checklist: [] }] },
  { id: 'proposed', name: 'Proposed', categories: [{ id: 'doors', name: 'Doors', checklist: [] }] },
] }];

if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

async function openSurvey(page, context) {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await context.addInitScript((value) => {
    if (!localStorage.getItem('mobileWorkflowTemplates')) localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(value));
  }, templates);
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/?testPdf=text-search-glyph-lab.pdf&surveyTemplateWorkflowE2E=1');
  await page.getByRole('toolbar', { name: 'Survey panel', exact: true }).getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Work Survey.*2 modules/ }).click();
  const box = await page.locator('[data-svg-annotation-layer]').first().boundingBox();
  return box;
}

// A press / drag with the given pointer type (CDP sends real pen events).
async function press(page, pointerType, points) {
  if (pointerType === 'mouse') {
    await page.mouse.move(points[0].x, points[0].y);
    await page.mouse.down();
    for (const p of points.slice(1)) await page.mouse.move(p.x, p.y, { steps: 6 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const send = (type, { x, y }, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'pen',
  });
  await send('mouseMoved', points[0], 0);
  await send('mousePressed', points[0], 1);
  for (const p of points.slice(1)) await send('mouseMoved', p, 1);
  const last = points[points.length - 1];
  await send('mouseReleased', last, 0);
  await cdp.detach();
}

for (const pointerType of ['mouse', 'pen']) {
  test(`survey marker card, freehand dot and width, Pan pick (${pointerType})`, async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const box = await openSurvey(page, context);
    const at = (x, y) => ({ x: box.x + x, y: box.y + y });
    const card = page.getByRole('dialog', { name: 'New Survey Marker' });

    // 1. A box marker: the card lists only the module in use.
    await press(page, pointerType, [at(90, 100), at(140, 130), at(180, 160)]);
    await expect(card).toBeVisible();
    await expect(card.getByRole('option', { name: /Walls/ })).toBeVisible();
    await expect(card.getByRole('option', { name: /Doors/ })).toHaveCount(0);
    // An entity disc recolours the marker on the page at once.
    const boxMarker = page.locator('[data-survey-marker-id]').first();
    await card.getByRole('button', { name: 'Entity New' }).click();
    await expect(boxMarker.locator('rect').first()).toHaveAttribute('fill', /239, 68, 68/);
    // The Module button swaps in the module list; Escape only closes it.
    await card.getByRole('button', { name: /Change module/ }).click();
    await expect(card.getByRole('listbox', { name: 'Module' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(card).toBeVisible();
    await expect(card.getByRole('listbox', { name: 'Category' })).toBeVisible();
    await card.getByRole('button', { name: /Change module/ }).click();
    await card.getByRole('option', { name: 'Proposed' }).click();
    await expect(card.getByRole('option', { name: /Walls/ })).toHaveCount(0);
    await card.getByRole('option', { name: /Doors/ }).click();
    await expect(card).toBeHidden();

    // 2. Freehand: the width is on the survey bar; a tap places a dot.
    await page.locator('[data-marker-draw-mode="freehand"]').click();
    const width = page.getByRole('button', { name: 'Freehand marker width' });
    await expect(width).toBeVisible();
    await width.click();
    await page.locator('[data-annotation-size-popover]').getByRole('option', { name: '24 pt', exact: true }).click();
    await expect(width).toHaveText(/24 pt/);
    await press(page, pointerType, [at(150, 430)]);
    await expect(card).toBeVisible();
    const dot = page.locator('[data-survey-marker-kind="stroke"]').last();
    await expect(dot.locator('[data-survey-marker-shape="stroke"]')).toHaveAttribute('stroke-width', '24');
    await card.getByRole('button', { name: /Change module/ }).click();
    await card.getByRole('option', { name: 'Existing' }).click();
    await card.getByRole('option', { name: /Floors/ }).click();
    await expect(card).toBeHidden();
    // A drag still draws a stroke.
    await press(page, pointerType, [at(100, 560), at(200, 570), at(300, 580)]);
    await expect(card).toBeVisible();
    await card.getByRole('option', { name: /Walls/ }).click();
    await expect(page.locator('[data-survey-marker-kind="stroke"]')).toHaveCount(2);

    // 3. Pan picks a Survey Marker; the survey bar comes up with it, with
    // the picked freehand marker's width.
    await page.getByRole('button', { name: 'Pan', exact: true }).click();
    await expect(page.locator('.survey-subrow')).toHaveCount(0);
    await press(page, pointerType, [at(150, 430)]);
    await expect(page.locator('.survey-subrow')).toHaveCount(1);
    await expect(width).toHaveText(/24 pt/);
    // A press on empty page drops the pick and the bar.
    await press(page, pointerType, [at(480, 660)]);
    await expect(page.locator('.survey-subrow')).toHaveCount(0);

    // 4. The picked freehand marker's width changes there; Undo puts it back.
    const stroke = page.locator('[data-survey-marker-kind="stroke"]').last();
    await press(page, pointerType, [at(200, 570)]);
    await expect(width).toHaveText(/24 pt/);
    await width.click();
    await page.locator('[data-annotation-size-popover]').getByRole('option', { name: '8 pt', exact: true }).click();
    await expect(stroke.locator('[data-survey-marker-shape="stroke"]')).toHaveAttribute('stroke-width', '8');
    await page.keyboard.press('Control+z');
    await expect(stroke.locator('[data-survey-marker-shape="stroke"]')).toHaveAttribute('stroke-width', '24');

    expect(errors).toEqual([]);
  });
}
