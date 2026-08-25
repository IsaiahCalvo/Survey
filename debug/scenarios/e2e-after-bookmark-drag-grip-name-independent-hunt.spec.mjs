import { test, expect } from '@playwright/test';

// Independent hunt after Bookmarks drag grip name (aria-label
// "Drag to reorder"). Axis: compile-visible leftovers that are NOT
// leftover-18 and NOT Bookmarks drag grip name / Survey category-main / category-arrow type / Survey Close type / Bookmarks Delete type / Bookmarks Edit / Done type / Expand group / Collapse group / Add bookmark to group type /
// CreateCategoryModal type / CreateCategoryModal name / Confirm Cancel/Confirm type /
// Draw sub-toolbar type / Shapes sub-toolbar type / sub-toolbar Text / Callout type / Edit text type / Zoom / page-nav type / Export / Draw / Shapes / Text type / Pan / Select type /
// Undo / Redo type / Manage Team More type / Manage Team Invite type / AccessManagement Invite type / AccessManagement Close type / AccessManagement dialog name / CreateProjectModal Close name / Confirm Cancel/Confirm type / ConfirmModal name / Rename Cancel/Save type / Rename Close name / Projects More type / Projects file-row More type / Archive Show documents name / Account Settings Sign out type / Account Settings Edit profile type / Account Settings sidebar tabs type / Account Settings Close type / Projects desktop file Select type / Projects 390 file Select type / Projects desktop Select type / Projects 390 Select type / Documents Select type / Archive Select type / Archive Close preview type / Documents Preview Share type / Documents Preview Open file type / Documents Close preview type / Documents Upload type / Manage team type / Category drag titles type / Entity Select type / Template-list Select type / Category Select type / Module Select type / New module name / New module type / Module count chrome name / Category drag titles name / Edit color type / New entity type / New category type / Entity name name / Projects Tap to rename name / New template
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
// Do not click Add files / New project apply (opening New project
// is setup only; Close is now named — inventory next leftover).
// Do not click Create project / submit a new project.
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
// Do not click Projects 390 file Select apply (type leftover already taken).
// Do not click Projects desktop file Select apply (type leftover already taken).
// Do not click Settings Close apply (type leftover already taken).
// Do not click Settings sidebar tab apply (type leftover already taken).
// Do not click Settings Edit profile apply (type leftover already taken).
// Do not click Settings Sign out apply (type leftover already taken).
// Do not click Start trial / Connect Microsoft /
// Manage billing / Delete account apply.
// Do not click Archive Show / Hide documents apply beyond inventory.
// Do not click Restore / Delete forever.
// Do not replay Projects More / file-row More menu name or type.
// Do not replay Rename Close name.
// Do not click Rename Save apply. Hunt opens Rename only to inventory Cancel / Save type.
// Do not click Confirm / Delete category apply. Hunt opens Confirm
// only to inventory Cancel / Confirm type.
// Documents More → Share is setup only to inventory AccessManagement
// Invite / Done type (already taken). Manage team is setup only to
// inventory Manage Team Invite / Done type and member-row More type.
// Do not click Invite / Send / Done apply. Do not click Change role /
// Remove / Resend / View activity / Invite user / Copy email.
// Text category click is setup only to inventory sub-toolbar Text /
// Callout type (already taken) and Edit text type.
// Shapes category click is setup only to inventory Rectangle /
// Ellipse / Line / Arrow / Counter type (this leftover, already taken).
// Draw category click is setup only to inventory Pen / Highlighter /
// Eraser (or Partial erase) type (already taken).
// Survey-rail Create category plus is setup only to inventory
// CreateCategoryModal Cancel / Create category type (already taken).
// Do not click the dialog Create category confirm.
// Survey tab + Two Category / KAL-436 pick is setup only to inventory
// category-main / category-arrow type (already taken) plus Close
// Survey panel type (already taken). Do not click Close Survey
// panel apply in this hunt (dedicated leftover spec dismisses). Do
// not click category-main apply. Do not click Create category confirm. Bookmarks tab on Package 2 is
// setup only to inventory drag grip name (this leftover) plus Delete type (already taken) plus Edit /
// Done type and Expand / Collapse / Add-to-group type (already
// taken). Opening Edit is inventory only; dismiss with Done. Do not
// create a bookmark group. Do not apply Add bookmark. Do not apply
// a bookmark rename/save. Do not click Delete bookmark / Delete group.
// Do not drag-apply bookmark order.
// Do not click Edit text apply / Font color / Bold / Italic.
// Do not click Callout apply.
// Do not apply Pen / Highlighter / Eraser create.
// Do not apply Rectangle / Ellipse / Line / Arrow / Counter create.
// Do not invent a Counter series.

const LINK_PDF = '/?testPdf=clickable-link-test.pdf';
const OUTLINE_PDF = '/?testPdf=Package%202%20-%20Rev%204%20--%20IC.pdf';
const SURVEY_PDF = '/?testPdf=clickable-link-test.pdf&surveyTransitionE2E=1';
const HUB = '/?hubPreview=1';
const HUB_ARCHIVE = '/?hubPreview=1&tab=archive';
const HUB_TEMPLATES = '/?hubPreview=1&tab=templates';
const HUB_PROJECTS = '/?hubPreview=1&tab=projects';
const HUB_PROJECTS_WORKFLOW = '/?hubPreview=1&tab=projects&workflowE2E=1';
const OWNER = 'SE-011 Security Shop Drawings.pdf';
const TEMPLATE = 'Security Walk-Through';
const TOWER = 'Tower 5 — Security';
const KAL436 = /KAL-436 Preservation Template/;
const TWO_CAT_TEMPLATE = /Two Category Template/;
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
  'Expand Survey panel', 'Collapse Survey panel', 'Close Survey panel',
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
  'Expand group', 'Collapse group', 'Add bookmark to group',
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
  'Show documents',
  'Hide documents',
  'Show categories',
  'Hide categories',
  'Rename document',
  'Name',
  'Cancel',
  'Save',
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

