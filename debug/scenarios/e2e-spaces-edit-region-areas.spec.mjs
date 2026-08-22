import { test, expect } from '@playwright/test';

// Unique leftover after notes Photo/Video attach:
// Spaces "Edit region areas on the page" (Region Selection Tool)
// + overlay on/off + last-space behavior.
// Distinct from Create space / rename / add-pages (U-02 cluster that only
// covered stamp/list presence). Not leftover-18. UL-31 Continue pin parked.
// No file.id. Do not invent Print / stamp / measure / Group / Extract /
// Note-Link / Copy-to-Spaces / category Move-Copy / checklist items.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try { localStorage.removeItem('survey_document_history_events_v1'); } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByText('Rendered fewer hooks')).toHaveCount(0);
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
}

function spacesTab(page) {
  return page.getByRole('button', { name: 'Spaces', exact: true });
}

function editRegionBtn(page) {
  return page.getByRole('button', { name: 'Edit region areas on the page' });
}

function exitRegionBtn(page) {
  return page.getByRole('button', { name: 'Exit region edit' });
}

function regionUi(page) {
  return page.locator('[data-region-selection-ui="true"]');
}

function regionTarget(page) {
  return page.locator('[data-region-selection-target="1"]');
}

function overlayRoot(page) {
  return page.locator('[data-space-region-overlay-root="1"]');
}

function overlaySvg(page) {
  return page.locator('[data-space-region-overlay-svg="1"]');
}

function hideOverlay(page) {
  return page.locator('[aria-label="Hide overlay for this region"]');
}

function showOverlay(page) {
  return page.locator('[aria-label="Show overlay for this region"]');
}

function defineOverlayFirst(page) {
  return page.locator('[aria-label="Define regions first to enable overlay"]');
}

function enableSpaceForOverlay(page) {
  return page.locator('[aria-label="Enable space to toggle overlay"]');
}

async function openSpaces(page) {
  const tab = spacesTab(page);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(page.getByRole('button', { name: 'Create space', exact: true })).toBeVisible({ timeout: 15_000 });
}

async function createSpaceWithPage(page, pageSpec = '1') {
  await page.getByRole('button', { name: 'Create space', exact: true }).click();
  const name = page.getByRole('textbox', { name: /Rename Space/i }).first();
  await expect(name).toBeVisible({ timeout: 8_000 });
  const addInput = page.locator('.space-add-pages-input');
  await expect(addInput).toBeVisible({ timeout: 8_000 });
  await addInput.fill(pageSpec);
  await page.getByRole('button', { name: 'Add pages', exact: true }).click();
  await expect.poll(async () => page.locator('.space-region-row').count(), {
    timeout: 8_000,
    message: 'expected a space-region row after Add pages',
  }).toBeGreaterThan(0);
}

