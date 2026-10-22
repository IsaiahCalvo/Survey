import { test, expect } from '@playwright/test';

const templates = [{ id: 'work', name: 'Work Survey', entities: [
  { id: 'existing', name: 'Existing', color: '#2563eb' },
  { id: 'new', name: 'New', color: '#ef4444' },
], modules: [
  { id: 'module', name: 'Existing', categories: [{ id: 'walls', name: 'Walls', checklist: [] }] },
  { id: 'proposed', name: 'Proposed', categories: [{ id: 'doors', name: 'Doors', checklist: [{ id: 'door-check', text: 'Door checked?' }] }] },
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
  const modal = page.getByRole('dialog', { name: 'New Survey Marker' });
  await expect(modal).toBeVisible();
  // The entity is already picked (the first); a category row places it.
  await expect(modal.getByRole('button', { name: 'Entity Existing' })).toHaveAttribute('aria-pressed', 'true');
  await modal.getByRole('button', { name: 'Entity New' }).click();
  // Only the marker's module is listed; the Module button switches it.
  await expect(modal.getByRole('option', { name: /Doors/ })).toHaveCount(0);
  await modal.getByRole('button', { name: /Change module/ }).click();
  await modal.getByRole('option', { name: 'Proposed' }).click();
  await modal.getByRole('option', { name: /Doors/ }).click();
  await expect(modal).toBeHidden();
  await expect(page.locator('.survey-rail__entity-caret')).toHaveCount(0);
  const rail = page.locator('.survey-rail');
  const originalMarkerId = await rail.locator('[id^="highlight-item-"]').first().getAttribute('id');
  const originalMarker = page.locator(`[id="${originalMarkerId}"]`);
  await originalMarker.getByRole('group', { name: 'Door checked?' }).getByRole('button', { name: 'Y', exact: true }).click();
  const checkAnswer = async () => { const expand = originalMarker.getByRole('button', { name: 'Expand marker details' }); if (await expand.isVisible()) await expand.click(); await expect(originalMarker.getByRole('group', { name: 'Door checked?' }).getByRole('button', { name: 'Y', exact: true })).toHaveAttribute('aria-pressed', 'true'); };
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
  await checkAnswer();
  const markerCount = await page.locator('[data-survey-marker-id]').count();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('[data-survey-marker-id]')).toHaveCount(markerCount);
  await expect(row.locator('.survey-subrow__fit > span:not(.is-ghost)')).toHaveText('Proposed');
  await checkAnswer();
  await expect(rail.getByRole('button', { name: 'New. Change entity' })).toHaveCount(3);
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('[data-survey-marker-id]')).toHaveCount(markerCount);
  await expect(row.locator('.survey-subrow__fit > span:not(.is-ghost)')).toHaveText('Existing');
  await checkAnswer();
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
  const panelToggle = page.getByRole('toolbar', { name: 'Survey panel', exact: true }).getByRole('button', { name: 'Survey', exact: true });
  if (await panelToggle.getAttribute('aria-expanded') === 'false') await panelToggle.click();
  await page.locator('.survey-rail .survey-marker-category-row').filter({ hasText: 'Walls' }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Move', exact: true })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Delete', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  // Keeping an old version is reversible from the template menu, even when
  // this revision was already reviewed.
  await page.locator('.survey-subrow').getByRole('button', { name: /^Survey template: Work Survey/ }).click();
  await page.getByRole('option', { name: 'Updated Work Survey', exact: true }).click();
  await expect(version).toBeVisible();
  await version.getByRole('button', { name: 'Keep previous version' }).click();

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


test.describe('phone Survey assignment', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  for (const [layout, route, viewport] of [
    ['mobile Safari', '/mobile', { width: 390, height: 664 }],
    ['native app', '/mobile', { width: 390, height: 844 }],
  ]) test(`a marker drawn with a category armed is placed with an entity in ${layout}`, async ({ page, context }) => {
    await page.setViewportSize(viewport);
    await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, (route) => route.abort());
    await context.addInitScript((value) => localStorage.setItem('mobileWorkflowTemplates', JSON.stringify(value)), templates);
    const errors = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${route}?testPdf=clickable-link-test.pdf&surveyTemplateWorkflowE2E=1${layout === 'native app' ? '&mobileNav=tabs&nativeShell=expo' : ''}`);
    await page.getByRole('button', { name: 'Open survey', exact: true }).tap();
    await page.getByRole('button', { name: /Work Survey/ }).filter({ visible: true }).first().tap();
    await page.getByRole('button', { name: 'Open survey', exact: true }).tap();
    await expect.poll(() => page.locator('.mobile-survey-sheet').filter({ visible: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Survey category Walls', exact: true }).tap();
    const bounds = await page.locator('[data-svg-annotation-layer]').first().boundingBox();
    const x = Math.max(60, bounds.x + 50), y = Math.max(100, bounds.y + 100);
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 100, y + 70, { steps: 8 }); await page.mouse.up();
    // Owner 2026-10-22: a marker always has an entity (the first when none
    // is picked), so with a category armed it is placed at once - no card.
    await expect(page.locator('[data-survey-marker-id]')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: 'New Survey Marker' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