test('independent hunt after Survey category-main / arrow type', async ({ page }) => {
  test.setTimeout(240_000);
  const inventory = {
    editor: {},
    overlay: {},
    createCategory: {},
    hub: {},
    archive: {},
    templates: {},
    projects: {},
    survey: {},
    confirm: {},
    createProject: {},
    access: {},
    style: {},
    width: {},
    color: {},
    opacity: {},
    search: {},
    share: {},
    invite: {},
    history: {},
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
    const undo = page.locator('[data-undo-redo-controls="true"]').getByRole('button', { name: 'Undo', exact: true });
    const redo = page.locator('[data-undo-redo-controls="true"]').getByRole('button', { name: 'Redo', exact: true });
    inventory.editor.undoCount = await undo.count();
    inventory.editor.undoType = inventory.editor.undoCount ? await undo.getAttribute('type') : null;
    inventory.editor.undoName = inventory.editor.undoCount ? await undo.getAttribute('aria-label') : null;
    inventory.editor.redoCount = await redo.count();
    inventory.editor.redoType = inventory.editor.redoCount ? await redo.getAttribute('type') : null;
    inventory.editor.redoName = inventory.editor.redoCount ? await redo.getAttribute('aria-label') : null;
    const exportBtn = page.getByRole('button', { name: 'Export annotated PDF', exact: true }).first();
    const draw = page.locator('[data-tool-toolbar="true"]').getByRole('button', { name: 'Draw', exact: true });
    const shapes = page.locator('[data-tool-toolbar="true"]').getByRole('button', { name: 'Shapes', exact: true });
    const text = page.locator('[data-tool-toolbar="true"]').getByRole('button', { name: 'Text', exact: true });
    const pan = page.locator('[data-tool-toolbar="true"]').getByRole('button', { name: 'Pan', exact: true });
    const select = page.locator('[data-tool-toolbar="true"]').getByRole('button', { name: 'Select', exact: true });
    inventory.editor.exportCount = await exportBtn.count();
    inventory.editor.exportType = inventory.editor.exportCount ? await exportBtn.getAttribute('type') : null;
    inventory.editor.exportName = inventory.editor.exportCount ? await exportBtn.getAttribute('aria-label') : null;
    inventory.editor.drawCount = await draw.count();
    inventory.editor.drawType = inventory.editor.drawCount ? await draw.getAttribute('type') : null;
    inventory.editor.drawName = inventory.editor.drawCount ? await draw.getAttribute('aria-label') : null;
    inventory.editor.shapesCount = await shapes.count();
    inventory.editor.shapesType = inventory.editor.shapesCount ? await shapes.getAttribute('type') : null;
    inventory.editor.shapesName = inventory.editor.shapesCount ? await shapes.getAttribute('aria-label') : null;
    inventory.editor.textCount = await text.count();
    inventory.editor.textType = inventory.editor.textCount ? await text.getAttribute('type') : null;
    inventory.editor.textName = inventory.editor.textCount ? await text.getAttribute('aria-label') : null;
    inventory.editor.panCount = await pan.count();
    inventory.editor.panType = inventory.editor.panCount ? await pan.getAttribute('type') : null;
    inventory.editor.panName = inventory.editor.panCount ? await pan.getAttribute('aria-label') : null;
    inventory.editor.selectCount = await select.count();
    inventory.editor.selectType = inventory.editor.selectCount ? await select.getAttribute('type') : null;
    inventory.editor.selectName = inventory.editor.selectCount ? await select.getAttribute('aria-label') : null;
    const zoomIn = page.locator('#chrome-right-host').getByRole('button', { name: 'Zoom in', exact: true });
    const zoomOut = page.locator('#chrome-right-host').getByRole('button', { name: 'Zoom out', exact: true });
    const prevPage = page.locator('#chrome-right-host').getByRole('button', { name: 'Previous page', exact: true });
    const nextPage = page.locator('#chrome-right-host').getByRole('button', { name: 'Next page', exact: true });
    inventory.editor.zoomInCount = await zoomIn.count();
    inventory.editor.zoomInType = inventory.editor.zoomInCount ? await zoomIn.getAttribute('type') : null;
    inventory.editor.zoomInName = inventory.editor.zoomInCount ? await zoomIn.getAttribute('aria-label') : null;
    inventory.editor.zoomOutCount = await zoomOut.count();
    inventory.editor.zoomOutType = inventory.editor.zoomOutCount ? await zoomOut.getAttribute('type') : null;
    inventory.editor.zoomOutName = inventory.editor.zoomOutCount ? await zoomOut.getAttribute('aria-label') : null;
    inventory.editor.prevPageCount = await prevPage.count();
    inventory.editor.prevPageType = inventory.editor.prevPageCount ? await prevPage.getAttribute('type') : null;
    inventory.editor.prevPageName = inventory.editor.prevPageCount ? await prevPage.getAttribute('aria-label') : null;
    inventory.editor.nextPageCount = await nextPage.count();
    inventory.editor.nextPageType = inventory.editor.nextPageCount ? await nextPage.getAttribute('type') : null;
    inventory.editor.nextPageName = inventory.editor.nextPageCount ? await nextPage.getAttribute('aria-label') : null;
    inventory.editor.editTextIdle = await page.getByRole('button', { name: 'Edit text', exact: true }).count();
    inventory.editor.fontColorIdle = await page.getByRole('button', { name: 'Font color', exact: true }).count();
    inventory.editor.boldIdle = await page.getByRole('button', { name: 'Bold', exact: true }).count();
    inventory.editor.italicIdle = await page.getByRole('button', { name: 'Italic', exact: true }).count();
    inventory.editor.implicitSubmit = await page.evaluate(() => (
      [...document.querySelectorAll('button')]
        .filter((btn) => !btn.getAttribute('type'))
        .map((btn) => ({
          name: (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim(),
          className: String(btn.className || ''),
        }))
        .filter((row) => row.name)
    ));
    await text.click();
    const editText = page.getByRole('button', { name: 'Edit text', exact: true });
    await expect(editText).toBeVisible({ timeout: 8_000 });
    inventory.editor.editTextCount = await editText.count();
    inventory.editor.editTextType = inventory.editor.editTextCount ? await editText.getAttribute('type') : null;
    inventory.editor.editTextName = inventory.editor.editTextCount ? await editText.getAttribute('aria-label') : null;
    inventory.editor.editTextDisabled = inventory.editor.editTextCount ? await editText.isDisabled() : null;
    inventory.editor.fontColorAfterText = await page.getByRole('button', { name: 'Font color', exact: true }).count();
    inventory.editor.boldAfterText = await page.getByRole('button', { name: 'Bold', exact: true }).count();
    inventory.editor.italicAfterText = await page.getByRole('button', { name: 'Italic', exact: true }).count();
    const subText = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Text', exact: true });
    const subCallout = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Callout', exact: true });
    inventory.editor.subTextCount = await subText.count();
    inventory.editor.subTextType = inventory.editor.subTextCount ? await subText.getAttribute('type') : null;
    inventory.editor.subTextName = inventory.editor.subTextCount ? await subText.getAttribute('aria-label') : null;
    inventory.editor.subCalloutCount = await subCallout.count();
    inventory.editor.subCalloutType = inventory.editor.subCalloutCount ? await subCallout.getAttribute('type') : null;
    inventory.editor.subCalloutName = inventory.editor.subCalloutCount ? await subCallout.getAttribute('aria-label') : null;
    inventory.editor.armedImplicitSubmit = await page.evaluate(() => (
      [...document.querySelectorAll('button')]
        .filter((btn) => !btn.getAttribute('type'))
        .map((btn) => ({
          name: (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim(),
          className: String(btn.className || ''),
        }))
        .filter((row) => row.name)
    ));
    inventory.editor.unnamed = editorControls.filter((row) => row.unnamed);
    inventory.novel.editor = novelNames(editorControls);

    await armRectangle(page);
    const subRect = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Rectangle', exact: true });
    const subEllipse = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Ellipse', exact: true });
    const subLine = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Line', exact: true });
    const subArrow = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Arrow', exact: true });
    const subCounter = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Counter', exact: true });
    inventory.editor.subRectCount = await subRect.count();
    inventory.editor.subRectType = inventory.editor.subRectCount ? await subRect.getAttribute('type') : null;
    inventory.editor.subEllipseType = (await subEllipse.count()) ? await subEllipse.getAttribute('type') : null;
    inventory.editor.subLineType = (await subLine.count()) ? await subLine.getAttribute('type') : null;
    inventory.editor.subArrowType = (await subArrow.count()) ? await subArrow.getAttribute('type') : null;
    inventory.editor.subCounterType = (await subCounter.count()) ? await subCounter.getAttribute('type') : null;
    inventory.editor.shapesArmedImplicitSubmit = await page.evaluate(() => (
      [...document.querySelectorAll('#chrome-sub-toolbar-host button')]
        .filter((btn) => !btn.getAttribute('type'))
        .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    ));
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

    await expect(draw).toBeVisible({ timeout: 8_000 });
    await draw.click();
    const subPen = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Pen', exact: true });
    const subHighlighter = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: 'Highlighter', exact: true });
    const subEraser = page.locator('#chrome-sub-toolbar-host').getByRole('button', { name: /^(Eraser|Partial erase|Full stroke erase)$/ });
    inventory.editor.subPenCount = await subPen.count();
    inventory.editor.subPenType = inventory.editor.subPenCount ? await subPen.getAttribute('type') : null;
    inventory.editor.subPenName = inventory.editor.subPenCount ? await subPen.getAttribute('aria-label') : null;
    inventory.editor.subHighlighterCount = await subHighlighter.count();
    inventory.editor.subHighlighterType = inventory.editor.subHighlighterCount ? await subHighlighter.getAttribute('type') : null;
    inventory.editor.subHighlighterName = inventory.editor.subHighlighterCount ? await subHighlighter.getAttribute('aria-label') : null;
    inventory.editor.subEraserCount = await subEraser.count();
    inventory.editor.subEraserType = inventory.editor.subEraserCount ? await subEraser.getAttribute('type') : null;
    inventory.editor.subEraserName = inventory.editor.subEraserCount ? await subEraser.getAttribute('aria-label') : null;
    inventory.editor.drawArmedImplicitSubmit = await page.evaluate(() => (
      [...document.querySelectorAll('#chrome-sub-toolbar-host button')]
        .filter((btn) => !btn.getAttribute('type'))
        .map((btn) => (btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.innerText || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
    ));

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
    await page.getByRole('button', { name: TWO_CAT_TEMPLATE }).click();
    const rightRail = page.locator('#chrome-right-host');
    const categorySelectToggle = rightRail.locator('.survey-marker-category-select-button');
    await expect(categorySelectToggle).toBeVisible({ timeout: 15_000 });
    await categorySelectToggle.click();
    const deleteCategoriesBtn = page.getByRole('button', { name: 'Delete selected categories' });
    await expect(deleteCategoriesBtn).toBeVisible({ timeout: 8_000 });
    await page.getByRole('button', { name: 'Select Walls', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Deselect Walls', exact: true })).toBeVisible({ timeout: 8_000 });
    await deleteCategoriesBtn.click();
    const confirmDialog = page.getByRole('dialog', { name: 'Delete 1 category?', exact: true });
    await expect(confirmDialog).toBeVisible({ timeout: 8_000 });
    const confirmCancel = confirmDialog.getByRole('button', { name: 'Cancel', exact: true });
    const confirmApply = confirmDialog.getByRole('button', { name: 'Delete category', exact: true });
    const confirmClose = confirmDialog.getByRole('button', { name: 'Close', exact: true });
    inventory.confirm.namedDialog = await confirmDialog.count();
    inventory.confirm.cancelCount = await confirmCancel.count();
    inventory.confirm.cancelType = inventory.confirm.cancelCount
      ? await confirmCancel.getAttribute('type')
      : null;
    inventory.confirm.cancelName = inventory.confirm.cancelCount
      ? await confirmCancel.innerText()
      : null;
    inventory.confirm.applyCount = await confirmApply.count();
    inventory.confirm.applyType = inventory.confirm.applyCount
      ? await confirmApply.getAttribute('type')
      : null;
    inventory.confirm.applyName = inventory.confirm.applyCount
      ? await confirmApply.innerText()
      : null;
    inventory.confirm.closeCount = await confirmClose.count();
    inventory.confirm.closeType = inventory.confirm.closeCount
      ? await confirmClose.getAttribute('type')
      : null;
    inventory.confirm.closeLabel = inventory.confirm.closeCount
      ? await confirmClose.getAttribute('aria-label')
      : null;
    inventory.confirm.implicitSubmit = await confirmDialog.evaluate((dialog) => (
      [...dialog.querySelectorAll('button')]
        .filter((node) => !node.getAttribute('type'))
        .map((node) => (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim())
    ));
    await confirmCancel.click();
    await expect(confirmDialog).toHaveCount(0, { timeout: 8_000 });
    inventory.confirm.afterCancel = await confirmDialog.count();
    inventory.confirm.wallsKept = await rightRail.locator('.survey-marker-category-main-label', { hasText: /^Walls$/ }).count();

    const createPlus = rightRail.locator('.survey-marker-category-create-button');
    await expect(createPlus).toBeVisible({ timeout: 8_000 });
    await createPlus.click();
    const createDialog = page.getByRole('dialog', { name: 'Create category', exact: true });
    await expect(createDialog).toBeVisible({ timeout: 8_000 });
    const createCancel = createDialog.getByRole('button', { name: 'Cancel', exact: true });
    const createApply = createDialog.getByRole('button', { name: 'Create category', exact: true });
    inventory.createCategory.namedDialog = await createDialog.count();
    inventory.createCategory.cancelCount = await createCancel.count();
    inventory.createCategory.cancelType = inventory.createCategory.cancelCount
      ? await createCancel.getAttribute('type')
      : null;
    inventory.createCategory.cancelName = inventory.createCategory.cancelCount
      ? await createCancel.innerText()
      : null;
    inventory.createCategory.applyCount = await createApply.count();
    inventory.createCategory.applyType = inventory.createCategory.applyCount
      ? await createApply.getAttribute('type')
      : null;
    inventory.createCategory.applyName = inventory.createCategory.applyCount
      ? await createApply.innerText()
      : null;
    inventory.createCategory.applyDisabled = inventory.createCategory.applyCount
      ? await createApply.isDisabled()
      : null;
    inventory.createCategory.implicitSubmit = await createDialog.evaluate((dialog) => (
      [...dialog.querySelectorAll('button')]
        .filter((node) => !node.getAttribute('type'))
        .map((node) => (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim())
    ));
    await createCancel.click();
    await expect(createDialog).toHaveCount(0, { timeout: 8_000 });
    inventory.createCategory.afterCancel = await createDialog.count();
    inventory.createCategory.wallsKept = await rightRail.locator('.survey-marker-category-main-label', { hasText: /^Walls$/ }).count();

    await openPage(page, { url: OUTLINE_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    const bookmarksTab = page.getByRole('button', { name: 'Bookmarks', exact: true }).first();
    await expect(bookmarksTab).toBeVisible({ timeout: 15_000 });
    if ((await bookmarksTab.getAttribute('aria-pressed')) !== 'true') {
      await bookmarksTab.click();
    }
    const expandGroup = page.getByRole('button', { name: 'Expand group', exact: true });
    const collapseGroup = page.getByRole('button', { name: 'Collapse group', exact: true });
    const addToGroup = page.getByRole('button', { name: 'Add bookmark to group', exact: true });
    const dragGrips = page.locator('[aria-label="Drag to reorder"]');
    await expect(addToGroup.first()).toBeVisible({ timeout: 20_000 });
    inventory.bookmarks.dragGripCount = await dragGrips.count();
    inventory.bookmarks.dragGripLabel = inventory.bookmarks.dragGripCount
      ? await dragGrips.first().getAttribute('aria-label')
      : null;
    inventory.bookmarks.dragGripAccname = inventory.bookmarks.dragGripCount
      ? await dragGrips.first().evaluate((node) => (
        (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim()
      ))
      : null;
    inventory.bookmarks.dragGripInForm = inventory.bookmarks.dragGripCount
      ? await dragGrips.first().evaluate((node) => Boolean(node.closest('form')))
      : null;
    inventory.bookmarks.dragGripRole = inventory.bookmarks.dragGripCount
      ? await dragGrips.first().getAttribute('role')
      : null;
    inventory.bookmarks.expandCount = await expandGroup.count();
    inventory.bookmarks.collapseCount = await collapseGroup.count();
    inventory.bookmarks.addToGroupCount = await addToGroup.count();
    inventory.bookmarks.expandType = inventory.bookmarks.expandCount
      ? await expandGroup.first().getAttribute('type')
      : null;
    inventory.bookmarks.collapseType = inventory.bookmarks.collapseCount
      ? await collapseGroup.first().getAttribute('type')
      : null;
    inventory.bookmarks.addToGroupType = inventory.bookmarks.addToGroupCount
      ? await addToGroup.first().getAttribute('type')
      : null;
    inventory.bookmarks.addToGroupName = inventory.bookmarks.addToGroupCount
      ? await addToGroup.first().getAttribute('aria-label')
      : null;
    inventory.bookmarks.createGroupDialog = await page.getByRole('dialog', { name: 'Create bookmark group', exact: true }).count();
    inventory.bookmarks.addBookmarksDialog = await page.getByRole('dialog', { name: 'Add bookmarks to group', exact: true }).count();
    inventory.bookmarks.addBookmarkDialog = await page.getByRole('dialog', { name: 'Add bookmark', exact: true }).count();
    inventory.bookmarks.implicitSubmit = await page.evaluate(() => (
      [...document.querySelectorAll('button')]
        .filter((node) => !node.getAttribute('type'))
        .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim())
        .filter((name) => name === 'Expand group' || name === 'Collapse group' || name === 'Add bookmark to group' || name === 'Edit' || name === 'Done' || name === 'Drag to reorder' || /^Delete (group|bookmark) /.test(name))
    ));
    const liveChevron = page.locator('button[aria-label="Expand group"]:not([disabled]), button[aria-label="Collapse group"]:not([disabled])').first();
    await expect(liveChevron).toBeVisible({ timeout: 8_000 });
    await liveChevron.click();
    inventory.bookmarks.afterExpandType = await liveChevron.getAttribute('type');
    const edit = page.getByRole('button', { name: 'Edit', exact: true });
    inventory.bookmarks.editType = await edit.getAttribute('type');
    inventory.bookmarks.editName = await edit.evaluate((node) => (
      (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim()
    ));
    await edit.click();
    const done = page.getByRole('button', { name: 'Done', exact: true });
    inventory.bookmarks.doneType = await done.getAttribute('type');
    inventory.bookmarks.doneName = await done.evaluate((node) => (
      (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim()
    ));
    const deleteBtn = page.getByRole('button', { name: /^Delete (group|bookmark) / }).first();
    inventory.bookmarks.deleteCount = await page.getByRole('button', { name: /^Delete (group|bookmark) / }).count();
    inventory.bookmarks.deleteType = inventory.bookmarks.deleteCount
      ? await deleteBtn.getAttribute('type')
      : null;
    inventory.bookmarks.deleteName = inventory.bookmarks.deleteCount
      ? await deleteBtn.getAttribute('aria-label')
      : null;
    await done.click();
    inventory.bookmarks.editAfterDone = await page.getByRole('button', { name: 'Edit', exact: true }).count();
    inventory.bookmarks.deleteAfterDone = await page.getByRole('button', { name: /^Delete (group|bookmark) / }).count();

    await openPage(page, { url: SURVEY_PDF });
    await expect(page.getByRole('button', { name: 'Draw', exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Choose survey template' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: KAL436 }).click();
    const closeSurvey = page.getByRole('button', { name: 'Close Survey panel', exact: true });
    await expect(closeSurvey.first()).toBeVisible({ timeout: 15_000 });
    inventory.survey.closeCount = await closeSurvey.count();
    inventory.survey.closeType = inventory.survey.closeCount
      ? await closeSurvey.first().getAttribute('type')
      : null;
    inventory.survey.closeName = inventory.survey.closeCount
      ? await closeSurvey.first().getAttribute('aria-label')
      : null;
    inventory.survey.closeInForm = inventory.survey.closeCount
      ? await closeSurvey.first().evaluate((node) => Boolean(node.closest('form')))
      : null;
    inventory.survey.collapseType = await page.getByRole('button', { name: 'Collapse Survey panel', exact: true }).first().getAttribute('type');
    inventory.survey.implicitSubmit = await page.evaluate(() => (
      [...document.querySelectorAll('button')]
        .filter((node) => !node.getAttribute('type'))
        .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim())
        .filter((name) => name === 'Close Survey panel' || name === 'Collapse Survey panel' || name === 'Expand Survey panel')
    ));
    const categoryMains = page.locator('#chrome-right-host button.survey-marker-category-main');
    inventory.survey.categoryMainCount = await categoryMains.count();
    inventory.survey.categoryMainType = inventory.survey.categoryMainCount
      ? await categoryMains.first().getAttribute('type')
      : null;
    inventory.survey.categoryMainName = inventory.survey.categoryMainCount
      ? await categoryMains.first().evaluate((node) => (
        (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim()
      ))
      : null;
    inventory.survey.categoryMainInForm = inventory.survey.categoryMainCount
      ? await categoryMains.first().evaluate((node) => Boolean(node.closest('form')))
      : null;
    const categoryArrows = page.locator('#chrome-right-host button.survey-marker-category-arrow');
    inventory.survey.categoryArrowCount = await categoryArrows.count();
    inventory.survey.categoryArrowType = inventory.survey.categoryArrowCount
      ? await categoryArrows.first().getAttribute('type')
      : null;
    inventory.survey.categoryImplicitSubmit = await page.evaluate(() => (
      [...document.querySelectorAll('button.survey-marker-category-main, button.survey-marker-category-arrow')]
        .filter((node) => !node.getAttribute('type'))
        .map((node) => (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim())
    ));
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
    await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
    const renameDialog = page.getByRole('dialog', { name: 'Rename document', exact: true });
    await expect(renameDialog).toBeVisible({ timeout: 8_000 });
    const renameClose = renameDialog.getByRole('button', { name: 'Close', exact: true });
    inventory.hub.renameDialog = await renameDialog.count();
    inventory.hub.renameCloseCount = await renameClose.count();
    inventory.hub.renameCloseType = inventory.hub.renameCloseCount
      ? await renameClose.getAttribute('type')
      : null;
    inventory.hub.renameCloseLabel = inventory.hub.renameCloseCount
      ? await renameClose.getAttribute('aria-label')
      : null;
    inventory.hub.renameCloseTitle = inventory.hub.renameCloseCount
      ? await renameClose.getAttribute('title')
      : null;
    inventory.hub.renameNameValue = await page.getByRole('textbox', { name: 'Name', exact: true }).inputValue();
    const renameCancel = renameDialog.getByRole('button', { name: 'Cancel', exact: true });
    const renameSave = renameDialog.getByRole('button', { name: 'Save', exact: true });
    inventory.hub.renameCancelCount = await renameCancel.count();
    inventory.hub.renameCancelType = inventory.hub.renameCancelCount
      ? await renameCancel.getAttribute('type')
      : null;
    inventory.hub.renameCancelName = inventory.hub.renameCancelCount
      ? await renameCancel.innerText()
      : null;
    inventory.hub.renameSaveCount = await renameSave.count();
    inventory.hub.renameSaveType = inventory.hub.renameSaveCount
      ? await renameSave.getAttribute('type')
      : null;
    inventory.hub.renameSaveName = inventory.hub.renameSaveCount
      ? await renameSave.innerText()
      : null;
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
    await expect(renameDialog).toHaveCount(0, { timeout: 8_000 });
    inventory.hub.renameCloseAfterEscape = await renameClose.count();

    await ownerMore.click();
    await expect(page.getByRole('menu')).toBeVisible();
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
    const accessDialog = page.getByRole('dialog', { name: 'Document Access', exact: true });
    await expect(accessDialog).toBeVisible({ timeout: 8_000 });
    const accessClose = accessDialog.getByRole('button', { name: 'Close', exact: true });
    inventory.access.namedDialog = await accessDialog.count();
    inventory.access.closeCount = await accessClose.count();
    inventory.access.closeType = inventory.access.closeCount
      ? await accessClose.getAttribute('type')
      : null;
    inventory.access.closeLabel = inventory.access.closeCount
      ? await accessClose.getAttribute('aria-label')
      : null;
    inventory.access.closeTitle = inventory.access.closeCount
      ? await accessClose.getAttribute('title')
      : null;
    inventory.access.closeAccname = inventory.access.closeCount
      ? await accessClose.evaluate((node) => {
        const labelled = node.getAttribute('aria-label')
          || node.getAttribute('title')
          || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        return labelled || '';
      })
      : null;
    inventory.access.inviteCount = await accessDialog.getByRole('button', { name: 'Invite', exact: true }).count();
    inventory.access.inviteType = inventory.access.inviteCount
      ? await accessDialog.getByRole('button', { name: 'Invite', exact: true }).getAttribute('type')
      : null;
    inventory.access.doneCount = await accessDialog.getByRole('button', { name: 'Done', exact: true }).count();
    inventory.access.doneType = inventory.access.doneCount
      ? await accessDialog.getByRole('button', { name: 'Done', exact: true }).getAttribute('type')
      : null;
    inventory.access.sendCount = await page.getByRole('button', { name: /Send .*invite/i }).count();
    inventory.access.implicitSubmit = await accessDialog.evaluate((dialog) => (
      [...dialog.querySelectorAll('button')]
        .filter((node) => !node.getAttribute('type'))
        .map((node) => ({
          name: (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim(),
          type: node.getAttribute('type'),
        }))
    ));
    await accessClose.click();
    await expect(accessDialog).toHaveCount(0, { timeout: 8_000 });
    inventory.access.afterClose = await accessDialog.count();
    inventory.access.sendAfterClose = await page.getByRole('button', { name: /Send .*invite/i }).count();

    const accountChip = page.getByRole('button', { name: 'Open account menu' }).first();
    await expect(accountChip).toBeVisible({ timeout: 8_000 });
    await accountChip.click();
    await page.getByRole('menu', { name: 'Account menu' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
    const settingsDialog = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(settingsDialog).toBeVisible({ timeout: 10_000 });
    const settingsClose = settingsDialog.getByRole('button', { name: 'Close', exact: true });
    inventory.hub.settingsNamed = await settingsDialog.count();
    inventory.hub.settingsCloseCount = await settingsClose.count();
    inventory.hub.settingsCloseType = inventory.hub.settingsCloseCount
      ? await settingsClose.getAttribute('type')
      : null;
    inventory.hub.settingsCloseName = inventory.hub.settingsCloseCount
      ? await settingsClose.getAttribute('aria-label')
      : null;
    inventory.hub.settingsGeneral = await settingsDialog.locator('.account-sidebar-btn.active').innerText();
    inventory.hub.settingsGeneralType = await settingsDialog.locator('.account-sidebar-btn').filter({ hasText: 'General' }).getAttribute('type');
    inventory.hub.settingsConnectedType = await settingsDialog.locator('.account-sidebar-btn').filter({ hasText: 'Connected services' }).getAttribute('type');
    inventory.hub.settingsSubscriptionType = await settingsDialog.locator('.account-sidebar-btn').filter({ hasText: 'Subscription' }).getAttribute('type');
    inventory.hub.settingsSidebarCount = await settingsDialog.locator('.account-sidebar-btn').count();
    inventory.hub.settingsEditProfile = await settingsDialog.getByRole('button', { name: 'Edit profile', exact: true }).count();
    inventory.hub.settingsEditProfileType = inventory.hub.settingsEditProfile
      ? await settingsDialog.getByRole('button', { name: 'Edit profile', exact: true }).getAttribute('type')
      : null;
    inventory.hub.settingsEditProfileName = inventory.hub.settingsEditProfile
      ? await settingsDialog.getByRole('button', { name: 'Edit profile', exact: true }).innerText()
      : null;
    inventory.hub.settingsSignOut = await settingsDialog.getByRole('button', { name: 'Sign out', exact: true }).count();
    inventory.hub.settingsSignOutType = inventory.hub.settingsSignOut
      ? await settingsDialog.getByRole('button', { name: 'Sign out', exact: true }).getAttribute('type')
      : null;
    inventory.hub.settingsSignOutName = inventory.hub.settingsSignOut
      ? await settingsDialog.getByRole('button', { name: 'Sign out', exact: true }).innerText()
      : null;
    inventory.hub.settingsStartTrial = await page.getByRole('button', { name: /Start trial|Manage billing|Checkout/i }).count();
    inventory.hub.settingsImplicitSubmit = await settingsDialog.evaluate((dialog) => (
      [...dialog.querySelectorAll('button')]
        .filter((node) => {
          if (node.getAttribute('type')) return false;
          const style = window.getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const box = node.getBoundingClientRect();
          if (box.width <= 0 || box.height <= 0) return false;
          return true;
        })
        .map((node) => ({
          name: (node.getAttribute('aria-label') || node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60),
          className: String(node.className || '').slice(0, 80),
        }))
    ));
    const settingsOpenControls = await visibleControls(page);
    inventory.novel.settingsOpen = novelNames(settingsOpenControls);
    await page.keyboard.press('Escape');
    await expect(settingsDialog).toHaveCount(0, { timeout: 8_000 });
    inventory.hub.settingsCloseAfterEscape = await settingsClose.count();

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
    const atriumShow = page.locator('.archive-desktop-card [data-archive-item-id]').filter({ hasText: 'Atrium' })
      .getByRole('button', { name: 'Show documents', exact: true });
    inventory.archive.showDocumentsCount = await atriumShow.count();
    inventory.archive.showDocumentsType = inventory.archive.showDocumentsCount
      ? await atriumShow.first().getAttribute('type')
      : null;
    inventory.archive.showDocumentsLabel = inventory.archive.showDocumentsCount
      ? await atriumShow.first().getAttribute('aria-label')
      : null;
    inventory.archive.showDocumentsTitle = inventory.archive.showDocumentsCount
      ? await atriumShow.first().getAttribute('title')
      : null;
    inventory.archive.showDocumentsNamed = await page.getByRole('button', { name: 'Show documents', exact: true }).count();
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
    inventory.projects.moreCount = await projectMore.count();
    inventory.projects.moreType = inventory.projects.moreCount
      ? await projectMore.getAttribute('type')
      : null;
    inventory.projects.moreTitle = inventory.projects.moreCount
      ? await projectMore.getAttribute('title')
      : null;
    inventory.projects.moreName = inventory.projects.moreCount
      ? await projectMore.getAttribute('aria-label') || await projectMore.getAttribute('title')
      : null;
    const fileRowMore = page.locator('.projects-desktop-layout [data-document-id]')
      .filter({ hasText: OWNER })
      .getByRole('button', { name: 'More', exact: true });
    inventory.projects.fileRowMoreCount = await fileRowMore.count();
    inventory.projects.fileRowMoreType = inventory.projects.fileRowMoreCount
      ? await fileRowMore.getAttribute('type')
      : null;
    inventory.projects.fileRowMoreTitle = inventory.projects.fileRowMoreCount
      ? await fileRowMore.getAttribute('title')
      : null;
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
    const teamInvite = team.getByRole('button', { name: 'Invite', exact: true });
    const teamDone = team.getByRole('button', { name: 'Done', exact: true });
    inventory.projects.teamInviteCount = await teamInvite.count();
    inventory.projects.teamInviteType = inventory.projects.teamInviteCount
      ? await teamInvite.getAttribute('type')
      : null;
    inventory.projects.teamInviteName = inventory.projects.teamInviteCount
      ? await teamInvite.evaluate((node) => {
        const labelled = node.getAttribute('aria-label')
          || node.getAttribute('title')
          || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        return labelled || '';
      })
      : null;
    inventory.projects.teamDoneCount = await teamDone.count();
    inventory.projects.teamDoneType = inventory.projects.teamDoneCount
      ? await teamDone.getAttribute('type')
      : null;
    inventory.projects.teamDoneName = inventory.projects.teamDoneCount
      ? await teamDone.evaluate((node) => {
        const labelled = node.getAttribute('aria-label')
          || node.getAttribute('title')
          || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        return labelled || '';
      })
      : null;
    inventory.projects.teamImplicitSubmit = await team.evaluate((dialog) => (
      [...dialog.querySelectorAll('button')]
        .filter((node) => !node.getAttribute('type'))
        .map((node) => ({
          name: (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim(),
          type: node.getAttribute('type'),
        }))
    ));
    const teamMore = team.getByRole('button', { name: 'More', exact: true });
    inventory.projects.teamMoreCount = await teamMore.count();
    inventory.projects.teamMoreType = inventory.projects.teamMoreCount
      ? await teamMore.first().getAttribute('type')
      : null;
    inventory.projects.teamMoreTitle = inventory.projects.teamMoreCount
      ? await teamMore.first().getAttribute('title')
      : null;
    inventory.projects.teamMoreName = inventory.projects.teamMoreCount
      ? await teamMore.first().evaluate((node) => {
        const labelled = node.getAttribute('aria-label')
          || node.getAttribute('title')
          || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        return labelled || '';
      })
      : null;
    inventory.projects.teamMoreSecondType = inventory.projects.teamMoreCount > 1
      ? await teamMore.nth(1).getAttribute('type')
      : null;
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
    const inviteClose = invite.getByRole('button', { name: 'Close', exact: true });
    inventory.invite.closeCount = await inviteClose.count();
    inventory.invite.closeType = inventory.invite.closeCount
      ? await inviteClose.getAttribute('type')
      : null;
    inventory.invite.closeLabel = inventory.invite.closeCount
      ? await inviteClose.getAttribute('aria-label')
      : null;
    const inviteControls = await visibleControls(page);
    inventory.novel.inviteOpen = novelNames(inviteControls);
    await page.keyboard.press('Escape');
    await expect(invite).toHaveCount(0);

    await openPage(page, { url: HUB_PROJECTS_WORKFLOW });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'New project', exact: true }).first().click();
    const createProjectDialog = page.getByRole('dialog', { name: 'Create project', exact: true });
    await expect(createProjectDialog).toBeVisible({ timeout: 8_000 });
    inventory.createProject.namedDialog = await createProjectDialog.count();
    const createClose = createProjectDialog.locator('button[title="Close"]');
    inventory.createProject.closeCount = await createClose.count();
    inventory.createProject.closeType = inventory.createProject.closeCount
      ? await createClose.first().getAttribute('type')
      : null;
    inventory.createProject.closeTitle = inventory.createProject.closeCount
      ? await createClose.first().getAttribute('title')
      : null;
    inventory.createProject.closeLabel = inventory.createProject.closeCount
      ? await createClose.first().getAttribute('aria-label')
      : null;
    inventory.createProject.closeAccname = inventory.createProject.closeCount
      ? await createClose.first().evaluate((node) => {
        const labelled = node.getAttribute('aria-label')
          || node.getAttribute('title')
          || (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim();
        return labelled || '';
      })
      : null;
    inventory.createProject.closeNamed = await createProjectDialog.getByRole('button', { name: 'Close', exact: true }).count();
    inventory.createProject.createCount = await createProjectDialog.getByRole('button', { name: 'Create project', exact: true }).count();
    inventory.createProject.cancelCount = await createProjectDialog.getByRole('button', { name: 'Cancel', exact: true }).count();
    inventory.createProject.implicitSubmit = await createProjectDialog.locator('button:not([type]), button[type=""], button[type="submit"]').evaluateAll((nodes) => (
      nodes.map((node) => ({
        name: (node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || '').replace(/\s+/g, ' ').trim(),
        type: node.getAttribute('type'),
      }))
    ));
    await createProjectDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(createProjectDialog).toHaveCount(0, { timeout: 8_000 });
    inventory.createProject.afterClose = await createProjectDialog.count();
    inventory.createProject.afterCancel = inventory.createProject.afterClose;

    await openPage(page, { width: 390, height: 844, url: HUB_PROJECTS });
    await expect(page.locator('.survey-hub')).toBeVisible({ timeout: 30_000 });
    const mobileTowerRow = page.locator('.projects-mobile-layout [data-project-id]').filter({ hasText: TOWER }).first();
    await expect(mobileTowerRow).toBeVisible({ timeout: 15_000 });
    const mobileMore = mobileTowerRow.getByRole('button', { name: 'More', exact: true });
    inventory.projects.more390Count = await mobileMore.count();
    inventory.projects.more390Type = inventory.projects.more390Count
      ? await mobileMore.getAttribute('type')
      : null;
    inventory.projects.more390Title = inventory.projects.more390Count
      ? await mobileMore.getAttribute('title')
      : null;
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
    if (await mobileTeam.first().isVisible().catch(() => false)) {
      await mobileTeam.first().click();
      const mobileTeamDialog = page.getByRole('dialog', { name: 'Manage Team', exact: true });
      await expect(mobileTeamDialog).toBeVisible({ timeout: 10_000 });
      const mobileInvite = mobileTeamDialog.getByRole('button', { name: 'Invite', exact: true });
      const mobileDone = mobileTeamDialog.getByRole('button', { name: 'Done', exact: true });
      inventory.projects.teamInvite390Count = await mobileInvite.count();
      inventory.projects.teamInvite390Type = inventory.projects.teamInvite390Count
        ? await mobileInvite.getAttribute('type')
        : null;
      inventory.projects.teamDone390Count = await mobileDone.count();
      inventory.projects.teamDone390Type = inventory.projects.teamDone390Count
        ? await mobileDone.getAttribute('type')
        : null;
      const mobileTeamMore = mobileTeamDialog.getByRole('button', { name: 'More', exact: true });
      inventory.projects.teamMore390Count = await mobileTeamMore.count();
      inventory.projects.teamMore390Type = inventory.projects.teamMore390Count
        ? await mobileTeamMore.first().getAttribute('type')
        : null;
      inventory.projects.teamMore390Name = inventory.projects.teamMore390Count
        ? await mobileTeamMore.first().getAttribute('aria-label')
        : null;
      await page.keyboard.press('Escape');
      await expect(mobileTeamDialog).toHaveCount(0, { timeout: 8_000 });
      inventory.projects.teamAfterEscape390 = await mobileTeamDialog.count();
    }
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
    console.log('AFTER_BOOKMARK_DRAG_GRIP_NAME_INDEPENDENT_HUNT', JSON.stringify(inventory, null, 2));
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
  expect(inventory.editor.undoCount).toBeGreaterThan(0);
  expect(inventory.editor.undoType).toBe('button');
  expect(inventory.editor.undoName).toBe('Undo');
  expect(inventory.editor.redoCount).toBeGreaterThan(0);
  expect(inventory.editor.redoType).toBe('button');
  expect(inventory.editor.redoName).toBe('Redo');
  expect(inventory.editor.exportCount).toBeGreaterThan(0);
  expect(inventory.editor.exportType).toBe('button');
  expect(inventory.editor.exportName).toBe('Export annotated PDF');
  expect(inventory.editor.drawCount).toBeGreaterThan(0);
  expect(inventory.editor.drawType).toBe('button');
  expect(inventory.editor.drawName).toBe('Draw');
  expect(inventory.editor.shapesCount).toBeGreaterThan(0);
  expect(inventory.editor.shapesType).toBe('button');
  expect(inventory.editor.shapesName).toBe('Shapes');
  expect(inventory.editor.textCount).toBeGreaterThan(0);
  expect(inventory.editor.textType).toBe('button');
  expect(inventory.editor.textName).toBe('Text');
  expect(inventory.editor.panCount).toBeGreaterThan(0);
  expect(inventory.editor.panType).toBe('button');
  expect(inventory.editor.panName).toBe('Pan');
  expect(inventory.editor.selectCount).toBeGreaterThan(0);
  expect(inventory.editor.selectType).toBe('button');
  expect(inventory.editor.selectName).toBe('Select');
  expect(inventory.editor.zoomInCount).toBeGreaterThan(0);
  expect(inventory.editor.zoomInType).toBe('button');
  expect(inventory.editor.zoomInName).toBe('Zoom in');
  expect(inventory.editor.zoomOutCount).toBeGreaterThan(0);
  expect(inventory.editor.zoomOutType).toBe('button');
  expect(inventory.editor.zoomOutName).toBe('Zoom out');
  expect(inventory.editor.prevPageCount).toBeGreaterThan(0);
  expect(inventory.editor.prevPageType).toBe('button');
  expect(inventory.editor.prevPageName).toBe('Previous page');
  expect(inventory.editor.nextPageCount).toBeGreaterThan(0);
  expect(inventory.editor.nextPageType).toBe('button');
  expect(inventory.editor.nextPageName).toBe('Next page');
  expect(inventory.editor.implicitSubmit.some((row) => row.name === 'Export annotated PDF')).toBe(false);
  expect(inventory.editor.implicitSubmit.some((row) => row.name === 'Draw')).toBe(false);
  expect(inventory.editor.implicitSubmit.some((row) => row.name === 'Shapes')).toBe(false);
  expect(inventory.editor.implicitSubmit.some((row) => row.name === 'Text')).toBe(false);
  expect(inventory.editor.implicitSubmit.some((row) => row.name === 'Pan')).toBe(false);
  expect(inventory.editor.implicitSubmit.some((row) => row.name === 'Select')).toBe(false);
  expect(inventory.editor.implicitSubmit.some((row) => row.name === 'Zoom in')).toBe(false);
  expect(inventory.editor.implicitSubmit.some((row) => row.name === 'Zoom out')).toBe(false);
  expect(inventory.editor.implicitSubmit.some((row) => row.name === 'Previous page')).toBe(false);
  expect(inventory.editor.implicitSubmit.some((row) => row.name === 'Next page')).toBe(false);
  expect(inventory.editor.editTextIdle).toBe(0);
  expect(inventory.editor.fontColorIdle).toBe(0);
  expect(inventory.editor.boldIdle).toBe(0);
  expect(inventory.editor.italicIdle).toBe(0);
  expect(inventory.editor.editTextCount).toBeGreaterThan(0);
  expect(inventory.editor.editTextType).toBe('button');
  expect(inventory.editor.editTextName).toBe('Edit text');
  expect(inventory.editor.editTextDisabled).toBe(true);
  expect(inventory.editor.fontColorAfterText).toBe(0);
  expect(inventory.editor.boldAfterText).toBe(0);
  expect(inventory.editor.italicAfterText).toBe(0);
  expect(inventory.editor.armedImplicitSubmit.some((row) => row.name === 'Edit text')).toBe(false);
  expect(inventory.editor.armedImplicitSubmit.some((row) => row.name === 'Text')).toBe(false);
  expect(inventory.editor.armedImplicitSubmit.some((row) => row.name === 'Callout')).toBe(false);
  expect(inventory.editor.subTextCount).toBeGreaterThan(0);
  expect(inventory.editor.subTextType).toBe('button');
  expect(inventory.editor.subTextName).toBe('Text');
  expect(inventory.editor.subCalloutCount).toBeGreaterThan(0);
  expect(inventory.editor.subCalloutType).toBe('button');
  expect(inventory.editor.subCalloutName).toBe('Callout');
  expect(inventory.editor.subRectCount).toBeGreaterThan(0);
  expect(inventory.editor.subRectType).toBe('button');
  expect(inventory.editor.subEllipseType).toBe('button');
  expect(inventory.editor.subLineType).toBe('button');
  expect(inventory.editor.subArrowType).toBe('button');
  expect(inventory.editor.subCounterType).toBe('button');
  expect(inventory.editor.shapesArmedImplicitSubmit.some((name) => name === 'Rectangle')).toBe(false);
  expect(inventory.editor.shapesArmedImplicitSubmit.some((name) => name === 'Ellipse')).toBe(false);
  expect(inventory.editor.shapesArmedImplicitSubmit.some((name) => name === 'Line')).toBe(false);
  expect(inventory.editor.shapesArmedImplicitSubmit.some((name) => name === 'Arrow')).toBe(false);
  expect(inventory.editor.shapesArmedImplicitSubmit.some((name) => name === 'Counter')).toBe(false);
  expect(inventory.editor.subPenCount).toBeGreaterThan(0);
  expect(inventory.editor.subPenType).toBe('button');
  expect(inventory.editor.subPenName).toBe('Pen');
  expect(inventory.editor.subHighlighterCount).toBeGreaterThan(0);
  expect(inventory.editor.subHighlighterType).toBe('button');
  expect(inventory.editor.subHighlighterName).toBe('Highlighter');
  expect(inventory.editor.subEraserCount).toBeGreaterThan(0);
  expect(inventory.editor.subEraserType).toBe('button');
  expect(['Partial erase', 'Full stroke erase', 'Eraser']).toContain(inventory.editor.subEraserName);
  expect(inventory.editor.drawArmedImplicitSubmit.some((name) => name === 'Pen')).toBe(false);
  expect(inventory.editor.drawArmedImplicitSubmit.some((name) => name === 'Highlighter')).toBe(false);
  expect(inventory.editor.drawArmedImplicitSubmit.some((name) => name === 'Partial erase')).toBe(false);
  expect(inventory.editor.drawArmedImplicitSubmit.some((name) => name === 'Eraser')).toBe(false);
  expect(inventory.editor.drawArmedImplicitSubmit.some((name) => name === 'Full stroke erase')).toBe(false);
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
  expect(inventory.survey.closeCount).toBeGreaterThan(0);
  expect(inventory.survey.closeType).toBe('button');
  expect(inventory.survey.closeName).toBe('Close Survey panel');
  expect(inventory.survey.closeInForm).toBe(false);
  expect(inventory.survey.collapseType).toBe('button');
  expect(inventory.survey.implicitSubmit).toEqual([]);
  expect(inventory.survey.namedMenu).toBe(1);
  expect(inventory.survey.nameless).toEqual([]);
  expect(inventory.survey.categoryMainCount).toBeGreaterThan(0);
  expect(inventory.survey.categoryMainType).toBe('button');
  expect(inventory.survey.categoryMainName).toMatch(/Walls/);
  expect(inventory.survey.categoryMainInForm).toBe(false);
  expect(inventory.survey.categoryImplicitSubmit).toEqual([]);
  if (inventory.survey.categoryArrowCount > 0) {
    expect(inventory.survey.categoryArrowType).toBe('button');
  }
  expect(inventory.confirm.namedDialog).toBe(1);
  expect(inventory.confirm.cancelCount).toBe(1);
  expect(inventory.confirm.cancelType).toBe('button');
  expect(inventory.confirm.cancelName).toBe('Cancel');
  expect(inventory.confirm.applyCount).toBe(1);
  expect(inventory.confirm.applyType).toBe('button');
  expect(inventory.confirm.applyName).toBe('Delete category');
  expect(inventory.confirm.closeCount).toBe(1);
  expect(inventory.confirm.closeType).toBe('button');
  expect(inventory.confirm.closeLabel).toBe('Close');
  expect(inventory.confirm.implicitSubmit).toEqual([]);
  expect(inventory.confirm.afterCancel).toBe(0);
  expect(inventory.confirm.wallsKept).toBeGreaterThan(0);
  expect(inventory.createCategory.namedDialog).toBe(1);
  expect(inventory.createCategory.cancelCount).toBe(1);
  expect(inventory.createCategory.cancelType).toBe('button');
  expect(inventory.createCategory.cancelName).toBe('Cancel');
  expect(inventory.createCategory.applyCount).toBe(1);
  expect(inventory.createCategory.applyType).toBe('button');
  expect(inventory.createCategory.applyName).toBe('Create category');
  expect(inventory.createCategory.applyDisabled).toBe(true);
  expect(inventory.createCategory.implicitSubmit).toEqual([]);
  expect(inventory.createCategory.afterCancel).toBe(0);
  expect(inventory.createCategory.wallsKept).toBeGreaterThan(0);
  expect(inventory.bookmarks.dragGripCount).toBeGreaterThan(1);
  expect(inventory.bookmarks.dragGripLabel).toBe('Drag to reorder');
  expect(inventory.bookmarks.dragGripAccname).toBe('Drag to reorder');
  expect(inventory.bookmarks.dragGripInForm).toBe(false);
  expect(inventory.bookmarks.expandCount + inventory.bookmarks.collapseCount).toBeGreaterThan(0);
  expect(inventory.bookmarks.addToGroupCount).toBeGreaterThan(0);
  if (inventory.bookmarks.expandCount) {
    expect(inventory.bookmarks.expandType).toBe('button');
  }
  if (inventory.bookmarks.collapseCount) {
    expect(inventory.bookmarks.collapseType).toBe('button');
  }
  expect(inventory.bookmarks.addToGroupType).toBe('button');
  expect(inventory.bookmarks.addToGroupName).toBe('Add bookmark to group');
  expect(inventory.bookmarks.createGroupDialog).toBe(0);
  expect(inventory.bookmarks.addBookmarksDialog).toBe(0);
  expect(inventory.bookmarks.addBookmarkDialog).toBe(0);
  expect(inventory.bookmarks.implicitSubmit).toEqual([]);
  expect(inventory.bookmarks.afterExpandType).toBe('button');
  expect(inventory.bookmarks.editType).toBe('button');
  expect(inventory.bookmarks.editName).toBe('Edit');
  expect(inventory.bookmarks.doneType).toBe('button');
  expect(inventory.bookmarks.doneName).toBe('Done');
  expect(inventory.bookmarks.deleteCount).toBeGreaterThan(0);
  expect(inventory.bookmarks.deleteType).toBe('button');
  expect(inventory.bookmarks.deleteName).toMatch(/^Delete (group|bookmark) /);
  expect(inventory.bookmarks.editAfterDone).toBeGreaterThan(0);
  expect(inventory.bookmarks.deleteAfterDone).toBe(0);
  expect(inventory.createProject.namedDialog).toBe(1);
  expect(inventory.createProject.closeCount).toBeGreaterThan(0);
  expect(inventory.createProject.closeType).toBe('button');
  expect(inventory.createProject.closeTitle).toBe('Close');
  expect(inventory.createProject.closeLabel).toBe('Close');
  expect(inventory.createProject.closeAccname).toBe('Close');
  expect(inventory.createProject.closeNamed).toBe(1);
  expect(inventory.createProject.createCount).toBe(1);
  expect(inventory.createProject.cancelCount).toBe(1);
  expect(inventory.createProject.implicitSubmit).toEqual([]);
  expect(inventory.createProject.afterClose).toBe(0);
  expect(inventory.createProject.afterCancel).toBe(0);
  expect(inventory.access.namedDialog).toBe(1);
  expect(inventory.access.closeCount).toBeGreaterThan(0);
  expect(inventory.access.closeType).toBe('button');
  expect(inventory.access.closeLabel).toBe('Close');
  expect(inventory.access.closeTitle).toBe('Close');
  expect(inventory.access.closeAccname).toBe('Close');
  expect(inventory.access.inviteCount).toBe(1);
  expect(inventory.access.inviteType).toBe('button');
  expect(inventory.access.doneCount).toBe(1);
  expect(inventory.access.doneType).toBe('button');
  expect(inventory.access.sendCount).toBe(0);
  expect(inventory.access.implicitSubmit.some((row) => row.name === 'Close')).toBe(false);
  expect(inventory.access.implicitSubmit.some((row) => row.name === 'Invite')).toBe(false);
  expect(inventory.access.implicitSubmit.some((row) => row.name === 'Done')).toBe(false);
  expect(inventory.access.afterClose).toBe(0);
  expect(inventory.access.sendAfterClose).toBe(0);
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
  expect(inventory.archive.showDocumentsCount).toBeGreaterThan(0);
  expect(inventory.archive.showDocumentsType).toBe('button');
  expect(inventory.archive.showDocumentsLabel).toBe('Show documents');
  expect(inventory.archive.showDocumentsTitle).toBe('Show documents');
  expect(inventory.archive.showDocumentsNamed).toBeGreaterThan(0);
  expect(inventory.hub.documentsSelectName).toBe('Select');
  expect(inventory.hub.documentsSelectType).toBe('button');
  expect(inventory.hub.renameDialog).toBe(1);
  expect(inventory.hub.renameCloseCount).toBeGreaterThan(0);
  expect(inventory.hub.renameCloseType).toBe('button');
  expect(inventory.hub.renameCloseLabel).toBe('Close');
  expect(inventory.hub.renameCloseTitle).toBe('Close');
  expect(inventory.hub.renameNameValue).toBe(OWNER);
  expect(inventory.hub.renameCancelCount).toBe(1);
  expect(inventory.hub.renameCancelType).toBe('button');
  expect(inventory.hub.renameCancelName).toBe('Cancel');
  expect(inventory.hub.renameSaveCount).toBe(1);
  expect(inventory.hub.renameSaveType).toBe('button');
  expect(inventory.hub.renameSaveName).toBe('Save');
  expect(inventory.hub.renameCloseAfterEscape).toBe(0);
  expect(inventory.hub.implicitSubmit.some((row) => row.name === 'Close')).toBe(false);
  expect(inventory.hub.implicitSubmit.some((row) => row.name === 'Cancel')).toBe(false);
  expect(inventory.hub.implicitSubmit.some((row) => row.name === 'Save')).toBe(false);
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
  expect(inventory.projects.moreCount).toBeGreaterThan(0);
  expect(inventory.projects.moreType).toBe('button');
  expect(inventory.projects.moreTitle).toBe('More');
  expect(inventory.projects.moreName).toBe('More');
  expect(inventory.projects.fileRowMoreCount).toBeGreaterThan(0);
  expect(inventory.projects.fileRowMoreType).toBe('button');
  expect(inventory.projects.fileRowMoreTitle).toBe('More');
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
  expect(inventory.projects.teamInviteCount).toBe(1);
  expect(inventory.projects.teamInviteType).toBe('button');
  expect(inventory.projects.teamInviteName).toBe('Invite');
  expect(inventory.projects.teamDoneCount).toBe(1);
  expect(inventory.projects.teamDoneType).toBe('button');
  expect(inventory.projects.teamDoneName).toBe('Done');
  expect(inventory.projects.teamImplicitSubmit.some((row) => row.name === 'Invite')).toBe(false);
  expect(inventory.projects.teamImplicitSubmit.some((row) => row.name === 'Done')).toBe(false);
  expect(inventory.projects.teamImplicitSubmit.some((row) => row.name === 'More')).toBe(false);
  expect(inventory.projects.teamMoreCount).toBeGreaterThan(0);
  expect(inventory.projects.teamMoreType).toBe('button');
  expect(inventory.projects.teamMoreTitle).toBe('More');
  expect(inventory.projects.teamMoreName).toBe('More');
  if (inventory.projects.teamMoreCount > 1) {
    expect(inventory.projects.teamMoreSecondType).toBe('button');
  }
  expect(inventory.projects.teamInvite390Count).toBe(1);
  expect(inventory.projects.teamInvite390Type).toBe('button');
  expect(inventory.projects.teamDone390Count).toBe(1);
  expect(inventory.projects.teamDone390Type).toBe('button');
  expect(inventory.projects.teamMore390Count).toBeGreaterThan(0);
  expect(inventory.projects.teamMore390Type).toBe('button');
  expect(inventory.projects.teamMore390Name).toBe('More');
  expect(inventory.projects.teamAfterEscape390).toBe(0);
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
  expect(inventory.hub.settingsNamed).toBe(1);
  expect(inventory.hub.settingsCloseCount).toBeGreaterThan(0);
  expect(inventory.hub.settingsCloseType).toBe('button');
  expect(inventory.hub.settingsCloseName).toBe('Close');
  expect(inventory.hub.settingsGeneral).toBe('General');
  expect(inventory.hub.settingsGeneralType).toBe('button');
  expect(inventory.hub.settingsConnectedType).toBe('button');
  expect(inventory.hub.settingsSubscriptionType).toBe('button');
  expect(inventory.hub.settingsSidebarCount).toBe(3);
  expect(inventory.hub.settingsImplicitSubmit.some((row) => row.name === 'General')).toBe(false);
  expect(inventory.hub.settingsImplicitSubmit.some((row) => row.name === 'Connected services')).toBe(false);
  expect(inventory.hub.settingsImplicitSubmit.some((row) => row.name === 'Subscription')).toBe(false);
  expect(inventory.hub.settingsEditProfile).toBeGreaterThan(0);
  expect(inventory.hub.settingsEditProfileName).toBe('Edit profile');
  expect(inventory.hub.settingsEditProfileType).toBe('button');
  expect(inventory.hub.settingsImplicitSubmit.some((row) => row.name === 'Edit profile')).toBe(false);
  expect(inventory.hub.settingsSignOut).toBeGreaterThan(0);
  expect(inventory.hub.settingsSignOutName).toBe('Sign out');
  expect(inventory.hub.settingsSignOutType).toBe('button');
  expect(inventory.hub.settingsImplicitSubmit.some((row) => row.name === 'Sign out')).toBe(false);
  expect(inventory.hub.settingsStartTrial).toBe(0);
  expect(inventory.hub.settingsCloseAfterEscape).toBe(0);
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
  expect(inventory.projects.more390Count).toBeGreaterThan(0);
  expect(inventory.projects.more390Type).toBe('button');
  expect(inventory.projects.more390Title).toBe('More');
  expect(inventory.projects.desktopSelectCount).toBeGreaterThan(0);
  expect(inventory.projects.desktopSelectName).toBe('Select');
  expect(inventory.projects.desktopSelectType).toBe('button');
  expect(inventory.projects.fileSelect390Count).toBeGreaterThan(0);
  expect(inventory.projects.fileSelect390Name).toBe('Select');
  expect(inventory.projects.fileSelect390Type).toBe('button');
  expect(inventory.projects.desktopFileSelect.count).toBeGreaterThan(0);
  expect(inventory.projects.desktopFileSelect.name).toBe('Select');
  expect(inventory.projects.desktopFileSelect.type).toBe('button');
  expect(inventory.lease.fileId).toBeNull();
});
