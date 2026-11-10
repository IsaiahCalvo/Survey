// Nightly 'eraser-look' (Drawboard PDF's eraser, checked live 2026-11-10):
// a cross-and-eraser cursor, a grey-edged trail while the button is held,
// marks the drag will take whole lit orange-red, nothing gone until release,
// and Full / Partial as two icon buttons.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function open(page, label, flagOn) {
  await page.addInitScript((on) => {
    if (on) localStorage.setItem('survey.flag.eraser-look', '1');
    else localStorage.removeItem('survey.flag.eraser-look');
  }, flagOn);
  const sheet = await seedSheet(label);
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  return { sheet, pageDiv, marks: pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]') };
}

async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function drawRectAndInk(page, at, marks) {
  await page.keyboard.press('r');
  await drag(page, at(100, 300), at(260, 380));
  await expect(marks).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('p');
  await drag(page, at(100, 460), at(300, 470));
  await expect(marks).toHaveCount(2);
  await page.keyboard.press('Escape');
}

const trail = (page) => page.locator('[data-eraser-look="1"] [data-eraser-look-trail] path').first();
const halos = (page) => page.locator('[data-eraser-look="1"] [data-eraser-halo]');

test('Full: the trail shows while held, the rectangle is lit and stays until release, then goes; one Undo brings it back', async ({ page }) => {
  test.setTimeout(150_000);
  const { sheet, pageDiv, marks } = await open(page, 'Eraser look full', true);
  try {
    const box = await pageDiv.boundingBox();
    const at = (x, y) => ({ x: box.x + x, y: box.y + y });
    await drawRectAndInk(page, at, marks);
    await page.keyboard.press('e');
    const full = page.getByRole('button', { name: 'Full Eraser', exact: true }).filter({ visible: true }).first();
    const partial = page.getByRole('button', { name: 'Partial Eraser', exact: true }).filter({ visible: true }).first();
    await expect(full).toBeVisible();
    await expect(partial).toBeVisible();
    await full.click();
    await expect(full).toHaveAttribute('aria-pressed', 'true');

    const wrapper = page.locator('[data-diag-eraser-wrapper="1"]');
    const cursor = await wrapper.evaluate((el) => el.style.cursor);
    expect(cursor).toContain('data:image/svg+xml');
    expect(cursor).toContain(' 9 26');

    // Down through the rectangle's left side, held.
    await page.mouse.move(at(100, 260).x, at(100, 260).y);
    await page.mouse.down();
    await page.mouse.move(at(100, 420).x, at(100, 420).y, { steps: 12 });
    await expect.poll(() => trail(page).getAttribute('d')).toMatch(/^M/);
    expect(Number(await trail(page).getAttribute('stroke-width'))).toBeGreaterThan(0);
    await expect(halos(page)).toHaveCount(1);
    const haloStroke = await halos(page).first().locator('rect, path, polygon').first().getAttribute('stroke');
    expect(haloStroke).toBe('#E6563D');
    await page.waitForTimeout(400);
    // Nothing has gone yet.
    await expect(marks).toHaveCount(2);
    await page.screenshot({ path: test.info().outputPath('eraser-look-held.png') });

    await page.mouse.up();
    await expect(marks).toHaveCount(1);
    await expect.poll(() => trail(page).getAttribute('d')).toBe('');
    await expect(halos(page)).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(marks).toHaveCount(2);
  } finally {
    await sheet.remove();
  }
});

test('Partial: ink shows no change and no glow while held, and is cut on release', async ({ page }) => {
  test.setTimeout(150_000);
  const { sheet, pageDiv, marks } = await open(page, 'Eraser look partial', true);
  try {
    const box = await pageDiv.boundingBox();
    const at = (x, y) => ({ x: box.x + x, y: box.y + y });
    await drawRectAndInk(page, at, marks);
    const ink = marks.nth(1);
    const before = await ink.evaluate((el) => el.outerHTML);
    await page.keyboard.press('e');
    await page.getByRole('button', { name: 'Partial Eraser', exact: true }).filter({ visible: true }).first().click();
    // Across the ink only (below the rectangle).
    await page.mouse.move(at(200, 430).x, at(200, 430).y);
    await page.mouse.down();
    await page.mouse.move(at(200, 510).x, at(200, 510).y, { steps: 12 });
    await expect.poll(() => trail(page).getAttribute('d')).toMatch(/^M/);
    await page.waitForTimeout(400);
    await expect(halos(page)).toHaveCount(0);
    expect(await ink.evaluate((el) => el.outerHTML)).toBe(before);
    await page.mouse.up();
    await expect.poll(async () => {
      const all = await marks.evaluateAll((els) => els.map((el) => el.outerHTML));
      return all.includes(before);
    }).toBe(false);
    await expect.poll(() => trail(page).getAttribute('d')).toBe('');
  } finally {
    await sheet.remove();
  }
});

test('without the flag the eraser looks as before', async ({ page }) => {
  test.setTimeout(120_000);
  const { sheet } = await open(page, 'Eraser look off', false);
  try {
    await page.keyboard.press('e');
    await expect(page.getByRole('button', { name: 'Partial erase', exact: true }).filter({ visible: true }).first()).toContainText('Partial');
    await expect(page.getByRole('button', { name: 'Full stroke erase', exact: true }).filter({ visible: true }).first()).toContainText('Whole');
    await expect(page.locator('[data-eraser-look]')).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});

for (const layout of [{ name: 'phone web', native: false }, { name: 'phone app', native: true }]) {
  test.describe(`eraser look, ${layout.name}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the eraser strip shows Full and Partial with their icons', async ({ page }) => {
      test.setTimeout(150_000);
      await page.addInitScript(() => localStorage.setItem('survey.flag.eraser-look', '1'));
      if (layout.native) {
        await page.addInitScript(() => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
        });
      }
      const sheet = await seedSheet(`Eraser look ${layout.native ? 'app' : 'web'}`);
      try {
        await signIn(page, E2E_ACCOUNTS.owner);
        await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().tap();
        const openFile = page.getByRole('button', { name: 'Open file' });
        if (await openFile.isVisible().catch(() => false)) await openFile.tap();
        const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
        await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
        await page.getByRole('button', { name: 'Draw', exact: true }).filter({ visible: true }).first().tap();
        await page.getByRole('button', { name: 'Eraser', exact: true }).filter({ visible: true }).last().tap();
        const group = page.getByRole('group', { name: 'Eraser mode' }).filter({ visible: true }).first();
        const buttons = group.getByRole('button');
        await expect(buttons).toHaveCount(2);
        await expect(buttons.nth(0)).toHaveAttribute('aria-label', 'Full Eraser');
        await expect(buttons.nth(1)).toHaveAttribute('aria-label', 'Partial Eraser');
        await expect(buttons.nth(0).locator('svg')).toHaveCount(1);
        await buttons.nth(0).tap();
        await expect(buttons.nth(0)).toHaveAttribute('aria-pressed', 'true');
      } finally {
        await sheet.remove();
      }
    });
  });
}
