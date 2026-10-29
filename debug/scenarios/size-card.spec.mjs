// Width / Size card (owner 2026-10-22: the old 12-row width list "looks like
// shit"; keep the dropdown and the typed number). Owner 2026-10-28 ("a little
// simpler"): the card is the typed number and the quick picks, no sample or
// slider. Mouse and pen.
import { test, expect } from '@playwright/test';

if (process.env.PW_CHROMIUM_PATH) test.use({ launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } });

async function slide(page, pointerType, from, to) {
  if (pointerType === 'mouse') {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  const send = (type, { x, y }, buttons) => cdp.send('Input.dispatchMouseEvent', {
    type, x, y, button: 'left', buttons, clickCount: 1, pointerType: 'pen',
  });
  await send('mouseMoved', from, 0);
  await send('mousePressed', from, 1);
  for (let i = 1; i <= 8; i += 1) {
    await send('mouseMoved', { x: from.x + ((to.x - from.x) * i) / 8, y: from.y + ((to.y - from.y) * i) / 8 }, 1);
  }
  await send('mouseReleased', to, 0);
  await cdp.detach();
}

for (const pointerType of ['mouse', 'pen']) {
  test(`width card: picks, typed number, drawing (${pointerType})`, async ({ page, context }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto('/?testPdf=text-search-glyph-lab.pdf&surveyTemplateWorkflowE2E=1');
    await expect(page.locator('[data-svg-annotation-layer]').first()).toBeVisible({ timeout: 60_000 });
    if (await page.getByRole('button', { name: 'Pen', exact: true }).count() === 0) {
      await page.getByRole('button', { name: 'Draw', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Pen', exact: true }).click();

    const pill = page.getByRole('button', { name: /^Width: / });
    const card = page.locator('[data-annotation-size-popover]');
    await pill.click();
    // No paper sample and no slider - the number and the picks.
    await expect(card.locator('[data-size-card-sample], input[type="range"]')).toHaveCount(0);
    await card.getByRole('option', { name: '32 pt', exact: true }).click();
    await expect(card).toBeHidden();
    await expect(pill).toHaveAttribute('aria-label', 'Width: 32 pt');

    // The typed number is in the card.
    await pill.click();
    const field = card.getByRole('textbox', { name: 'Width' });
    await field.fill('7');
    await field.press('Enter');
    await expect(pill).toHaveAttribute('aria-label', 'Width: 7 pt');
    await field.press('ArrowUp');
    await expect(pill).toHaveAttribute('aria-label', 'Width: 7.5 pt');

    await field.fill('16');
    await field.press('Enter');
    await expect(pill).toHaveAttribute('aria-label', 'Width: 16 pt');
    const after = 16;
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();

    // The pen draws at that width (the outline is about width + slope tall).
    const layer = await page.locator('[data-svg-annotation-layer]').first().boundingBox();
    await slide(page, pointerType, { x: layer.x + 100, y: layer.y + 300 }, { x: layer.x + 300, y: layer.y + 300 });
    await expect.poll(() => page.evaluate(() => {
      const marks = [...document.querySelectorAll('[data-svg-annotation-layer] [data-annotation-index]')];
      return marks.length ? marks[marks.length - 1].querySelector('path').getBBox().height : 0;
    })).toBeGreaterThan(after - 1);

    // The eraser's Size opens the same card, its picks drawn as dots.
    await page.getByRole('button', { name: /^Eraser/ }).first().click();
    await page.getByRole('button', { name: /^Size: / }).click();
    await expect(page.locator('.annotation-size-card__chip-dot > span:not(.annotation-size-card__chip-line)').first()).toBeVisible();

    expect(errors).toEqual([]);
  });
}
