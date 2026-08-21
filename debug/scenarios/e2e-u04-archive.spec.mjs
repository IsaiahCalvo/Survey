import { test, expect } from '@playwright/test';

const HUB = '/?hubPreview=1&tab=templates';

const USED_ITEM = 'Is the camera cable pulled?';
const UNUSED_ITEM = 'Is the camera installed?';

function valueInput(page, value) {
  return page.locator(`input[value="${value}"]`);
}

async function openSecurityWalkThrough(page) {
  await page.goto(HUB);
  await expect(page.getByRole('button', { name: 'New template', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByText('Security Walk-Through').first().click();
  await expect(valueInput(page, 'Security Walk-Through')).toBeVisible();
}

async function expandCameras(page) {
  const camerasInput = valueInput(page, 'Cameras');
  await expect(camerasInput).toBeVisible();
  const expand = camerasInput.locator('xpath=preceding-sibling::button[@title="Expand" or @title="Collapse"]');
  if ((await expand.getAttribute('title')) === 'Expand') {
    await expand.click();
  }
  await expect(valueInput(page, USED_ITEM)).toBeVisible();
  await expect(valueInput(page, UNUSED_ITEM)).toBeVisible();
}

function itemRow(page, label) {
  return page.locator('[data-drag-rearrange-row]').filter({ has: valueInput(page, label) });
}

test('U-04 archive-with-markers on hubPreview TemplatesEditor', async ({ page }) => {
  await openSecurityWalkThrough(page);
  await expandCameras(page);

  // Intended: used item (MOCK usage 3) opens KAL-44 warning + count + Archive/Cancel.
  await itemRow(page, USED_ITEM).getByRole('button', { name: 'Delete item', exact: true }).click();
  const modal = page.getByTestId('archive-confirm-modal');
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('heading', { name: 'Archive checklist item?' })).toBeVisible();
  await expect(modal).toContainText('3');
  await expect(modal).toContainText('survey markers have');
  await expect(modal).toContainText(USED_ITEM);
  await expect(page.getByTestId('archive-confirm-cancel')).toBeVisible();
  await expect(page.getByTestId('archive-confirm-archive')).toBeVisible();

  // Edge: Cancel leaves the item active.
  await page.getByTestId('archive-confirm-cancel').click();
  await expect(modal).toHaveCount(0);
  await expect(valueInput(page, USED_ITEM)).toBeVisible();
  await expect(page.locator('[data-archived-item-id="i1"]')).toHaveCount(0);

  // Edge: Archive moves it to the Archived tail (still in the template).
  await itemRow(page, USED_ITEM).getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(modal).toBeVisible();
  await page.getByTestId('archive-confirm-archive').click();
  await expect(modal).toHaveCount(0);
  await expect(valueInput(page, USED_ITEM)).toHaveCount(0);
  await expect(page.getByTestId('archived-items-c1')).toBeVisible();
  await expect(page.locator('[data-archived-item-id="i1"]')).toContainText(USED_ITEM);

  // Break: unused item (usage 0) hard-deletes — no warning, different path.
  await itemRow(page, UNUSED_ITEM).getByRole('button', { name: 'Delete item', exact: true }).click();
  await expect(page.getByTestId('archive-confirm-modal')).toHaveCount(0);
  await expect(valueInput(page, UNUSED_ITEM)).toHaveCount(0);
  await expect(page.locator('[data-archived-item-id="i2"]')).toHaveCount(0);

  console.log('U04_ARCHIVE_PROOF', JSON.stringify({
    route: HUB,
    usedItem: USED_ITEM,
    unusedItem: UNUSED_ITEM,
    usedUsage: 3,
    cancelLeftItem: true,
    confirmArchived: true,
    unusedHardDeleted: true,
  }));
});
