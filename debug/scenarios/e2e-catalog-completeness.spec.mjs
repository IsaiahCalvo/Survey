import { test, expect } from '@playwright/test';

const HUB = '/?hubPreview=1&tab=documents';
const HUB_WORKFLOW = '/?hubPreview=1&workflowE2E=1&tab=projects';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';

async function openHub(page, path = HUB) {
  await page.goto(path);
  await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
}

async function openEditor(page, fixture = LINK_PDF) {
  await page.goto(fixture);
  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.__phase35GetAnnotationById)).toBe('function');
}

async function pageBox(page, pageNumber = 1) {
  const box = await page.locator(`.survey-pdfjs-page-div[data-page-number="${pageNumber}"]`).boundingBox();
  expect(box, `page ${pageNumber} geometry`).toBeTruthy();
  return box;
}

async function activateTool(page, categoryName, toolName) {
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  await expect(tool).toBeVisible();
  await tool.click();
}

async function dragOnPage(page, {
  pageNumber = 1,
  x0 = 0.22,
  y0 = 0.28,
  x1 = 0.42,
  y1 = 0.46,
} = {}) {
  const box = await pageBox(page, pageNumber);
  const start = { x: box.x + box.width * x0, y: box.y + box.height * y0 };
  const end = { x: box.x + box.width * x1, y: box.y + box.height * y1 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
  return { start, end, box };
}

async function annotationStyle(page, id) {
  return page.evaluate((annoId) => {
    const object = window.__phase35GetAnnotationById?.(annoId) || {};
    const data = object.data || {};
    const host = document.querySelector(`[data-svg-annotation-layer="1"] [data-anno-id="${annoId}"]`);
    const svgDash = host?.querySelector('path, line, polyline')?.getAttribute('stroke-dasharray') || null;
    const dash = object.strokeDashArray || data.strokeDashArray || data.style?.strokeDashArray || svgDash;
    return {
      id: annoId,
      type: String(object.type || data.type || '').toLowerCase(),
      strokeDashArray: Array.isArray(dash) ? dash.join(',') : dash,
      lineBorderStyle: data.lineBorderStyle || data.borderStyle || data.style?.lineStyle || data.style?.lineBorderStyle || object.lineBorderStyle || null,
    };
  }, id);
}

test('Hub documents search / rename / delete intended + break + edge', async ({ page }) => {
  await openHub(page);
  await expect(page.getByText('test.pdf').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible();

  const search = page.locator('.documents-desktop-search input[placeholder="Search documents..."]');
  await expect(search).toBeVisible();

  await search.fill('zzzz-no-such-document');
  await expect(page.getByText('No documents match your search.').first()).toBeVisible();
  await expect(page.getByText('test.pdf')).toHaveCount(0);

  await search.fill('Package 2');
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible();
  await expect(page.getByText('test.pdf')).toHaveCount(0);

  await search.fill('');
  await expect(page.getByText('test.pdf').first()).toBeVisible();
  await page.locator('h1.title').click();

  const testRow = page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: 'test.pdf' }).first();
  await testRow.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  const rename = page.getByRole('dialog', { name: 'Rename document' });
  await expect(rename).toBeVisible();
  const nameField = rename.getByLabel('Name');
  await nameField.fill('   ');
  await expect(rename.getByRole('button', { name: 'Save' })).toBeDisabled();
  await nameField.fill('catalog-hunt.pdf');
  await rename.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('catalog-hunt.pdf').first()).toBeVisible();
  await expect(page.getByText('test.pdf')).toHaveCount(0);

  const renamed = page.locator('.documents-desktop-card [data-document-id]').filter({ hasText: 'catalog-hunt.pdf' }).first();
  await renamed.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(page.getByText('catalog-hunt.pdf')).toHaveCount(0);
  await expect(page.getByText('Package 2 — Rev 4 — IC.pdf').first()).toBeVisible();

  console.log('HUB_DOCS_PROOF', JSON.stringify({ searchMiss: true, rename: true, blankSaveDisabled: true, delete: true }));
});

