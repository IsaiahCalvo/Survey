import { test, expect } from '@playwright/test';

const closeTo = (actual, expected, tolerance = 0.75, label = 'geometry') => {
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance);
};

const openHub = async (page, tab, loading = false, mobile = false) => {
  const query = new URLSearchParams({ hubPreview: '1', tab });
  if (mobile) {
    query.set('mobileNav', 'tabs');
    query.set('nativeShell', 'expo');
  }
  if (loading) query.set('hubLoading', tab);
  await page.goto(`/?${query}`);
  await page.locator('.survey-hub').waitFor();
};

const box = async (locator) => locator.evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
});

// Owner 2026-10-04: one calm loading state. The list area shows the quiet
// "Loading <tab>…" line (no placeholder rows); the header must not move when
// the data lands.
test('first load keeps the desktop Home header still and shows one quiet line', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const tab of ['documents', 'projects', 'templates']) {
    await openHub(page, tab);
    const real = await box(page.locator('.actions'));
    await openHub(page, tab, true);
    await page.locator('.hub-loading-region [data-quiet-loading]').waitFor();
    const loading = await box(page.locator('.actions'));
    for (const dimension of ['x', 'y', 'width', 'height']) {
      closeTo(loading[dimension], real[dimension], 0.75, `${tab}.actions.${dimension}`);
    }
    await expect(page.locator('.hub-loading-region .quiet-loading-text')).toHaveText(new RegExp(`^Loading ${tab}…$`));
  }
});

test('first load keeps the mobile Home header still', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const selectors = {
    documents: { row: '.mobile-doc-card' },
    projects: { row: '.projects-mobile-folder-row.drill.reorderable' },
    templates: { row: '.templates-mobile-row.reorderable' },
  };

  for (const [tab, selector] of Object.entries(selectors)) {
    await openHub(page, tab, false, true);
    await page.locator(selector.row).first().waitFor();
    const real = {
      actions: await box(page.locator('.actions')),
      select: await box(page.locator('.mobile-header-select-row')),
    };

    await openHub(page, tab, true, true);
    await page.locator('.hub-loading-region').waitFor();
    const skeleton = {
      actions: await box(page.locator('.actions')),
      select: await box(page.locator('.mobile-header-select-row')),
    };

    for (const area of Object.keys(real)) {
      for (const dimension of ['x', 'y', 'width', 'height']) {
        closeTo(skeleton[area][dimension], real[area][dimension], 0.75, `${tab}.${area}.${dimension}`);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  }
});

test('mobile account menu consumes the first outside document tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'documents', false, true);

  const firstDocument = page.locator('.mobile-doc-card').first();
  await firstDocument.waitFor();
  await page.getByRole('button', { name: 'Open account menu' }).click();
  await expect(page.getByRole('menu', { name: 'Account menu' })).toBeVisible();

  await page.locator('.profile-menu-scrim').click({ position: { x: 40, y: 300 } });
  await expect(page.getByRole('menu', { name: 'Account menu' })).toHaveCount(0);
  await expect(page).toHaveURL(/hubPreview=1/);
  await expect(firstDocument).toBeVisible();

  await firstDocument.click();
  await expect(page).toHaveURL(/testPdf=/);
});

test('focused mobile search consumes the first outside document tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'documents', false, true);

  const search = page.locator('input[placeholder="Search documents..."]').first();
  const firstDocument = page.locator('.mobile-doc-card').first();
  await search.focus();
  await expect(search).toBeFocused();

  await firstDocument.click();
  await expect(search).not.toBeFocused();
  await expect(page).toHaveURL(/hubPreview=1/);
  await expect(firstDocument).toBeVisible();

  await firstDocument.click();
  await expect(page).toHaveURL(/testPdf=/);
});

test('mobile document More menu consumes the first outside document tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'documents', false, true);

  const rows = page.locator('.mobile-doc-card');
  const target = rows.nth(1);
  await rows.first().getByTitle('More').click();
  await expect(page.locator('body > [role="menu"]')).toBeVisible();

  await target.click();
  await expect(page.locator('body > [role="menu"]')).toHaveCount(0);
  await expect(page).toHaveURL(/hubPreview=1/);
  await expect(target).toBeVisible();

  await target.click();
  await expect(page).toHaveURL(/testPdf=/);
});

