import { test, expect } from '@playwright/test';

// Independent hunt after Settings dialog accessible name leftover.
// Axis: official leftover files vs live source after keep-mount inert
// (NOT isolated 8448); compile-visible chrome that is NOT rail-toggle,
// dismiss, nameless-menu, Home `?`, hub nav type, keep-mount inert,
// Sync chip, remapped-after-CW, or Settings dialog name just proved.
// Live DOM walk of ?testPdf= / ?hubPreview=1 for button/input/menuitem
// names. PDF AcroForm name/agree stay Forms / X-05 leftover-18.
// Do not stamp file.id.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
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

test('independent hunt after Settings dialog name', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    editor: {},
    hub: {},
    settings: {},
    mobileHub: {},
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
    inventory.editor.unnamed = editorControls.filter((row) => row.unnamed);
    inventory.novel.editor = novelNames(editorControls);

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const hubControls = await visibleControls(page);
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.settingsDialogBefore = await page.getByRole('dialog', { name: 'Settings', exact: true }).count();
    inventory.hub.unnamed = hubControls.filter((row) => row.unnamed);
    inventory.novel.hub = novelNames(hubControls);

    await page.getByRole('button', { name: 'Open account menu' }).first().click();
    await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible({ timeout: 15_000 });
    inventory.settings.named = await page.getByRole('dialog', { name: 'Settings', exact: true }).count();
    inventory.settings.labelledBy = await page.getByRole('dialog', { name: 'Settings', exact: true }).getAttribute('aria-labelledby');
    inventory.settings.unnamedDialogs = await page.evaluate(() => (
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
    await page.keyboard.press('Escape');

    await openPage(page, { width: 390, height: 844, url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const mobileHubControls = await visibleControls(page);
    inventory.mobileHub.openNav = await page.getByRole('button', { name: 'Open navigation', exact: true }).count();
    inventory.mobileHub.unnamed = mobileHubControls.filter((row) => row.unnamed);
    inventory.novel.mobileHub = novelNames(mobileHubControls);

    inventory.lease.processAutoLogin = Boolean(process.env.VITE_DEV_AUTO_LOGIN_EMAIL);
    inventory.lease.serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_SETTINGS_DIALOG_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
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
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.settingsDialogBefore).toBe(0);
  expect(inventory.settings.named).toBe(1);
  expect(inventory.settings.labelledBy).toBe('account-settings-title');
  expect(inventory.settings.unnamedDialogs).toEqual([]);
  expect(inventory.lease.fileId).toBeNull();
});