test('Hub projects rename / delete / create intended + break + edge', async ({ page }) => {
  await openHub(page);
  await page.locator('aside.side nav.nav').getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.getByText('Tower 5 — Security').first()).toBeVisible({ timeout: 15_000 });

  const desktopProjects = page.locator('.projects-desktop-layout');
  await desktopProjects.locator('[data-project-id="p1"]').first().click();
  const rename = desktopProjects.locator('input[title="Click to rename"]');
  await expect(rename).toBeVisible();
  await rename.fill('   ');
  await rename.blur();
  await expect(page.getByText('Tower 5 — Security').first()).toBeVisible();
  await rename.fill('Hunt Tower');
  await rename.press('Enter');
  await expect(page.getByText('Hunt Tower').first()).toBeVisible();

  await desktopProjects.getByRole('button', { name: 'Manage team' }).click();
  const team = page.getByRole('dialog').filter({ hasText: /Manage team|Team|Invite/i }).first();
  await expect(team).toBeVisible({ timeout: 8_000 });
  await page.keyboard.press('Escape');
  await expect(page.getByText('Hunt Tower').first()).toBeVisible();

  await desktopProjects.getByTestId('project-select-toggle').click();
  await desktopProjects.locator('[data-project-id="p2"]').first().click();
  await desktopProjects.getByTestId('delete-selected-projects').click();
  await expect(page.getByText('Lab Reno — MEP')).toHaveCount(0);
  await expect(page.getByText('Hunt Tower').first()).toBeVisible();

  // Regular hubPreview New project is a no-op (workflowE2E only).
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Create project' })).toHaveCount(0);

  await openHub(page, HUB_WORKFLOW);
  await expect(page.getByRole('button', { name: 'New project', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'New project', exact: true }).first().click();
  const create = page.getByRole('dialog', { name: 'Create project' });
  await expect(create).toBeVisible();
  await expect(create.getByRole('button', { name: 'Create project' })).toBeDisabled();
  const huntName = `Hunt Project ${Date.now()}`;
  await create.getByLabel('Project name').fill(huntName);
  await create.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByText(huntName).first()).toBeVisible();

  console.log('HUB_PROJECTS_PROOF', JSON.stringify({
    rename: true,
    blankRestore: true,
    manageTeamChrome: true,
    delete: true,
    previewCreateNoop: true,
    workflowCreate: true,
  }));
});