test('mobile project More menu consumes the first outside project tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'projects', false, true);

  const rows = page.locator('.projects-mobile-folder-row.drill.reorderable');
  const initialCount = await rows.count();
  const target = rows.first();
  await rows.last().getByTitle('More').click();
  await expect(page.locator('body > [role="menu"]')).toBeVisible();

  await target.click();
  await expect(page.locator('body > [role="menu"]')).toHaveCount(0);
  await expect(rows).toHaveCount(initialCount);
  await expect(target).toBeVisible();

  await target.click();
  await expect(rows).toHaveCount(0);
});

test('mobile template More menu consumes the first outside template tap', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'templates', false, true);

  const rows = page.locator('.templates-mobile-row.reorderable');
  const initialCount = await rows.count();
  const target = rows.first();
  await rows.last().getByTitle('More').click();
  await expect(page.locator('body > [role="menu"]')).toBeVisible();

  await target.click();
  await expect(page.locator('body > [role="menu"]')).toHaveCount(0);
  await expect(rows).toHaveCount(initialCount);
  await expect(target).toBeVisible();

  await target.click();
  await expect(rows).toHaveCount(0);
  await expect(page.locator('.templates-mobile-detail')).toBeVisible();
});

test('mobile New category remains actionable while template search is focused', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'templates', false, true);

  await page.locator('.templates-mobile-row.reorderable').first().click();
  await expect(page.locator('.templates-mobile-detail')).toBeVisible();

  const search = page.locator('input[placeholder="Search template..."]').first();
  const categories = page.locator('.templates-mobile-categories-section .templates-mobile-category-row');
  const initialCount = await categories.count();

  await search.fill('no matching category');
  await expect(search).toBeFocused();
  await expect(categories).toHaveCount(0);

  await page.locator('.templates-mobile-categories-section').getByRole('button', { name: 'New category' }).click();

  await expect(search).toHaveValue('');
  await expect(categories).toHaveCount(initialCount + 1);
  const createdName = categories.last().locator('input');
  await expect(createdName).toHaveValue('Category 1');
  await expect(createdName).toBeFocused();
});

test('mobile New category seeds the first module in an empty template', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?hubPreview=1&tab=templates&mobileNav=tabs&nativeShell=expo&workflowE2E=1');
  await page.locator('.templates-mobile-row.reorderable').first().waitFor();

  const templates = page.locator('.templates-mobile-row.reorderable');
  const initialTemplateCount = await templates.count();
  await page.getByRole('button', { name: 'New template' }).first().click();
  await expect(templates).toHaveCount(initialTemplateCount + 1);
  await templates.first().click();

  await page.locator('.templates-mobile-categories-section').getByRole('button', { name: 'New category' }).click();

  await expect(page.locator('.templates-mobile-module-tabs')).toContainText('Module 1');
  const createdName = page.locator('.templates-mobile-categories-section input[data-mobile-category-id]').last();
  await expect(createdName).toHaveValue('Category 1');
  await expect(createdName).toBeFocused();
});

