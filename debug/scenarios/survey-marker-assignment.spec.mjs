import { test, expect } from '@playwright/test';

const templates = [{ id: 'work', name: 'Work Survey', entities: [
  { id: 'existing', name: 'Existing', color: '#2563eb' },
  { id: 'new', name: 'New', color: '#ef4444' },
], modules: [
  { id: 'module', name: 'Existing', categories: [{ id: 'walls', name: 'Walls', checklist: [] }] },
  { id: 'proposed', name: 'Proposed', categories: [{ id: 'doors', name: 'Doors', checklist: [] }] },
] }];

test('Survey placement chooses module, category and entity and Reuse keeps them', async ({ page, context }) => {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await context.addInitScript((value) => { if (!localStorage.getItem('mobileWorkflowTemplates')) localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(value)); }, templates);
  await page.setViewportSize({ width: 1400, height: 900 });
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1');
  await page.getByRole('toolbar', { name: 'Survey panel', exact: true }).getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Work Survey.*2 modules/ }).click();
  const layer = page.locator('[data-svg-annotation-layer]').first();
  const draw = async (y) => { const box = await layer.boundingBox(); await page.mouse.move(box.x + 90, box.y + y); await page.mouse.down(); await page.mouse.move(box.x + 180, box.y + y + 60, { steps: 8 }); await page.mouse.up(); };
  await draw(100);
  const modal = page.getByRole('dialog', { name: 'Categorize Survey Marker' });
  await expect(modal).toBeVisible();
  await expect(modal.getByRole('button', { name: 'Add Survey Marker' })).toBeDisabled();
  await modal.getByRole('combobox', { name: 'Module', exact: true }).selectOption('proposed');
  await modal.getByRole('combobox', { name: 'Category', exact: true }).selectOption('doors');
  await expect(modal.getByRole('button', { name: 'Add Survey Marker' })).toBeDisabled();
  await modal.getByRole('combobox', { name: 'Entity', exact: true }).selectOption('new');
  await modal.getByRole('button', { name: 'Add Survey Marker' }).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('.survey-rail__entity-caret')).toHaveCount(0);
  const rail = page.locator('.survey-rail');
  await expect(rail.getByRole('button', { name: 'New. Change entity' })).toBeVisible();
  await rail.getByRole('button', { name: 'New. Change entity' }).click();
  await expect(rail.getByRole('listbox', { name: 'Entity' })).toBeVisible();
  await page.keyboard.press('Escape');
  const row = page.locator('.survey-subrow');
  await row.getByRole('button', { name: 'Doors', exact: true }).click();
  await row.getByRole('switch', { name: 'Reuse category' }).click();
  await draw(240);
  await expect(modal).toBeHidden();
  await expect(rail.getByRole('button', { name: 'New. Change entity' })).toHaveCount(2);
  await rail.locator('.survey-rail__marker-line').first().click({ button: 'right' });
  await expect(page.getByRole('menu', { name: 'List item actions' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click();
  await expect(rail.getByRole('button', { name: 'New. Change entity' })).toHaveCount(3);
  await rail.locator('.survey-marker-category-row').filter({ hasText: 'Doors' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click();
  const move = page.getByRole('dialog', { name: 'Move categories', exact: true });
  await move.getByRole('combobox', { name: 'Destination module' }).selectOption('module');
  await move.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(move).toBeHidden();
  await expect(row.getByRole('button', { name: 'Doors', exact: true })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'New. Change entity' })).toHaveCount(3);
  await row.getByRole('button', { name: 'Leave Survey' }).click();
  await expect(page.getByText('Left Survey', { exact: true })).toBeHidden();
  await page.evaluate(() => {
    const templates = JSON.parse(localStorage.getItem('mobileWorkflowTemplates'));
    templates[0].name = 'Updated Work Survey';
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(templates));
  });
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole('toolbar', { name: 'Survey panel', exact: true }).getByRole('button', { name: 'Survey', exact: true }).click();
  const version = page.getByRole('dialog', { name: 'Survey template updated', exact: true });
  await expect(version).toBeVisible();
  await version.getByRole('button', { name: 'Keep previous version' }).click();
  await expect(page.locator('.survey-subrow').getByRole('button', { name: /^Survey template: Work Survey/ })).toBeVisible();
  await page.locator('.survey-subrow').getByRole('button', { name: 'Leave Survey' }).click();
  await page.evaluate(() => { const value = JSON.parse(localStorage.getItem('mobileWorkflowTemplates')); value[0].name = 'Latest Work Survey'; localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(value)); });
  await page.reload();
  await page.getByRole('toolbar', { name: 'Survey panel', exact: true }).getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('dialog', { name: 'Survey template updated' }).getByRole('button', { name: 'Use latest version' }).click();
  await expect(page.locator('.survey-subrow').getByRole('button', { name: /^Survey template: Latest Work Survey/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('Documents preview rows without selection checks and list tools animate', async ({ page, context }) => {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/?hubPreview=1');
  await page.getByRole('button', { name: 'Documents', exact: true }).click();
  const rows = page.locator('.documents-ledger-row');
  await expect(rows.first()).toBeVisible();
  await expect(page.locator('.documents-row-check')).toHaveCount(0);
  await rows.first().click();
  await expect(page.locator('.documents-row-check')).toHaveCount(0);
  await rows.first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Preview & details' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.__listMorphFrames = []; const step = () => { window.__listMorphFrames.push(document.querySelectorAll('[data-loadout-morph]').length); if (window.__listMorphFrames.length < 35) requestAnimationFrame(step); }; step(); });
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await expect(page.locator('.documents-row-check').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__listMorphFrames.some((count) => count > 0))).toBe(true);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.documents-row-check')).toHaveCount(0);
});

test('unused template edits enter latest without a version prompt', async ({ page, context }) => {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await context.addInitScript((value) => { if (!localStorage.getItem('mobileWorkflowTemplates')) localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(value)); }, templates);
  await page.goto('/?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1');
  const toggle = () => page.getByRole('toolbar', { name: 'Survey panel', exact: true }).getByRole('button', { name: 'Survey', exact: true }).click();
  await toggle(); await page.getByRole('button', { name: /Work Survey.*2 modules/ }).click();
  await page.locator('.survey-subrow').getByRole('button', { name: 'Leave Survey' }).click();
  await page.evaluate(() => { const value = JSON.parse(localStorage.getItem('mobileWorkflowTemplates')); value[0].name = 'Unused revision'; localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(value)); });
  await page.reload(); await toggle();
  await expect(page.getByRole('dialog', { name: 'Survey template updated' })).toBeHidden();
  await expect(page.locator('.survey-subrow').getByRole('button', { name: /^Survey template: Unused revision/ })).toBeVisible();
});

test('template list right-click opens the existing item actions without Select mode', async ({ page, context }) => {
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
  await page.goto('/?hubPreview=1');
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  const category = page.locator('.tpl-cat-row').filter({ has: page.getByRole('textbox', { name: 'Category name, Doors', exact: true }) });
  await expect(category).toBeVisible();
  await category.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Move', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Move', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Move items', exact: true });
  await dialog.getByRole('button', { name: /Installation Phase/ }).click();
  await page.getByRole('option', { name: 'Commissioning Phase', exact: true }).click();
  await dialog.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.tpl-cat-row').filter({ has: page.getByRole('textbox', { name: 'Category name, Doors', exact: true }) })).toHaveCount(0);
  await page.locator('[data-module-tab-id]').filter({ hasText: 'Commissioning Phase' }).click();
  await expect(page.locator('.tpl-cat-row').filter({ has: page.getByRole('textbox', { name: 'Category name, Doors', exact: true }) })).toBeVisible();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.locator('[data-project-id]').first().click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Share', exact: true })).toBeVisible();
});
