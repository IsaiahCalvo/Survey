import { test, expect } from '@playwright/test';

// Unique leftover after Spaces space-card Delete:
// U-03 Templates editor entity color (aria-label="Edit color" /
// setEntityColor / CompactColorPicker on roster). Distinct from viewer
// every-swatch, leftover-18 Space CSV / PDF Pages, and from already-proven
// template create/rename/delete. UL-31 Continue pin parked. No file.id.
// Do not invent Print / stamp / measure / Group / Extract / Note-Link /
// Copy-to-Spaces / checklist items.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const GC_HEX = '#d8a84e';

async function openHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function desktopRightRail(page) {
  return page.locator('.templates-editor-grid > aside').last();
}

function desktopEntityRow(page, role) {
  return desktopRightRail(page).locator('[data-drag-rearrange-row]').filter({
    has: page.locator(`input.inline-edit.cat-title[value="${role}"], input.inline-edit.cat-title`).first(),
  }).filter({ hasText: role }).first();
}

function desktopEditColor(page, role) {
  return desktopEntityRow(page, role).getByRole('button', { name: 'Edit color' });
}

function colorPanel(page) {
  return page.locator('[data-entity-color-panel]').first();
}

async function pickPreset(page, hex) {
  const panel = colorPanel(page);
  await expect(panel).toBeVisible();
  await panel.getByTitle(hex, { exact: true }).click();
}

async function swatchBackground(page, role) {
  return desktopEditColor(page, role).evaluate((button) => {
    const raw = getComputedStyle(button).backgroundColor;
    const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
    if (!match) return raw;
    const hx = (n) => Number(n).toString(16).padStart(2, '0');
    return `#${hx(match[1])}${hx(match[2])}${hx(match[3])}`;
  });
}

test('Templates entity color intended + break + edge', async ({ page }) => {
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByRole('button', { name: 'New template', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const emptyColors = await page.getByRole('button', { name: 'Edit color' }).count();
  expect(emptyColors, 'empty templates have no entity color').toBe(0);

  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'Entity name' }).first()).toHaveValue('GC');
  await expect(desktopEditColor(page, 'GC')).toBeVisible();
  await expect(desktopEditColor(page, 'Subcontractor')).toBeVisible();
  expect((await swatchBackground(page, 'GC')).toLowerCase()).toBe(GC_HEX);

  await desktopEditColor(page, 'GC').click();
  await expect(colorPanel(page)).toBeVisible();
  await expect(colorPanel(page).getByRole('button', { name: 'Fill', exact: true })).toBeVisible();
  await pickPreset(page, '#00FF00');
  expect((await swatchBackground(page, 'GC')).toLowerCase()).toBe('#00ff00');
  expect((await swatchBackground(page, 'Subcontractor')).toLowerCase()).not.toBe('#00ff00');
  await page.getByRole('button', { name: 'Cancel', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect((await swatchBackground(page, 'GC')).toLowerCase()).toBe(GC_HEX);

  await desktopEditColor(page, 'GC').click();
  await pickPreset(page, '#FF0000');
  expect((await swatchBackground(page, 'GC')).toLowerCase()).toBe('#ff0000');
  const subBefore = (await swatchBackground(page, 'Subcontractor')).toLowerCase();
  await colorPanel(page).getByRole('button', { name: 'Border', exact: true }).click();
  await expect(colorPanel(page).getByText('Match fill', { exact: true })).toBeVisible();
  await colorPanel(page).locator('input[type="checkbox"]').check();
  await expect(colorPanel(page).locator('div').filter({ has: page.locator('[aria-label="Hex color"]') }).first()).toHaveCSS('pointer-events', 'none');
  await pickPreset(page, '#0000FF').catch(() => {});
  expect((await swatchBackground(page, 'GC')).toLowerCase()).toBe('#ff0000');
  expect((await swatchBackground(page, 'Subcontractor')).toLowerCase()).toBe(subBefore);

  await page.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await page.getByText('MEP As-Built Markup').first().click();
  await expect(page.getByRole('textbox', { name: 'Entity name' }).first()).toHaveValue('MEP');
  await page.getByText('Security Walk-Through').first().click();
  await expect(page.getByRole('textbox', { name: 'Entity name' }).first()).toHaveValue('GC');
  expect((await swatchBackground(page, 'GC')).toLowerCase()).toBe('#ff0000');
  expect((await swatchBackground(page, 'Subcontractor')).toLowerCase()).toBe(subBefore);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  await expect(mobileRow).toBeVisible();
  await mobileRow.click();
  await page.getByRole('button', { name: 'Entities', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Entities' })).toBeVisible();
  const mobileEdit = page.getByRole('dialog', { name: 'Entities' }).getByRole('button', { name: 'Edit color' });
  await expect(mobileEdit.first()).toBeVisible();
  const mobileBefore = await mobileEdit.count();
  expect(mobileBefore).toBeGreaterThan(0);
  await mobileEdit.first().click();
  await expect(page.locator('[data-entity-color-panel]')).toBeVisible();
  await page.locator('[data-entity-color-panel]').getByTitle('#0000FF', { exact: true }).click();
  const mobileSwatch = await mobileEdit.first().evaluate((button) => (
    getComputedStyle(button).getPropertyValue('--entity-color') || getComputedStyle(button).backgroundColor
  ));
  expect(String(mobileSwatch).toLowerCase()).toMatch(/#0000ff|rgb\(\s*0,\s*0,\s*255/);

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_ENTITY_COLOR_PROOF: {
      emptyZero: emptyColors === 0,
      cancelRestored: true,
      fillSaved: true,
      isolation: true,
      matchFillLocked: true,
      mobileEdit: mobileBefore,
      mobilePicked: true,
    },
  }));
});
