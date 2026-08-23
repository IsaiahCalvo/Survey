import { test, expect } from '@playwright/test';

// Independent hunt after KeyboardShortcutsOverlay dialog accessible name.
// Axis: official leftover files vs live source after CreateCategoryModal
// labelledby (NOT isolated 8448); compile-visible chrome that is NOT
// rail-toggle, dismiss, nameless-menu, Home `?` singleton, hub nav type,
// keep-mount inert, Sync chip, remapped-after-CW, Settings / Confirm /
// CreateCategory dialog name.
// PromptModal lock / NewColumnsModal stay leftover-18. Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1';
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
  'Create category', 'Keyboard shortcuts',
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

function novelNames(controls) {
  return [...new Set(
    controls
      .map((row) => row.name)
      .filter((name) => name && !EXHAUSTED_NAMES.has(name) && !HIDDEN.includes(name)),
  )].sort();
}

test('independent hunt after KeyboardShortcutsOverlay dialog name', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    editor: {},
    overlay: {},
    hub: {},
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
    inventory.editor.sync = await page.getByRole('button', { name: /Syncing|Retry now|Save version|checking whether this document uses live collaboration/i }).count();
    inventory.editor.keepMountInert = await page.evaluate(() => {
      const host = document.querySelector('[data-hub-keep-mount]');
      return host ? (host.hasAttribute('inert') || host.inert === true) : null;
    });
    inventory.editor.settingsDialog = await page.getByRole('dialog', { name: 'Settings', exact: true }).count();
    inventory.editor.confirmDialog = await page.getByRole('dialog', { name: 'Delete 1 category?', exact: true }).count();
    inventory.editor.createDialog = await page.getByRole('dialog', { name: 'Create category', exact: true }).count();
    inventory.editor.lockDialog = await page.getByRole('dialog', { name: /Lock this document/ }).count();
    inventory.editor.shortcutsDialog = await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count();
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
    inventory.overlay.named = await shortcuts.count();
    inventory.overlay.labelledBy = await shortcuts.getAttribute('aria-labelledby');
    inventory.overlay.hostCount = await page.locator('[data-keyboard-shortcuts-modal="true"]').count();
    inventory.overlay.unnamedDialogs = await page.evaluate(() => (
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
    inventory.overlay.promptNamed = await page.getByRole('dialog', { name: /Lock this document/ }).count();
    inventory.overlay.createNamed = await page.getByRole('dialog', { name: 'Create category', exact: true }).count();
    await page.keyboard.press('Escape');

    await openPage(page, { url: SURVEY_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    inventory.editor.surveyShortcuts = await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count();
    inventory.editor.surveyCreate = await page.getByRole('dialog', { name: 'Create category', exact: true }).count();

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const hubControls = await visibleControls(page);
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.settingsDialog = await page.getByRole('dialog', { name: 'Settings', exact: true }).count();
    inventory.hub.confirmDialog = await page.getByRole('dialog', { name: 'Delete 1 category?', exact: true }).count();
    inventory.hub.createDialog = await page.getByRole('dialog', { name: 'Create category', exact: true }).count();
    inventory.hub.lockDialog = await page.getByRole('dialog', { name: /Lock this document/ }).count();
    inventory.hub.shortcutsDialog = await page.getByRole('dialog', { name: 'Keyboard shortcuts', exact: true }).count();
    inventory.hub.unnamed = hubControls.filter((row) => row.unnamed);
    inventory.novel.hub = novelNames(hubControls);

    inventory.lease.processAutoLogin = Boolean(process.env.VITE_DEV_AUTO_LOGIN_EMAIL);
    inventory.lease.serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_KEYBOARD_SHORTCUTS_OVERLAY_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.sync).toBe(0);
  expect(inventory.editor.keepMountInert).toBe(true);
  expect(inventory.editor.settingsDialog).toBe(0);
  expect(inventory.editor.confirmDialog).toBe(0);
  expect(inventory.editor.createDialog).toBe(0);
  expect(inventory.editor.lockDialog).toBe(0);
  expect(inventory.editor.shortcutsDialog).toBe(0);
  expect(inventory.overlay.named).toBe(1);
  expect(inventory.overlay.labelledBy).toBe('keyboard-shortcuts-title');
  expect(inventory.overlay.hostCount).toBe(1);
  expect(inventory.overlay.unnamedDialogs).toEqual([]);
  expect(inventory.overlay.promptNamed).toBe(0);
  expect(inventory.overlay.createNamed).toBe(0);
  expect(inventory.editor.surveyShortcuts).toBe(0);
  expect(inventory.editor.surveyCreate).toBe(0);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.settingsDialog).toBe(0);
  expect(inventory.hub.confirmDialog).toBe(0);
  expect(inventory.hub.createDialog).toBe(0);
  expect(inventory.hub.lockDialog).toBe(0);
  expect(inventory.hub.shortcutsDialog).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
});