async function enterRegionEdit(page) {
  await expect(editRegionBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await editRegionBtn(page).first().click();
  await expect(exitRegionBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(regionTarget(page)).toBeAttached({ timeout: 8_000 });
  await expect(regionUi(page).first()).toBeVisible({ timeout: 8_000 });
}

async function dragRegion(page, { x0 = 0.22, y0 = 0.28, x1 = 0.48, y1 = 0.50 } = {}) {
  const layer = regionUi(page).last();
  await expect(layer).toBeVisible({ timeout: 8_000 });
  const box = await layer.boundingBox();
  expect(box, 'region-selection overlay geometry').toBeTruthy();
  await page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * x1, box.y + box.height * y1, { steps: 10 });
  await page.mouse.up();
}

async function emptyClick(page) {
  const layer = regionUi(page).last();
  await expect(layer).toBeVisible({ timeout: 8_000 });
  const box = await layer.boundingBox();
  expect(box, 'region-selection overlay geometry').toBeTruthy();
  await page.mouse.click(box.x + box.width * 0.62, box.y + box.height * 0.62);
}

function regionConfirm(page) {
  return regionUi(page).getByRole('button', { name: 'Confirm', exact: true });
}

function regionCancel(page) {
  return regionUi(page).getByRole('button', { name: 'Cancel', exact: true });
}

async function confirmRegion(page) {
  await expect(regionConfirm(page)).toBeVisible({ timeout: 8_000 });
  await regionConfirm(page).click();
  await expect(exitRegionBtn(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(regionTarget(page)).toHaveCount(0);
}

async function pageViewBox(page) {
  const raw = await page.locator('[data-svg-annotation-layer="1"]').first().getAttribute('viewBox');
  return { raw: raw || '' };
}

async function overlayViewBox(page) {
  return overlaySvg(page).getAttribute('viewBox');
}

test('U-02 Edit region areas + overlay on/off + last space', async ({ page }) => {
  const toasts = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (/no regions yet/i.test(text)) toasts.push(text);
  });

  await openEditor(page);
  await openSpaces(page);

  // Break: enter with no spaces — the edit-region control is absent.
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await editRegionBtn(page).count(), 'no Edit region with zero spaces').toBe(0);
  expect(await overlayRoot(page).count(), 'no overlay with zero spaces').toBe(0);

  await createSpaceWithPage(page, '1');
  await expect(editRegionBtn(page).first()).toBeVisible();
  await expect(enableSpaceForOverlay(page).first()).toBeVisible();
  expect(await hideOverlay(page).count(), 'overlay toggle stays dimmed until a region exists').toBe(0);

  // Break: Turn on space with no regions — toast, stay off.
  await page.getByLabel('Turn on space').click();
  await expect(page.getByText(/no regions yet/i).first()).toBeVisible({ timeout: 8_000 });
  await expect(page.getByLabel('Turn on space')).toBeVisible();
  await expect(enableSpaceForOverlay(page).first()).toBeVisible();
  expect(await overlayRoot(page).count(), 'no overlay before a region').toBe(0);

  // Break: Esc/cancel + empty click leave no region.
  await enterRegionEdit(page);
  await emptyClick(page);
  await page.keyboard.press('Escape');
  await expect(exitRegionBtn(page)).toHaveCount(0, { timeout: 8_000 });
  await expect(editRegionBtn(page).first()).toBeVisible();
  expect(await overlayRoot(page).count(), 'Esc after empty click writes nothing').toBe(0);
  // Region-edit entry activates the space even without a drawn region, so the
  // toggle flips from "Enable space…" to "Define regions first…".
  await expect(defineOverlayFirst(page).first()).toBeVisible();

  await enterRegionEdit(page);
  await emptyClick(page);
  await expect(regionCancel(page)).toBeVisible();
  await regionCancel(page).click();
  await expect(exitRegionBtn(page)).toHaveCount(0, { timeout: 8_000 });
  expect(await overlayRoot(page).count(), 'Cancel after empty click writes nothing').toBe(0);

  // Break: Pen-armed still enters and can confirm a region (return-tool restores Pen).
  await page.getByRole('button', { name: 'Draw', exact: true }).click();
  const pen = page.getByRole('button', { name: 'Pen', exact: true });
  await expect(pen).toBeVisible({ timeout: 8_000 });
  if (!(String(await pen.getAttribute('class') || '').includes('btn-active'))) {
    await pen.click();
  }
  await openSpaces(page);
  await enterRegionEdit(page);
  await dragRegion(page);
  await confirmRegion(page);
  await expect(overlayRoot(page)).toBeVisible({ timeout: 8_000 });
  await expect(overlaySvg(page)).toBeVisible();
  const overlayBox = await overlayViewBox(page);
  expect(overlayBox, 'overlay viewBox after confirm').toMatch(/^0 0 /);
  await expect(hideOverlay(page).first()).toBeVisible();
  await expect(page.getByLabel('Turn off space')).toBeVisible();
  const penClass = String(await pen.getAttribute('class') || '');
  expect(penClass.includes('btn-active'), 'Pen restores after region confirm').toBe(true);

  // Intended: overlay on/off.
  await hideOverlay(page).first().click();
  await expect(showOverlay(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(overlayRoot(page)).toHaveCount(0);
  await showOverlay(page).first().click();
  await expect(hideOverlay(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(overlayRoot(page)).toBeVisible();

  // Last-space off: the only space turns off → overlay hides; on → overlay returns.
  await page.getByLabel('Turn off space').click();
  await expect(page.getByLabel('Turn on space')).toBeVisible({ timeout: 8_000 });
  await expect(overlayRoot(page)).toHaveCount(0);
  await page.getByLabel('Turn on space').click();
  await expect(page.getByLabel('Turn off space')).toBeVisible({ timeout: 8_000 });
  await expect(overlayRoot(page)).toBeVisible();

  // Edge: undo rewinds the space:update checkpoint (region gone).
  await page.keyboard.press('Control+z');
  await expect.poll(async () => overlayRoot(page).count(), {
    timeout: 8_000,
    message: 'undo drops the confirmed region overlay',
  }).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  await expect(overlayRoot(page)).toBeVisible({ timeout: 8_000 });

  // Edge: zoom viewBox still page-space on the overlay.
  const zoomIn = page.getByRole('button', { name: /Zoom in/i }).first();
  if (await zoomIn.count()) {
    await zoomIn.click();
    await zoomIn.click();
  }
  const annoViewBox = (await pageViewBox(page)).raw;
  expect(annoViewBox.startsWith('0 0 '), 'annotation viewBox owns scale').toBe(true);
  const zoomedOverlay = await overlayViewBox(page);
  expect(zoomedOverlay, 'overlay viewBox after zoom').toBe(overlayBox);

  // Re-enter edit, then Exit via the rail control (no rewrite).
  await openSpaces(page);
  await enterRegionEdit(page);
  await exitRegionBtn(page).first().click();
  await expect(editRegionBtn(page).first()).toBeVisible({ timeout: 8_000 });
  await expect(overlayRoot(page)).toBeVisible();

  // Last space delete: confirm wipes the only space + overlay.
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.space-card-delete-button').first().click();
  await expect.poll(async () => page.locator('[data-space-sortable-row-id]').count(), {
    timeout: 8_000,
    message: 'last space delete returns to empty list',
  }).toBe(0);
  await expect(page.getByText(/No spaces yet/i)).toBeVisible({ timeout: 8_000 });
  expect(await editRegionBtn(page).count(), 'Edit region gone after last space').toBe(0);
  expect(await overlayRoot(page).count(), 'overlay gone after last space').toBe(0);

  const persist = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(persist, 'no file.id').toBeNull();
  await assertNoErrorBoundary(page);

  // Edge: 390 — Open spaces + Edit region control if present.
  await openEditor(page, { width: 390, height: 844 });
  await expect(page.locator('[data-mobile-pdf-header="true"]')).toBeVisible({ timeout: 30_000 });
  const openSpacesBtn = page.getByRole('button', { name: 'Open spaces' });
  await expect(openSpacesBtn).toBeVisible({ timeout: 15_000 });
  await openSpacesBtn.click();
  const create390 = page.getByRole('button', { name: 'Create space', exact: true });
  const edit390 = editRegionBtn(page);
  let mobileEdit = 0;
  let mobileCreate = 0;
  if (await create390.count()) {
    mobileCreate = await create390.count();
    await expect(create390.first()).toBeVisible({ timeout: 8_000 });
    await create390.first().click();
    const add390 = page.locator('.space-add-pages-input');
    if (await add390.count()) {
      await add390.fill('1');
      const addPages = page.getByRole('button', { name: 'Add pages', exact: true });
      if (await addPages.count()) await addPages.click();
    }
    mobileEdit = await edit390.count();
    if (mobileEdit > 0) {
      await edit390.first().click();
      const mobileToolbar = page.getByRole('toolbar', { name: 'Region editing' });
      await expect(mobileToolbar).toBeVisible({ timeout: 8_000 });
      await mobileToolbar.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(mobileToolbar).toHaveCount(0, { timeout: 8_000 });
    }
  }

  await assertNoErrorBoundary(page);
  console.log('SPACES_EDIT_REGION_AREAS_PROOF', JSON.stringify({
    persist,
    noSpacesEdit: 0,
    overlayAfterConfirm: true,
    overlayToggle: true,
    lastSpaceOffOn: true,
    undoRewound: true,
    overlayViewBox: overlayBox,
    zoomedOverlayViewBox: zoomedOverlay,
    lastSpaceDeleted: true,
    mobileCreate,
    mobileEdit,
    toasts: toasts.length,
  }));
});
