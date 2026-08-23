import { test, expect } from '@playwright/test';

// Independent hunt after keep-mount inert leftover.
// Axis: unique leftover that is NOT leftover-18, NOT nameless-menu /
// menuitem-role, NOT rail-toggle, dismiss, Home `?`, remapped-after-CW,
// overlay-mount, Sync chip, hub Account, hub nav type=button, or
// keep-mount inert just proved. PDF AcroForm name/agree on
// clickable-link-test.pdf stay dedicated page widgets (Forms / X-05
// parked). Do not stamp file.id.

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
        unnamed: !nameOf(node),
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

test('independent hunt after keep-mount inert', async ({ page }) => {
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
    inventory.editor.keepMount = await page.evaluate(() => {
      const host = document.querySelector('[data-hub-keep-mount]');
      return host ? {
        inert: host.hasAttribute('inert') || host.inert === true,
        ariaHidden: host.getAttribute('aria-hidden'),
      } : null;
    });
    inventory.editor.hubNavFocusable = await page.evaluate(() => (
      [...document.querySelectorAll('.survey-hub aside.side nav button')]
        .filter((node) => {
          if (node.closest('[inert], [aria-hidden="true"]')) return false;
          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const box = node.getBoundingClientRect();
          return box.width > 0 && box.height > 0;
        })
        .map((node) => (node.getAttribute('aria-label') || node.textContent || '').replace(/\s+/g, ' ').trim())
    ));
    inventory.editor.formWidgets = editorControls.filter((row) => (
      (row.tag === 'input' && (row.type === 'text' || row.type === 'checkbox')) && !row.inHub
    ));
    inventory.editor.unnamed = editorControls.filter((row) => row.unnamed);
    inventory.novel.editor = novelNames(editorControls);

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const hubControls = await visibleControls(page);
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.keepMount = await page.evaluate(() => {
      const host = document.querySelector('[data-hub-keep-mount]');
      return host ? {
        inert: host.hasAttribute('inert') || host.inert === true,
        ariaHidden: host.getAttribute('aria-hidden'),
      } : null;
    });
    inventory.hub.unnamed = hubControls.filter((row) => row.unnamed);
    inventory.novel.hub = novelNames(hubControls);

    await openPage(page, { width: 390, height: 844, url: LINK_PDF });
    await expect(page.getByRole('button', { name: /Draw|Document tools/ }).first()).toBeVisible({ timeout: 60_000 });
    const mobileEditorControls = await visibleControls(page);
    inventory.mobileEditor.tapToSync = await page.getByRole('button', { name: /Up to date\. Tap to sync now/i }).count();
    inventory.mobileEditor.hidden = await hiddenCounts(page);
    inventory.mobileEditor.keepMount = await page.evaluate(() => {
      const host = document.querySelector('[data-hub-keep-mount]');
      return host ? {
        inert: host.hasAttribute('inert') || host.inert === true,
        ariaHidden: host.getAttribute('aria-hidden'),
      } : null;
    });
    inventory.mobileEditor.unnamed = mobileEditorControls.filter((row) => row.unnamed);
    inventory.novel.mobileEditor = novelNames(mobileEditorControls);

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
    console.log('AFTER_HUB_KEEP_MOUNT_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.sync).toBe(0);
  expect(inventory.editor.keepMount.inert).toBe(true);
  expect(inventory.editor.hubNavFocusable).toEqual([]);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.keepMount, 'hubPreview is not AppShell keep-mount').toBeNull();
  expect(inventory.mobileEditor.tapToSync).toBe(0);
  expect(inventory.mobileEditor.keepMount.inert).toBe(true);
  expect(inventory.lease.fileId).toBeNull();
});
