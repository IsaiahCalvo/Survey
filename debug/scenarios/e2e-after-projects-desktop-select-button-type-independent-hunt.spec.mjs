import { test, expect } from '@playwright/test';

// Independent hunt after Projects desktop Select type=button.
// Axis: compile-visible leftovers that are NOT leftover-18 and NOT
// Projects desktop Select type / Projects 390 Select type / Documents Select type / Archive Select type / Archive Close preview type / Documents Preview Share type / Documents Preview Open file type / Documents Close preview type / Documents Upload type / Manage team type / Category drag titles type / Entity Select type / Template-list Select type / Category Select type / Module Select type / New module name / New module type / Module count chrome name / Category drag titles name / Edit color type / New entity type / New category type / Entity name name / Projects Tap to rename name / New template
// type / Templates Expand name / Templates Click to rename name
// / Drag to rearrange name / Click to rename name / Invite-open
// Edit type / Share-open hub chrome type /
// Search Previous/Next type / Fill / Border type / Invite User
// role name / Share Permission name / Opacity slider name /
// Style picker name / Width picker name / Color picker name /
// Search clear name / Add bookmark name / Add bookmarks to
// group name / Create bookmark group name / Survey export name
// / Spaces export menuitem / Projects file-row More / Documents
// mobile sort / Projects More / Templates More / Archive sort /
// Documents More / Eraser Type / Selection Mode / Manage Team
// menuitem / Activity dialog name / unnamed-dialog family
// already proved / exhausted catalogs / Space CSV-PDF apply /
// Survey EXPORT-Push-Sync apply / V-07 Create group apply / Add
// bookmarks apply / Create bookmark apply / V-08 Next-Previous
// apply / Search rail toggle / C-01 swatch apply / Style-Width
// dismiss / Width preset apply / Style option apply / remapped
// opacity apply / Share Copy-Send apply / Invite Copy-Send
// apply / Documents Share Access apply / Manage Team role
// picker / Fill / Border apply / Add files / New project apply
// / Edit apply / Click to rename apply / Drag to rearrange
// apply / Templates rename apply / Templates Expand apply.
// Official annotationContextMenuitem leftover vs spec Enter is not
// stale vs live source (source already has Enter).
// Do not stamp file.id. Do not invent leftover-18 mint / roster / Stripe.
// Do not open Activity. Do not click Restore / Delete forever.
// Do not click Upload files. Do not apply Pin. Do not click Lock / Delete.
// Do not click CSV / PDF Pages. Do not click EXPORT / Open linked /
// Update existing / Export Excel / Sync Microsoft 365.
// Do not click Create group apply. Do not click Add bookmarks apply.
// Do not click Create bookmark apply. Do not click color swatches.
// Do not click Width presets to apply. Do not click Style options.
// Do not drag / type Opacity. Do not click Copy link / Send invite.
// Do not change Permission / Invite User role.
// Do not click Fill / Border / hex / Transparent.
// Do not click Previous match / Next match.
// Do not click Add files / New project apply.
// Do not click Edit apply.
// Do not apply Click to rename.
// Do not apply Tap to rename.
// Do not drag-apply project order.
// Do not click New template apply.
// Do not apply Entity name.
// Do not click New entity apply.
// Do not click New category apply.
// Do not click Edit color apply.
// Do not click New module apply (name leftover already taken).
// Do not click Module Select apply / do not switch modules.
// Do not click Category Select apply / do not switch categories.
// Do not click Template-list Select apply / do not switch templates.
// Do not click Entity Select apply / do not switch entities.
// Do not click Category drag-title apply / do not switch modules.
// Do not drag-apply category or module reorder.
// Do not double-click to rename apply.
// Do not apply module count chrome.
// Do not apply module edits.
// Do not open Edit-modules for the type-null New module there.
// Do not click Manage team apply (type leftover already taken).
// Do not click Upload apply / do not pick a file.
// Do not click Upload PDF empty-state apply.
// Do not click Close preview apply.
// Do not click Open file / Share apply.
// Do not apply archive restore/delete.
// Do not click Archive Select apply (type leftover already taken).
// Do not click Documents Select apply (type leftover already taken).
// Do not click Projects 390 Select apply (type leftover already taken).
// Do not click Projects desktop Select apply (type leftover already taken).

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
  'Width presets',
  'Opacity', 'Opacity percentage',
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
  'Clear search', 'Search text in PDF...', 'Search text',
  'Previous match (Shift+Enter)', 'Next match (Enter)',
  'Version history', 'Close version history panel',
  'Preset colors', 'Color spectrum',
  'Solid', 'Dashed', 'Dotted', 'Cloud',
  'Permission', 'Invite by email', 'Copy link', 'Share template',
  'Invite User', 'Share link role', 'Invite by email role',
  'Send Editor invite',
  'Fill', 'Border',
  'Add files', 'New project', 'Search projects...',
  'Search files...', 'Search templates...', 'Search archive...',
  'Edit', 'Click to rename', 'Tap to rename', 'Drag to rearrange',
  'Expand', 'Collapse',
  'New template',
  'Entity name',
  'New category',
  'New entity',
  'Edit color',
  'Installation Phase · drag to reorder · double-click to rename',
  'Commissioning Phase · drag to reorder · double-click to rename',
  'Installation Phase 2',
  'Commissioning Phase 1',
  'Installation Phase',
  'Commissioning Phase',
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
    const nodes = [...document.querySelectorAll('button, input, select, [role="button"], [role="menuitem"], [role="tab"], [role="dialog"], [role="slider"], [role="combobox"]')];
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