test('mobile document details trap focus, close on Escape, and restore More', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'documents', false, true);

  const opener = page.locator('.mobile-doc-card').first().getByTitle('More');
  await opener.click();
  await page.getByRole('menuitem', { name: 'Preview & details' }).click();

  const dialog = page.getByRole('dialog', { name: /details$/ });
  const close = dialog.getByTitle('Close details');
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();

  await dialog.getByRole('button', { name: 'Open file' }).focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('mobile Entities traps focus, closes on Escape, and restores its opener', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'templates', false, true);
  await page.locator('.templates-mobile-row.reorderable').first().click();

  const opener = page.getByRole('button', { name: 'Entities' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Entities' });
  const close = dialog.getByRole('button', { name: 'Close' });
  await expect(close).toBeFocused();

  await dialog.locator('button').last().focus();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('Entities yields focus and Escape to real Share, Move/Copy, and color layers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'templates', false, true);
  await page.locator('.templates-mobile-row.reorderable').first().click();
  await page.getByRole('button', { name: 'Entities' }).click();

  const entities = page.getByRole('dialog', { name: 'Entities' });
  await entities.getByRole('button', { name: 'Select' }).click();
  await entities.getByRole('button', { name: 'All' }).click();

  const shareOpener = entities.getByTitle('Share');
  await shareOpener.click();
  const share = page.getByRole('dialog', { name: 'Share template' });
  await expect(share.getByTitle('Close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(share).toHaveCount(0);
  await expect(entities).toBeVisible();
  await expect(shareOpener).toBeFocused();

  await entities.getByRole('button', { name: 'Move/Copy' }).click();
  const move = page.getByRole('dialog', { name: 'Move or copy items' });
  await expect(move.getByTitle('Close')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(move).toHaveCount(0);
  await expect(entities).toBeVisible();

  await entities.getByRole('button', { name: 'Done' }).click();
  await entities.getByTitle('Edit color').first().click();
  const visibleColorPicker = page.locator('[data-testid="compact-color-picker"]:visible');
  await expect(visibleColorPicker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(visibleColorPicker).toHaveCount(0);
  await expect(entities).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(entities).toHaveCount(0);
});

test('named mobile controls provide at least 44px hit geometry', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const effectiveHitBox = (locator) => locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const pseudo = getComputedStyle(element, '::after');
    const hasHitPseudo = pseudo.display !== 'none' && pseudo.content !== 'none';
    const top = hasHitPseudo ? (Number.parseFloat(pseudo.top) || 0) : 0;
    const bottom = hasHitPseudo ? (Number.parseFloat(pseudo.bottom) || 0) : 0;
    const left = hasHitPseudo ? (Number.parseFloat(pseudo.left) || 0) : 0;
    const right = hasHitPseudo ? (Number.parseFloat(pseudo.right) || 0) : 0;
    const hit = {
      left: rect.left + left,
      right: rect.right - right,
      top: rect.top + top,
      bottom: rect.bottom - bottom,
    };
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      const clip = ancestor.getBoundingClientRect();
      if (style.overflowX !== 'visible') {
        hit.left = Math.max(hit.left, clip.left);
        hit.right = Math.min(hit.right, clip.right);
      }
      if (style.overflowY !== 'visible') {
        hit.top = Math.max(hit.top, clip.top);
        hit.bottom = Math.min(hit.bottom, clip.bottom);
      }
    }
    const sampleX = (hit.left + hit.right) / 2;
    const topTarget = document.elementFromPoint(sampleX, hit.top + 1);
    const bottomTarget = document.elementFromPoint(sampleX, hit.bottom - 1);
    return {
      width: Math.max(0, hit.right - hit.left),
      height: Math.max(0, hit.bottom - hit.top),
      topHittable: topTarget === element || element.contains(topTarget),
      bottomHittable: bottomTarget === element || element.contains(bottomTarget),
    };
  });

  const expectLeadControlAligned = async (row, control) => {
    const rowBox = await row.boundingBox();
    const controlBox = await control.boundingBox();
    expect(rowBox).not.toBeNull();
    expect(controlBox).not.toBeNull();
    expect(controlBox.x - rowBox.x).toBeCloseTo(3, 0);
    expect(controlBox.width).toBeGreaterThanOrEqual(44);
  };

  await openHub(page, 'documents', false, true);
  for (const control of [
    page.getByRole('button', { name: 'Upload' }).first(),
    page.locator('.mobile-header-select-button'),
    page.locator('.documents-mobile-filter'),
    page.getByRole('button', { name: 'Open account menu' }),
    page.locator('.mobile-doc-card').first().getByTitle('More'),
  ]) {
    const hit = await effectiveHitBox(control);
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
    expect(hit.topHittable).toBe(true);
    expect(hit.bottomHittable).toBe(true);
  }
  await expectLeadControlAligned(
    page.locator('.mobile-doc-card').first(),
    page.locator('.mobile-doc-card').first().getByTitle('More'),
  );

  await openHub(page, 'projects', false, true);
  for (const control of [
    page.getByRole('button', { name: 'New project' }),
    page.locator('.mobile-header-select-button'),
    page.locator('.projects-mobile-folder-row.drill.reorderable').first().getByTitle('More'),
  ]) {
    const hit = await effectiveHitBox(control);
    expect(hit.width).toBeGreaterThanOrEqual(44);
    expect(hit.height).toBeGreaterThanOrEqual(44);
    expect(hit.topHittable).toBe(true);
    expect(hit.bottomHittable).toBe(true);
  }
  await expectLeadControlAligned(
    page.locator('.projects-mobile-folder-row.drill.reorderable').first(),
    page.locator('.projects-mobile-folder-row.drill.reorderable').first().locator('[data-drag-rearrange-handle]'),
  );

  await openHub(page, 'templates', false, true);
  for (const control of [
    page.getByRole('button', { name: 'New template' }),
    page.locator('.mobile-header-select-button'),
    page.locator('.templates-mobile-row.reorderable').first().getByTitle('More'),
  ]) {
    const listHit = await effectiveHitBox(control);
    expect(listHit.width).toBeGreaterThanOrEqual(44);
    expect(listHit.height).toBeGreaterThanOrEqual(44);
    expect(listHit.topHittable).toBe(true);
    expect(listHit.bottomHittable).toBe(true);
  }
  await expectLeadControlAligned(
    page.locator('.templates-mobile-row.reorderable').first(),
    page.locator('.templates-mobile-row.reorderable').first().locator('[data-drag-rearrange-handle]'),
  );
  await page.locator('.templates-mobile-row.reorderable').first().click();
  for (const control of [
    page.locator('.templates-mobile-back-button:visible'),
    page.getByRole('button', { name: 'Entities' }),
    page.locator('[data-drag-rearrange-handle]:visible').first(),
    page.locator('.templates-mobile-category-toggle:visible').first(),
  ]) {
    const detailHit = await effectiveHitBox(control);
    expect(detailHit.width).toBeGreaterThanOrEqual(44);
    expect(detailHit.height).toBeGreaterThanOrEqual(44);
  }

  await page.getByRole('button', { name: 'Entities' }).click();
  const entitiesDialog = page.getByRole('dialog', { name: 'Entities' });
  for (const control of [
    entitiesDialog.locator('[data-drag-rearrange-handle]').first(),
    entitiesDialog.getByTitle('Edit color').first(),
    entitiesDialog.locator('.templates-mobile-more').first(),
  ]) {
    const entityHit = await effectiveHitBox(control);
    expect(entityHit.width).toBeGreaterThanOrEqual(44);
    expect(entityHit.height).toBeGreaterThanOrEqual(44);
  }
});

test('edge swipe exposes the already-rendered template list under the moving detail', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'templates', false, true);
  await page.locator('.templates-mobile-row.reorderable').first().click();
  await expect(page.locator('.templates-mobile-detail')).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 4, y: 280 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 150, y: 282 }] });
  await page.evaluate(() => new Promise(requestAnimationFrame));

  const underlay = page.locator('[data-mobile-swipe-underlay="true"]');
  await expect(underlay).toHaveCount(1);
  await expect(underlay.locator('.templates-mobile-row.reorderable').first()).toBeVisible();
  expect(await page.locator('.main.mobile-edge-swipe-active').evaluate((element) => getComputedStyle(element).transform)).not.toBe('none');

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(underlay).toHaveCount(0);
  await expect(page.locator('.templates-mobile-detail')).toBeVisible();
});

