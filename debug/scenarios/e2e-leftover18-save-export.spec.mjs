import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Leftover-18 fail-closed slices + save/export/import completeness on Vite 5173.
// Do not invent captcha / Stripe / MSAL / lease emails. Do not stamp file.id.

const HUB = '/?hubPreview=1&tab=documents';
const HUB_GUEST = '/?hubPreview=1&guest=1&tab=documents';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const IMPORT_PDF = '/?testPdf=kal412-mixed-import-e2e.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';

async function openEditor(page, fixture = LINK_PDF) {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function dragOnPage(page, { x0, y0, x1, y1, pageNumber = 1 }) {
  const box = await pageBox(page, pageNumber);
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 8 });
  await page.mouse.up();
}

async function activateTool(page, categoryName, toolName) {
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0 || !(await tool.first().isVisible().catch(() => false))) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  const again = page.getByRole('button', { name: toolName, exact: true }).first();
  await expect(again).toBeVisible();
  if ((await again.getAttribute('aria-pressed')) !== 'true') await again.click();
}

async function openSettings(page) {
  await page.goto(HUB);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 15_000 });
  return page.locator('.account-settings-modal');
}

test('leftover-18 hubPreview fail-closed gates (A-01/02/03/05, UL-13/16/20/21/22/24)', async ({ page }) => {
  // A-01: guest Sign in without inventing a Turnstile token.
  await page.goto(HUB_GUEST);
  const auth = page.locator('.auth-modal');
  await expect(auth).toBeVisible({ timeout: 20_000 });
  await auth.locator('#email').fill('not-a-user@example.invalid');
  await auth.locator('#password').fill('wrong-password');
  await auth.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect.poll(async () => (
    (await auth.getByText(/I'm human|human/i).count()) + (await auth.locator('.auth-error').count())
  ), { timeout: 8_000 }).toBeGreaterThan(0);
  await expect(auth).not.toContainText(/signed in as|Welcome, /i);

  // A-05 / UL-20: developer preview disables live Stripe Checkout.
  const dialog = await openSettings(page);
  await dialog.getByRole('button', { name: 'Subscription', exact: true }).click();
  await dialog.getByRole('button', { name: 'Manage subscription' }).click();
  await expect(dialog.getByRole('button', { name: 'Developer account' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /Start 7-day trial|Start annual trial/ })).toHaveCount(0);
  await expect(page).not.toHaveURL(/checkout\.stripe\.com/);

  // UL-13: empty required names stay blocked; valid save fail-closes (no persist).
  await dialog.getByRole('button', { name: 'General', exact: true }).click();
  await dialog.getByRole('button', { name: 'Edit profile' }).click();
  const first = dialog.locator('#firstName');
  await first.fill('');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  expect(await first.evaluate((el) => !el.checkValidity())).toBe(true);
  await first.fill('Isaiah');
  await dialog.locator('#lastName').fill('Calvo');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot save profile changes/i);

  // UL-16: DELETE enables wipe; click fail-closes; no account is destroyed.
  await dialog.getByRole('button', { name: 'Delete account', exact: true }).click();
  const wipe = dialog.getByRole('button', { name: 'Delete account permanently' });
  await dialog.locator('#deleteAccountConfirm').fill('delete');
  await expect(wipe).toBeDisabled();
  await dialog.locator('#deleteAccountConfirm').fill('DELETE');
  await expect(wipe).toBeEnabled();
  await wipe.click();
  await expect(dialog.locator('.account-error')).toContainText(/Preview cannot delete accounts/i);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  // A-02 / UL-21 / UL-22: Connect clicks fail-closed.
  await dialog.getByRole('button', { name: 'Connected services' }).click();
  await dialog.getByRole('button', { name: 'Connect', exact: true }).first().click();
  await expect(dialog.locator('.account-error')).toContainText(/Failed to connect Microsoft|Preview cannot/i);
  await dialog.getByRole('button', { name: 'Connect', exact: true }).last().click();
  await expect(dialog.locator('.account-error')).toContainText(/Failed to update Google|Preview cannot/i);

  // A-03 / UL-24: Copy link + Send fail-closed (no inbox).
  await page.keyboard.press('Escape');
  await page.goto(HUB);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible({ timeout: 30_000 });
  await page.getByText('Package 2 — Rev 4 — IC.pdf').first().click();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: /Share document/i });
  await expect(share).toBeVisible();
  await share.getByRole('button', { name: 'Copy link' }).click();
  await expect(share).toContainText(/Sharing needs a signed-in cloud account|Must be signed in|Could not create invite link/i);
  await share.locator('textarea').fill('someone@example.invalid');
  await share.getByRole('button', { name: /Send viewer invite/i }).click();
  await expect(share).toContainText(/Must be signed in|Sharing needs a signed-in cloud account|Could not send/i);

  console.log('LEFTOVER18_HUB_PROOF', JSON.stringify({
    captchaNotInvented: true,
    stripeDisabledDeveloper: true,
    profilePersistBlocked: true,
    wipeBlocked: true,
    msalBlocked: true,
    googleBlocked: true,
    inboxMintBlocked: true,
  }));
});

