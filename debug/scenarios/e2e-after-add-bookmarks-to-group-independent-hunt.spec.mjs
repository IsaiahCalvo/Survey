import { test, expect } from '@playwright/test';

// Independent hunt after Add bookmarks to group dialog name.
// Axis: compile-visible leftovers that are NOT leftover-18 and NOT
// Add bookmarks to group name / Create bookmark group name / Survey
// export name / Spaces export menuitem / Projects file-row More /
// Documents mobile sort / Projects More / Templates More / Archive
// sort / Documents More / Eraser Type / Selection Mode / Manage Team
// menuitem / Activity dialog name / unnamed-dialog family already
// proved / exhausted catalogs / Space CSV-PDF apply / Survey
// EXPORT-Push-Sync apply / V-07 Create group apply / Add bookmarks
// apply. Official annotationContextMenuitem leftover vs spec Enter
// is not stale vs live source (source already has Enter).
// Do not stamp file.id. Do not invent leftover-18 mint / roster / Stripe.
// Do not open Activity. Do not click Restore / Delete forever.
// Do not click Upload files. Do not apply Pin. Do not click Lock / Delete.
// Do not click CSV / PDF Pages. Do not click EXPORT / Open linked /
// Update existing / Export Excel / Sync Microsoft 365.
// Do not click Create group apply. Do not click Add bookmarks apply.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const TEMPLATE = 'Security Walk-Through';
const TOWER = 'Tower 5 — Security';
const KAL436 = /KAL-436 Preservation Template/;
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
  'Edit profile', 'Close', 'Close preview',
  'Survey', 'Delete selected categories', 'Cancel', 'Delete category',
  'Create category', 'Keyboard shortcuts', 'Document Access', 'Invite',
  'Edit modules', 'New module',
  'Manage team', 'Invite user', 'Copy email', 'View activity',
  'Select annotations', 'Select text', 'Selection Mode',
  'Partial erase', 'Full stroke erase', 'Eraser Type', 'Eraser type',
  'Preview & details', 'Rename', 'Copy', 'Paste', 'Lock document',
  'Show and sort', 'Most recently archived', 'File', 'Project', 'Size',
  'Sort', 'Last edited',
  'Restore', 'Delete forever',
  `${TEMPLATE} actions`, 'GC actions', 'Template actions', 'Entity actions',
  `${TOWER} actions`, 'Lab Reno — MEP actions', 'Project actions',
  `${OWNER} actions`, 'Document actions',
  'Add member', 'Get link to project', 'Upload files', 'Pin project',
  'Manage project', 'Share project',
  'Create space', 'Create a space to export', 'Export Space 1',
  'CSV', 'PDF Pages',
  'Excel actions', 'Open linked', 'Update existing',
  'Export survey data', 'Export Excel', 'Sync Microsoft 365',
  'Add bookmark', 'New bookmark group', 'Create bookmark group',
  'Create group', 'Create bookmark', 'Current page',
  'Add bookmarks to group', 'Add bookmarks',
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
    [...document.querySelectorAll('[role="menu"], [data-select-mode-menu="true"], [data-eraser-caret-popup="true"], [data-highlighter-caret-popup="true"], [data-counter-caret-popup="true"], [data-manage-team-dismiss-surface="true"], .archive-sort-menu, .documents-mobile-sort-menu, .ed-tpl-menu, .spaces-header-export-menu, .mobile-survey-sheet-export-menu, .survey-marker-export-compact-menu')]
      .filter((node) => {
        const style = window.getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const role = node.getAttribute('role');
        const name = node.getAttribute('aria-label')
          || (node.getAttribute('aria-labelledby') && document.getElementById(node.getAttribute('aria-labelledby'))?.textContent)
          || '';
        const items = node.querySelectorAll('[role="menuitem"], [role="option"], [role="menuitemradio"]');
        return (role !== 'menu' && role !== 'listbox' && items.length === 0) || (role === 'menu' && !String(name).trim());
      })
      .map((node) => ({
        role: node.getAttribute('role') || '',
        name: node.getAttribute('aria-label') || '',
        className: node.className || '',
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

async function openBookmarks(page) {
  const tab = page.getByRole('button', { name: 'Bookmarks', exact: true }).first();
  await expect(tab).toBeVisible({ timeout: 15_000 });
  if ((await tab.getAttribute('aria-pressed')) !== 'true') {
    await tab.click();
  }
  await expect(page.getByRole('button', { name: 'Add bookmark', exact: true })).toBeVisible({ timeout: 10_000 });
}

test('independent hunt after Add bookmarks to group dialog name', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    editor: {},
    overlay: {},
    hub: {},
    archive: {},
    templates: {},
    projects: {},
    survey: {},
    bookmarks: {},
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
    inventory.editor.createGroupIdle = await page.getByRole('dialog', { name: 'Create bookmark group', exact: true }).count();
    inventory.editor.addToGroupIdle = await page.getByRole('dialog', { name: 'Add bookmarks to group', exact: true }).count();
    inventory.editor.lockDialog = await page.getByRole('dialog', { name: /Lock this document/ }).count();
    inventory.editor.unnamed = editorControls.filter((row) => row.unnamed);
    inventory.novel.editor = novelNames(editorControls);

    await openBookmarks(page);
    await page.getByRole('button', { name: 'Add bookmark', exact: true }).click();
    await page.getByRole('button', { name: 'Add bookmarks to group', exact: true }).click();
    const addToGroup = page.getByRole('dialog', { name: 'Add bookmarks to group', exact: true });
    await expect(addToGroup).toBeVisible({ timeout: 8_000 });
    inventory.bookmarks.namedDialog = await addToGroup.count();
    inventory.bookmarks.createGroupNamed = await page.getByRole('dialog', { name: 'Create bookmark group', exact: true }).count();
    inventory.bookmarks.unnamedDialogs = await unnamedDialogs(page);
    await page.keyboard.press('Escape');
    inventory.bookmarks.afterEscape = await addToGroup.count();

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

    await openPage(page, { url: SURVEY_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: KAL436 }).click();
    const excelChevron = page.getByRole('button', { name: 'Excel actions', exact: true });
    await expect(excelChevron).toBeVisible({ timeout: 15_000 });
    await excelChevron.click();
    inventory.survey.namedMenu = await page.getByRole('menu', { name: 'Excel actions', exact: true }).count();
    inventory.survey.nameless = await namelessOpenMenus(page);
    await page.keyboard.press('Escape');

    inventory.editor.highlighterCaret = await page.locator('[data-highlighter-caret-button="true"]').count();
    inventory.editor.counterCaret = await page.locator('[data-counter-caret], [data-counter-caret-button="true"]').count();

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const hubControls = await visibleControls(page);
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.addToGroupIdle = await page.getByRole('dialog', { name: 'Add bookmarks to group', exact: true }).count();
    inventory.hub.lockDialog = await page.getByRole('dialog', { name: /Lock this document/ }).count();
    inventory.hub.unnamed = hubControls.filter((row) => row.unnamed);
    inventory.novel.hub = novelNames(hubControls);

    const ownerMore = page.locator('.documents-desktop-card [data-document-id]')
      .filter({ hasText: OWNER })
      .getByRole('button', { name: 'More' })
      .first();
    await ownerMore.click();
    inventory.hub.ownerMenu = await page.getByRole('menu', { name: `${OWNER} actions`, exact: true }).count();
    inventory.hub.share = await page.getByRole('menuitem', { name: 'Share', exact: true }).count();
    inventory.hub.docNameless = await namelessOpenMenus(page);
    await page.keyboard.press('Escape');

    await openPage(page, { url: HUB_ARCHIVE });
    await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
    await page.locator('.archive-desktop-search .archive-filter-button').click();
    inventory.archive.namedMenu = await page.getByRole('menu', { name: 'Show and sort', exact: true }).count();
    inventory.archive.nameless = await namelessOpenMenus(page);
    await page.keyboard.press('Escape');

    await openPage(page, { url: HUB_TEMPLATES });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const tplMore = page.getByRole('complementary').filter({
      has: page.getByRole('button', { name: 'New template', exact: true }),
    }).locator('[data-drag-rearrange-row]').filter({ hasText: TEMPLATE })
      .getByRole('button', { name: 'More', exact: true });
    await tplMore.click();
    const namedTpl = page.getByRole('menu', { name: `${TEMPLATE} actions`, exact: true });
    await expect(namedTpl).toBeVisible({ timeout: 8_000 });
    inventory.templates.openMenus = await namelessOpenMenus(page);
    inventory.templates.namedActions = await namedTpl.count();
    await page.keyboard.press('Escape');

    await openPage(page, { url: HUB_PROJECTS });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(TOWER).first()).toBeVisible({ timeout: 15_000 });
    const projectMore = page.locator('.projects-desktop-layout [data-project-id]')
      .filter({ hasText: TOWER })
      .getByRole('button', { name: 'More' });
    await projectMore.click();
    const namedProject = page.getByRole('menu', { name: `${TOWER} actions`, exact: true });
    await expect(namedProject).toBeVisible({ timeout: 8_000 });
    inventory.projects.openMenus = await namelessOpenMenus(page);
    inventory.projects.namedActions = await namedProject.count();
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Manage team', exact: true }).click();
    const team = page.getByRole('dialog', { name: 'Manage Team', exact: true });
    await expect(team).toBeVisible({ timeout: 10_000 });
    inventory.projects.manageTeamNamed = await team.count();
    inventory.projects.activityDialog = await page.getByRole('dialog', { name: /activity/i }).count();
    inventory.projects.unnamedDialogs = await unnamedDialogs(page);
    await page.keyboard.press('Escape');

    inventory.lease.processAutoLogin = Boolean(process.env.VITE_DEV_AUTO_LOGIN_EMAIL);
    inventory.lease.serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_ADD_BOOKMARKS_TO_GROUP_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.createGroupIdle).toBe(0);
  expect(inventory.editor.addToGroupIdle).toBe(0);
  expect(inventory.bookmarks.namedDialog).toBe(1);
  expect(inventory.bookmarks.createGroupNamed).toBe(0);
  expect(inventory.bookmarks.unnamedDialogs).toEqual([]);
  expect(inventory.bookmarks.afterEscape).toBe(0);
  expect(inventory.survey.namedMenu).toBe(1);
  expect(inventory.survey.nameless).toEqual([]);
  expect(inventory.editor.highlighterCaret).toBe(0);
  expect(inventory.editor.lockDialog).toBe(0);
  expect(inventory.overlay.shortcutsNamed).toBe(1);
  expect(inventory.overlay.unnamedDialogs).toEqual([]);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.addToGroupIdle).toBe(0);
  expect(inventory.hub.lockDialog).toBe(0);
  expect(inventory.hub.ownerMenu).toBe(1);
  expect(inventory.hub.share).toBe(1);
  expect(inventory.hub.docNameless).toEqual([]);
  expect(inventory.archive.namedMenu).toBe(1);
  expect(inventory.archive.nameless).toEqual([]);
  expect(inventory.templates.namedActions).toBe(1);
  expect(inventory.templates.openMenus).toEqual([]);
  expect(inventory.projects.namedActions).toBe(1);
  expect(inventory.projects.openMenus).toEqual([]);
  expect(inventory.projects.manageTeamNamed).toBe(1);
  expect(inventory.projects.activityDialog).toBe(0);
  expect(inventory.lease.fileId).toBeNull();
});