test('completed edge swipe navigates once while a second gesture is ignored during settle', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'projects', false, true);
  await page.locator('.projects-mobile-folder-row.drill.reorderable').first().click();
  await expect(page.locator('.projects-mobile-drill-view')).toBeVisible();

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 3, y: 290 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 260, y: 292 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.locator('.main.mobile-edge-swipe-settling')).toHaveCount(1);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 3, y: 310 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 180, y: 312 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(page.locator('[data-mobile-swipe-underlay="true"]')).toHaveCount(0);
  await expect(page.locator('.projects-mobile-folder-row.drill.reorderable').first()).toBeVisible();
  await expect(page.locator('.survey-hub')).toHaveClass(/hub-tab-projects/);
});

test('desktop and mobile document Share controls preserve document semantics', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openHub(page, 'documents');
  const previewAside = page.locator('aside').filter({ has: page.getByTitle('Share') });
  const selectedName = await previewAside.locator(':scope > div').nth(1).textContent();
  await previewAside.getByTitle('Share').click();
  await expect(page.getByText('Share document', { exact: true })).toBeVisible();
  const desktopShareClose = page.getByTitle('Close').last();
  await expect(desktopShareClose.locator('..').getByText(selectedName, { exact: true })).toBeVisible();
  await desktopShareClose.click();

  await page.setViewportSize({ width: 390, height: 844 });
  await openHub(page, 'documents', false, true);
  const mobileRow = page.locator('.mobile-doc-card').first();
  const mobileName = await mobileRow.locator('.mobile-card-title').textContent();
  await mobileRow.getByTitle('More').click();
  await page.getByRole('menuitem', { name: 'Share' }).click();
  await expect(page.getByText('Share document', { exact: true })).toBeVisible();
  const mobileShareClose = page.getByTitle('Close').last();
  await expect(mobileShareClose.locator('..').getByText(mobileName, { exact: true })).toBeVisible();
});
