import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official leftover files besides isolated 8448 match live source after Documents Sort menu name', () => {
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
  ];
  for (const rel of official) {
    const src = read(rel);
    assert.match(src, /role="dialog"|KeyboardShortcutsOverlay|AccessManagementModal|templates-module-edit-title|role="menuitem"|Document actions|Show and sort|Template actions|Project actions/);
  }

  assert.match(read('src/PDFSidebar.jsx'), /openPanel\(tab\.id\)/);
  assert.match(read('src/AppShell.jsx'), /document\.addEventListener\('pointerdown', onDown, true\)/);
  assert.doesNotMatch(read('src/DevTestRoute.jsx'), /cloudSync: true/);
  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('hunt after Documents Sort menu name looks past Projects More name and leftover-18', () => {
  const spec = read('debug/scenarios/e2e-after-documents-mobile-sort-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /AFTER_DOCUMENTS_MOBILE_SORT_INDEPENDENT_HUNT/);
  assert.match(spec, /name: 'Sort', exact: true/);
  assert.match(spec, /\$\{TOWER\} actions/);
  assert.match(spec, /documents-mobile-sort-menu/);
  assert.match(spec, /ed-tpl-menu/);
  assert.match(spec, /data-counter-caret-popup/);
  assert.match(spec, /templates-module-edit/);
  assert.match(spec, /Lock this document/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pin project'[^\n]*\.click\(/);
});
