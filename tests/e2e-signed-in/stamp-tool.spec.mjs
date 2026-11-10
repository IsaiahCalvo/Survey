// Nightly 'stamp-tool' (Drawboard Projects' Stamp, checked live 2026-11-10,
// stamps-and-captions.md): the Text group's Stamp button opens a card with
// the twelve presets; pick one and each click on the page drops a 120 x 60 pt
// stamp centred on it. Phone: a tap on a preset drops it mid-page.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

const ORDER = [
  'DRAFT ISSUE', 'FOR REVIEW', 'CHECK PRINT', 'PRELIMINARY ISSUE', 'APPROVED', 'FOR INFORMATION ONLY',
  'REVISE AND RESUBMIT', 'REVISED', 'REJECTED', 'NOT FOR CONSTRUCTION', 'FOR CONSTRUCTION', 'AS-BUILT',
];

async function flags(page, on) {
  await page.addInitScript((value) => {
    if (value) localStorage.setItem('survey.flag.stamp-tool', '1');
    else localStorage.removeItem('survey.flag.stamp-tool');
  }, on);
}

async function openSheet(page, label, tap = false) {
  const sheet = await seedSheet(label);
  await signIn(page, E2E_ACCOUNTS.owner);
  const row = page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first();
  if (tap) await row.tap(); else await row.click();
  const openFile = page.getByRole('button', { name: 'Open file' });
  if (tap) { if (await openFile.isVisible().catch(() => false)) await openFile.tap(); } else await openFile.click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  return { sheet, pageDiv, marks: pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]') };
}

const card = (page) => page.locator('[data-stamp-picker]');
const tiles = (page) => card(page).getByRole('option');
const pageBoxes = (marks) => marks.evaluateAll((els) => els.map((g) => {
  const b = g.getBBox();
  return { cx: b.x + b.width / 2, cy: b.y + b.height / 2, w: b.width, h: b.height, text: g.textContent };
}));

test('Stamp opens the card; a picked preset drops on each click, centred, 120 x 60; Esc lets go then closes; Undo', async ({ page }) => {
  test.setTimeout(180_000);
  await flags(page, true);
  const { sheet, pageDiv, marks } = await openSheet(page, 'Stamps');
  try {
    const box = await pageDiv.boundingBox();
    const scale = box.width / 612;
    await page.keyboard.press('t');
    await page.getByRole('button', { name: 'Stamp', exact: true }).filter({ visible: true }).first().click();
    await expect(card(page)).toBeVisible();
    await expect(tiles(page)).toHaveCount(12);
    expect(await tiles(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(ORDER);

    const approved = card(page).getByRole('option', { name: 'APPROVED', exact: true });
    await approved.click();
    await expect(approved).toHaveAttribute('aria-selected', 'true');

    await page.mouse.click(box.x + 200 * scale, box.y + 300 * scale);
    await expect(marks).toHaveCount(1);
    await page.mouse.click(box.x + 400 * scale, box.y + 500 * scale);
    await expect(marks).toHaveCount(2);
    const [a, b] = await pageBoxes(marks);
    expect(a.text).toContain('APPROVED');
    expect(Math.abs(a.cx - 200)).toBeLessThan(3);
    expect(Math.abs(a.cy - 300)).toBeLessThan(3);
    expect(Math.abs(b.cx - 400)).toBeLessThan(3);
    expect(Math.round(a.w)).toBeGreaterThanOrEqual(120);
    expect(Math.round(a.w)).toBeLessThanOrEqual(123);
    expect(Math.round(a.h)).toBeGreaterThanOrEqual(60);
    expect(Math.round(a.h)).toBeLessThanOrEqual(63);
    // Another preset picked right after a drop takes over at once.
    const rejected = card(page).getByRole('option', { name: 'REJECTED', exact: true });
    await rejected.click();
    await expect(rejected).toHaveAttribute('aria-selected', 'true');
    await page.mouse.click(box.x + 300 * scale, box.y + 650 * scale);
    await expect(marks).toHaveCount(3);
    expect((await pageBoxes(marks))[2].text).toContain('REJECTED');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(marks).toHaveCount(2);
    await approved.click();
    // The stamp's look: #FF4F68 border and words.
    expect(await marks.first().evaluate((g) => g.innerHTML.toLowerCase().includes('#ff4f68') || g.innerHTML.includes('255, 79, 104'))).toBe(true);

    await page.keyboard.press('Escape');
    await expect(approved).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(marks).toHaveCount(1);
  } finally {
    await sheet.remove();
  }
});

test('without the flag there is no Stamp button', async ({ page }) => {
  test.setTimeout(120_000);
  await flags(page, false);
  const { sheet } = await openSheet(page, 'Stamps off');
  try {
    await page.keyboard.press('t');
    await expect(page.getByRole('button', { name: 'Callout', exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Stamp', exact: true }).filter({ visible: true })).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});

for (const layout of [{ name: 'phone web', native: false }, { name: 'phone app', native: true }]) {
  test.describe(`stamp tool, ${layout.name}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('the Text group has Stamp; a tap on a preset drops it on the page', async ({ page }) => {
      test.setTimeout(150_000);
      await flags(page, true);
      if (layout.native) {
        await page.addInitScript(() => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
        });
      }
      const { sheet, marks } = await openSheet(page, `Stamps ${layout.native ? 'app' : 'web'}`, true);
      try {
        await page.getByRole('button', { name: 'Text', exact: true }).filter({ visible: true }).first().tap();
        await page.getByRole('button', { name: 'Stamp', exact: true }).filter({ visible: true }).last().tap();
        await expect(card(page)).toBeVisible();
        await expect(tiles(page)).toHaveCount(12);
        await card(page).getByRole('option', { name: 'REJECTED', exact: true }).tap();
        await expect(marks).toHaveCount(1);
        expect((await pageBoxes(marks))[0].text).toContain('REJECTED');
      } finally {
        await sheet.remove();
      }
    });
  });
}
