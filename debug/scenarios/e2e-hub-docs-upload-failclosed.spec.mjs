import { test, expect } from '@playwright/test';

// Leftover-18 UL-03 fail-closed slice that was still thinner than a dedicated
// intended+break+edge proof: Hub Documents Upload on hubPreview.
// HubPreview.handleUpload logs `[hub preview] upload` and returns unless
// workflowE2E. No <input type=file>. No OS chooser. No invented cloud upload.
// Distinct from leftover18-unblock web `/` Auth-modal gate + Electron IPC,
// Guest AuthModal A-01, Documents Select All / Share Access / extras / Lock /
// Open file, Hub Try again, Settings General / Usage, A-04, Archive, TabBar,
// Projects / Templates / Spaces / Survey-rail / PDF waves.
// Do not invent .env.local, Stripe, MSAL, Turnstile, leases, or prod SQL.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const HUB_WORKFLOW = '/?hubPreview=1&workflowE2E=1&tab=documents';
const OWNER = 'SE-011 Security Shop Drawings.pdf';

async function openHub(page, { width = 1440, height = 900, url } = {}) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

function attachWatchers(page) {
  const logs = [];
  const choosers = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.includes('[hub preview] upload')) logs.push(text);
  });
  page.on('filechooser', (chooser) => {
    choosers.push(chooser.url ? chooser : true);
  });
  return { logs, choosers };
}

async function assertStayClosed(page, { choosers, expectAuth = false } = {}) {
  expect(choosers.length).toBe(0);
  await expect(page).toHaveURL(/hubPreview=1/);
  await expect(page).not.toHaveURL(/checkout\.stripe|accounts\.google|login\.microsoftonline|identity\.microsoft/i);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
  if (!expectAuth) {
    await expect(page.locator('.auth-modal')).toHaveCount(0);
  }
}

async function clickAndExpectUploadLog(page, button, logs, choosers, extra = {}) {
  logs.length = 0;
  choosers.length = 0;
  await button.click();
  await expect.poll(() => logs.length).toBe(1);
  expect(logs[0]).toContain('[hub preview] upload');
  await assertStayClosed(page, { choosers, ...extra });
}

test('Hub Documents Upload fail-closed intended + break + edge', async ({ page }) => {
  test.setTimeout(180_000);
  const { logs, choosers } = attachWatchers(page);

  // --- Break: seed Upload exists, no file input, no chooser until/after click ---
  await openHub(page, { url: HUB });
  await expect(page.getByText(OWNER).first()).toBeVisible({ timeout: 20_000 });
  const desktopUpload = page.locator('.documents-desktop-upload');
  await expect(desktopUpload).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByTestId('mobile-workflow-upload-input')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Upload PDF' })).toHaveCount(0);
  const seedCount = await page.locator('.documents-desktop-card [data-document-id]').count();
  expect(seedCount).toBe(6);

  // --- Intended: header Upload logs and does not open a picker ---
  await clickAndExpectUploadLog(page, desktopUpload, logs, choosers);
  await expect(page.locator('.documents-desktop-card [data-document-id]')).toHaveCount(6);
  await expect(page.getByText(OWNER).first()).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  // Double-click still fail-closed (no second picker, no extra row).
  await clickAndExpectUploadLog(page, desktopUpload, logs, choosers);
  await expect(page.locator('.documents-desktop-card [data-document-id]')).toHaveCount(6);

  // Search no-match still has header Upload; click does not mint a row.
  // empty=1 keeps EmptyState ("No documents yet") even after a query.
  const search = page.locator('.documents-desktop-search input[placeholder="Search documents..."]');
  await search.fill('zzzz-no-such-document');
  await expect(page.getByText('No documents match your search.').first()).toBeVisible();
  await clickAndExpectUploadLog(page, desktopUpload, logs, choosers);
  await expect(page.getByText('No documents match your search.').first()).toBeVisible();
  await expect(page.locator('.documents-desktop-card [data-document-id]')).toHaveCount(0);
  await expect(page.getByText(OWNER)).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  // --- Break: empty=1 EmptyState Upload PDF + header Upload ---
  await openHub(page, { url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);

  const emptyPdf = page.getByRole('button', { name: 'Upload PDF' }).first();
  await expect(emptyPdf).toBeVisible();
  await clickAndExpectUploadLog(page, emptyPdf, logs, choosers);
  await expect(page.getByText('No documents yet').first()).toBeVisible();
  await expect(page.locator('[data-document-id]')).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  await clickAndExpectUploadLog(page, page.locator('.documents-desktop-upload'), logs, choosers);
  await expect(page.getByText('No documents yet').first()).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  // --- Break: guest Continue-without then Upload (do not replay A-01 submit) ---
  await openHub(page, { url: HUB_GUEST });
  const auth = page.locator('.auth-modal');
  await expect(auth).toBeVisible({ timeout: 15_000 });
  await auth.getByRole('button', { name: 'Continue without an account' }).click();
  await expect(auth).toHaveCount(0);
  await expect(page.locator('.profile-signin').first()).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await clickAndExpectUploadLog(page, page.locator('.documents-desktop-upload'), logs, choosers);
  await expect(page.locator('.profile-signin').first()).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  // --- Edge: workflowE2E mounts the harness input; do not pick a file ---
  await openHub(page, { url: HUB_WORKFLOW });
  await expect(page.getByTestId('mobile-workflow-upload-input')).toHaveCount(1);
  await expect(page.getByTestId('mobile-workflow-upload-input')).toHaveAttribute('type', 'file');
  await expect(page.getByTestId('mobile-workflow-upload-input')).toHaveAttribute('accept', 'application/pdf');
  // Isolation: this leftover does not complete a harness pick.
  await expect(page.getByRole('button', { name: 'Start trial' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Connect', exact: true })).toHaveCount(0);

  // --- Edge: 390 empty Upload PDF + header Upload ---
  await openHub(page, { width: 390, height: 844, url: HUB_EMPTY });
  await expect(page.getByText('No documents yet').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.documents-desktop-upload')).toBeHidden();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await clickAndExpectUploadLog(page, page.getByRole('button', { name: 'Upload PDF' }).first(), logs, choosers);
  await expect(page.getByText('No documents yet').first()).toBeVisible();
  await clickAndExpectUploadLog(page, page.locator('.hub-mobile-primary-action'), logs, choosers);
  await expect(page.locator('.mobile-doc-card')).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  await openHub(page, { width: 390, height: 844, url: HUB });
  await expect(page.locator('.mobile-doc-card').filter({ hasText: OWNER })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.mobile-doc-card')).toHaveCount(6);
  await clickAndExpectUploadLog(page, page.locator('.hub-mobile-primary-action'), logs, choosers);
  await expect(page.locator('.mobile-doc-card')).toHaveCount(6);

  console.log('HUB_DOCS_UPLOAD_FAILCLOSED_PROOF', JSON.stringify({
    intendedHeaderUpload: true,
    emptyUploadPdf: true,
    emptyHeaderUpload: true,
    searchNoMatch: true,
    guestContinueThenUpload: true,
    workflowInputCatalogOnly: true,
    mobileEmptyAndSeed: true,
    noFileChooser: choosers.length === 0,
    leftover18HostNotInvented: true,
  }));
});
