import { test, expect } from '@playwright/test';

// Independent hunt after hub Account menuitem (`46ffa455` / `f4a8a077`).
// Axis: unique leftover that is NOT leftover-18, NOT nameless-menu /
// menuitem-role, NOT rail-toggle, dismiss, Home `?`, remapped-after-CW,
// overlay-mount, spacesRail, popover, or hub-account files just aligned.
// Live DOM: button/input accessible names without a 2026-08-23 receipt.
// Do not stamp file.id. Do not invent dest-XYZ / lease / Note create.

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
]);

async function openPage(page, { width = 1400, height = 900, url } = {}) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('survey_document_history_events_v1');
      const keys = [];
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key && (
          key.startsWith('annotationsByPage_')
          || key.startsWith('callouts_')
          || key.startsWith('cloudRenderAnnotationsByPage_')
          || key.startsWith('toolPrefs_')
        )) {
          keys.push(key);
        }
      }
      keys.forEach((key) => localStorage.removeItem(key));
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
    const nodes = [...document.querySelectorAll('button, input, [role="button"], [role="menuitem"], [role="tab"]')];
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

test('independent hunt after hub Account menuitem', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    editor: {},
    hub: {},
    mobileEditor: {},
    mobileHub: {},
    unnamed: {},
    novel: {},
    official: {},
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
    inventory.editor.accountMenu = await page.getByRole('menu', { name: 'Account menu' }).count();
    inventory.editor.settingsMenuitem = await page.getByRole('menuitem', { name: 'Settings', exact: true }).count();
    inventory.editor.rotateMenuitem = await page.getByRole('menuitem', { name: 'Rotate', exact: true }).count();
    inventory.editor.sync = await page.getByRole('button', { name: /Syncing|Retry now|Save version|checking whether this document uses live collaboration/i }).count();
    inventory.editor.presence = await page.getByRole('button', { name: /presence|collaborator/i }).count();
    inventory.editor.fileMenu = await page.getByRole('button', { name: /^File$/i }).count();
    inventory.editor.unnamed = editorControls.filter((row) => row.unnamed);
    inventory.novel.editor = novelNames(editorControls);

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const hubControls = await visibleControls(page);
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.accountMenu = await page.getByRole('menu', { name: 'Account menu' }).count();
    inventory.hub.settingsMenuitem = await page.getByRole('menuitem', { name: 'Settings', exact: true }).count();
    inventory.hub.navTypeButton = await page.evaluate(() => (
      [...document.querySelectorAll('.survey-hub .nav button, .survey-hub .mobile-home-tabs button')]
        .map((node) => ({
          name: (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim(),
          type: node.getAttribute('type'),
        }))
    ));
    inventory.hub.unnamed = hubControls.filter((row) => row.unnamed);
    inventory.novel.hub = novelNames(hubControls);

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 });
    const mobileEditorControls = await visibleControls(page);
    inventory.mobileEditor.more = await page.getByRole('button', { name: 'More document options', exact: true }).count();
    inventory.mobileEditor.tapToSync = await page.getByRole('button', { name: /Up to date\. Tap to sync now/i }).count();
    inventory.mobileEditor.checking = await page.getByRole('button', { name: /checking whether this document uses live collaboration/i }).count();
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
    inventory.mobileHub.navTypeButton = await page.evaluate(() => (
      [...document.querySelectorAll('.survey-hub .mobile-home-tabs button, .survey-hub .mobile-rail-nav-options button')]
        .map((node) => ({
          name: (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim(),
          type: node.getAttribute('type'),
        }))
    ));

    inventory.official.annotationContextEnter = 'stale leftover official vs spec, not live source';
    inventory.lease.processAutoLogin = Boolean(process.env.VITE_DEV_AUTO_LOGIN_EMAIL);
    inventory.lease.serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_HUB_ACCOUNT_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.accountMenu).toBe(0);
  expect(inventory.editor.sync).toBe(0);
  expect(inventory.mobileEditor.tapToSync).toBe(0);
  expect(inventory.mobileEditor.checking).toBe(0);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
});
