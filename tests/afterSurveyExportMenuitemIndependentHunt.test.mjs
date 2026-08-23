import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official leftover files besides isolated 8448 match live source after Survey export name', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /role="dialog"/);
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);

  const access = read('src/home/AccessManagementModal.jsx');
  assert.match(access, /aria-labelledby="access-management-modal-title"/);

  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('className="templates-module-edit-modal"');
  const slice = editor.slice(start, start + 1100);
  assert.match(slice, /aria-labelledby="templates-module-edit-title"/);
  const moreStart = editor.indexOf('function MoreMenu');
  const moreEnd = editor.indexOf('function CustomSelect');
  assert.match(editor.slice(moreStart, moreEnd), /aria-label=\{ariaLabel\}/);
  assert.match(editor, /ariaLabel=\{`\$\{t\.name \|\| 'Template'\} actions`\}/);

  const team = read('src/home/ManageTeamModal.jsx');
  const memberStart = team.indexOf('{!editMode && openMenu === m.id && (');
  const memberEnd = team.indexOf('{/* Pending invites');
  assert.match(team.slice(memberStart, memberEnd), /role="menu"/);
  assert.match(team.slice(memberStart, memberEnd), /role="menuitem"/);

  const app = read('src/AppShell.jsx');
  const selectStart = app.indexOf('data-select-mode-menu="true"');
  const selectEnd = app.indexOf('{/* Draw category */}');
  assert.match(app.slice(selectStart, selectEnd), /role="menu"/);
  assert.match(app.slice(selectStart, selectEnd), /role="menuitem"/);

  const viewer = read('src/PDFViewer.jsx');
  const eraserStart = viewer.indexOf('data-eraser-caret-popup={isEraser ? \'true\' : undefined}');
  const eraserEnd = viewer.indexOf('{activeCategoryDropdown === \'shape\' && (');
  assert.match(viewer.slice(eraserStart, eraserEnd), /role="menu"/);
  assert.match(viewer.slice(eraserStart, eraserEnd), /role="menuitem"/);

  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /aria-label=\{ariaLabel\}/);
  assert.match(ledger, /ariaLabel=\{`\$\{doc\.name \|\| 'Document'\} actions`\}/);
  const sortStart = ledger.indexOf('className="documents-mobile-sort-control"');
  const sortEnd = ledger.indexOf('const uploadButtonBody');
  assert.match(ledger.slice(sortStart, sortEnd), /aria-label="Sort"/);

  const archive = read('src/home/ArchiveScreen.jsx');
  const menuStart = archive.indexOf('const filterMenu = (');
  const menuEnd = archive.indexOf('const filterButton = (');
  assert.match(archive.slice(menuStart, menuEnd), /aria-label="Show and sort"/);

  const projects = read('src/home/ProjectsFolderTree.jsx');
  const popupStart = projects.indexOf('function PopupMenu');
  const popupEnd = projects.indexOf('export default function ProjectsFolderTree');
  assert.match(projects.slice(popupStart, popupEnd), /aria-label=\{ariaLabel\}/);
  assert.match(projects, /ariaLabel=\{`\$\{proj\.name \|\| 'Project'\} actions`\}/);
  assert.match(projects, /ariaLabel=\{`\$\{f\.name \|\| 'Document'\} actions`\}/);

  const spaces = read('src/sidebar/SpacesPanel.jsx');
  const exportStart = spaces.indexOf('className={`spaces-header-export-button');
  const exportEnd = spaces.indexOf('{/* Spaces List */}');
  assert.match(spaces.slice(exportStart, exportEnd), /aria-label=\{`Export \$\{spacesExportTarget\.name \|\| 'space'\}`\}/);
  assert.match(spaces.slice(exportStart, exportEnd), /role="menuitem"/);

  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /className="survey-marker-export-compact-menu" role="menu" aria-label="Excel actions"/);
  assert.match(rail, /className="mobile-survey-sheet-export-menu" role="menu" aria-label="Export survey data"/);

  const settings = read('src/components/AccountSettings.jsx');
  assert.match(settings, /aria-labelledby="account-settings-title"/);

  const confirm = read('src/home/BulkModals.jsx');
  const confirmStart = confirm.indexOf('export function ConfirmModal');
  const confirmEnd = confirm.indexOf('export function RenameModal');
  assert.match(confirm.slice(confirmStart, confirmEnd), /aria-labelledby="confirm-modal-title"/);

  const create = read('src/components/CreateCategoryModal.jsx');
  assert.match(create, /aria-labelledby="create-category-modal-title"/);

  const hook = read('src/hooks/useAnnotationContextMenu.jsx');
  assert.match(hook, /e\.key === 'Enter' \|\| e\.key === ' '/);
  assert.match(hook, /role="menuitem"/);

  const official = [
    'tests/keyboardShortcutMatrix.test.mjs',
    'tests/mobileChromeHitTargets.test.mjs',
    'tests/shortcutsOverlay.test.mjs',
    'tests/keyboardShortcutsOverlayDialogName.test.mjs',
    'tests/accessManagementDialogName.test.mjs',
    'tests/templatesModuleEditDialogName.test.mjs',
    'tests/manageTeamMenuitem.test.mjs',
    'tests/selectModeMenuitem.test.mjs',
    'tests/eraserTypeMenuitem.test.mjs',
    'tests/documentsMoreMenuName.test.mjs',
    'tests/archiveSortMenuName.test.mjs',
    'tests/templatesMoreMenuName.test.mjs',
    'tests/projectsMoreMenuName.test.mjs',
    'tests/documentsMobileSortMenuName.test.mjs',
    'tests/projectsFileRowMoreMenuName.test.mjs',
    'tests/spacesExportMenuitem.test.mjs',
  ];
  for (const rel of official) {
    const src = read(rel);
    assert.match(src, /role="dialog"|KeyboardShortcutsOverlay|AccessManagementModal|templates-module-edit-title|role="menuitem"|Document actions|Show and sort|Template actions|Project actions|Sort|Export Space 1/);
  }

  assert.match(read('src/PDFSidebar.jsx'), /openPanel\(tab\.id\)/);
  assert.match(read('src/AppShell.jsx'), /document\.addEventListener\('pointerdown', onDown, true\)/);
  assert.doesNotMatch(read('src/DevTestRoute.jsx'), /cloudSync: true/);
  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('hunt after Survey export name looks past Spaces export and leftover-18', () => {
  const spec = read('debug/scenarios/e2e-after-survey-export-menuitem-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /surveyTransitionE2E=1/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /AFTER_SURVEY_EXPORT_MENUITEM_INDEPENDENT_HUNT/);
  assert.match(spec, /Excel actions/);
  assert.match(spec, /Export survey data/);
  assert.match(spec, /survey-marker-export-compact-menu/);
  assert.match(spec, /mobile-survey-sheet-export-menu/);
  assert.match(spec, /Export Space 1/);
  assert.match(spec, /\$\{OWNER\} actions/);
  assert.match(spec, /\$\{TOWER\} actions/);
  assert.match(spec, /documents-mobile-sort-menu/);
  assert.match(spec, /ed-tpl-menu/);
  assert.match(spec, /data-counter-caret-popup/);
  assert.match(spec, /Lock this document/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pin project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Lock document'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'CSV'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'PDF Pages'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open linked'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Update existing'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Export Excel'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
});
