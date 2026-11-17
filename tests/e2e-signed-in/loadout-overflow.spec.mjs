// KAL-667: with every Nightly tool on, the Text group's tools never run under
// the Pin / Share / Export buttons at the right of the tool bar. The tools that
// do not fit wait in a More menu at the end of the row; picking one there arms
// it and brings it back into the row; the group icons never move.
import { readFileSync } from 'node:fs';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

// Every flag in the registry (featureFlags.js is not loadable from here).
const ALL_FLAGS = [...readFileSync(new URL('../../src/featureFlags.js', import.meta.url), 'utf8')
  .matchAll(/^  '([a-z0-9-]+)': Object\.freeze\(/gm)].map((m) => m[1]);

async function openSheet(page, sheet) {
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
}

// The row as drawn: each shown tool's box, the leftmost right-hand button,
// the More button and the Text group icon.
const measure = (page) => page.evaluate(() => {
  const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
  const row = document.querySelector('#chrome-subtools-host [data-chrome-subtools-row]');
  const tools = row ? [...row.children].filter((el) => el.getBoundingClientRect().width > 0).map((el) => ({
    label: (el.matches('button') ? el : el.querySelector('button'))?.getAttribute('aria-label'),
    pressed: el.getAttribute('aria-pressed') === 'true',
    ...box(el),
  })) : [];
  const exportsLeft = Math.min(...[...document.querySelectorAll('[data-toolbar-export]')]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0).map((r) => r.left));
  const more = document.querySelector('[data-loadout-more]');
  const textGroup = document.querySelector('[data-tool-toolbar] button[aria-label="Text"]');
  return { tools, exportsLeft, more: more ? box(more) : null, textGroup: textGroup ? box(textGroup) : null };
});

for (const width of [1440, 1024]) {
  test(`Text group tools stay clear of the right-hand buttons at ${width}`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((flags) => {
      for (const key of flags) localStorage.setItem(`survey.flag.${key}`, '1');
    }, ALL_FLAGS);
    const sheet = await seedSheet(`Loadout overflow ${width}`);
    await openSheet(page, sheet);

    await page.locator('[data-tool-toolbar] button[aria-label="Text"]').click();
    await expect(page.locator('[data-loadout-more]')).toBeVisible();
    const before = await measure(page);
    expect(before.tools.length).toBeGreaterThan(1);
    for (const tool of before.tools) expect(tool.right).toBeLessThanOrEqual(before.exportsLeft);
    expect(before.more.right).toBeLessThanOrEqual(before.exportsLeft);
    await page.screenshot({ path: test.info().outputPath(`loadout-${width}.png`), clip: { x: 0, y: 0, width, height: 120 } });

    // More lists the rest, by name.
    await page.locator('[data-loadout-more]').click();
    const menu = page.locator('[data-loadout-more-menu]');
    await expect(menu).toBeVisible();
    const items = menu.getByRole('menuitem');
    const names = await items.allTextContents();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(before.tools.map((t) => t.label)).not.toContain(name);
    await page.screenshot({ path: test.info().outputPath(`loadout-${width}-menu.png`), clip: { x: Math.max(0, width - 520), y: 0, width: Math.min(520, width), height: 520 } });

    // Picking one arms it and brings it back into the row, still clear.
    const target = 'Redact area';
    expect(names).toContain(target);
    await menu.getByRole('menuitem', { name: target }).click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator(`#chrome-subtools-host button[aria-label="${target}"]`)).toBeVisible();
    await expect(page.locator(`#chrome-subtools-host button[aria-label="${target}"]`)).toHaveAttribute('aria-pressed', 'true');
    const after = await measure(page);
    for (const tool of after.tools) expect(tool.right).toBeLessThanOrEqual(after.exportsLeft);
    expect(after.more.right).toBeLessThanOrEqual(after.exportsLeft);
    // The group icons never moved.
    expect(Math.abs(after.textGroup.left - before.textGroup.left)).toBeLessThan(1);
    await page.screenshot({ path: test.info().outputPath(`loadout-${width}-picked.png`), clip: { x: 0, y: 0, width, height: 120 } });
  });
}
