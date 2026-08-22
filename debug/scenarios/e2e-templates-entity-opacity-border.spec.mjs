import { test, expect } from '@playwright/test';

// Unique leftover after Templates family + fill-only entity color:
// entity picker opacity + independent Border tab (not fill presets,
// not Match-fill lock-only). Distinct from viewer every-swatch C-01..C-06
// and leftover-18 Space CSV / PDF Pages. UL-31 Continue pin parked.
// Do not invent Print / stamp / measure / Group / Extract / Note-Link /
// Copy-to-Spaces / category Move/Copy.

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const GC_HEX = '#d8a84e';
const SUB_HEX = '#7ab7e6';

async function openHub(page, { width = 1440, height = 900, url = HUB } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function entitiesRail(page) {
  return page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New entity', exact: true }),
  });
}

function colorPanel(page) {
  return page.locator('[data-entity-color-panel]').first();
}

async function findEntitySwatch(page, role) {
  return entitiesRail(page).evaluate((rail, roleName) => {
    const rows = [...rail.querySelectorAll('[data-drag-rearrange-row]')];
    const row = rows.find((node) => node.querySelector('input[placeholder="Entity name"]')?.value === roleName);
    const button = row?.querySelector('button[aria-label="Edit color"]');
    if (!button) return null;
    const style = getComputedStyle(button);
    const toHex = (raw) => {
      const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw || '');
      if (!match) return String(raw || '');
      const hx = (n) => Number(n).toString(16).padStart(2, '0');
      return `#${hx(match[1])}${hx(match[2])}${hx(match[3])}`;
    };
    return {
      fill: toHex(style.backgroundColor),
      border: toHex(style.borderTopColor),
    };
  }, role);
}

async function clickEditColor(page, role) {
  const clicked = await entitiesRail(page).evaluate((rail, roleName) => {
    const rows = [...rail.querySelectorAll('[data-drag-rearrange-row]')];
    const row = rows.find((node) => node.querySelector('input[placeholder="Entity name"]')?.value === roleName);
    const button = row?.querySelector('button[aria-label="Edit color"]');
    if (!button) return false;
    button.click();
    return true;
  }, role);
  expect(clicked, `Edit color for ${role}`).toBe(true);
}

async function readOpacity(page) {
  return Number(await colorPanel(page).getByLabel('Opacity percentage').inputValue());
}

async function setOpacity(page, pct) {
  const input = colorPanel(page).getByLabel('Opacity percentage');
  await expect(input).toBeVisible();
  await input.fill(String(pct));
  await expect(input).toHaveValue(String(pct));
}

async function pickPreset(page, hex) {
  const panel = colorPanel(page);
  await expect(panel).toBeVisible();
  await panel.getByTitle(hex, { exact: true }).click();
}

