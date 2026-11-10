// Nightly 'link-tool' (Drawboard Projects' Hyperlink tool, deep/link-tool.md):
// Shift+H, drag a box, "New hyperlink" asks where it goes (a page, a website,
// an area), Create makes a link mark. A click only picks it; "Go to ..." on
// the picked bar follows it; Link edits it. Phone web and phone app: the
// Text group's Hyperlink and a finger drag make one too.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const flagOn = (page, on) => page.addInitScript((value) => {
  if (value) localStorage.setItem('survey.flag.link-tool', '1');
  else localStorage.removeItem('survey.flag.link-tool');
  try { localStorage.removeItem('survey.linkTool.look'); } catch { /* fine */ }
  // A website link opens a new tab: note it instead.
  window.__opened = [];
  window.open = (url) => { window.__opened.push(String(url)); return null; };
}, on);

async function openSheet(page, sheet, { tap = false } = {}) {
  await signIn(page, E2E_ACCOUNTS.owner);
  const row = page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first();
  if (tap) await row.tap(); else await row.click();
  const openFile = page.getByRole('button', { name: 'Open file' });
  if (tap) { if (await openFile.isVisible().catch(() => false)) await openFile.tap(); } else await openFile.click();
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  return { surface, marks: surface.locator('[data-svg-annotation-layer="1"] [data-annotation-index]') };
}

async function drag(page, box, from, to) {
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 4 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 4 });
  await page.mouse.up();
}

const dialog = (page) => page.locator('[data-hyperlink-dialog]');
const links = (marks) => marks.locator('[data-shape-kind="link"]');
const goTo = (page) => page.locator('[data-selection-quick-goto]').filter({ visible: true });

test('Shift+H, drag, New hyperlink: page, website and area links; Go to follows; Link edits; Cancel drops; Undo', async ({ page }) => {
  test.setTimeout(240_000);
  await flagOn(page, true);
  const sheet = await seedSheet('Link tool desktop', { pages: 3 });
  try {
    const { surface, marks } = await openSheet(page, sheet);
    const box = await surface.boundingBox();

    // Page link.
    await page.keyboard.press('Shift+H');
    await drag(page, box, [80, 120], [260, 170]);
    await expect(dialog(page)).toBeVisible();
    await expect(dialog(page)).toContainText('New hyperlink');
    const submit = dialog(page).locator('[data-hyperlink-submit]');
    await expect(submit).toBeDisabled();
    await dialog(page).getByLabel('Page number').fill('9');
    await submit.click();
    await expect(dialog(page).getByRole('alert')).toContainText('1 to 3');
    await dialog(page).getByLabel('Page number').fill('3');
    await submit.click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(links(marks)).toHaveCount(1);
    const look = await links(marks).first().evaluate((g) => {
      const border = g.querySelectorAll('rect')[1];
      return { stroke: border?.getAttribute('stroke'), width: border?.getAttribute('stroke-width'), style: g.getAttribute('data-link-style') };
    });
    expect(look).toEqual({ stroke: '#0066D4', width: '3', style: 'box' });
    // It comes up picked: Go to page 3 follows it.
    await expect(goTo(page)).toHaveText('Go to page 3');
    await goTo(page).click();
    const page3 = page.locator('.survey-pdfjs-page-div[data-page-number="3"]').filter({ visible: true }).first();
    await expect.poll(async () => {
      const r = await page3.boundingBox();
      return r ? Math.abs(r.y) < 400 : false;
    }, { timeout: 10_000 }).toBe(true);
    await page.keyboard.press('Home');
    await page.waitForTimeout(800);

    // Cancel drops the box.
    const box1 = await surface.boundingBox();
    await drag(page, box1, [80, 600], [260, 640]);
    await expect(dialog(page)).toBeVisible();
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog(page)).toHaveCount(0);
    await expect(links(marks)).toHaveCount(1);

    // Website link, green and dashed: a missing https:// is added.
    await drag(page, box1, [300, 300], [480, 340]);
    await dialog(page).getByRole('radio', { name: 'Website' }).click();
    await dialog(page).getByLabel('Web address').fill('example.com');
    await dialog(page).getByRole('radio', { name: 'Dashed' }).click();
    await dialog(page).locator('[data-hyperlink-color="green"]').click();
    await dialog(page).locator('[data-hyperlink-submit]').click();
    await expect(links(marks)).toHaveCount(2);
    await expect(links(marks).nth(1)).toHaveAttribute('data-link-style', 'dashed');
    await expect(goTo(page)).toHaveText('Go to example.com');
    await goTo(page).click();
    await expect.poll(() => page.evaluate(() => window.__opened)).toEqual(['https://example.com/']);

    // Link edits it in place: back to a box, still green, same width.
    await page.locator('[data-selection-quick-link-edit]').filter({ visible: true }).click();
    await expect(dialog(page)).toContainText('Edit hyperlink');
    await expect(dialog(page).getByLabel('Web address')).toHaveValue('https://example.com/');
    await dialog(page).getByRole('radio', { name: 'Box' }).click();
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(links(marks).nth(1)).toHaveAttribute('data-link-style', 'box');
    expect(await links(marks).nth(1).evaluate((g) => g.querySelectorAll('rect')[1].getAttribute('stroke'))).toBe('#118A4E');

    // Area link: Choose Area, then the next box is where it opens.
    await page.keyboard.press('Escape');
    await drag(page, box1, [80, 450], [260, 490]);
    await dialog(page).getByRole('radio', { name: 'Area' }).click();
    await expect(dialog(page).locator('[data-hyperlink-submit]')).toHaveText('Choose Area');
    await dialog(page).locator('[data-hyperlink-submit]').click();
    await expect(page.getByText('Drag a box round the area the link should open.')).toBeVisible();
    await drag(page, box1, [60, 45], [340, 85]);
    await expect(links(marks)).toHaveCount(3);
    await expect(goTo(page)).toHaveText('Go to area');
    const before = (await surface.boundingBox()).width;
    await goTo(page).click();
    await expect.poll(async () => (await surface.boundingBox()).width / before, { timeout: 10_000 }).toBeGreaterThan(2);
    await page.screenshot({ path: test.info().outputPath('link-area.png') });

    // A plain click only picks a link (Drawboard): nothing opens.
    await page.keyboard.press('ControlOrMeta+0');
    await page.waitForTimeout(800);
    await page.keyboard.press('v');
    const box2 = await surface.boundingBox();
    const scale = box2.width / box1.width;
    await page.mouse.click(box2.x + 390 * scale, box2.y + 320 * scale);
    await expect(goTo(page)).toHaveText('Go to example.com');
    expect(await page.evaluate(() => window.__opened.length)).toBe(1);

    // One Undo takes the newest link away.
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(links(marks)).toHaveCount(2);
  } finally {
    await sheet.remove();
  }
});

