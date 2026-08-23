import { test, expect } from '@playwright/test';

// Independent hunt after Eraser Type menuitem.
// Axis: compile-visible leftovers that are NOT leftover-18 and NOT
// Eraser Type / Selection Mode / Manage Team menuitem / Activity dialog
// name / unnamed-dialog family already proved / exhausted catalogs.
// Do not stamp file.id. Do not invent leftover-18 mint / roster / Stripe.
// Do not open Activity. Do not take Counter caret this pass.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const HUB = '/?hubPreview=1';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const TEMPLATE = 'Security Walk-Through';
const TOWER = 'Tower 5 — Security';
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
  'Manage team', 'Invite user', 'Copy email', 'View activity',
  'Select annotations', 'Select text', 'Selection Mode',
  'Partial erase', 'Full stroke erase', 'Eraser Type', 'Eraser type',
]);

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey-hub-tab');
      localStorage.removeItem('survey_document_history_events_v1');
      localStorage.removeItem('eraserMode');
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

function namelessOpenMenus(page) {
  return page.evaluate(() => (
    [...document.querySelectorAll('[data-select-mode-menu="true"], [data-eraser-caret-popup="true"], [data-highlighter-caret-popup="true"], [data-counter-caret-popup="true"], [data-manage-team-dismiss-surface="true"]')]
      .filter((node) => {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const role = node.getAttribute('role');
        const items = node.querySelectorAll('[role="menuitem"], [role="option"]');
        return role !== 'menu' && role !== 'listbox' && items.length === 0;
      })
      .map((node) => ({
        role: node.getAttribute('role') || '',
        text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      }))
  ));
}

function novelNames(controls) {
  return [...new Set(
    controls
      .map((row) => row.name)
      .filter((name) => name && !EXHAUSTED_NAMES.has(name) && !HIDDEN.includes(name)),
  )].sort();
}

