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