test('without the flag there is no Hyperlink button and Shift+H does nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await flagOn(page, false);
  const sheet = await seedSheet('Link tool off');
  try {
    const { surface, marks } = await openSheet(page, sheet);
    const box = await surface.boundingBox();
    await page.keyboard.press('t');
    await expect(page.getByRole('button', { name: 'Callout', exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Hyperlink', exact: true }).filter({ visible: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('m');
    await page.keyboard.press('Shift+H');
    await drag(page, box, [80, 120], [260, 170]);
    await page.waitForTimeout(800);
    await expect(dialog(page)).toHaveCount(0);
    await expect(marks).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});

for (const layout of [{ name: 'phone web', native: false }, { name: 'phone app', native: true }]) {
  test.describe(`link tool, ${layout.name}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('Hyperlink in the Text group, a finger drag, a page link; Go to shows on the picked bar', async ({ page }) => {
      test.setTimeout(150_000);
      await flagOn(page, true);
      if (layout.native) {
        await page.addInitScript(() => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
        });
      }
      const sheet = await seedSheet(`Link tool ${layout.native ? 'app' : 'web'}`, { pages: 2 });
      try {
        const { surface, marks } = await openSheet(page, sheet, { tap: true });
        await page.getByRole('button', { name: 'Text', exact: true }).filter({ visible: true }).first().tap();
        await page.getByRole('button', { name: 'Hyperlink', exact: true }).filter({ visible: true }).last().tap();
        await page.waitForTimeout(300);
        const box = await surface.boundingBox();
        const cdp = await page.context().newCDPSession(page);
        const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', {
          type,
          touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }],
        });
        const from = { x: box.x + box.width * 0.2, y: box.y + box.height * 0.2 };
        const to = { x: box.x + box.width * 0.6, y: box.y + box.height * 0.3 };
        await touch('touchStart', from.x, from.y);
        for (let i = 1; i <= 12; i += 1) {
          await touch('touchMove', from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12);
          await page.waitForTimeout(30);
        }
        await touch('touchEnd');
        await expect(dialog(page)).toBeVisible();
        const card = await dialog(page).boundingBox();
        expect(card.x).toBeGreaterThanOrEqual(0);
        expect(card.x + card.width).toBeLessThanOrEqual(390);
        await dialog(page).getByLabel('Page number').fill('2');
        await dialog(page).locator('[data-hyperlink-submit]').tap();
        await expect(links(marks)).toHaveCount(1);
        await expect(goTo(page)).toHaveText('Go to page 2');
        await page.screenshot({ path: test.info().outputPath(`link-${layout.native ? 'app' : 'web'}.png`) });
      } finally {
        await sheet.remove();
      }
    });
  });
}
