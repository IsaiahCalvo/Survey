import { test, expect } from '@playwright/test';

// Product bug leftover the color-picker Width/Style hunt parked, then
// the Style/Search hunt: 390 Documents sort had no Search/Upload
// passthrough, so the first header tap only dismissed the menu.
// Canvas / document-row dismiss must still not activate.
// Distinct from leftover-18 / X-01. No file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';

async function openEditor(page, { width = 1440, height = 900, url = LINK_PDF } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function assertNoErrorBoundary(page) {
  await expect(page.getByRole('button', { name: 'Reload Page' })).toHaveCount(0);
  await expect(page.getByText(/Rendered fewer hooks/i)).toHaveCount(0);
}

async function clickVisible(page, name) {
  const buttons = page.getByRole('button', { name, exact: true });
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return button;
    }
  }
  await expect(buttons.first(), `visible ${name}`).toBeVisible();
  await buttons.first().click();
  return buttons.first();
}

async function activateTool(page, categoryName, toolName) {
  const sub = page.getByRole('button', { name: toolName, exact: true });
  const visibleSub = async () => {
    const count = await sub.count();
    for (let i = 0; i < count; i += 1) {
      if (await sub.nth(i).isVisible().catch(() => false)) return sub.nth(i);
    }
    return null;
  };
  if (!(await visibleSub())) {
    await clickVisible(page, categoryName);
  }
  const target = (await visibleSub()) || sub.first();
  await expect(target).toBeVisible();
  const pressed = await target.getAttribute('aria-pressed');
  const active = String(await target.getAttribute('class') || '').includes('is-active')
    || String(await target.getAttribute('class') || '').includes('btn-active');
  if (pressed !== 'true' && !active) await target.click();
}

