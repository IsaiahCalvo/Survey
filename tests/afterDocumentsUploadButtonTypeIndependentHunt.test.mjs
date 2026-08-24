import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official leftover files besides isolated 8448 match live source after Documents Upload type', () => {
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
  const navStart = search.indexOf('{/* Navigation Controls');
  const navSlice = search.slice(navStart, search.indexOf('{/* Search Progress */}'));
  assert.match(navSlice, /type="button"[\s\S]*onClick=\{goToPrevMatch\}/);
  assert.match(navSlice, /type="button"[\s\S]*onClick=\{goToNextMatch\}/);

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
  const modalStart = team.indexOf('/* ============ Manage Team modal ============ */');
  assert.match(team.slice(modalStart), /<button type="button" data-manage-team-edit /);

  const shell = read('src/AppShell.jsx');
  const tabStart = shell.indexOf("const secondTabLabel = isCounter ? 'Number' : 'Border'");
  const tabEnd = shell.indexOf('<CompactColorPicker', tabStart);
  assert.match(shell.slice(tabStart, tabEnd), /<button\s+key=\{k\}\s+type="button"/);

  const hub = read('src/home/HubShell.jsx');
  const searchStart = hub.indexOf('export const Search');
  const searchSlice = hub.slice(searchStart, hub.indexOf('export const EmptyState'));
  assert.match(searchSlice, /aria-label=\{placeholder\}/);

  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(tree, /type="button"[\s\S]*className="btn primary projects-desktop-create-button"/);
  const addFiles = tree.match(/<button[^>]*>[\s\S]{0,80}Add files<\/button>/g) || [];
  assert.ok(addFiles.length >= 4);
  for (const tag of addFiles) {
    assert.match(tag, /type="button"/);
  }
  assert.equal(tree.match(/<button(?![^>]*type="button")[^>]*>[\s\S]{0,80}Add files/), null);
  assert.match(
    tree,
    /<button type="button" className="btn" onClick=\{\(\) => setTeamModalProject\(open\)\}><Icon name="users" size=\{12\} \/>Manage team<\/button>/,
  );
  assert.doesNotMatch(tree, /<button className="btn"[^>]{0,160}setTeamModalProject/);
  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(
    ledger,
    /<button type="button" className="btn primary documents-desktop-upload" disabled=\{uploadBusy\} onClick=\{\(\) => onUpload && onUpload\(\)\}>\{uploadButtonBody\}<\/button>/,
  );
  assert.match(
    ledger,
    /<button type="button" className="btn primary hub-mobile-primary-action" disabled=\{uploadBusy\} onClick=\{\(\) => onUpload && onUpload\(\)\}>\{uploadButtonBody\}<\/button>/,
  );
  assert.doesNotMatch(ledger, /<button className="btn primary documents-desktop-upload"/);
  assert.doesNotMatch(ledger, /<button className="btn primary hub-mobile-primary-action"/);
  assert.match(tree, /title="Click to rename"[\s\S]{0,80}aria-label="Click to rename"|aria-label="Click to rename"[\s\S]{0,80}title="Click to rename"/);
  assert.match(tree, /title="Tap to rename"[\s\S]{0,80}aria-label="Tap to rename"|aria-label="Tap to rename"[\s\S]{0,80}title="Tap to rename"/);
  assert.equal(
    (tree.match(/title="Tap to rename"/g) || []).length,
    (tree.match(/aria-label="Tap to rename"/g) || []).length,
  );
  assert.match(read('src/reorder/DragRearrangeHandle.jsx'), /aria-label=\{title\}/);
  assert.match(editor, /title="Click to rename"[\s\S]{0,80}aria-label="Click to rename"|aria-label="Click to rename"[\s\S]{0,80}title="Click to rename"/);
  assert.match(editor, /title="Tap to rename"[\s\S]{0,80}aria-label="Tap to rename"|aria-label="Tap to rename"[\s\S]{0,80}title="Tap to rename"/);
  assert.match(editor, /aria-label=\{open \? 'Collapse' : 'Expand'\}/);
  assert.equal(editor.match(/<button(?![^>]*type="button")[^>]*>[\s\S]{0,80}New template/), null);
  assert.match(editor, /placeholder="Entity name"[\s\S]{0,80}aria-label="Entity name"|aria-label="Entity name"[\s\S]{0,80}placeholder="Entity name"/);
  const entityInputs = editor.match(/<input[\s\S]{0,400}placeholder="Entity name"[\s\S]{0,120}>/g) || [];
  assert.ok(entityInputs.length >= 2, 'desktop + mobile Entity name inputs');
  for (const tag of entityInputs) {
    assert.match(tag, /aria-label="Entity name"/);
  }
  assert.equal((editor.match(/aria-label="Entity name"/g) || []).length, entityInputs.length);
  assert.equal(editor.match(/<button(?![^>]*type="button")[^>]*>[\s\S]{0,80}New category/), null);
  assert.equal(editor.match(/<button(?![^>]*type="button")[^>]*>[\s\S]{0,80}New entity/), null);
  const colorChips = editor.match(/<button[\s\S]{0,220}title="Edit color"[\s\S]{0,80}aria-label="Edit color"/g) || [];
  assert.ok(colorChips.length >= 2, 'desktop + mobile Edit color chips');
  for (const tag of colorChips) {
    assert.match(tag, /type="button"/);
  }
  assert.equal(
    (editor.match(/title="Edit color"/g) || []).length,
    (editor.match(/aria-label="Edit color"/g) || []).length,
  );
  assert.match(
    editor,
    /title=\{`\$\{mod\.name\} · drag to reorder · double-click to rename`\}[\s\S]{0,80}aria-label=\{`\$\{mod\.name\} · drag to reorder · double-click to rename`\}|aria-label=\{`\$\{mod\.name\} · drag to reorder · double-click to rename`\}[\s\S]{0,80}title=\{`\$\{mod\.name\} · drag to reorder · double-click to rename`\}/,
  );
  assert.match(
    editor,
    /<button\s+type="button"\s+onClick=\{\(\) => onOpen\(index\)\}\s+onDoubleClick=\{\(\) => onStartRename\(mod\.id\)\}/,
  );
  assert.equal(
    editor.match(/<button(?![^>]*type="button")[^>]*onClick=\{\(\) => onOpen\(index\)\}/),
    null,
  );
  assert.equal(
    (editor.match(/title=\{`\$\{mod\.name\} · drag to reorder · double-click to rename`\}/g) || []).length,
    (editor.match(/aria-label=\{`\$\{mod\.name\} · drag to reorder · double-click to rename`\}/g) || []).length,
  );
  assert.match(
    editor,
    /aria-label=\{showCount \? `\$\{mod\.name\} \$\{catCount\}` : mod\.name\}/,
  );
  assert.match(editor, /<button\s+type="button"\s+onClick=\{addModule\}\s+title="New module"/);
  assert.match(
    editor,
    /title="New module"[\s\S]{0,80}aria-label="New module"|aria-label="New module"[\s\S]{0,80}title="New module"/,
  );
  assert.equal(editor.match(/<button(?![^>]*type="button")[^>]*title="New module"/), null);
  assert.equal(editor.match(/<button(?![^>]*aria-label="New module")[^>]*title="New module"/), null);
  assert.match(
    editor,
    /<p className="micro" style=\{\{ margin: 0 \}\}>Module<\/p>\s*<button\s+type="button"\s+onClick=\{\(\) => \{ setModEdit\(true\); setSelMods\(new Set\(\)\); \}\}/,
  );
  assert.equal(
    editor.match(/<p className="micro" style=\{\{ margin: 0 \}\}>Module<\/p>\s*<button(?![^>]*type="button")/),
    null,
  );
  assert.match(
    editor,
    /<p className="micro" style=\{\{ margin: 0 \}\}>Categories<\/p>[\s\S]{0,280}<button\s+type="button"\s+onClick=\{\(\) => \{ const next = !catEdit;/,
  );
  assert.match(
    editor,
    /<button\s+type="button"\s+style=\{selectLinkStyle\}\s+onClick=\{\(\) => \{ const next = !catEdit;/,
  );
  assert.equal(
    editor.match(/<p className="micro" style=\{\{ margin: 0 \}\}>Categories<\/p>[\s\S]{0,280}<button(?![^>]*type="button")/),
    null,
  );
  assert.match(
    editor,
    /<button\s+type="button"\s+className="mobile-header-select-button"\s+onClick=\{\(\) => \{ const next = !tplEdit;/,
  );
  assert.match(
    editor,
    /<button\s+type="button"\s+onClick=\{\(\) => \{ const next = !tplEdit; setTplEdit\(next\); if \(!next\) setSelTpls\(new Set\(\)\); \}\}\s+style=\{miniSelectButtonStyle/,
  );
  assert.equal(
    editor.match(/<button(?![^>]*type="button")[^>]*onClick=\{\(\) => \{ const next = !tplEdit;/),
    null,
  );
  assert.match(
    editor,
    /<button\s+type="button"\s+onClick=\{\(\) => \{ const next = !entityEdit; setEntityEdit\(next\); if \(!next\) setSelEntities\(new Set\(\)\); \}\}\s+style=\{\{ \.\.\.miniSelectButtonStyle/,
  );
  assert.match(
    editor,
    /<button\s+type="button"\s+style=\{selectLinkStyle\}\s+onClick=\{\(\) => \{ const next = !entityEdit;/,
  );
  assert.equal(
    editor.match(/<button(?![^>]*type="button")[^>]*onClick=\{\(\) => \{ const next = !entityEdit;/),
    null,
  );

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
    'tests/inviteUserRoleName.test.mjs',
    'tests/fillBorderButtonType.test.mjs',
    'tests/searchMatchNavButtonType.test.mjs',
    'tests/shareOpenHubChromeType.test.mjs',
    'tests/inviteOpenEditButtonType.test.mjs',
    'tests/clickToRenameName.test.mjs',
    'tests/dragToRearrangeName.test.mjs',
    'tests/templatesClickToRenameName.test.mjs',
    'tests/templatesExpandName.test.mjs',
    'tests/newTemplateButtonType.test.mjs',
    'tests/projectsTapToRenameName.test.mjs',
    'tests/entityNameName.test.mjs',
    'tests/newCategoryButtonType.test.mjs',
    'tests/newEntityButtonType.test.mjs',
    'tests/editColorButtonType.test.mjs',
    'tests/categoryDragTitlesName.test.mjs',
    'tests/moduleCountChromeName.test.mjs',
    'tests/newModuleButtonType.test.mjs',
    'tests/newModuleName.test.mjs',
    'tests/moduleSelectButtonType.test.mjs',
    'tests/categorySelectButtonType.test.mjs',
    'tests/templateListSelectButtonType.test.mjs',
    'tests/entitySelectButtonType.test.mjs',
    'tests/categoryDragTitlesButtonType.test.mjs',
    'tests/manageTeamButtonType.test.mjs',
    'tests/documentsUploadButtonType.test.mjs',
  ];
  for (const rel of official) {
    const src = read(rel);
    assert.match(src, /role="dialog"|KeyboardShortcutsOverlay|AccessManagementModal|templates-module-edit-title|role="menuitem"|Document actions|Show and sort|Template actions|Project actions|Sort|Export Space 1|Excel actions|create-bookmark-group-title|add-bookmarks-to-group-title|Add bookmark|Clear search|aria-label="Color"|aria-label=\{label\}|aria-label="Opacity"|aria-label="Permission"|Share link role|type="button"|Click to rename|Drag to rearrange|data-manage-team-edit|aria-label=\{open \? 'Collapse' : 'Expand'\}|New template|Tap to rename|Entity name|New category|New entity|Edit color|drag to reorder|catCount|New module|aria-label="New module"|Module Select|Category Select|Template-list Select|Entity Select|Category drag-title|Manage team|documents-desktop-upload/);
  }

  assert.match(read('src/PDFSidebar.jsx'), /openPanel\(tab\.id\)/);
  assert.match(read('src/AppShell.jsx'), /document\.addEventListener\('pointerdown', onDown, true\)/);
  assert.doesNotMatch(read('src/DevTestRoute.jsx'), /cloudSync: true/);
  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('hunt after Documents Upload type looks past Manage team type and leftover-18', () => {
  const spec = read('debug/scenarios/e2e-after-documents-upload-button-type-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /surveyTransitionE2E=1/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /AFTER_DOCUMENTS_UPLOAD_BUTTON_TYPE_INDEPENDENT_HUNT/);
  assert.match(spec, /name: 'Style'/);
  assert.match(spec, /name: 'Shapes'/);
  assert.match(spec, /#chrome-sub-toolbar-host/);
  assert.match(spec, /Width presets/);
  assert.match(spec, /name: 'Color'/);
  assert.match(spec, /name: 'Opacity'/);
  assert.match(spec, /name: 'Fill'/);
  assert.match(spec, /name: 'Border'/);
  assert.match(spec, /Previous match \(Shift\+Enter\)/);
  assert.match(spec, /Next match \(Enter\)/);
  assert.match(spec, /prevType/);
  assert.match(spec, /nextType/);
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
  assert.match(spec, /Add files/);
  assert.match(spec, /New project/);
  assert.match(spec, /Search projects/);
  assert.match(spec, /Find a teammate/);
  assert.match(spec, /data-manage-team-edit/);
  assert.match(spec, /editType/);
  assert.match(spec, /Click to rename/);
  assert.match(spec, /renameLabel/);
  assert.match(spec, /Tap to rename/);
  assert.match(spec, /Drag to rearrange/);
  assert.match(spec, /dragLabel/);
  assert.match(spec, /data-drag-rearrange-handle/);
  assert.match(spec, /data-template-title/);
  assert.match(spec, /expandLabel/);
  assert.match(spec, /expandType/);
  assert.match(spec, /newTemplateType/);
  assert.match(spec, /entityNameLabel/);
  assert.match(spec, /entityNameNamed/);
  assert.match(spec, /newCategoryType/);
  assert.match(spec, /newEntityType/);
  assert.match(spec, /editColorType/);
  assert.match(spec, /newModuleType/);
  assert.match(spec, /newModuleTitle/);
  assert.match(spec, /newModuleLabel/);
  assert.match(spec, /newModuleAccname/);
  assert.match(spec, /moduleSelectType/);
  assert.match(spec, /moduleSelectText/);
  assert.match(spec, /moduleSelectNamed/);
  assert.match(spec, /categorySelectType/);
  assert.match(spec, /categorySelectText/);
  assert.match(spec, /categorySelectNamed/);
  assert.match(spec, /templateListSelectType/);
  assert.match(spec, /templateListSelectText/);
  assert.match(spec, /templateListSelectNamed/);
  assert.match(spec, /entitySelectType/);
  assert.match(spec, /entitySelectText/);
  assert.match(spec, /entitySelectNamed/);
  assert.match(spec, /dragTitleLabel/);
  assert.match(spec, /dragTitleTitle/);
  assert.match(spec, /dragTitleType/);
  assert.match(spec, /dragTitleNamed/);
  assert.match(spec, /countChromeLabel/);
  assert.match(spec, /countChromeNamed/);
  assert.match(spec, /siblingCountNamed/);
  assert.match(spec, /drag to reorder/);
  assert.match(spec, /toBe\('Entity name'\)/);
  assert.match(spec, /toBe\('button'\)/);
  assert.match(spec, /editColorType\)\.toBe\('button'\)/);
  assert.match(spec, /newModuleType\)\.toBe\('button'\)/);
  assert.match(spec, /newModuleTitle\)\.toBe\('New module'\)/);
  assert.match(spec, /newModuleLabel\)\.toBe\('New module'\)/);
  assert.match(spec, /newModuleAccname\)\.toBeGreaterThan\(0\)/);
  assert.match(spec, /moduleSelectType\)\.toBe\('button'\)/);
  assert.match(spec, /moduleSelectText\)\.toBe\('Select'\)/);
  assert.match(spec, /categorySelectType\)\.toBe\('button'\)/);
  assert.match(spec, /categorySelectText\)\.toBe\('Select'\)/);
  assert.match(spec, /templateListSelectType\)\.toBe\('button'\)/);
  assert.match(spec, /templateListSelectText\)\.toBe\('Select'\)/);
  assert.match(spec, /entitySelectType\)\.toBe\('button'\)/);
  assert.match(spec, /entitySelectText\)\.toBe\('Select'\)/);
  assert.match(spec, /dragTitleLabel\)\.toBe\('Installation Phase · drag to reorder · double-click to rename'\)/);
  assert.match(spec, /dragTitleType\)\.toBe\('button'\)/);
  assert.match(spec, /countChromeLabel\)\.toBe\('Installation Phase 2'\)/);
  assert.match(spec, /manageTeamType/);
  assert.match(spec, /manageTeam390Type/);
  assert.match(spec, /uploadType/);
  assert.match(spec, /mobileUploadType/);
  assert.match(spec, /previewOpenFileType/);
  assert.match(spec, /previewShareType/);
  assert.match(spec, /implicitSubmit/);
  assert.match(spec, /data-page-number/);
  assert.match(spec, /tapRename390/);
  assert.match(spec, /tapRename390Label/);
  assert.match(spec, /toBe\('Tap to rename'\)/);
  assert.match(spec, /manageTeamType\)\.toBe\('button'\)/);
  assert.match(spec, /manageTeam390Type\)\.toBe\('button'\)/);
  assert.match(spec, /uploadType\)\.toBe\('button'\)/);
  assert.match(spec, /mobileUploadType\)\.toBe\('button'\)/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload PDF'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /documents-desktop-upload[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
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
  assert.doesNotMatch(spec, /name: 'Send viewer invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Fill'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Border'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Transparent'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Previous match \(Shift\+Enter\)'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Next match \(Enter\)'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /data-manage-team-edit[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /dragTo\(|manualDrag|dispatchEvent\(new MouseEvent\('drag/);
  assert.doesNotMatch(spec, /name: 'Click to rename'[^\n]*\.fill\(/);
  assert.doesNotMatch(spec, /name: 'Tap to rename'[^\n]*\.fill\(/);
  assert.doesNotMatch(spec, /name: 'Entity name'[^\n]*\.fill\(/);
  assert.doesNotMatch(spec, /name: 'New category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New entity'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New module'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit color'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Select'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New template'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /dblclick|dblClick|doubleClick/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
});