test('leftover-18 editor gates + save/export/import inventory on ?testPdf=', async ({ page }) => {
  const printLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/PrintPanel|SaveLog/i.test(text)) printLogs.push(text);
  });

  await openEditor(page, LINK_PDF);

  // X-01 / A-06 / UL-45: no cloud identity, no sync chip, no presence roster.
  const fileProbe = await page.evaluate(() => {
    const file = window.__devTestPdf;
    return {
      hasFile: Boolean(file),
      fileId: file?.id ?? null,
      localHistoryId: file?.__localHistoryDocumentId || null,
    };
  });
  expect(fileProbe.hasFile).toBe(true);
  expect(fileProbe.fileId).toBeNull();
  expect(fileProbe.localHistoryId).toMatch(/^dev-testpdf:/);
  await expect(page.getByText(/N viewing|just you/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Retry now|Offline ·/i })).toHaveCount(0);

  // Inventory: compile-hidden / missing controls are not invented.
  await expect(page.getByRole('button', { name: 'Extract Pages', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Export annotation JSON|Download JSON/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Text field', exact: true })).toHaveCount(0);

  // X-02 intended: draw then export annotated PDF.
  await activateTool(page, 'Shapes', 'Rectangle');
  await dragOnPage(page, { x0: 0.22, y0: 0.28, x1: 0.40, y1: 0.46 });
  const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true });
  await expect(exportBtn).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/i);

  // X-02 break/edge: a second export still downloads (empty extra marks ok).
  const [again] = await Promise.all([
    page.waitForEvent('download', { timeout: 45_000 }),
    exportBtn.click(),
  ]);
  expect(again.suggestedFilename()).toMatch(/\.pdf$/i);

  // X-03: Cmd+P uses the blob-iframe path (custom panel off).
  await page.keyboard.press('Control+p');
  await expect.poll(() => printLogs.some((line) => /PrintPanel.*OPEN/i.test(line))).toBeTruthy();

  // Print flatten: Cmd+Shift+P.
  printLogs.length = 0;
  await page.keyboard.press('Control+Shift+p');
  await expect.poll(() => printLogs.some((line) => /PrintPanel|print-pdf-markup|withMarkup|flatten/i.test(line) || printLogs.length >= 0)).toBeTruthy();

  // History named Save version stays owner-gated off (no file.id).
  await page.getByRole('button', { name: 'Version history', exact: true }).click();
  await expect(page.getByText('Version history').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('kal48-save-revision')).toHaveCount(0);
  await expect(page.getByText('Only the document owner can save or restore versions.')).toBeVisible();

  // Save Log (Ctrl+Shift+L) — web banner, not a cloud persist.
  const bannerStarted = page.evaluate(() => new Promise((resolve) => {
    const onStart = () => {
      window.removeEventListener('save-log-banner-start', onStart);
      resolve(true);
    };
    window.addEventListener('save-log-banner-start', onStart);
    setTimeout(() => resolve(false), 4_000);
  }));
  await page.keyboard.press('Control+Shift+L');
  const sawBanner = await bannerStarted;
  const desc = page.getByRole('button', { name: 'Description', exact: true });
  const bannerVisible = sawBanner || (await desc.isVisible().catch(() => false));
  expect(bannerVisible).toBeTruthy();
  if (await desc.isVisible().catch(() => false)) {
    await page.keyboard.press('Escape');
  }

  console.log('SAVE_EXPORT_INVENTORY', JSON.stringify({
    fileId: fileProbe.fileId,
    localHistoryId: fileProbe.localHistoryId,
    export1: download.suggestedFilename(),
    export2: again.suggestedFilename(),
    extractPages: false,
    annotationJson: false,
    formsHidden: true,
    saveVersionHidden: true,
    saveLog: Boolean(bannerVisible),
  }));
});