async function armRectangle(page) {
  const rectangle = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true });
  if (!(await rectangle.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
  }
  await expect(rectangle).toBeVisible({ timeout: 15_000 });
  const pressed = await rectangle.getAttribute('aria-pressed');
  const cls = String(await rectangle.getAttribute('class') || '');
  const active = cls.includes('is-active') || cls.includes('btn-active');
  if (pressed !== 'true' && !active) {
    await rectangle.click();
  }
  await expect(rectangle).toHaveClass(/btn-active|is-active/);
}

test('independent hunt after Projects desktop Select type=button', async ({ page }) => {
  test.setTimeout(180_000);
  const inventory = {
    editor: {},
    overlay: {},
    hub: {},
    archive: {},
    templates: {},
    projects: {},
    survey: {},
    style: {},
    width: {},
    color: {},
    opacity: {},
    search: {},
    share: {},
    invite: {},
    history: {},
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
    inventory.editor.styleIdle = await page.getByRole('dialog', { name: 'Style', exact: true }).count();
    inventory.editor.widthIdle = await page.getByRole('dialog', { name: 'Width', exact: true }).count();
    inventory.editor.colorIdle = await page.getByRole('dialog', { name: 'Color', exact: true }).count();
    inventory.editor.opacityIdle = await page.getByRole('slider', { name: 'Opacity', exact: true }).count();
    inventory.editor.permissionIdle = await page.getByRole('combobox', { name: 'Permission', exact: true }).count();
    inventory.editor.linkRoleIdle = await page.getByRole('combobox', { name: 'Share link role', exact: true }).count();
    inventory.editor.emailRoleIdle = await page.getByRole('combobox', { name: 'Invite by email role', exact: true }).count();
    inventory.editor.clearIdle = await page.getByRole('button', { name: 'Clear search', exact: true }).count();
    inventory.editor.prevIdle = await page.getByRole('button', { name: 'Previous match (Shift+Enter)', exact: true }).count();
    inventory.editor.nextIdle = await page.getByRole('button', { name: 'Next match (Enter)', exact: true }).count();
    inventory.editor.addBookmarkIdle = await page.getByRole('dialog', { name: 'Add bookmark', exact: true }).count();
    inventory.editor.lockDialog = await page.getByRole('dialog', { name: /Lock this document/ }).count();
    inventory.editor.editIdle = await page.locator('[data-manage-team-edit]').count();
    inventory.editor.unnamed = editorControls.filter((row) => row.unnamed);
    inventory.novel.editor = novelNames(editorControls);

    await armRectangle(page);
    const styleTrigger = page.getByRole('button', { name: 'Style', exact: true });
    await expect(styleTrigger).toBeVisible({ timeout: 8_000 });
    await styleTrigger.click();
    const styleDialog = page.getByRole('dialog', { name: 'Style', exact: true });
    await expect(styleDialog).toBeVisible({ timeout: 8_000 });
    inventory.style.namedDialog = await styleDialog.count();
    inventory.style.unnamedDialogs = await unnamedDialogs(page);
    await page.keyboard.press('Escape');
    await expect(styleDialog).toHaveCount(0, { timeout: 8_000 });
    inventory.style.afterEscape = await styleDialog.count();

    const widthTrigger = page.getByRole('button', { name: 'Width presets', exact: true });
    await expect(widthTrigger).toBeVisible({ timeout: 8_000 });
    await widthTrigger.click();
    const widthDialog = page.getByRole('dialog', { name: 'Width', exact: true });
    await expect(widthDialog).toBeVisible({ timeout: 8_000 });
    inventory.width.namedDialog = await widthDialog.count();
    inventory.width.unnamedDialogs = await unnamedDialogs(page);
    await page.keyboard.press('Escape');
    await expect(widthDialog).toHaveCount(0, { timeout: 8_000 });
    inventory.width.afterEscape = await widthDialog.count();

    const colorTrigger = page.locator('[data-annotation-color-trigger]').first();
    await expect(colorTrigger).toBeVisible({ timeout: 8_000 });
    await colorTrigger.click();
    const colorDialog = page.getByRole('dialog', { name: 'Color', exact: true });
    await expect(colorDialog).toBeVisible({ timeout: 8_000 });
    inventory.color.namedDialog = await colorDialog.count();
    const opacitySlider = page.getByRole('slider', { name: 'Opacity', exact: true });
    await expect(opacitySlider).toBeVisible({ timeout: 8_000 });
    inventory.opacity.namedSlider = await opacitySlider.count();
    const fillTab = page.locator('[data-annotation-color-picker]').getByRole('button', { name: 'Fill', exact: true });
    const borderTab = page.locator('[data-annotation-color-picker]').getByRole('button', { name: 'Border', exact: true });
    inventory.color.fillType = await fillTab.getAttribute('type');
    inventory.color.borderType = await borderTab.getAttribute('type');
    const colorOpenControls = await visibleControls(page);
    inventory.novel.colorOpen = novelNames(colorOpenControls);
    await page.keyboard.press('Escape');
    await expect(colorDialog).toHaveCount(0, { timeout: 8_000 });
    inventory.color.afterEscape = await colorDialog.count();

    const searchTab = page.getByRole('button', { name: 'Search text', exact: true }).first();
    await expect(searchTab).toBeVisible({ timeout: 8_000 });
    if ((await searchTab.getAttribute('aria-pressed')) !== 'true') {
      await searchTab.click();
    }
    const searchField = page.getByPlaceholder('Search text in PDF...');
    await expect(searchField).toBeVisible({ timeout: 10_000 });
    await searchField.fill('the');
    const prevMatch = page.getByRole('button', { name: 'Previous match (Shift+Enter)', exact: true });
    const nextMatch = page.getByRole('button', { name: 'Next match (Enter)', exact: true });
    await expect(prevMatch).toBeVisible({ timeout: 15_000 });
    await expect(nextMatch).toBeVisible({ timeout: 8_000 });
    inventory.search.prevType = await prevMatch.getAttribute('type');
    inventory.search.nextType = await nextMatch.getAttribute('type');
    inventory.search.clearType = await page.getByRole('button', { name: 'Clear search', exact: true }).getAttribute('type');
    const searchOpenControls = await visibleControls(page);
    inventory.novel.searchOpen = novelNames(searchOpenControls);
    await searchField.focus();
    await page.keyboard.press('Escape');
    await expect(prevMatch).toHaveCount(0, { timeout: 8_000 });
    inventory.search.afterEscape = await prevMatch.count();

    const historyBtn = page.getByRole('button', { name: 'Version history', exact: true }).first();
    inventory.history.trigger = await historyBtn.count();
    if (await historyBtn.isVisible().catch(() => false)) {
      await historyBtn.click();
      inventory.history.panel = await page.getByText('Version history').count();
      inventory.history.unnamedDialogs = await unnamedDialogs(page);
      inventory.history.restore = await page.getByRole('button', { name: 'Restore', exact: true }).count();
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

    await openPage(page, { url: SURVEY_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: KAL436 }).click();
    const excelChevron = page.getByRole('button', { name: 'Excel actions', exact: true });
    await expect(excelChevron).toBeVisible({ timeout: 15_000 });
    await excelChevron.click();
    const namedExcel = page.getByRole('menu', { name: 'Excel actions', exact: true });
    await expect(namedExcel).toBeVisible({ timeout: 8_000 });
    inventory.survey.namedMenu = await namedExcel.count();
    inventory.survey.nameless = await namelessOpenMenus(page);
    await page.keyboard.press('Escape');

    inventory.editor.highlighterCaret = await page.locator('[data-highlighter-caret-button="true"]').count();
    inventory.editor.counterCaret = await page.locator('[data-counter-caret], [data-counter-caret-button="true"]').count();
    const pagesTab = page.getByRole('button', { name: 'Pages', exact: true }).first();
    if ((await pagesTab.getAttribute('aria-pressed')) !== 'true') {
      await pagesTab.click();
    }
    inventory.pages = await page.evaluate(() => {
      const panel = document.querySelector('.mobile-pages-panel, [class*="pages"]') || document.body;
      const cards = [...document.querySelectorAll('[data-page-number]')].filter((node) => {
        const box = node.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      });
      const unnamed = cards.filter((node) => {
        const name = node.getAttribute('aria-label') || node.getAttribute('role') || '';
        return !String(name).trim();
      }).map((node) => ({
        tag: node.tagName.toLowerCase(),
        role: node.getAttribute('role') || '',
        page: node.getAttribute('data-page-number') || '',
      }));
      return { cardCount: cards.length, unnamed };
    });

    await openPage(page, { url: HUB });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const hubControls = await visibleControls(page);
    inventory.hub.draw = await page.getByRole('button', { name: 'Draw', exact: true }).count();
    inventory.hub.permissionIdle = await page.getByRole('combobox', { name: 'Permission', exact: true }).count();
    inventory.hub.linkRoleIdle = await page.getByRole('combobox', { name: 'Share link role', exact: true }).count();
    inventory.hub.lockDialog = await page.getByRole('dialog', { name: /Lock this document/ }).count();
    inventory.hub.editIdle = await page.locator('[data-manage-team-edit]').count();
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
    inventory.hub.uploadCount = await page.locator('.documents-desktop-upload').count();
    inventory.hub.uploadType = inventory.hub.uploadCount
      ? await page.locator('.documents-desktop-upload').getAttribute('type')
      : null;
    inventory.hub.uploadName = inventory.hub.uploadCount
      ? await page.locator('.documents-desktop-upload').innerText()
      : null;
    const mobileUpload = page.locator('.hub-mobile-primary-action').filter({ hasText: 'Upload' });
    inventory.hub.mobileUploadCount = await mobileUpload.count();
    inventory.hub.mobileUploadType = inventory.hub.mobileUploadCount
      ? await mobileUpload.first().getAttribute('type')
      : null;
    const closePreview = page.locator('.documents-desktop-card').getByRole('button', { name: 'Close preview', exact: true });
    inventory.hub.closePreviewCount = await closePreview.count();
    inventory.hub.closePreviewType = inventory.hub.closePreviewCount
      ? await closePreview.first().getAttribute('type')
      : null;
    inventory.hub.closePreviewName = inventory.hub.closePreviewCount
      ? await closePreview.first().getAttribute('aria-label')
      : null;
    const previewOpenFile = page.locator('.documents-desktop-preview, aside').getByRole('button', { name: 'Open file', exact: true }).first();
    inventory.hub.previewOpenFileCount = await previewOpenFile.count();
    inventory.hub.previewOpenFileType = inventory.hub.previewOpenFileCount
      ? await previewOpenFile.getAttribute('type')
      : null;
    const previewShare = page.locator('.documents-desktop-preview, aside').getByRole('button', { name: 'Share', exact: true }).first();
    inventory.hub.previewShareCount = await previewShare.count();
    inventory.hub.previewShareType = inventory.hub.previewShareCount
      ? await previewShare.getAttribute('type')
      : null;
    inventory.hub.documentsSelectType = await page.locator('.documents-select-row button.mobile-header-select-button').first().getAttribute('type');
    inventory.hub.documentsSelectName = await page.locator('.documents-select-row button.mobile-header-select-button').first().innerText();
    inventory.hub.implicitSubmit = await page.evaluate(() => (
      [...document.querySelectorAll('button')]
        .filter((node) => {
          if (node.closest('[data-hub-keep-mount][inert], [data-hub-keep-mount][aria-hidden="true"]')) return false;
          if (node.getAttribute('type')) return false;
          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const box = node.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0) return false;
          const name = (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim();
          return !['All', 'None', 'Duplicate', 'Move/Copy', 'Select', 'Done'].includes(name);
        })
        .map((node) => ({
          name: (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          className: String(node.className || '').slice(0, 80),
        }))
    ));
    await page.keyboard.press('Escape');

    await openPage(page, { url: HUB_ARCHIVE });
    await expect(page.getByRole('heading', { name: 'Archive', exact: true })).toBeVisible({ timeout: 15_000 });
    await page.locator('.archive-desktop-search .archive-filter-button').click();
    inventory.archive.namedMenu = await page.getByRole('menu', { name: 'Show and sort', exact: true }).count();
    inventory.archive.nameless = await namelessOpenMenus(page);
    await page.keyboard.press('Escape');
    const sitePlan = page.locator('.archive-desktop-card [data-archive-item-id]').filter({ hasText: 'Site plan' }).first();
    await expect(sitePlan).toBeVisible({ timeout: 8_000 });
    inventory.archive.closePreviewBeforeSelect = await page.locator('.archive-desktop-card').getByRole('button', { name: 'Close preview', exact: true }).count();
    await sitePlan.click();
    const archiveClosePreview = page.locator('.archive-desktop-card').getByRole('button', { name: 'Close preview', exact: true });
    await expect(archiveClosePreview).toBeVisible({ timeout: 8_000 });
    inventory.archive.closePreviewCount = await archiveClosePreview.count();
    inventory.archive.closePreviewType = inventory.archive.closePreviewCount
      ? await archiveClosePreview.first().getAttribute('type')
      : null;
    inventory.archive.closePreviewName = inventory.archive.closePreviewCount
      ? await archiveClosePreview.first().getAttribute('aria-label')
      : null;
    inventory.archive.implicitSubmit = await page.evaluate(() => (
      [...document.querySelectorAll('button')]
        .filter((node) => {
          if (node.closest('[data-hub-keep-mount][inert], [data-hub-keep-mount][aria-hidden="true"]')) return false;
          if (node.getAttribute('type')) return false;
          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const box = node.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0) return false;
          const name = (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim();
          return !['All', 'None', 'Duplicate', 'Move/Copy', 'Select', 'Done'].includes(name);
        })
        .map((node) => ({
          name: (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          className: String(node.className || '').slice(0, 80),
        }))
    ));
    inventory.archive.selectType = await page.locator('.archive-select-row button.mobile-header-select-button').first().getAttribute('type');
    inventory.archive.selectName = await page.locator('.archive-select-row button.mobile-header-select-button').first().innerText();
    await archiveClosePreview.focus();
    await page.keyboard.press('Escape');
    inventory.archive.closePreviewAfterEscape = await archiveClosePreview.count();

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
    const tplRename = page.locator('.ed-scope input[data-template-title][aria-label="Click to rename"]');
    inventory.templates.renameLabel = await tplRename.getAttribute('aria-label');
    inventory.templates.renameTitle = await tplRename.getAttribute('title');
    inventory.templates.renameValue = await tplRename.inputValue();
    inventory.templates.renameNamed = await page.getByRole('textbox', { name: 'Click to rename', exact: true }).count();
    inventory.templates.newTemplateType = await page.getByRole('button', { name: 'New template', exact: true }).first().getAttribute('type');
    const entityName = page.locator('.ed-scope input[placeholder="Entity name"]').first();
    inventory.templates.entityNameLabel = await entityName.getAttribute('aria-label');
    inventory.templates.entityNamePlaceholder = await entityName.getAttribute('placeholder');
    inventory.templates.entityNameValue = await entityName.inputValue();
    inventory.templates.entityNameNamed = await page.getByRole('textbox', { name: 'Entity name', exact: true }).count();
    inventory.templates.newCategoryType = await page.getByRole('button', { name: 'New category', exact: true }).first().getAttribute('type');
    inventory.templates.newEntityType = await page.getByRole('button', { name: 'New entity', exact: true }).first().getAttribute('type');
    inventory.templates.editColorType = await page.getByRole('button', { name: 'Edit color', exact: true }).first().getAttribute('type');
    inventory.templates.newModuleType = await page.locator('.ed-scope button[title="New module"]').first().getAttribute('type');
    inventory.templates.newModuleTitle = await page.locator('.ed-scope button[title="New module"]').first().getAttribute('title');
    inventory.templates.newModuleLabel = await page.locator('.ed-scope button[title="New module"]').first().getAttribute('aria-label');
    inventory.templates.newModuleAccname = await page.getByRole('button', { name: 'New module', exact: true }).count();
    const moduleSelect = page.locator('.ed-scope p.micro').filter({ hasText: /^Module$/ })
      .locator('..')
      .getByRole('button', { name: 'Select', exact: true });
    inventory.templates.moduleSelectType = await moduleSelect.getAttribute('type');
    inventory.templates.moduleSelectText = await moduleSelect.innerText();
    inventory.templates.moduleSelectNamed = await moduleSelect.count();
    const categorySelect = page.locator('.ed-scope p.micro').filter({ hasText: /^Categories$/ })
      .locator('..')
      .getByRole('button', { name: 'Select', exact: true });
    inventory.templates.categorySelectType = await categorySelect.getAttribute('type');
    inventory.templates.categorySelectText = await categorySelect.innerText();
    inventory.templates.categorySelectNamed = await categorySelect.count();
    const templateListSelect = page.locator('.ed-scope aside').first()
      .getByRole('button', { name: 'Select', exact: true });
    inventory.templates.templateListSelectType = await templateListSelect.getAttribute('type');
    inventory.templates.templateListSelectText = await templateListSelect.innerText();
    inventory.templates.templateListSelectNamed = await templateListSelect.count();
    const entitySelect = page.locator('.ed-scope p.micro').filter({ hasText: /^Entities/ })
      .locator('../../..')
      .getByRole('button', { name: 'Select', exact: true });
    inventory.templates.entitySelectType = await entitySelect.getAttribute('type');
    inventory.templates.entitySelectText = await entitySelect.innerText();
    inventory.templates.entitySelectNamed = await entitySelect.count();
    const dragTitle = page.locator('.ed-scope button[title$="· drag to reorder · double-click to rename"]').first();
    inventory.templates.dragTitleCount = await page.locator('.ed-scope button[title$="· drag to reorder · double-click to rename"]').count();
    inventory.templates.dragTitleLabel = await dragTitle.getAttribute('aria-label');
    inventory.templates.dragTitleTitle = await dragTitle.getAttribute('title');
    inventory.templates.dragTitleType = await dragTitle.getAttribute('type');
    inventory.templates.dragTitleNamed = await page.getByRole('button', { name: 'Installation Phase · drag to reorder · double-click to rename', exact: true }).count();
    const countChrome = page.locator('.ed-scope [data-module-tab-id][aria-label="Installation Phase 2"]').first();
    inventory.templates.countChromeCount = await page.locator('.ed-scope [data-module-tab-id][aria-label="Installation Phase 2"]').count();
    inventory.templates.countChromeLabel = await countChrome.getAttribute('aria-label');
    inventory.templates.countChromeNamed = await page.getByRole('button', { name: 'Installation Phase 2', exact: true }).count();
    inventory.templates.siblingCountNamed = await page.getByRole('button', { name: 'Commissioning Phase 1', exact: true }).count();
    const expand = page.locator('.ed-scope button[aria-label="Expand"], .ed-scope button[title="Expand"]').first();
    inventory.templates.expandCount = await page.locator('.ed-scope button[aria-label="Expand"]').count();
    inventory.templates.expandTitle = await expand.getAttribute('title');
    inventory.templates.expandLabel = await expand.getAttribute('aria-label');
    inventory.templates.expandType = await expand.getAttribute('type');
    inventory.templates.expandNamed = await page.getByRole('button', { name: 'Expand', exact: true }).count();
    const templatesControls = await visibleControls(page);
    inventory.novel.templatesOpen = novelNames(templatesControls);

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
    const tapRename = page.locator('input[title="Tap to rename"]');
    inventory.projects.tapRename = await tapRename.count();
    inventory.projects.tapRenameLabel = inventory.projects.tapRename
      ? await tapRename.first().getAttribute('aria-label')
      : null;
    await page.getByRole('menuitem', { name: 'Get link to project', exact: true }).click();
    const shareDialog = page.getByRole('dialog', { name: 'Share project', exact: true });
    await expect(shareDialog).toBeVisible({ timeout: 10_000 });
    const permission = page.getByRole('combobox', { name: 'Permission', exact: true });
    await expect(permission).toBeVisible();
    inventory.share.namedPermission = await permission.count();
    inventory.share.label = await permission.getAttribute('aria-label');
    inventory.share.value = await permission.inputValue();
    inventory.share.linkRole = await page.getByRole('combobox', { name: 'Share link role', exact: true }).count();
    inventory.share.email = await page.getByRole('textbox', { name: 'Invite by email', exact: true }).count();
    inventory.share.unnamedDialogs = await unnamedDialogs(page);
    inventory.share.addFilesType = await page.getByRole('button', { name: 'Add files', exact: true }).first().getAttribute('type');
    inventory.share.newProjectType = await page.locator('.projects-desktop-create-button').getAttribute('type');
    inventory.share.searchLabel = await page.locator('.projects-desktop-search').getByRole('textbox', { name: 'Search projects...', exact: true }).getAttribute('aria-label');
    const rename = page.locator('.projects-desktop-layout input[aria-label="Click to rename"]');
    inventory.share.renameLabel = await rename.getAttribute('aria-label');
    inventory.share.renameTitle = await rename.getAttribute('title');
    inventory.share.renameValue = await rename.inputValue();
    inventory.share.sendViewer = await page.getByRole('button', { name: 'Send viewer invite', exact: true }).count();
    const dragHandle = page.locator('.projects-desktop-layout [data-drag-rearrange-handle]').first();
    inventory.share.dragLabel = await dragHandle.getAttribute('aria-label');
    inventory.share.dragTitle = await dragHandle.getAttribute('title');
    inventory.share.dragNamed = await page.getByRole('button', { name: 'Drag to rearrange', exact: true }).count();
    const shareControls = await visibleControls(page);
    inventory.novel.shareOpen = novelNames(shareControls);
    await page.keyboard.press('Escape');
    await expect(shareDialog).toHaveCount(0);
    inventory.share.afterEscape = await permission.count();

    const desktopSelect = page.locator('.projects-desktop-layout [data-testid="project-select-toggle"]');
    inventory.projects.desktopSelectCount = await desktopSelect.count();
    inventory.projects.desktopSelectType = inventory.projects.desktopSelectCount
      ? await desktopSelect.getAttribute('type')
      : null;
    inventory.projects.desktopSelectName = inventory.projects.desktopSelectCount
      ? await desktopSelect.innerText()
      : null;
    inventory.projects.desktopFileSelect = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('.projects-desktop-layout button')];
      const fileSelect = buttons.find((node) => {
        const name = (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim();
        return name === 'Select' && node.getAttribute('data-testid') !== 'project-select-toggle';
      });
      if (!fileSelect) return { count: 0, type: null, name: null };
      return {
        count: 1,
        type: fileSelect.getAttribute('type'),
        name: (fileSelect.getAttribute('aria-label') || fileSelect.innerText || '').replace(/\s+/g, ' ').trim(),
      };
    });
    const manageTeamBtn = page.locator('.projects-desktop-layout').getByRole('button', { name: 'Manage team', exact: true });
    inventory.projects.manageTeamType = await manageTeamBtn.getAttribute('type');
    inventory.projects.manageTeamNamedBtn = await manageTeamBtn.count();
    await manageTeamBtn.click();
    const team = page.getByRole('dialog', { name: 'Manage Team', exact: true });
    await expect(team).toBeVisible({ timeout: 10_000 });
    inventory.projects.manageTeamNamed = await team.count();
    inventory.projects.activityDialog = await page.getByRole('dialog', { name: /activity/i }).count();
    inventory.projects.roleTrigger = await page.locator('[data-kal31-role-trigger]').count();
    inventory.invite.editTypeBeforeInvite = await page.locator('[data-manage-team-edit]').getAttribute('type');
    await team.locator('[data-manage-team-invite]').click();
    const invite = page.getByRole('dialog', { name: 'Invite User', exact: true });
    await expect(invite).toBeVisible({ timeout: 10_000 });
    const linkRole = page.getByRole('combobox', { name: 'Share link role', exact: true });
    const emailRole = page.getByRole('combobox', { name: 'Invite by email role', exact: true });
    await expect(linkRole).toBeVisible();
    await expect(emailRole).toBeVisible();
    inventory.invite.namedDialog = await invite.count();
    inventory.invite.linkRole = await linkRole.count();
    inventory.invite.emailRole = await emailRole.count();
    inventory.invite.linkValue = await linkRole.inputValue();
    inventory.invite.emailValue = await emailRole.inputValue();
    inventory.invite.email = await page.getByRole('textbox', { name: 'Invite by email', exact: true }).count();
    inventory.invite.unnamedDialogs = await unnamedDialogs(page);
    inventory.invite.teammate = await page.getByRole('textbox', { name: /Find a teammate/ }).count();
    inventory.invite.editType = await page.locator('[data-manage-team-edit]').getAttribute('type');
    const inviteControls = await visibleControls(page);
    inventory.novel.inviteOpen = novelNames(inviteControls);
    await page.keyboard.press('Escape');
    await expect(invite).toHaveCount(0);

    await openPage(page, { width: 390, height: 844, url: HUB_PROJECTS });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const mobileTowerRow = page.locator('.projects-mobile-layout [data-project-id]').filter({ hasText: TOWER }).first();
    await expect(mobileTowerRow).toBeVisible({ timeout: 15_000 });
    const projects390Select = page.locator('.projects-mobile-select-row button.mobile-header-select-button').first();
    inventory.projects.select390Count = await projects390Select.count();
    inventory.projects.select390Type = inventory.projects.select390Count
      ? await projects390Select.getAttribute('type')
      : null;
    inventory.projects.select390Name = inventory.projects.select390Count
      ? await projects390Select.innerText()
      : null;
    inventory.projects.select390Visible = await projects390Select.isVisible().catch(() => false);
    const mobileProject = page.locator('.projects-mobile-layout [data-project-id], .projects-mobile-row, .projects-mobile-browser [data-project-id]')
      .filter({ hasText: TOWER }).first();
    inventory.projects.mobileTower = await mobileProject.count();
    if (await mobileProject.isVisible().catch(() => false)) {
      await mobileProject.click();
    }
    const mobileTap = page.locator('input[title="Tap to rename"]').filter({ visible: true });
    inventory.projects.tapRename390 = await mobileTap.count();
    inventory.projects.tapRename390Label = inventory.projects.tapRename390
      ? await mobileTap.first().getAttribute('aria-label')
      : null;
    const mobileTeam = page.getByRole('button', { name: 'Manage team', exact: true });
    inventory.projects.manageTeam390 = await mobileTeam.count();
    inventory.projects.manageTeam390Type = inventory.projects.manageTeam390
      ? await mobileTeam.first().getAttribute('type')
      : null;
    const fileSelect390 = page.locator('.projects-mobile-select-row button.mobile-header-select-button').first();
    inventory.projects.fileSelect390Count = await fileSelect390.count();
    inventory.projects.fileSelect390Type = inventory.projects.fileSelect390Count
      ? await fileSelect390.getAttribute('type')
      : null;
    inventory.projects.fileSelect390Name = inventory.projects.fileSelect390Count
      ? await fileSelect390.innerText()
      : null;
    inventory.invite.afterEscape = await linkRole.count();
    inventory.projects.activityAfterInvite = await page.getByRole('dialog', { name: /activity/i }).count();

    inventory.lease.processAutoLogin = Boolean(process.env.VITE_DEV_AUTO_LOGIN_EMAIL);
    inventory.lease.serviceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    inventory.lease.fileId = inventory.editor.fileId;
  } finally {
    console.log('AFTER_PROJECTS_DESKTOP_SELECT_BUTTON_TYPE_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
  }

  expect(inventory.editor.hidden['Match case']).toBe(0);
  expect(inventory.editor.hidden.Forms).toBe(0);
  expect(inventory.editor.hidden.Note).toBe(0);
  expect(inventory.editor.hidden.Group).toBe(0);
  expect(inventory.editor.viewBox).toBe('0 0 612 792');
  expect(inventory.editor.fileId).toBeNull();
  expect(inventory.editor.styleIdle).toBe(0);
  expect(inventory.editor.widthIdle).toBe(0);
  expect(inventory.editor.colorIdle).toBe(0);
  expect(inventory.editor.opacityIdle).toBe(0);
  expect(inventory.editor.permissionIdle).toBe(0);
  expect(inventory.editor.linkRoleIdle).toBe(0);
  expect(inventory.editor.emailRoleIdle).toBe(0);
  expect(inventory.editor.clearIdle).toBe(0);
  expect(inventory.editor.prevIdle).toBe(0);
  expect(inventory.editor.nextIdle).toBe(0);
  expect(inventory.editor.addBookmarkIdle).toBe(0);
  expect(inventory.editor.editIdle).toBe(0);
  expect(inventory.style.namedDialog).toBe(1);
  expect(inventory.style.unnamedDialogs).toEqual([]);
  expect(inventory.style.afterEscape).toBe(0);
  expect(inventory.width.namedDialog).toBe(1);
  expect(inventory.width.afterEscape).toBe(0);
  expect(inventory.color.namedDialog).toBe(1);
  expect(inventory.color.afterEscape).toBe(0);
  expect(inventory.color.fillType).toBe('button');
  expect(inventory.color.borderType).toBe('button');
  expect(inventory.opacity.namedSlider).toBe(1);
  expect(inventory.search.prevType).toBe('button');
  expect(inventory.search.nextType).toBe('button');
  expect(inventory.search.clearType).toBe('button');
  expect(inventory.search.afterEscape).toBe(0);
  expect(inventory.survey.namedMenu).toBe(1);
  expect(inventory.survey.nameless).toEqual([]);
  expect(inventory.editor.highlighterCaret).toBe(0);
  expect(inventory.editor.lockDialog).toBe(0);
  expect(inventory.overlay.shortcutsNamed).toBe(1);
  expect(inventory.overlay.unnamedDialogs).toEqual([]);
  expect(inventory.hub.draw).toBe(0);
  expect(inventory.hub.permissionIdle).toBe(0);
  expect(inventory.hub.linkRoleIdle).toBe(0);
  expect(inventory.hub.lockDialog).toBe(0);
  expect(inventory.hub.editIdle).toBe(0);
  expect(inventory.hub.ownerMenu).toBe(1);
  expect(inventory.hub.share).toBe(1);
  expect(inventory.hub.docNameless).toEqual([]);
  expect(inventory.archive.namedMenu).toBe(1);
  expect(inventory.archive.nameless).toEqual([]);
  expect(inventory.archive.closePreviewBeforeSelect).toBe(0);
  expect(inventory.archive.closePreviewCount).toBeGreaterThan(0);
  expect(inventory.archive.closePreviewType).toBe('button');
  expect(inventory.archive.closePreviewName).toBe('Close preview');
  expect(inventory.archive.closePreviewAfterEscape).toBeGreaterThan(0);
  expect(inventory.archive.implicitSubmit.some((row) => row.name === 'Close preview')).toBe(false);
  expect(inventory.archive.selectName).toBe('Select');
  expect(inventory.archive.selectType).toBe('button');
  expect(inventory.hub.documentsSelectName).toBe('Select');
  expect(inventory.hub.documentsSelectType).toBe('button');
  expect(inventory.templates.namedActions).toBe(1);
  expect(inventory.templates.openMenus).toEqual([]);
  expect(inventory.templates.renameLabel).toBe('Click to rename');
  expect(inventory.templates.renameTitle).toBe('Click to rename');
  expect(inventory.templates.renameValue).toBe(TEMPLATE);
  expect(inventory.templates.renameNamed).toBeGreaterThan(0);
  expect(inventory.templates.expandLabel).toBe('Expand');
  expect(inventory.templates.expandTitle).toBe('Expand');
  expect(inventory.templates.expandType).toBe('button');
  expect(inventory.templates.expandNamed).toBeGreaterThan(0);
  expect(inventory.templates.newTemplateType).toBe('button');
  expect(inventory.templates.entityNameLabel).toBe('Entity name');
  expect(inventory.templates.entityNamePlaceholder).toBe('Entity name');
  expect(inventory.templates.entityNameValue).toBe('GC');
  expect(inventory.templates.entityNameNamed).toBeGreaterThan(0);
  expect(inventory.templates.newCategoryType).toBe('button');
  expect(inventory.templates.newEntityType).toBe('button');
  expect(inventory.templates.editColorType).toBe('button');
  expect(inventory.templates.newModuleType).toBe('button');
  expect(inventory.templates.newModuleTitle).toBe('New module');
  expect(inventory.templates.newModuleLabel).toBe('New module');
  expect(inventory.templates.newModuleAccname).toBeGreaterThan(0);
  expect(inventory.templates.moduleSelectType).toBe('button');
  expect(inventory.templates.moduleSelectText).toBe('Select');
  expect(inventory.templates.moduleSelectNamed).toBeGreaterThan(0);
  expect(inventory.templates.categorySelectType).toBe('button');
  expect(inventory.templates.categorySelectText).toBe('Select');
  expect(inventory.templates.categorySelectNamed).toBeGreaterThan(0);
  expect(inventory.templates.templateListSelectType).toBe('button');
  expect(inventory.templates.templateListSelectText).toBe('Select');
  expect(inventory.templates.templateListSelectNamed).toBeGreaterThan(0);
  expect(inventory.templates.entitySelectType).toBe('button');
  expect(inventory.templates.entitySelectText).toBe('Select');
  expect(inventory.templates.entitySelectNamed).toBeGreaterThan(0);
  expect(inventory.templates.dragTitleCount).toBeGreaterThan(0);
  expect(inventory.templates.dragTitleLabel).toBe('Installation Phase · drag to reorder · double-click to rename');
  expect(inventory.templates.dragTitleTitle).toBe('Installation Phase · drag to reorder · double-click to rename');
  expect(inventory.templates.dragTitleType).toBe('button');
  expect(inventory.templates.dragTitleNamed).toBeGreaterThan(0);
  expect(inventory.templates.countChromeCount).toBeGreaterThan(0);
  expect(inventory.templates.countChromeLabel).toBe('Installation Phase 2');
  expect(inventory.templates.countChromeNamed).toBeGreaterThan(0);
  expect(inventory.templates.siblingCountNamed).toBeGreaterThan(0);
  expect(inventory.projects.namedActions).toBe(1);
  expect(inventory.share.namedPermission).toBe(1);
  expect(inventory.share.label).toBe('Permission');
  expect(inventory.share.value).toBe('Viewer');
  expect(inventory.share.linkRole).toBe(0);
  expect(inventory.share.email).toBe(1);
  expect(inventory.share.addFilesType).toBe('button');
  expect(inventory.share.newProjectType).toBe('button');
  expect(inventory.share.searchLabel).toBe('Search projects...');
  expect(inventory.share.renameLabel).toBe('Click to rename');
  expect(inventory.share.renameTitle).toBe('Click to rename');
  expect(inventory.share.renameValue).toBe(TOWER);
  expect(inventory.share.sendViewer).toBe(1);
  expect(inventory.share.dragLabel).toBe('Drag to rearrange');
  expect(inventory.share.dragTitle).toBe('Drag to rearrange');
  expect(inventory.share.dragNamed).toBeGreaterThan(0);
  expect(inventory.share.afterEscape).toBe(0);
  expect(inventory.projects.manageTeamNamed).toBe(1);
  expect(inventory.projects.manageTeamType).toBe('button');
  expect(inventory.projects.manageTeamNamedBtn).toBeGreaterThan(0);
  expect(inventory.projects.manageTeam390).toBeGreaterThan(0);
  expect(inventory.projects.manageTeam390Type).toBe('button');
  expect(inventory.pages.cardCount).toBeGreaterThan(0);
  expect(inventory.hub.uploadCount).toBeGreaterThan(0);
  expect(inventory.hub.uploadType).toBe('button');
  expect(inventory.hub.uploadName).toMatch(/Upload/);
  expect(inventory.hub.mobileUploadCount).toBeGreaterThan(0);
  expect(inventory.hub.mobileUploadType).toBe('button');
  expect(inventory.hub.closePreviewCount).toBeGreaterThan(0);
  expect(inventory.hub.closePreviewType).toBe('button');
  expect(inventory.hub.closePreviewName).toBe('Close preview');
  expect(inventory.hub.previewOpenFileCount).toBeGreaterThan(0);
  expect(inventory.hub.previewOpenFileType).toBe('button');
  expect(inventory.hub.previewShareCount).toBeGreaterThan(0);
  expect(inventory.hub.previewShareType).toBe('button');
  expect(inventory.hub.implicitSubmit.some((row) => row.name === 'Open file')).toBe(false);
  expect(inventory.hub.implicitSubmit.some((row) => row.name === 'Share' && String(row.className || '').includes('btn'))).toBe(false);
  expect(inventory.projects.activityDialog).toBe(0);
  expect(inventory.invite.namedDialog).toBe(1);
  expect(inventory.invite.linkRole).toBe(1);
  expect(inventory.invite.emailRole).toBe(1);
  expect(inventory.invite.linkValue).toBe('Viewer');
  expect(inventory.invite.emailValue).toBe('Editor');
  expect(inventory.invite.email).toBe(1);
  expect(inventory.invite.teammate).toBe(1);
  expect(inventory.invite.editTypeBeforeInvite).toBe('button');
  expect(inventory.invite.editType).toBe('button');
  expect(inventory.invite.afterEscape).toBe(0);
  expect(inventory.projects.activityAfterInvite).toBe(0);
  expect(inventory.projects.tapRename390).toBeGreaterThan(0);
  expect(inventory.projects.tapRename390Label).toBe('Tap to rename');
  expect(inventory.projects.select390Count).toBeGreaterThan(0);
  expect(inventory.projects.select390Name).toBe('Select');
  expect(inventory.projects.select390Type).toBe('button');
  expect(inventory.projects.select390Visible).toBe(true);
  expect(inventory.projects.desktopSelectCount).toBeGreaterThan(0);
  expect(inventory.projects.desktopSelectName).toBe('Select');
  expect(inventory.projects.desktopSelectType).toBe('button');
  expect(inventory.lease.fileId).toBeNull();
});
