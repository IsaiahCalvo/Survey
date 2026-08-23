import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official leftover files besides isolated 8448 match live source after Invite User role name', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /role="dialog"/);
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);

  const access = read('src/home/AccessManagementModal.jsx');
  assert.match(access, /aria-labelledby="access-management-modal-title"/);

  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('className="templates-module-edit-modal"');
  const slice = editor.slice(start, start + 1100);
  assert.match(slice, /aria-labelledby="templates-module-edit-title"/);

  const bookmarks = read('src/sidebar/BookmarksPanel.jsx');
  const groupStart = bookmarks.indexOf('{/* Bookmark Group Creation Modal */}');
  const groupEnd = bookmarks.indexOf('{/* Add Bookmarks to Existing Group Modal */}');
  assert.match(bookmarks.slice(groupStart, groupEnd), /aria-labelledby="create-bookmark-group-title"/);
  assert.match(bookmarks, /useFocusTrap\(createGroupDialogRef, showBookmarkGroupModal, \{ onEscape: closeCreateGroupModal \}\)/);
  assert.match(bookmarks, /aria-labelledby="add-bookmarks-to-group-title"/);
  assert.match(bookmarks, /useFocusTrap\(addToGroupDialogRef, showAddToGroupModal, \{ onEscape: closeAddToGroupModal \}\)/);
  assert.match(bookmarks, /aria-haspopup="dialog"/);
  assert.match(bookmarks, /aria-label="Add bookmark"/);

  const search = read('src/sidebar/SearchTextPanel.jsx');
  const clearStart = search.indexOf('{internalSearchQuery && (');
  const clearSlice = search.slice(clearStart, search.indexOf('{/* Navigation Controls'));
  assert.match(clearSlice, /type="button"/);
  assert.match(clearSlice, /aria-label="Clear search"/);

  const picker = read('src/components/CompactColorPicker.jsx');
  assert.match(picker, /role="dialog"/);
  assert.match(picker, /aria-label="Color"/);
  assert.match(picker, /aria-label="Opacity"/);

  const size = read('src/components/AnnotationSizeControl.jsx');
  assert.match(size, /role="dialog"/);
  assert.match(size, /aria-label=\{label\}/);
  assert.match(size, /aria-haspopup="dialog"/);

  const dropdown = read('src/components/AnnotationDropdown.jsx');
  assert.match(dropdown, /role="dialog"/);
  assert.match(dropdown, /aria-label=\{label\}/);
  assert.match(dropdown, /aria-haspopup="dialog"/);

  const share = read('src/home/ShareModal.jsx');
  assert.match(share, /aria-label="Permission"/);
  assert.match(share, /aria-label="Invite by email"/);

  const team = read('src/home/ManageTeamModal.jsx');
  const inviteStart = team.indexOf('/* ============ Invite User sub-modal (REAL) ============');
  const inviteEnd = team.indexOf('/* ============ Manage Team modal ============ */');
  assert.match(team.slice(inviteStart, inviteEnd), /aria-label="Share link role"/);
  assert.match(team.slice(inviteStart, inviteEnd), /aria-label="Invite by email role"/);

  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /className="survey-marker-export-compact-menu" role="menu" aria-label="Excel actions"/);
  assert.match(rail, /className="mobile-survey-sheet-export-menu" role="menu" aria-label="Export survey data"/);

  const spaces = read('src/sidebar/SpacesPanel.jsx');
  const exportStart = spaces.indexOf('className={`spaces-header-export-button');
  const exportEnd = spaces.indexOf('{/* Spaces List */}');
  assert.match(spaces.slice(exportStart, exportEnd), /aria-label=\{`Export \$\{spacesExportTarget\.name \|\| 'space'\}`\}/);
  assert.match(spaces.slice(exportStart, exportEnd), /role="menuitem"/);

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
    'tests/surveyExportMenuitem.test.mjs',
    'tests/createBookmarkGroupDialogName.test.mjs',
    'tests/addBookmarksToGroupDialogName.test.mjs',
    'tests/addBookmarkDialogName.test.mjs',
    'tests/searchClearButtonName.test.mjs',
    'tests/colorPickerDialogName.test.mjs',
    'tests/widthPickerDialogName.test.mjs',
    'tests/stylePickerDialogName.test.mjs',
    'tests/opacitySliderName.test.mjs',
    'tests/sharePermissionName.test.mjs',
  ];
  for (const rel of official) {
    const src = read(rel);
    assert.match(src, /role="dialog"|KeyboardShortcutsOverlay|AccessManagementModal|templates-module-edit-title|role="menuitem"|Document actions|Show and sort|Template actions|Project actions|Sort|Export Space 1|Excel actions|create-bookmark-group-title|add-bookmarks-to-group-title|Add bookmark|Clear search|aria-label="Color"|aria-label=\{label\}|aria-label="Opacity"|aria-label="Permission"/);
  }

  assert.match(read('src/PDFSidebar.jsx'), /openPanel\(tab\.id\)/);
  assert.match(read('src/AppShell.jsx'), /document\.addEventListener\('pointerdown', onDown, true\)/);
  assert.doesNotMatch(read('src/DevTestRoute.jsx'), /cloudSync: true/);
  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('hunt after Invite User role name looks past Share Permission and leftover-18', () => {
  const spec = read('debug/scenarios/e2e-after-invite-user-role-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /surveyTransitionE2E=1/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /AFTER_INVITE_USER_ROLE_INDEPENDENT_HUNT/);
  assert.match(spec, /name: 'Style'/);
  assert.match(spec, /name: 'Shapes'/);
  assert.match(spec, /#chrome-sub-toolbar-host/);
  assert.match(spec, /Width presets/);
  assert.match(spec, /name: 'Color'/);
  assert.match(spec, /name: 'Opacity'/);
  assert.match(spec, /name: 'Permission'/);
  assert.match(spec, /Share link role/);
  assert.match(spec, /Invite by email role/);
  assert.match(spec, /Invite User/);
  assert.match(spec, /Invite by email/);
  assert.match(spec, /Get link to project/);
  assert.match(spec, /Clear search/);
  assert.match(spec, /Add bookmark/);
  assert.match(spec, /Version history/);
  assert.match(spec, /Excel actions/);
  assert.match(spec, /Export survey data/);
  assert.match(spec, /\$\{OWNER\} actions/);
  assert.match(spec, /\$\{TOWER\} actions/);
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
  assert.doesNotMatch(spec, /name: 'Create group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add bookmarks'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create bookmark'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Solid'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Width presets'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Copy link'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
});
