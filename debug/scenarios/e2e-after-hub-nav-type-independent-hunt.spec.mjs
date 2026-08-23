import { test, expect } from '@playwright/test';

// Independent hunt after hub nav type=button leftover.
// Axis: unique leftover that is NOT leftover-18, NOT nameless-menu /
// menuitem-role, NOT rail-toggle, dismiss, Home `?`, remapped-after-CW,
// overlay-mount, Sync chip, hub Account, or hub nav type=button just proved.
// Live DOM: unnamed keep-mounted Search/select and other compile-visible
// names without a 2026-08-23 receipt. Do not stamp file.id.

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
    const nodes = [...document.querySelectorAll('button, input, select, [role="button"], [role="menuitem"], [role="tab"]')];
    return nodes
      .filter((node) => {
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
        unnamed: !nameOf(node),
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

test('independent hunt after hub nav type=button', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    editor: {},
    hub: {},
    mobileEditor: {},
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
    inventory.editor.hubNav = await page.evaluate(() => (
      [...document.querySelectorAll('.survey-hub aside.side nav button')]
        .map((node) => ({
          name: (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim(),
          type: node.getAttribute('type'),
        }))
    ));
    inventory.editor.unnamed = editorControls.filter((row) => row.unnamed);
    inventory.editor.searchInputs = editorControls.filter((row) => (
      row.tag === 'input' && /search/i.test(row.name || row.type)
    ));
    inventory.novel.editor = novelNames(editorControls);

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const hubControls = await visibleControls(page);
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.navTypeButton = await page.evaluate(() => (
      [...document.querySelectorAll('.survey-hub aside.side nav button')]
        .map((node) => ({
          name: (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim(),
          type: node.getAttribute('type'),
        }))
    ));
    inventory.hub.searchInputs = hubControls.filter((row) => (
      (row.tag === 'input' || row.tag === 'select') && (row.unnamed || /search/i.test(row.name))
    ));
    inventory.hub.unnamed = hubControls.filter((row) => row.unnamed);
    inventory.novel.hub = novelNames(hubControls);

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 });
    const mobileEditorControls = await visibleControls(page);
    inventory.mobileEditor.tapToSync = await page.getByRole('button', { name: /Up to date\. Tap to sync now/i }).count();
    inventory.mobileEditor.hidden = await hiddenCounts(page);
    inventory.mobileEditor.unnamed = mobileEditorControls.filter((row) => row.unnamed);
    inventory.novel.mobileEditor = novelNames(mobileEditorControls);

    await openPage(page, { width: 390, height: 844, url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const mobileHubControls = await visibleControls(page);
    inventory.mobileHub.openNav = await page.getByRole('button', { name: 'Open navigation', exact: true }).count();
    inventory.mobileHub.homeSections = await page.getByRole('navigation', { name: 'Home sections' }).count();
    inventory.mobileHub.unnamed = mobileHubControls.filter((row) => row.unnamed);
    inventory.novel.mobileHub = novelNames(mobileHubControls);

    inventory.lease.processAutoLogin = Boolean(process.env.VITE_DEV_AUTO_LOGIN_EMAIL);
    inventory.lease.serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_HUB_NAV_TYPE_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.sync).toBe(0);
  expect(inventory.editor.hubNav.every((row) => row.type === 'button')).toBe(true);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.navTypeButton.every((row) => row.type === 'button')).toBe(true);
  expect(inventory.mobileEditor.tapToSync).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
});