async function userInkCount(page, pageNumber = 1) {
  return page.evaluate((pageNum) => (
    [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .filter((group) => {
        const id = group.getAttribute('data-anno-id');
        const object = window.__phase35GetAnnotationById?.(id) || {};
        return object.isPdfImported !== true;
      }).length
  ), pageNumber);
}

test('390 Style / Arrowhead first Width tap opens presets', async ({ page }) => {
  test.setTimeout(180_000);

  await openEditor(page, { width: 390, height: 844 });
  await assertNoErrorBoundary(page);

  await activateTool(page, 'Shapes', 'Rectangle');
  const style = page.getByRole('button', { name: /Border style/i }).first();
  await expect(style).toBeVisible({ timeout: 8_000 });
  await style.click();
  await expect(page.getByRole('option', { name: 'Cloud', exact: true })).toBeVisible();

  // Intended — first Width tap dismisses Style and opens presets.
  const widthTrigger = page.getByRole('button', { name: 'Width presets', exact: true }).first();
  await expect(widthTrigger).toBeVisible();
  await widthTrigger.click();
  await expect(page.getByRole('option', { name: 'Cloud', exact: true })).toHaveCount(0);
  const widthPopover = page.locator('[data-annotation-size-popover="true"]');
  await expect(widthPopover).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await expect(widthPopover).toHaveCount(0);

  await activateTool(page, 'Shapes', 'Arrow');
  const arrow = page.getByRole('button', { name: /Arrowhead style/i }).first();
  await expect(arrow).toBeVisible();
  await arrow.click();
  await expect(page.getByRole('listbox', { name: 'Arrowhead style' })).toBeVisible();
  await widthTrigger.click();
  await expect(page.getByRole('listbox', { name: 'Arrowhead style' })).toHaveCount(0);
  await expect(widthPopover).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('Escape');
  await expect(widthPopover).toHaveCount(0);

  // Break — canvas tap still dismisses without starting a stroke.
  await activateTool(page, 'Draw', 'Pen');
  await activateTool(page, 'Shapes', 'Rectangle');
  await style.click();
  await expect(page.getByRole('option', { name: 'Cloud', exact: true })).toBeVisible();
  const before = await userInkCount(page);
  const pageEl = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
  const box = await pageEl.boundingBox();
  expect(box, 'page geometry').toBeTruthy();
  await page.mouse.click(box.x + box.width * 0.35, box.y + box.height * 0.40);
  await expect(page.getByRole('option', { name: 'Cloud', exact: true })).toHaveCount(0);
  expect(await userInkCount(page)).toBe(before);

  await assertNoErrorBoundary(page);
  console.log('MOBILE_SELECT_WIDTH_PASSTHROUGH', JSON.stringify({
    styleFirstWidth: true,
    arrowFirstWidth: true,
    canvasNoStroke: true,
  }));
});

test('Documents search first Upload click + edge hub / testPdf', async ({ page }) => {
  test.setTimeout(180_000);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  const search = page.locator('.documents-desktop-search input[placeholder="Search documents..."]');
  await expect(search).toBeVisible();
  await search.click();
  await search.fill('test');
  await expect(search).toBeFocused();

  const logs = [];
  page.on('console', (msg) => logs.push(msg.text()));
  await page.locator('.documents-desktop-upload').click();
  await expect.poll(() => logs.some((text) => text.includes('[hub preview] upload'))).toBe(true);
  await expect(search).not.toBeFocused();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  // Break — a document row click still only blurs search (does not open).
  await search.click();
  await expect(search).toBeFocused();
  const row = page.locator('.documents-desktop-card [data-document-id]').first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(search).not.toBeFocused();
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
  await expect(page.locator('.survey-hub')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const mobileSearch = page.locator('.hub-mobile-search-actions input[placeholder="Search documents..."]');
  if (await mobileSearch.isVisible().catch(() => false)) {
    await mobileSearch.click();
    await mobileSearch.fill('test');
    await page.locator('.hub-mobile-primary-action').click();
    await expect.poll(() => logs.some((text) => text.includes('[hub preview] upload'))).toBe(true);
  }

  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible();
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('SEARCH_UPLOAD_PASSTHROUGH_EDGE', JSON.stringify({
    desktopUpload: true,
    rowNoOpen: true,
    hub: true,
    testPdf: true,
  }));
});

test('390 Documents sort first Upload / Search click lands', async ({ page }) => {
  test.setTimeout(180_000);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  const sort = page.locator('.documents-mobile-filter');
  await expect(sort).toBeVisible();
  await sort.click();
  const sortMenu = page.locator('.documents-mobile-sort-menu');
  await expect(sortMenu).toBeVisible();

  const logs = [];
  page.on('console', (msg) => logs.push(msg.text()));

  // Intended — first Upload tap dismisses sort and fires upload.
  await page.locator('.hub-mobile-primary-action').click();
  await expect(sortMenu).toHaveCount(0);
  await expect.poll(() => logs.some((text) => text.includes('[hub preview] upload'))).toBe(true);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);

  await sort.click();
  await expect(sortMenu).toBeVisible();
  const mobileSearch = page.locator('.hub-mobile-search-actions input[placeholder="Search documents..."]');
  await expect(mobileSearch).toBeVisible();
  await mobileSearch.click();
  await expect(sortMenu).toHaveCount(0);
  await expect(mobileSearch).toBeFocused();
  await mobileSearch.fill('test');

  // Complementary intended — first sort tap while Search is focused
  // dismisses the field and still opens the menu.
  await sort.click();
  await expect(mobileSearch).not.toBeFocused();
  await expect(sortMenu).toBeVisible();

  // Break — a document row click still only dismisses (does not open).
  const row = page.locator('.documents-mobile-list [data-document-id]').first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(sortMenu).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toHaveCount(0);
  await expect(page.locator('.survey-hub')).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.documents-mobile-filter')).toBeHidden();

  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible();
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('DOCUMENTS_SORT_SIBLING_PASSTHROUGH', JSON.stringify({
    firstUpload: true,
    firstSearch: true,
    rowNoOpen: true,
    desktopSortHidden: true,
    testPdf: true,
  }));
});

test('Manage Team Search first Invite click + 390 Templates Save', async ({ page }) => {
  test.setTimeout(180_000);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${HUB}&tab=projects`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });

  await page.getByRole('button', { name: 'Manage team', exact: true }).click();
  const team = page.getByRole('dialog', { name: 'Manage Team' });
  await expect(team).toBeVisible({ timeout: 10_000 });
  const teamSearch = team.locator('input[placeholder="Find a teammate…"]');
  await teamSearch.click();
  await teamSearch.fill('isaiah');
  await expect(teamSearch).toBeFocused();

  // Intended — first Invite tap dismisses Search and opens Invite.
  await team.getByRole('button', { name: 'Invite', exact: true }).click();
  const invite = page.getByRole('dialog', { name: 'Invite User' });
  await expect(invite).toBeVisible();
  await expect(teamSearch).not.toBeFocused();
  await invite.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(invite).toHaveCount(0);

  await teamSearch.click();
  await expect(teamSearch).toBeFocused();
  await team.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(team.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(teamSearch).not.toBeFocused();

  // Break — a member row click still only blurs search (does not open More).
  await team.getByRole('button', { name: 'Done', exact: true }).click();
  await teamSearch.click();
  await expect(teamSearch).toBeFocused();
  const memberRow = team.locator('[data-kal31-project-member]').first();
  await expect(memberRow).toBeVisible();
  await memberRow.click();
  await expect(teamSearch).not.toBeFocused();
  await expect(team.locator('[data-manage-team-dismiss-surface="true"]')).toHaveCount(0);
  await expect(team.getByText('View activity')).toHaveCount(0);
  await expect(invite).toHaveCount(0);
  await team.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(team).toHaveCount(0);

  // 390 Templates — first Save tap while content Search is focused lands.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${HUB}&tab=templates`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
  const firstRow = page.locator('.templates-mobile-browser .templates-mobile-row').first();
  await expect(firstRow).toBeVisible();
  await firstRow.click();
  const nameInput = page.locator('.templates-mobile-inline-input').first();
  await expect(nameInput).toBeVisible();
  await nameInput.click();
  await nameInput.fill('Dirty name');
  const save = page.locator('.templates-mobile-save-row button.primary');
  await expect(save).toBeVisible();
  const contentSearch = page.locator('.templates-mobile-search-actions input[placeholder="Search template..."]');
  await contentSearch.click();
  await contentSearch.fill('cam');
  await expect(contentSearch).toBeFocused();
  await save.click();
  await expect(save).toHaveCount(0);
  await expect(contentSearch).not.toBeFocused();

  await openEditor(page);
  await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible();
  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  await assertNoErrorBoundary(page);

  console.log('SEARCH_INVITE_SAVE_PASSTHROUGH', JSON.stringify({
    firstInvite: true,
    firstEdit: true,
    memberRowNoMenu: true,
    templates390Save: true,
    testPdf: true,
  }));
});