test('Templates entity opacity + independent Border tab intended + break + edge', async ({ page }) => {
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByRole('button', { name: 'New template', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const emptyColors = await page.getByRole('button', { name: 'Edit color' }).count();
  expect(emptyColors, 'empty templates have no entity color').toBe(0);

  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'Entity name' }).first()).toHaveValue('GC');
  expect((await findEntitySwatch(page, 'GC'))?.fill.toLowerCase()).toBe(GC_HEX);
  expect((await findEntitySwatch(page, 'Subcontractor'))?.fill.toLowerCase()).toBe(SUB_HEX);

  await clickEditColor(page, 'GC');
  await expect(colorPanel(page)).toBeVisible();
  await expect(colorPanel(page).getByRole('button', { name: 'Fill', exact: true })).toBeVisible();
  await expect(colorPanel(page).getByRole('button', { name: 'Border', exact: true })).toBeVisible();
  await expect(colorPanel(page).getByText('OPACITY', { exact: true })).toBeVisible();
  expect(await readOpacity(page)).toBe(35);

  await setOpacity(page, 80);
  expect(await readOpacity(page)).toBe(80);
  expect((await findEntitySwatch(page, 'GC'))?.fill.toLowerCase()).toBe(GC_HEX);
  expect((await findEntitySwatch(page, 'Subcontractor'))?.fill.toLowerCase()).toBe(SUB_HEX);

  await colorPanel(page).getByRole('button', { name: 'Border', exact: true }).click();
  await expect(colorPanel(page).getByText('Match fill', { exact: true })).toBeVisible();
  const matchBox = colorPanel(page).locator('input[type="checkbox"]');
  await expect(matchBox).not.toBeChecked();
  await pickPreset(page, '#0000FF');
  await setOpacity(page, 50);
  expect(await readOpacity(page)).toBe(50);
  await colorPanel(page).getByRole('button', { name: 'Fill', exact: true }).click();
  await expect(colorPanel(page).getByText('Match fill', { exact: true })).toHaveCount(0);
  await expect(colorPanel(page).getByLabel('Hex color')).toHaveValue(/d8a84e/i);
  expect(await readOpacity(page)).toBe(80);
  await colorPanel(page).getByRole('button', { name: 'Border', exact: true }).click();
  await expect(colorPanel(page).getByLabel('Hex color')).toHaveValue(/0000ff/i);
  expect(await readOpacity(page)).toBe(50);
  const dirtySwatch = await findEntitySwatch(page, 'GC');
  expect(dirtySwatch?.fill.toLowerCase()).toBe(GC_HEX);
  expect(dirtySwatch?.border.toLowerCase()).toBe('#0000ff');
  expect((await findEntitySwatch(page, 'Subcontractor'))?.fill.toLowerCase()).toBe(SUB_HEX);
  expect((await findEntitySwatch(page, 'Subcontractor'))?.border.toLowerCase()).not.toBe('#0000ff');

  await entitiesRail(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(entitiesRail(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  const restored = await findEntitySwatch(page, 'GC');
  expect(restored?.fill.toLowerCase()).toBe(GC_HEX);
  expect(restored?.border.toLowerCase()).toBe(GC_HEX);

  await clickEditColor(page, 'GC');
  await colorPanel(page).getByRole('button', { name: 'Fill', exact: true }).click();
  await expect(colorPanel(page).getByText('Match fill', { exact: true })).toHaveCount(0);
  expect(await readOpacity(page)).toBe(35);
  await setOpacity(page, 80);
  await colorPanel(page).getByRole('button', { name: 'Border', exact: true }).click();
  await pickPreset(page, '#0000FF');
  await setOpacity(page, 50);
  await colorPanel(page).getByRole('button', { name: 'Fill', exact: true }).click();
  await expect(colorPanel(page).getByLabel('Hex color')).toHaveValue(/d8a84e/i);
  expect(await readOpacity(page), 'in-memory fill opacity before Save').toBe(80);
  await colorPanel(page).getByRole('button', { name: 'Border', exact: true }).click();
  const subBefore = await findEntitySwatch(page, 'Subcontractor');
  await entitiesRail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(entitiesRail(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  await page.getByText('MEP As-Built Markup').first().click();
  await expect(page.getByRole('textbox', { name: 'Entity name' }).first()).toHaveValue('MEP');
  await page.getByText('Security Walk-Through').first().click();
  await expect(page.getByRole('textbox', { name: 'Entity name' }).first()).toHaveValue('GC');
  const savedSwatch = await findEntitySwatch(page, 'GC');
  expect(savedSwatch?.fill.toLowerCase()).toBe(GC_HEX);
  expect(savedSwatch?.border.toLowerCase()).toBe('#0000ff');
  expect((await findEntitySwatch(page, 'Subcontractor'))?.fill.toLowerCase()).toBe(subBefore.fill.toLowerCase());
  expect((await findEntitySwatch(page, 'Subcontractor'))?.border.toLowerCase()).toBe(subBefore.border.toLowerCase());

  await clickEditColor(page, 'GC');
  await colorPanel(page).getByRole('button', { name: 'Fill', exact: true }).click();
  await expect(colorPanel(page).getByText('Match fill', { exact: true })).toHaveCount(0);
  await expect(colorPanel(page).getByLabel('Hex color')).toHaveValue(/d8a84e/i);
  expect(await readOpacity(page)).toBe(80);
  await colorPanel(page).getByRole('button', { name: 'Border', exact: true }).click();
  await expect(colorPanel(page).getByLabel('Hex color')).toHaveValue(/0000ff/i);
  expect(await readOpacity(page)).toBe(50);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  let mobileEdit = 0;
  let mobileOpacity = null;
  let mobileBorderHex = null;
  if (await mobileRow.isVisible().catch(() => false)) {
    await mobileRow.click();
    await page.getByRole('button', { name: 'Entities', exact: true }).click();
    const mobileDialog = page.getByRole('dialog', { name: 'Entities' });
    await expect(mobileDialog).toBeVisible();
    const mobileEditBtn = mobileDialog.getByRole('button', { name: 'Edit color' });
    mobileEdit = await mobileEditBtn.count();
    if (mobileEdit > 0) {
      await mobileEditBtn.first().click();
      const mobilePanel = mobileDialog.locator('[data-entity-color-panel]');
      await expect(mobilePanel).toBeVisible();
      await expect(mobilePanel.getByRole('button', { name: 'Border', exact: true })).toBeVisible();
      const opacityInput = mobilePanel.getByLabel('Opacity percentage');
      await opacityInput.fill('25');
      mobileOpacity = Number(await opacityInput.inputValue());
      await mobilePanel.getByRole('button', { name: 'Border', exact: true }).click();
      await mobilePanel.getByTitle('#FF0000', { exact: true }).click();
      mobileBorderHex = (await mobilePanel.getByLabel('Hex color').inputValue()).toLowerCase();
    }
  } else {
    mobileEdit = await page.getByRole('button', { name: 'Edit color' }).count();
  }

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_ENTITY_OPACITY_BORDER_PROOF: {
      emptyZero: emptyColors === 0,
      seedOpacity35: true,
      cancelRestored: true,
      fillOpacitySaved: 80,
      borderHexSaved: '#0000ff',
      borderOpacitySaved: 50,
      isolation: true,
      mobileEdit,
      mobileOpacity,
      mobileBorderHex,
    },
  }));
});
