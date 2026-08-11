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

test('cold-load skeletons keep desktop Home geometry stable', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });

  await openHub(page, 'documents');
  const documentsReal = await box(page.locator('.documents-desktop-card'));
  await openHub(page, 'documents', true);
  const documentsSkeleton = await box(page.locator('.documents-desktop-card'));
  closeTo(documentsSkeleton.width, documentsReal.width);
  closeTo(documentsSkeleton.height, documentsReal.height);

  await openHub(page, 'projects');
  await page.locator('.projects-desktop-layout [data-drag-rearrange-row]').first().waitFor();
  const projectsReal = await page.evaluate(() => {
    const layout = document.querySelector('.projects-desktop-layout');
    const detail = layout.children[1];
    return {
      grid: getComputedStyle(layout).gridTemplateColumns,
      header: detail.firstElementChild.getBoundingClientRect().height,
      columns: getComputedStyle(detail.children[1]).gridTemplateColumns,
      fileRow: document.querySelector('[data-drag-rearrange-row][style*="height: 42px"]')?.getBoundingClientRect().height,
    };
  });
  await openHub(page, 'projects', true);
  const projectsSkeleton = await page.evaluate(() => ({
    grid: getComputedStyle(document.querySelector('.projects-desktop-layout')).gridTemplateColumns,
    header: document.querySelector('.hub-loading-project-header').getBoundingClientRect().height,
    columns: getComputedStyle(document.querySelector('.hub-loading-project-columns')).gridTemplateColumns,
    fileRow: document.querySelector('.hub-loading-project-file-row').getBoundingClientRect().height,
  }));
  expect(projectsSkeleton.grid).toBe(projectsReal.grid);
  expect(projectsSkeleton.columns).toBe(projectsReal.columns);
  closeTo(projectsSkeleton.header, projectsReal.header);
  closeTo(projectsSkeleton.fileRow, projectsReal.fileRow);

  await openHub(page, 'templates');
  await page.locator('.templates-editor-grid input').first().waitFor();
  const templatesReal = await page.evaluate(() => {
    const grid = document.querySelector('.templates-editor-grid');
    const entitiesCard = grid.querySelector('aside:last-child .card');
    return {
      grid: getComputedStyle(grid).gridTemplateColumns,
      height: grid.getBoundingClientRect().height,
      editorHeader: grid.querySelector('section').firstElementChild.getBoundingClientRect().height,
      entitiesHeader: entitiesCard.firstElementChild.getBoundingClientRect().height,
      entityRow: entitiesCard.querySelector('[data-drag-rearrange-row]').getBoundingClientRect().height,
    };
  });
  await openHub(page, 'templates', true);
  const templatesSkeleton = await page.evaluate(() => {
    const grid = document.querySelector('.templates-editor-grid');
    return {
      grid: getComputedStyle(grid).gridTemplateColumns,
      height: grid.getBoundingClientRect().height,
      editorHeader: document.querySelector('.hub-loading-template-header').getBoundingClientRect().height,
      entitiesHeader: document.querySelector('.hub-loading-entities-header').getBoundingClientRect().height,
      entityRow: document.querySelector('.hub-loading-entity-row').getBoundingClientRect().height,
    };
  });
  expect(templatesSkeleton.grid).toBe(templatesReal.grid);
  closeTo(templatesSkeleton.height, templatesReal.height);
  closeTo(templatesSkeleton.editorHeader, templatesReal.editorHeader);
  closeTo(templatesSkeleton.entitiesHeader, templatesReal.entitiesHeader);
  closeTo(templatesSkeleton.entityRow, templatesReal.entityRow);
});

test('cold-load skeletons keep mobile Home geometry stable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });

  const selectors = {
    documents: { row: '.mobile-doc-card' },
    projects: { row: '.projects-mobile-folder-row.drill.reorderable' },
    templates: { row: '.templates-mobile-row.reorderable' },
  };

  for (const [tab, selector] of Object.entries(selectors)) {
    await openHub(page, tab, false, true);
    await page.locator(`${selector.row}:not(.hub-loading-mobile-row)`).first().waitFor();
    const real = {
      actions: await box(page.locator('.actions')),
      select: await box(page.locator('.mobile-header-select-row')),
      row: await box(page.locator(selector.row).first()),
    };

    await openHub(page, tab, true, true);
    await page.locator('.hub-loading-region').waitFor();
    const skeleton = {
      actions: await box(page.locator('.actions')),
      select: await box(page.locator('.mobile-header-select-row')),
      row: await box(page.locator(selector.row).first()),
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