test('Hub archive empty chrome intended + break + edge', async ({ page }) => {
  // Seeded hubPreview now has a local Archive list for Search / filter / sort.
  // Empty chrome stays on the existing `empty=1` contrast — do not invent Restore.
  await openHub(page, '/?hubPreview=1&empty=1&tab=archive');
  await expect(page.getByText('Nothing in Archive').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Go to documents' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Restore' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete forever' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  const restore = page.getByRole('button', { name: 'Restore' });
  const wipe = page.getByRole('button', { name: 'Delete forever' });
  if (await restore.count()) await expect(restore).toBeDisabled();
  if (await wipe.count()) await expect(wipe).toBeDisabled();

  await page.getByRole('button', { name: 'Go to documents' }).first().click();
  await expect(page.getByText('No documents yet.').first()).toBeVisible();

  console.log('HUB_ARCHIVE_PROOF', JSON.stringify({ empty: true, noProdRestore: true, goToDocuments: true }));
});

test('U-02 spaces rename + add pages intended + break + edge', async ({ page }) => {
  await openEditor(page);
  await page.getByRole('button', { name: 'Spaces', exact: true }).click();
  const create = page.getByRole('button', { name: 'Create space', exact: true });
  await expect(create).toBeVisible();
  await create.click();
  const name = page.getByRole('textbox', { name: 'Rename Space 1' });
  await expect(name).toBeVisible();

  await name.fill('Hunt Space');
  await name.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Rename Hunt Space' })).toBeVisible();

  const renamed = page.getByRole('textbox', { name: 'Rename Hunt Space' });
  await renamed.fill('   ');
  await renamed.press('Enter');
  const afterBlank = await page.getByRole('textbox', { name: /Rename / }).first().inputValue();
  expect(afterBlank.trim().length).toBeGreaterThan(0);

  const addInput = page.locator('.space-add-pages-input');
  await expect(addInput).toBeVisible();
  await addInput.fill('99');
  await page.getByRole('button', { name: 'Add pages' }).click();
  const badError = page.locator('.space-page-range-error');
  const badCount = await page.locator('.space-region-row').count();
  const rejectedOrErrored = (await badError.count()) > 0 || badCount === 0;

  await addInput.fill('1');
  await page.getByRole('button', { name: 'Add pages' }).click();
  await expect.poll(async () => page.locator('.space-region-row').count()).toBeGreaterThan(0);
  const overlay = page.getByRole('button', { name: /Show overlay for this region|Hide overlay for this region/ }).first();
  if (await overlay.count()) {
    await overlay.click();
    await expect(overlay).toBeVisible();
  }

  const fileId = await page.evaluate(() => window.__devTestPdf?.id ?? null);
  expect(fileId).toBeNull();
  expect(rejectedOrErrored).toBeTruthy();

  console.log('SPACES_PROOF', JSON.stringify({
    rename: true,
    blankKeptName: afterBlank,
    page99Rejected: rejectedOrErrored,
    page1Added: true,
    fileId,
  }));
});

test('UL-33 Dashed / Dotted style + ellipse has no Cloud', async ({ page }) => {
  await openEditor(page);
  await activateTool(page, 'Shapes', 'Rectangle');
  const stylePopover = page.locator('[data-annotation-dropdown-popover="true"]');
  await page.getByRole('button', { name: 'Style' }).click();
  await expect(stylePopover.getByRole('option', { name: 'Dashed', exact: true })).toBeVisible();
  await stylePopover.getByRole('option', { name: 'Dashed', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Style' })).toContainText('Dashed');

  const before = await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.filter((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return object.isPdfImported !== true && !/^\d+R$/.test(id);
    });
  });
  await dragOnPage(page, { x0: 0.18, y0: 0.22, x1: 0.38, y1: 0.36 });
  let lineId = null;
  await expect.poll(async () => {
    const rows = await page.evaluate(() => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((group) => group.getAttribute('data-anno-id'))
        .filter(Boolean)
        .map((id) => {
          const object = window.__phase35GetAnnotationById?.(id) || {};
          return {
            id,
            type: String(object.type || object.data?.type || '').toLowerCase(),
            imported: object.isPdfImported === true || /^\d+R$/.test(id),
            dash: object.strokeDashArray || null,
          };
        })
    ));
    const created = rows.find((row) => !before.includes(row.id) && !row.imported);
    lineId = created?.id || null;
    return created;
  }).not.toBeNull();
  await expect.poll(async () => {
    const style = await annotationStyle(page, lineId);
    return String(style.lineBorderStyle || style.strokeDashArray || '').toLowerCase();
  }).toMatch(/6|dash/);

  await page.getByRole('button', { name: 'Style' }).click();
  await stylePopover.getByRole('option', { name: 'Dotted', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Style' })).toContainText('Dotted');
  const afterDash = [lineId];
  await dragOnPage(page, { x0: 0.48, y0: 0.22, x1: 0.66, y1: 0.38 });
  let dottedId = null;
  await expect.poll(async () => {
    const rows = await page.evaluate((known) => (
      [...document.querySelectorAll('[data-svg-annotation-layer="1"] > g[data-anno-id]')]
        .map((group) => group.getAttribute('data-anno-id'))
        .filter(Boolean)
        .map((id) => {
          const object = window.__phase35GetAnnotationById?.(id) || {};
          return {
            id,
            imported: object.isPdfImported === true || /^\d+R$/.test(id),
          };
        })
        .filter((row) => !row.imported && !known.includes(row.id))
    ), afterDash);
    dottedId = rows[0]?.id || null;
    return dottedId;
  }).not.toBeNull();
  await expect.poll(async () => {
    const style = await annotationStyle(page, dottedId);
    return String(style.lineBorderStyle || style.strokeDashArray || '').toLowerCase();
  }).toMatch(/2|dot/);
  const dashedStill = await annotationStyle(page, lineId);
  expect(String(dashedStill.strokeDashArray || '')).toMatch(/6/);

  await activateTool(page, 'Shapes', 'Ellipse');
  await page.getByRole('button', { name: 'Style' }).click();
  await expect(stylePopover.getByRole('listbox', { name: 'Style' })).toBeVisible();
  const ellipseOptions = await stylePopover.getByRole('option').allTextContents();
  expect(ellipseOptions.join(' | ').toLowerCase()).not.toMatch(/cloud/);
  await page.keyboard.press('Escape');

  await activateTool(page, 'Shapes', 'Rectangle');
  await page.getByRole('button', { name: 'Style' }).click();
  await expect(stylePopover.getByRole('option', { name: 'Cloud', exact: true })).toBeVisible();

  console.log('STYLE_PROOF', JSON.stringify({ dashed: true, dotted: true, ellipseNoCloud: true, rectCloud: true }));
});
