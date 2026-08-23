import { test, expect } from '@playwright/test';

// Independent hunt after Templates Edit modules dialog accessible name.
// Axis: official leftover files vs live source after AccessManagementModal
// role=dialog (NOT isolated 8448); compile-visible overlays with a heading
// but no role=dialog + aria-labelledby that are NOT leftover-18 hosts.
// PromptModal lock / NewColumnsModal stay leftover-18. Do not stamp file.id.
// Do not invent leftover-18 module Move/Copy apply.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const TEMPLATE = 'Security Walk-Through';
const HIDDEN = [
  'Match case', 'Whole word', 'Comments', 'Forms', 'Print',
  'Actual size', 'Measure', 'Group', 'Extract Pages', 'Note',
  'Marquee zoom', 'Layers', 'Attachments',
];

const EXHAUSTED_NAMES = new Set([
  'Draw', 'Shapes', 'Text', 'Select', 'Selection mode', 'Pan',
  'Pen', 'Highlighter', 'Eraser', 'Rectangle', 'Ellipse', 'Line',
  'Arrow', 'Counter', 'Callout',
  'Undo', 'Redo', 'Export annotated PDF',
  'Zoom in', 'Zoom out', 'Fit options', 'Fit page', 'Fit width', 'Fit height',
  'Previous page', 'Next page', 'Current page', 'Edit page number',
  'Zoom percentage', 'Edit zoom percentage',
  'Home', 'Close tab',
  'Expand sidebar', 'Collapse sidebar',
  'Pages', 'Search text', 'Bookmarks', 'Spaces', 'History',
  'Expand Survey panel', 'Collapse Survey panel',
  'Style', 'Width', 'Color', 'Font color', 'Edit text',
  'More document options',
  'Open account menu', 'Settings', 'Sign out', 'Archive',
  'Documents', 'Projects', 'Templates',
  'Select', 'All', 'None', 'Done', 'Duplicate', 'Move/Copy', 'Share', 'Delete',
  'Upload', 'More', 'Preview', 'Open file',
  'Open navigation',
  'Search documents...', 'General', 'Connected services', 'Subscription',
  'Edit profile', 'Close',
  'Survey', 'Delete selected categories', 'Cancel', 'Delete category',
  'Create category', 'Keyboard shortcuts', 'Document Access', 'Invite',
  'Edit modules', 'New module',
]);

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey-hub-tab');
      localStorage.removeItem('survey_document_history_events_v1');
    } catch { /* ignore */ }
  });
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
}

function visibleControls(page) {
  return page.evaluate(() => {
    const nameOf = (node) => {
      const labelled = node.getAttribute('aria-label')
        || node.getAttribute('title')
        || node.getAttribute('placeholder')
        || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
      return labelled || '';
    };
    const nodes = [...document.querySelectorAll('button, input, select, [role="button"], [role="menuitem"], [role="tab"], [role="dialog"]')];
    return nodes
      .filter((node) => {
        if (node.closest('[data-hub-keep-mount][inert], [data-hub-keep-mount][aria-hidden="true"]')) {
          return false;
        }
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      })
      .map((node) => ({
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute('role') || node.tagName.toLowerCase(),
        type: node.getAttribute('type') || '',
        name: nameOf(node),
        labelledBy: node.getAttribute('aria-labelledby') || '',
        unnamed: !nameOf(node) && !node.getAttribute('aria-labelledby'),
        inHub: Boolean(node.closest('.survey-hub')),
      }));
  });
}

async function hiddenCounts(page) {
  const counts = {};
  for (const name of HIDDEN) {
    counts[name] = await page.getByRole('button', { name, exact: true }).count();
  }
  return counts;
}

async function fileId(page) {
  return page.evaluate(() => {
    const file = window.__phase35SelectedPdf || window.selectedPDF || window.__devTestPdf || null;
    return file && typeof file === 'object' ? file.id ?? null : null;
  }).catch(() => null);
}

function unnamedDialogs(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('[role="dialog"]')]
      .filter((node) => {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const name = node.getAttribute('aria-label')
          || (node.getAttribute('aria-labelledby') && document.getElementById(node.getAttribute('aria-labelledby'))?.textContent)
          || '';
        return !String(name).trim();
      })
      .map((node) => node.className || node.id || node.tagName)
  ));
}

