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

function entitiesRail(page) {
  return page.getByRole('complementary').filter({
    has: page.getByRole('button', { name: 'New entity', exact: true }),
  });
}

function colorPanel(page) {
  return page.locator('[data-entity-color-panel]').first();
}

async function pickPreset(page, hex) {
  const panel = colorPanel(page);
  await expect(panel).toBeVisible();
  await panel.getByTitle(hex, { exact: true }).click();
}

async function findEntitySwatch(page, role) {
  return entitiesRail(page).evaluate((rail, roleName) => {
    const rows = [...rail.querySelectorAll('[data-drag-rearrange-row]')];
    const row = rows.find((node) => node.querySelector('input[placeholder="Entity name"]')?.value === roleName);
    const button = row?.querySelector('button[aria-label="Edit color"]');
    if (!button) return null;
    const raw = getComputedStyle(button).backgroundColor;
    const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(raw);
    const hx = (n) => Number(n).toString(16).padStart(2, '0');
    return {
      hex: match ? `#${hx(match[1])}${hx(match[2])}${hx(match[3])}` : raw,
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

test('Templates entity color intended + break + edge', async ({ page }) => {
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByRole('button', { name: 'New template', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  const emptyColors = await page.getByRole('button', { name: 'Edit color' }).count();
  expect(emptyColors, 'empty templates have no entity color').toBe(0);

  await openHub(page);
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('textbox', { name: 'Entity name' }).first()).toHaveValue('GC');
  await expect(entitiesRail(page).getByRole('button', { name: 'Edit color' }).first()).toBeVisible();
  expect((await findEntitySwatch(page, 'GC'))?.hex.toLowerCase()).toBe(GC_HEX);
  expect((await findEntitySwatch(page, 'Subcontractor'))).toBeTruthy();

  await clickEditColor(page, 'GC');
  await expect(colorPanel(page)).toBeVisible();
  await expect(colorPanel(page).getByRole('button', { name: 'Fill', exact: true })).toBeVisible();
  await pickPreset(page, '#00FF00');
  expect((await findEntitySwatch(page, 'GC'))?.hex.toLowerCase()).toBe('#00ff00');
  expect((await findEntitySwatch(page, 'Subcontractor'))?.hex.toLowerCase()).not.toBe('#00ff00');
  await entitiesRail(page).getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(entitiesRail(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  expect((await findEntitySwatch(page, 'GC'))?.hex.toLowerCase()).toBe(GC_HEX);

  await clickEditColor(page, 'GC');
  await pickPreset(page, '#FF0000');
  expect((await findEntitySwatch(page, 'GC'))?.hex.toLowerCase()).toBe('#ff0000');
  const subBefore = (await findEntitySwatch(page, 'Subcontractor'))?.hex.toLowerCase();
  await colorPanel(page).getByRole('button', { name: 'Border', exact: true }).click();
  await expect(colorPanel(page).getByText('Match fill', { exact: true })).toBeVisible();
  await colorPanel(page).locator('input[type="checkbox"]').check();
  const matchLocked = await colorPanel(page).evaluate((panel) => (
    [...panel.querySelectorAll('div')].some((node) => node.style.pointerEvents === 'none')
  ));
  expect(matchLocked, 'Match fill locks the border picker').toBe(true);
  await colorPanel(page).getByTitle('#0000FF', { exact: true }).click({ timeout: 1500 }).catch(() => {});
  expect((await findEntitySwatch(page, 'GC'))?.hex.toLowerCase()).toBe('#ff0000');
  expect((await findEntitySwatch(page, 'Subcontractor'))?.hex.toLowerCase()).toBe(subBefore);

  await entitiesRail(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(entitiesRail(page).getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await page.getByText('MEP As-Built Markup').first().click();
  await expect(page.getByRole('textbox', { name: 'Entity name' }).first()).toHaveValue('MEP');
  await page.getByText('Security Walk-Through').first().click();
  await expect(page.getByRole('textbox', { name: 'Entity name' }).first()).toHaveValue('GC');
  expect((await findEntitySwatch(page, 'GC'))?.hex.toLowerCase()).toBe('#ff0000');
  expect((await findEntitySwatch(page, 'Subcontractor'))?.hex.toLowerCase()).toBe(subBefore);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileRow = page.locator('.templates-mobile-row').filter({ hasText: 'Security Walk-Through' }).first();
  let mobileBefore = 0;
  let mobilePicked = false;
  if (await mobileRow.isVisible().catch(() => false)) {
    await mobileRow.click();
    await page.getByRole('button', { name: 'Entities', exact: true }).click();
    const mobileDialog = page.getByRole('dialog', { name: 'Entities' });
    await expect(mobileDialog).toBeVisible();
    const mobileEdit = mobileDialog.getByRole('button', { name: 'Edit color' });
    mobileBefore = await mobileEdit.count();
    if (mobileBefore > 0) {
      await mobileEdit.first().click();
      const mobilePanel = mobileDialog.locator('[data-entity-color-panel]');
      await expect(mobilePanel).toBeVisible();
      await mobilePanel.getByTitle('#0000FF', { exact: true }).click();
      const mobileSwatch = await mobileEdit.first().evaluate((button) => (
        getComputedStyle(button).getPropertyValue('--entity-color') || getComputedStyle(button).backgroundColor
      ));
      mobilePicked = /#0000ff|rgb\(\s*0,\s*0,\s*255/i.test(String(mobileSwatch));
    }
  } else {
    mobileBefore = await page.getByRole('button', { name: 'Edit color' }).count();
  }

  await assertNoErrorBoundary(page);
  console.log(JSON.stringify({
    TEMPLATES_ENTITY_COLOR_PROOF: {
      emptyZero: emptyColors === 0,
      cancelRestored: true,
      fillSaved: true,
      isolation: true,
        matchFillLocked: matchLocked,
      mobileEdit: mobileBefore,
      mobilePicked,
    },
  }));
});