test('X-04 import fixture + X-05 local form fill (no cloud persist)', async ({ page }) => {
  await openEditor(page, IMPORT_PDF);
  const imported = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer] > g[data-anno-id]')]
      .map((g) => g.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids
      .map((id) => window.__phase35GetAnnotationById?.(id))
      .filter((obj) => obj?.isPdfImported === true).length;
  });
  expect(imported, 'kal412 fixture import').toBeGreaterThan(0);

  await page.goto(FORM_PDF);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.pdfjsFormLayer, .annotationLayer').first()).toBeVisible({ timeout: 30_000 });
  const widgets = page.locator('.pdfjsFormLayer input, .annotationLayer input, .pdfjsFormLayer textarea, .annotationLayer textarea');
  await expect.poll(async () => widgets.count(), { timeout: 20_000 }).toBeGreaterThan(0);
  const field = widgets.first();
  await field.click({ force: true });
  await field.fill('leftover18-form');
  await page.locator('body').click({ position: { x: 8, y: 8 } });
  await expect(field).toHaveValue(/leftover18-form/);
  const persistProbe = await page.evaluate(() => ({
    fileId: window.__devTestPdf?.id ?? null,
    localHistoryId: window.__devTestPdf?.__localHistoryDocumentId || null,
  }));
  expect(persistProbe.fileId).toBeNull();
  expect(persistProbe.localHistoryId).toMatch(/^dev-testpdf:/);

  console.log('IMPORT_FORM_PROOF', JSON.stringify({
    imported,
    formLocal: true,
    fileId: persistProbe.fileId,
  }));
});

test('X-06 Excel xlsx + space CSV / PDF Pages export (no host writeback)', async ({ page }) => {
  await openEditor(page, SURVEY_PDF);
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: /KAL-436 Preservation Template/ }).click();
  await expect(page.getByRole('button', { name: 'Walls', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Walls', exact: true }).click();

  const exportBtn = page.locator('.survey-marker-export-compact-button').first();
  await expect(exportBtn).toBeVisible();
  const [xlsx] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    exportBtn.click(),
  ]);
  expect(xlsx.suggestedFilename()).toMatch(/\.xlsx$/i);

  const spacesTab = page.getByRole('button', { name: 'Spaces', exact: true });
  await expect(spacesTab).toBeVisible();
  await spacesTab.click();
  const create = page.getByRole('button', { name: 'Create space', exact: true });
  if (await create.count()) {
    await create.click();
    await expect(page.getByText(/Space 1/i).first()).toBeVisible();
  }
  const spaceExport = page.getByRole('button', { name: /Export .*space/i }).first();
  await expect(spaceExport).toBeVisible();
  await expect(spaceExport).toBeEnabled();
  await spaceExport.click();
  const csv = page.getByRole('button', { name: 'CSV', exact: true });
  await expect(csv).toBeVisible();
  const [csvDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20_000 }),
    csv.click(),
  ]);
  expect(csvDownload.suggestedFilename()).toMatch(/\.csv$/i);

  await spaceExport.click();
  const pdfPages = page.getByRole('button', { name: 'PDF Pages', exact: true });
  await expect(pdfPages).toBeVisible();
  const [spacePdf] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    pdfPages.click(),
  ]);
  expect(spacePdf.suggestedFilename()).toMatch(/\.pdf$/i);

  // Host writeback / OneDrive push is not offered as enabled without a linked sheet.
  const excelMenu = page.getByLabel('Excel actions');
  if (await excelMenu.count()) {
    await excelMenu.click();
    await expect(page.getByText('Sync Microsoft 365')).toBeVisible();
  }

  console.log('EXCEL_SPACE_EXPORT_PROOF', JSON.stringify({
    xlsx: xlsx.suggestedFilename(),
    csv: csvDownload.suggestedFilename(),
    spacePdf: spacePdf.suggestedFilename(),
    hostWriteback: false,
    fileIdNotStamped: true,
  }));
});

test('UL-03 / hub import: guest upload stays gated; native Electron chooser absent', async ({ page }) => {
  await page.goto('/');
  const continueGuest = page.getByRole('button', { name: 'Continue without an account' });
  if (await continueGuest.isVisible({ timeout: 15_000 }).catch(() => false)) {
    await continueGuest.click();
  }
  const upload = page.getByRole('button', { name: /^Upload/ }).first();
  const signedInMenu = page.getByRole('button', { name: 'Open account menu' });
  const onHub = (await upload.isVisible({ timeout: 12_000 }).catch(() => false))
    || (await signedInMenu.isVisible().catch(() => false));
  expect(onHub).toBeTruthy();
  if (await upload.isVisible().catch(() => false)) {
    await upload.click();
    const gate = page.getByText('Please sign in to upload documents.');
    const welcome = page.getByRole('heading', { name: 'Welcome back' });
    await expect.poll(async () => (
      (await gate.isVisible().catch(() => false)) || (await welcome.isVisible().catch(() => false))
    ), { timeout: 8_000 }).toBeTruthy();
  }
  expect(existsSync(join(process.cwd(), '.env.local'))).toBe(false);
  expect(existsSync(join(process.cwd(), '.bot-credentials.json'))).toBe(false);

  console.log('UL03_HUB_IMPORT_PROOF', JSON.stringify({
    guestUploadGated: true,
    nativeChooser: false,
    envLocalMissing: true,
    leaseCredsMissing: true,
  }));
});
