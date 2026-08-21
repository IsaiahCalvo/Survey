import { test, expect } from '@playwright/test';

const HUB = '/?hubPreview=1&tab=templates';
const HUB_EMPTY = '/?hubPreview=1&empty=1&tab=templates';
const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const FORM_PDF = '/?testPdf=kal441-form-fields.pdf';

async function openEditor(page, fixture) {
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

async function userAnnotationSnapshot(page, pageNumber = 1) {
  return page.evaluate((pageNum) => {
    const ids = [...document.querySelectorAll(`[data-svg-annotation-layer="${pageNum}"] > g[data-anno-id]`)]
      .map((group) => group.getAttribute('data-anno-id'))
      .filter(Boolean);
    return ids.map((id) => {
      const object = window.__phase35GetAnnotationById?.(id) || {};
      return {
        id,
        type: String(object.type || object.data?.type || '').toLowerCase(),
        tool: String(object.data?.tool || object.data?.type || object.tool || '').toLowerCase(),
        imported: object.isPdfImported === true,
        dataType: String(object.data?.type || '').toLowerCase(),
        fieldName: object.data?.fieldName || null,
        value: object.data?.value,
      };
    }).filter((row) => row.imported !== true);
  }, pageNumber);
}

async function activateTool(page, categoryName, toolName) {
  const tool = page.getByRole('button', { name: toolName, exact: true });
  if (await tool.count() === 0) {
    await page.getByRole('button', { name: categoryName, exact: true }).click();
  }
  await expect(tool).toBeVisible();
  await tool.click();
}

test('U-03 templates editor create / edit / delete on hubPreview', async ({ page }) => {
  await page.goto(HUB);
  await expect(page.getByRole('button', { name: 'New template', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Security Walk-Through').first()).toBeVisible();
  await expect(page.getByText('MEP As-Built Markup').first()).toBeVisible();

  const beforeNames = await page.locator('.templates-editor-grid aside [data-drag-rearrange-row]').evaluateAll((rows) => (
    rows.map((row) => row.querySelector('div[style*="font-weight"]')?.textContent?.trim() || row.textContent.trim())
  ));

  const title = page.getByRole('textbox', { name: 'Click to rename' });

  // Intended: New template adds an empty template and opens it (no modal).
  await page.getByRole('button', { name: 'New template', exact: true }).first().click();
  await expect(title).toBeVisible();
  await expect(title).toHaveValue(/Template \d+/);
  const createdName = await title.inputValue();
  await expect(page.getByText(createdName).first()).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Entity name' }).first()).toHaveValue('GC');

  // Intended: rename + Save persists the working copy to the hub host.
  await title.fill('E2E Leftover Template');
  await title.press('Enter');
  await expect(page.getByText('E2E Leftover Template').first()).toBeVisible();
  const save = page.getByRole('button', { name: 'Save', exact: true }).first();
  await expect(save).toBeVisible();
  await save.click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  // Break: blank rename is a no-op and the field restores the last name.
  await title.fill('   ');
  await title.press('Enter');
  await expect(title).toHaveValue('E2E Leftover Template');
  await expect(page.getByText('E2E Leftover Template').first()).toBeVisible();

  // Edge: a second New template increments the default name.
  await page.getByRole('button', { name: 'New template', exact: true }).first().click();
  await expect(title).toHaveValue(/Template \d+/);
  const secondName = await title.inputValue();
  expect(secondName).not.toBe(createdName);

  // Intended: Select + Delete removes the leftover (local bundle save; no archive host).
  await page.getByRole('button', { name: 'Select', exact: true }).first().click();
  await page.getByText(secondName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByText(secondName, { exact: true })).toHaveCount(0);

  // Empty-state edge lives on the documented empty fixture.
  await page.goto(HUB_EMPTY);
  await expect(page.getByText('No templates yet', { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'New template', exact: true }).first().click();
  await expect(page.getByRole('textbox', { name: 'Click to rename' })).toHaveValue(/Template \d+/);

  console.log('TEMPLATES_PROOF', JSON.stringify({
    seed: beforeNames.slice(0, 4),
    createdName,
    secondName,
    emptyCreate: true,
  }));
});

test('D-01 1-dot pen tap creates or no-ops', async ({ page }) => {
  await openEditor(page, LINK_PDF);
  const before = await userAnnotationSnapshot(page);
  const beforeIds = new Set(before.map((row) => row.id));
  await activateTool(page, 'Draw', 'Pen');
  const box = await pageBox(page);
  const x = box.x + box.width * 0.22;
  const y = box.y + box.height * 0.24;
  // True tap: down + up at the same client point, no move.
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();

  let created = null;
  try {
    await expect.poll(async () => {
      const rows = await userAnnotationSnapshot(page);
      created = rows.find((row) => !beforeIds.has(row.id) && (row.type === 'path' || row.tool === 'pen')) || null;
      return created;
    }, { timeout: 4_000 }).not.toBeNull();
  } catch {
    created = null;
  }

  const after = await userAnnotationSnapshot(page);
  const delta = after.filter((row) => !beforeIds.has(row.id));
  console.log('PEN_TAP_PROOF', JSON.stringify({
    created: created ? { id: created.id, type: created.type, tool: created.tool } : null,
    deltaCount: delta.length,
    policy: 'createProductionPaperInk keeps a 1-point centerline (circle); null only if compactPoints is empty',
  }));
  // Documented outcome — a 1-point tap is intended to commit a mark.
  expect(created, '1-dot pen tap should commit a paper-ink path').toBeTruthy();
});

test('U-04 archive-with-markers is TemplatesEditor on hubPreview', async ({ page }) => {
  // Full intended / break / edge lives in e2e-u04-archive.spec.mjs.
  // This leftovers row only asserts the KAL-44 host is now wired.
  await page.goto(HUB);
  await expect(page.getByRole('button', { name: 'New template', exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await page.getByText('Security Walk-Through').first().click();
  const camerasInput = page.locator('input[value="Cameras"]');
  await expect(camerasInput).toBeVisible();
  const expand = camerasInput.locator('xpath=preceding-sibling::button[@title="Expand" or @title="Collapse"]');
  if ((await expand.getAttribute('title')) === 'Expand') await expand.click();
  await page.locator('[data-drag-rearrange-row]')
    .filter({ has: page.locator('input[value="Is the camera cable pulled?"]') })
    .getByRole('button', { name: 'Delete item', exact: true })
    .click();
  await expect(page.getByTestId('archive-confirm-modal')).toBeVisible();
  await expect(page.getByTestId('archive-confirm-modal')).toContainText('3');
  await page.getByTestId('archive-confirm-cancel').click();
  console.log('U04_ARCHIVE_PROOF', JSON.stringify({ route: HUB, modal: true, usage: 3 }));
});

test('X-05 fill AcroForm widgets on kal441-form-fields.pdf', async ({ page }) => {
  await openEditor(page, FORM_PDF);
  // Form widgets are interactive only in pan / select (PdfjsFormLayer).
  await page.keyboard.press('v');

  const layer = page.locator('.pdfjsFormLayer[data-pdfjs-form-layer="1"]');
  await expect(layer).toBeAttached({ timeout: 30_000 });
  await expect.poll(async () => (
    page.locator('.pdfjsFormLayer input, .pdfjsFormLayer textarea, .pdfjsFormLayer select').count()
  ), { timeout: 20_000 }).toBeGreaterThan(0);

  const widgets = page.locator('.pdfjsFormLayer input, .pdfjsFormLayer textarea, .pdfjsFormLayer select');
  const widgetCount = await widgets.count();
  const types = await widgets.evaluateAll((els) => els.map((el) => `${el.tagName.toLowerCase()}:${el.type || ''}`));

  const text = page.locator('.pdfjsFormLayer .textWidgetAnnotation input').first();
  await expect(text).toBeVisible({ timeout: 10_000 });
  await text.click({ force: true });
  await text.fill('wave-form');
  await text.blur();

  const checkbox = page.locator('.pdfjsFormLayer .buttonWidgetAnnotation.checkBox input').first();
  let checkboxClicked = false;
  if (await checkbox.count()) {
    await checkbox.click({ force: true });
    checkboxClicked = true;
  }

  await page.mouse.click(12, 200);
  await expect(text).toHaveValue('wave-form');

  const annotationRow = await page.evaluate(() => {
    const getter = window.__phase35GetAnnotationById;
    if (typeof getter !== 'function') return null;
    const ids = [...document.querySelectorAll('[data-anno-id]')].map((node) => node.getAttribute('data-anno-id'));
    for (const id of ids) {
      const object = getter(id);
      if (object?.data?.type === 'form-field' && String(object.data.value || '').includes('wave-form')) {
        return { id, fieldName: object.data.fieldName, value: object.data.value };
      }
    }
    return null;
  });

  console.log('FORM_WIDGET_PROOF', JSON.stringify({
    widgetCount,
    types,
    checkboxClicked,
    inputStillWaveForm: true,
    annotationRow,
  }));
  expect(widgetCount).toBeGreaterThan(0);
});