function headingWithoutNamedDialog(page) {
  return page.evaluate(() => {
    const named = new Set(
      [...document.querySelectorAll('[role="dialog"]')].flatMap((node) => {
        const by = node.getAttribute('aria-labelledby');
        const label = node.getAttribute('aria-label')
          || (by && document.getElementById(by)?.textContent)
          || '';
        return String(label).trim() ? [String(label).trim()] : [];
      }),
    );
    return [...document.querySelectorAll('h1, h2, h3, h4')]
      .map((node) => (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => text && !named.has(text));
  });
}

function novelNames(controls) {
  return [...new Set(
    controls
      .map((row) => row.name)
      .filter((name) => name && !EXHAUSTED_NAMES.has(name) && !HIDDEN.includes(name)),
  )].sort();
}

test('independent hunt after Templates Edit modules dialog name', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    editor: {},
    overlay: {},
    hub: {},
    templates: {},
    projects: {},
    unnamed: {},
    novel: {},
    lease: {},
  };

  try {
    await openPage(page, { url: LINK_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 45_000 });

    const editorControls = await visibleControls(page);
    inventory.editor.hidden = await hiddenCounts(page);
    inventory.editor.fileId = await fileId(page);
    inventory.editor.viewBox = await page.locator('[data-svg-annotation-layer="1"]').getAttribute('viewBox');
    inventory.editor.editModules = await page.getByRole('dialog', { name: 'Edit modules', exact: true }).count();
    inventory.editor.accessDialog = await page.getByRole('dialog', { name: 'Document Access', exact: true }).count();
    inventory.editor.shortcutsDialog = await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count();
    inventory.editor.lockDialog = await page.getByRole('dialog', { name: /Lock this document/ }).count();
    inventory.editor.unnamed = editorControls.filter((row) => row.unnamed);
    inventory.novel.editor = novelNames(editorControls);

    await page.evaluate(() => {
      const el = document.activeElement;
      if (el && typeof el.blur === 'function') el.blur();
      if (document.body) document.body.focus();
    });
    await page.keyboard.press('?');
    const shortcuts = page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true });
    await expect(shortcuts).toBeVisible({ timeout: 8_000 });
    inventory.overlay.shortcutsNamed = await shortcuts.count();
    inventory.overlay.unnamedDialogs = await unnamedDialogs(page);
    await page.keyboard.press('Escape');

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const hubControls = await visibleControls(page);
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.editIdle = await page.getByRole('dialog', { name: 'Edit modules', exact: true }).count();
    inventory.hub.accessIdle = await page.getByRole('dialog', { name: 'Document Access', exact: true }).count();
    inventory.hub.shortcutsDialog = await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count();
    inventory.hub.lockDialog = await page.getByRole('dialog', { name: /Lock this document/ }).count();
    inventory.hub.unnamed = hubControls.filter((row) => row.unnamed);
    inventory.novel.hub = novelNames(hubControls);

    const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
      .filter({ hasText: OWNER })
      .getByRole('button', { name: 'More' })
      .first();
    await ownerMore.click();
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
    const access = page.getByRole('dialog', { name: 'Document Access', exact: true });
    await expect(access).toBeVisible({ timeout: 10_000 });
    inventory.hub.accessNamed = await access.count();
    inventory.hub.accessLabelledBy = await access.getAttribute('aria-labelledby');
    inventory.hub.accessUnnamedDialogs = await unnamedDialogs(page);
    await page.keyboard.press('Escape');

    await openPage(page, { url: HUB_TEMPLATES });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    await page.getByText(TEMPLATE).first().click();
    const moduleSelect = page.locator('.templates-editor-grid p.micro', { hasText: /^Module$/ })
      .locator('xpath=following-sibling::button[1]');
    inventory.templates.moduleSelect = await moduleSelect.count();
    if (await moduleSelect.count()) {
      await moduleSelect.first().click();
      inventory.templates.heading = await page.getByRole('heading', { name: 'Edit modules', exact: true }).count();
      inventory.templates.namedDialog = await page.getByRole('dialog', { name: 'Edit modules', exact: true }).count();
      inventory.templates.modalHost = await page.locator('.templates-module-edit-modal').count();
      inventory.templates.labelledBy = await namedOrNull(page);
      inventory.templates.unnamedDialogs = await unnamedDialogs(page);
      inventory.templates.headingsWithoutName = await headingWithoutNamedDialog(page);
      inventory.templates.moveCopyDisabled = await page.getByRole('dialog', { name: 'Edit modules', exact: true })
        .getByRole('button', { name: 'Move/Copy', exact: true })
        .isDisabled();
      if (await page.locator('.templates-module-edit-modal').count()) {
        await page.getByRole('dialog', { name: 'Edit modules', exact: true })
          .getByRole('button', { name: 'Done', exact: true })
          .click();
      }
    }

    await openPage(page, { url: HUB_PROJECTS });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    inventory.projects.manageTeam = await page.getByRole('button', { name: /Manage Team|Invite User/i }).count();
    inventory.projects.activityDialog = await page.getByRole('dialog', { name: /activity/i }).count();
    inventory.projects.unnamedDialogs = await unnamedDialogs(page);
    inventory.projects.novel = novelNames(await visibleControls(page));

    inventory.lease.processAutoLogin = Boolean(process.env.VITE_DEV_AUTO_LOGIN_EMAIL);
    inventory.lease.serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_TEMPLATES_MODULE_EDIT_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.editModules).toBe(0);
  expect(inventory.editor.accessDialog).toBe(0);
  expect(inventory.editor.lockDialog).toBe(0);
  expect(inventory.overlay.shortcutsNamed).toBe(1);
  expect(inventory.overlay.unnamedDialogs).toEqual([]);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.editIdle).toBe(0);
  expect(inventory.hub.accessIdle).toBe(0);
  expect(inventory.hub.lockDialog).toBe(0);
  expect(inventory.hub.accessNamed).toBe(1);
  expect(inventory.hub.accessLabelledBy).toBe('access-management-modal-title');
  expect(inventory.hub.accessUnnamedDialogs).toEqual([]);
  expect(inventory.templates.namedDialog).toBe(1);
  expect(inventory.templates.labelledBy).toBe('templates-module-edit-title');
  expect(inventory.templates.unnamedDialogs).toEqual([]);
  expect(inventory.templates.moveCopyDisabled).toBe(true);
  expect(inventory.lease.fileId).toBeNull();
});

async function namedOrNull(page) {
  const dialog = page.getByRole('dialog', { name: 'Edit modules', exact: true });
  if (!(await dialog.count())) return null;
  return dialog.getAttribute('aria-labelledby');
}