test('independent hunt after Eraser Type menuitem', async ({ page }) => {
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
    inventory.editor.partialIdle = await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count();
    inventory.editor.selectTextIdle = await page.getByRole('menuitem', { name: /^Select text/ }).count();
    inventory.editor.copyEmail = await page.getByRole('menuitem', { name: 'Copy email', exact: true }).count();
    inventory.editor.editModules = await page.getByRole('dialog', { name: 'Edit modules', exact: true }).count();
    inventory.editor.lockDialog = await page.getByRole('dialog', { name: /Lock this document/ }).count();
    inventory.editor.unnamed = editorControls.filter((row) => row.unnamed);
    inventory.novel.editor = novelNames(editorControls);

    await page.locator('[data-select-mode-caret="true"]').click();
    inventory.editor.selectMenu = await page.getByRole('menu', { name: 'Selection Mode', exact: true }).count();
    inventory.editor.selectText = await page.getByRole('menuitem', { name: /^Select text/ }).count();
    inventory.editor.selectAnnotations = await page.getByRole('menuitem', { name: /^Select annotations/ }).count();
    inventory.editor.selectNameless = await namelessOpenMenus(page);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Draw', exact: true }).first().click();
    const eraserCaret = page.locator('[data-eraser-caret-button="true"]').first();
    inventory.editor.eraserCaret = await eraserCaret.count();
    if (await eraserCaret.count()) {
      await eraserCaret.click();
      inventory.editor.eraserMenu = await page.getByRole('menu', { name: 'Eraser Type', exact: true }).count();
      inventory.editor.eraserPopup = await page.locator('[data-eraser-caret-popup="true"]').count();
      inventory.editor.eraserMenuitems = await page.locator('[data-eraser-caret-popup="true"] [role="menuitem"]').count();
      inventory.editor.partial = await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count();
      inventory.editor.fullStroke = await page.getByRole('menuitem', { name: 'Full stroke erase', exact: true }).count();
      inventory.editor.eraserNameless = await namelessOpenMenus(page);
      await page.keyboard.press('Escape');
    }

    const highlighterCaret = page.locator('[data-highlighter-caret-button="true"]').first();
    inventory.editor.highlighterCaret = await highlighterCaret.count();
    const counterCaret = page.locator('[data-counter-caret], [data-counter-caret-button="true"]').first();
    inventory.editor.counterCaret = await counterCaret.count();
    if (await counterCaret.count()) {
      await counterCaret.click();
      inventory.editor.counterPopup = await page.locator('[data-counter-caret-popup="true"]').count();
      inventory.editor.counterMenuitems = await page.locator('[data-counter-caret-popup="true"] [role="menuitem"]').count();
      inventory.editor.counterNameless = await namelessOpenMenus(page);
      await page.keyboard.press('Escape');
    }

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
    inventory.hub.partialIdle = await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count();
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
    if (await moduleSelect.count()) {
      await moduleSelect.first().click();
      inventory.templates.namedDialog = await page.getByRole('dialog', { name: 'Edit modules', exact: true }).count();
      inventory.templates.labelledBy = await page.getByRole('dialog', { name: 'Edit modules', exact: true })
        .getAttribute('aria-labelledby');
      inventory.templates.unnamedDialogs = await unnamedDialogs(page);
      if (await page.locator('.templates-module-edit-modal').count()) {
        await page.getByRole('dialog', { name: 'Edit modules', exact: true })
          .getByRole('button', { name: 'Done', exact: true })
          .click();
      }
    }

    await openPage(page, { url: HUB_PROJECTS });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Manage team', exact: true }).click();
    const team = page.getByRole('dialog', { name: 'Manage Team', exact: true });
    await expect(team).toBeVisible({ timeout: 10_000 });
    inventory.projects.manageTeamNamed = await team.count();
    await team.getByRole('button', { name: 'More', exact: true }).first().click();
    inventory.projects.memberMenu = await page.getByRole('menu', { name: /actions$/ }).count();
    inventory.projects.copyEmail = await page.getByRole('menuitem', { name: 'Copy email', exact: true }).count();
    inventory.projects.partial = await page.getByRole('menuitem', { name: 'Partial erase', exact: true }).count();
    inventory.projects.activityDialog = await page.getByRole('dialog', { name: /activity/i }).count();
    inventory.projects.namelessMenus = await namelessOpenMenus(page);
    inventory.projects.unnamedDialogs = await unnamedDialogs(page);
    await page.keyboard.press('Escape');

    inventory.lease.processAutoLogin = Boolean(process.env.VITE_DEV_AUTO_LOGIN_EMAIL);
    inventory.lease.serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_ERASER_TYPE_MENUITEM_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.partialIdle).toBe(0);
  expect(inventory.editor.selectTextIdle).toBe(0);
  expect(inventory.editor.selectMenu).toBe(1);
  expect(inventory.editor.selectText).toBe(1);
  expect(inventory.editor.selectAnnotations).toBe(1);
  expect(inventory.editor.eraserMenu).toBe(1);
  expect(inventory.editor.eraserMenuitems).toBe(2);
  expect(inventory.editor.partial).toBe(1);
  expect(inventory.editor.fullStroke).toBe(1);
  expect(inventory.editor.eraserNameless).toEqual([]);
  expect(inventory.editor.highlighterCaret).toBe(0);
  expect(inventory.editor.editModules).toBe(0);
  expect(inventory.editor.lockDialog).toBe(0);
  expect(inventory.overlay.shortcutsNamed).toBe(1);
  expect(inventory.overlay.unnamedDialogs).toEqual([]);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.partialIdle).toBe(0);
  expect(inventory.hub.lockDialog).toBe(0);
  expect(inventory.hub.accessNamed).toBe(1);
  expect(inventory.hub.accessLabelledBy).toBe('access-management-modal-title');
  expect(inventory.templates.namedDialog).toBe(1);
  expect(inventory.templates.labelledBy).toBe('templates-module-edit-title');
  expect(inventory.projects.manageTeamNamed).toBe(1);
  expect(inventory.projects.memberMenu).toBe(1);
  expect(inventory.projects.copyEmail).toBe(1);
  expect(inventory.projects.partial).toBe(0);
  expect(inventory.projects.activityDialog).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
});
