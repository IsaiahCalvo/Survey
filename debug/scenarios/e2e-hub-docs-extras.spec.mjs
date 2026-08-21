import { test, expect } from '@playwright/test';

// Unique unblocked GAP after catalog reconcile 2026-08-21:
// hub documents More extras that catalog-completeness did not cover
// (search / rename / delete already live). Do not invent leftover-18.

const HUB = '/?hubPreview=1&tab=documents';

async function openHub(page) {
  await page.goto(HUB);
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('test.pdf').first()).toBeVisible({ timeout: 15_000 });
}

function desktopRow(page, name) {
  return page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: name }).first();
}

async function openMore(page, name) {
  await desktopRow(page, name).getByRole('button', { name: 'More' }).click();
  await expect(page.getByRole('menu')).toBeVisible();
}

test('Hub documents Copy/Paste + Duplicate + Move/Copy + Sort + Preview intended + break + edge', async ({ page }) => {
  await openHub(page);

  const fileHeader = page.locator('.documents-desktop-card').locator('span', { hasText: /^File/ }).first();
  const sizeHeader = page.locator('.documents-desktop-card').locator('span', { hasText: /^Size/ }).first();
  await expect(fileHeader).toBeVisible();

  const namesBeforeSort = await page.locator('.documents-desktop-card [data-document-id]').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('span')?.textContent?.trim() || '')
  ));
  await sizeHeader.click();
  const namesAfterSize = await page.locator('.documents-desktop-card [data-document-id]').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('span')?.textContent?.trim() || '')
  ));
  expect(namesAfterSize.join('|')).not.toBe(namesBeforeSort.join('|'));
  await fileHeader.click();
  await expect(page.getByText('test.pdf').first()).toBeVisible();

  await openMore(page, 'test.pdf');
  const pasteEmpty = page.getByRole('menuitem', { name: 'Paste', exact: true });
  await expect(pasteEmpty).toBeDisabled();
  await page.keyboard.press('Escape');

  await desktopRow(page, 'test.pdf').click();
  const preview = page.getByText('Preview', { exact: true }).first();
  await expect(preview).toBeVisible();
  await expect(page.locator('aside').getByText('test.pdf').first()).toBeVisible();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(page.getByRole('button', { name: 'Close preview' })).toHaveCount(0);

  await openMore(page, 'test.pdf');
  await page.getByRole('menuitem', { name: 'Preview & details', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Close preview' })).toBeVisible();

  await openMore(page, 'test.pdf');
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await openMore(page, 'Package 2 — Rev 4 — IC.pdf');
  const pasteReady = page.getByRole('menuitem', { name: 'Paste', exact: true });
  await expect(pasteReady).toBeEnabled();
  await pasteReady.click();
  await expect(page.getByText('test-copy.pdf').first()).toBeVisible();
  await expect(page.getByText('test.pdf').first()).toBeVisible();

  const select = page.getByRole('button', { name: 'Select', exact: true }).first();
  await expect(select).toBeVisible();
  await select.click();
  await expect(page.getByRole('button', { name: 'Done', exact: true }).first()).toBeVisible();
  const duplicate = page.getByRole('button', { name: 'Duplicate', exact: true });
  const moveCopy = page.getByRole('button', { name: 'Move/Copy', exact: true });
  await expect(duplicate).toBeDisabled();
  await expect(moveCopy).toBeDisabled();

  await desktopRow(page, 'Package 2 — Rev 4 — IC.pdf').click();
  await expect(duplicate).toBeEnabled();
  await duplicate.click();
  await expect(page.getByText('Package 2 — Rev 4 — IC-copy.pdf').first()).toBeVisible();
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible();

  // Duplicate clears the selection but stays in Select mode (button reads Done).
  await expect(page.getByRole('button', { name: 'Done', exact: true }).first()).toBeVisible();
  await desktopRow(page, 'RFI-014 Lobby Camera Coverage.pdf').click();
  await page.getByRole('button', { name: 'Move/Copy', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Move or copy documents' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Move here' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByRole('button', { name: 'Move/Copy', exact: true }).click();
  const again = page.getByRole('dialog', { name: 'Move or copy documents' });
  await expect(again).toBeVisible();
  await again.getByRole('button', { name: 'Copy', exact: true }).click();
  await again.getByRole('button', { name: 'MEP Phase 2' }).click();
  await again.getByRole('button', { name: 'Copy here' }).click();
  await expect(again).toHaveCount(0);
  await expect(page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: 'RFI-014 Lobby Camera Coverage.pdf' })).toHaveCount(2);

  await page.getByRole('button', { name: 'Done', exact: true }).first().click();
  await desktopRow(page, 'test-copy.pdf').click();
  await expect(page.getByRole('button', { name: 'Close preview' })).toBeVisible();

  const lockItem = page.getByRole('menuitem', { name: /Lock document|Unlock document/ });
  await openMore(page, 'SE-011 Security Shop Drawings.pdf');
  await expect(page.getByRole('menuitem', { name: 'Lock document', exact: true })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Lock document', exact: true }).click();
  await openMore(page, 'SE-011 Security Shop Drawings.pdf');
  await expect(page.getByRole('menuitem', { name: 'Lock document', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();

  console.log('HUB_DOCS_EXTRAS_PROOF', JSON.stringify({
    sortSizeChangedOrder: namesAfterSize.join('|') !== namesBeforeSort.join('|'),
    pasteDisabledEmpty: true,
    previewClose: true,
    copyPaste: 'test-copy.pdf',
    selectDuplicateDisabled: true,
    selectDuplicate: 'Package 2 — Rev 4 — IC-copy.pdf',
    moveCopyCancel: true,
    copyToProject: 2,
    lockNoOpWithoutHandler: true,
    noFileId: fileId === null,
  }));
});
