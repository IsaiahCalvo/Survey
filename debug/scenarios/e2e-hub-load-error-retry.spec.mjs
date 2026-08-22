import { test, expect } from '@playwright/test';

// Unique leftover after Documents Select All / None / Done.
// Hub load-error Try again (`HubLoadError` / HubPreview `retryLoad`).
// Distinct from Documents Select All / Share Access / extras / Lock persist /
// Open file, leftover-18 Upload, empty=1 EmptyState, and hubLoading skeletons.
// Do not replay those families. Do not invent leftover-18.

const HUB = '/?hubPreview=1';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const TOWER = 'Tower 5 — Security';
const SECURITY = 'Security Walk-Through';

async function openPage(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

async function openHub(page, { width = 1440, height = 900, url } = {}) {
  await openPage(page, { width, height, url });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

test('Hub load-error Try again intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);

  // --- Break: default seed and empty=1 have no Try again ---
  await openHub(page, { url: `${HUB}&tab=documents` });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);

  await openHub(page, { url: `${HUB}&empty=1&tab=documents` });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Upload/ }).first()).toBeVisible();

  await openHub(page, { url: `${HUB}&hubLoading=documents&tab=documents` });
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByText(OWNER)).toHaveCount(0);

  // --- Intended: documents hubError + Try again restores the seed ---
  await openHub(page, { url: `${HUB}&hubError=documents&tab=documents` });
  const docsAlert = page.getByRole('alert');
  await expect(docsAlert).toBeVisible();
  await expect(docsAlert).toContainText("Couldn't load documents. Check your connection and try again.");
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(1);
  await expect(page.getByText(OWNER)).toHaveCount(0);
  await expect(page.locator('[data-document-id]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText(OWNER).first()).toBeVisible();
  await expect(page.locator('.documents-desktop-card [data-document-id]')).toHaveCount(6);
  await expect(page).toHaveURL(/hubError=documents/);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);

  // --- Edge: projects + templates same chrome; Archive stays off this path ---
  await openHub(page, { url: `${HUB}&hubError=projects&tab=projects` });
  await expect(page.getByRole('alert')).toContainText("Couldn't load projects.");
  await expect(page.getByText(TOWER)).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByText(TOWER).first()).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  await openHub(page, { url: `${HUB}&hubError=templates&tab=templates` });
  await expect(page.getByRole('alert')).toContainText("Couldn't load templates.");
  await expect(page.getByText(SECURITY)).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByText(SECURITY).first()).toBeVisible();

  await openHub(page, { url: `${HUB}&hubError=documents&tab=archive` });
  await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);

  // Isolation: documents retry is not Archive Restore / leftover-18 Upload picker
  await openHub(page, { url: `${HUB}&hubError=documents&tab=documents` });
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Restore', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete forever', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select', exact: true }).first()).toBeVisible();

  // --- Edge: 390 documents Try again ---
  await openHub(page, { width: 390, height: 844, url: `${HUB}&hubError=documents&tab=documents` });
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(1);
  await expect(page.locator('.mobile-doc-card')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
  await expect(page.locator('.mobile-doc-card').filter({ hasText: OWNER })).toBeVisible();
  await expect(page.locator('.mobile-doc-card')).toHaveCount(6);

  console.log('HUB_LOAD_ERROR_RETRY_PROOF', JSON.stringify({
    defaultNoTryAgain: true,
    emptyNoTryAgain: true,
    loadingNoTryAgain: true,
    documentsRestored: true,
    projectsRestored: true,
    templatesRestored: true,
    archiveIsolated: true,
    mobileRetry: true,
    leftover18UploadNotInvented: true,
  }));
});
