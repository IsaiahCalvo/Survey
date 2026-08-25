import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official leftover files besides isolated 8448 match live source after Survey category-main / arrow type', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /role="dialog"/);
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);

  const access = read('src/home/AccessManagementModal.jsx');
  assert.match(access, /aria-labelledby="access-management-modal-title"/);
  assert.match(
    access,
    /<button type="button" onClick=\{onClose\} title="Close" aria-label="Close" style=\{closeButtonStyle/,
  );
  assert.doesNotMatch(
    access,
    /<button onClick=\{onClose\} title="Close" aria-label="Close" style=\{closeButtonStyle/,
  );
  assert.match(
    access,
    /<button type="button" onClick=\{\(\) => setInviteOpen\(true\)\} data-kal31-invite-btn="true"/,
  );
  assert.doesNotMatch(
    access,
    /<button onClick=\{\(\) => setInviteOpen\(true\)\} data-kal31-invite-btn="true"/,
  );
  assert.match(
    access,
    /<button type="button" onClick=\{onClose\} style=\{\{ background: C\.gold, color: '#15110a', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' \}\}>Done<\/button>/,
  );
  assert.doesNotMatch(
    access,
    /<button onClick=\{onClose\} style=\{\{ background: C\.gold, color: '#15110a', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' \}\}>Done<\/button>/,
  );

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
  const chevronStart = bookmarks.indexOf("aria-label={(isCollapsed || isVisuallyCollapsed) ? 'Expand group' : 'Collapse group'}");
  assert.ok(chevronStart > 0);
  assert.match(bookmarks.slice(Math.max(0, chevronStart - 400), chevronStart + 80), /<button\s+type="button"/);
  const addStart = bookmarks.indexOf('aria-label="Add bookmark to group"');
  assert.ok(addStart > 0);
  assert.match(bookmarks.slice(Math.max(0, addStart - 280), addStart + 40), /<button\s+type="button"/);
  const bookmarkEditLabel = bookmarks.indexOf("{isEditMode ? 'Done' : 'Edit'}");
  assert.ok(bookmarkEditLabel > 0);
  assert.match(bookmarks.slice(Math.max(0, bookmarkEditLabel - 1400), bookmarkEditLabel + 40), /<button\s+type="button"/);
  assert.doesNotMatch(
    bookmarks.slice(Math.max(0, bookmarkEditLabel - 1400), bookmarkEditLabel + 40),
    /<button\s+onClick=\{\(\) => setIsEditMode\(!isEditMode\)\}/,
  );
  const bookmarkDeleteLabel = bookmarks.indexOf("aria-label={isFolder ? `Delete group ${item.name}` : `Delete bookmark ${item.name}`}");
  assert.ok(bookmarkDeleteLabel > 0);
  assert.match(bookmarks.slice(Math.max(0, bookmarkDeleteLabel - 400), bookmarkDeleteLabel + 40), /<button\s+type="button"/);
  assert.doesNotMatch(
    bookmarks.slice(Math.max(0, bookmarkDeleteLabel - 400), bookmarkDeleteLabel + 40),
    /<button\s+onClick=\{\(event\) => \{/,
  );
  const surveyRail = read('src/SurveySpacesRail.jsx');
  const headerClose = surveyRail.indexOf("className=\"btn btn-icon btn-icon-sm\"\n                        aria-label=\"Close Survey panel\"");
  assert.ok(headerClose > 0, 'header Close Survey panel');
  assert.match(surveyRail.slice(Math.max(0, headerClose - 500), headerClose + 40), /<button\s+type="button"/);
  assert.doesNotMatch(
    surveyRail.slice(Math.max(0, headerClose - 500), headerClose + 40),
    /<button\s+onClick=\{\(\) => \{/,
  );
  const categoryMain = surveyRail.indexOf('className="survey-marker-category-main"');
  assert.ok(categoryMain > 0, 'category-main');
  assert.match(surveyRail.slice(Math.max(0, categoryMain - 1600), categoryMain + 40), /<button\s+type="button"/);
  assert.doesNotMatch(
    surveyRail.slice(Math.max(0, categoryMain - 1600), categoryMain + 40),
    /<button\s+onClick=\{\(e\) => \{/,
  );
  const categoryArrow = surveyRail.indexOf('className="survey-marker-category-arrow"');
  assert.ok(categoryArrow > 0, 'category-arrow');
  assert.match(surveyRail.slice(Math.max(0, categoryArrow - 400), categoryArrow + 40), /<button\s+type="button"/);
  assert.doesNotMatch(
    surveyRail.slice(Math.max(0, categoryArrow - 400), categoryArrow + 40),
    /<button\s+className="survey-marker-category-arrow"/,
  );

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
  assert.match(team.slice(modalStart), /<button type="button" data-manage-team-invite /);
  assert.match(
    team.slice(modalStart),
    /<button type="button" onClick=\{onClose\} style=\{\{ background: GOLD, color: "#15110a", border: 0, borderRadius: 6, padding: "5px 14px", height: 28, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" \}\}>Done<\/button>/,
  );
  assert.doesNotMatch(
    team.slice(modalStart),
    /<button onClick=\{onClose\} style=\{\{ background: GOLD, color: "#15110a", border: 0, borderRadius: 6, padding: "5px 14px", height: 28, fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" \}\}>Done<\/button>/,
  );

  const settings = read('src/components/AccountSettings.jsx');
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(
    settings,
    /<button type="button" className="account-settings-close" onClick=\{onClose\} aria-label="Close">/,
  );
  assert.doesNotMatch(
    settings,
    /<button className="account-settings-close" onClick=\{onClose\} aria-label="Close">/,
  );
  const sidebarStart = settings.indexOf('{/* Sidebar */}');
  const sidebarEnd = settings.indexOf('{/* Content */}');
  const sidebar = settings.slice(sidebarStart, sidebarEnd);
  assert.match(
    sidebar,
    /<button\s+type="button"\s+onClick=\{\(\) => setActiveTab\('general'\)\}\s+className=\{`account-sidebar-btn/,
  );
  assert.match(
    sidebar,
    /<button\s+type="button"\s+onClick=\{\(\) => setActiveTab\('connected-services'\)\}\s+className=\{`account-sidebar-btn/,
  );
  assert.match(
    sidebar,
    /<button\s+type="button"\s+onClick=\{\(\) => setActiveTab\('subscription'\)\}\s+className=\{`account-sidebar-btn/,
  );
  assert.equal((sidebar.match(/type="button"/g) || []).length, 3);
  assert.equal(sidebar.match(/<button(?![^>]*type="button")/), null);
  assert.match(
    settings,
    /<button\s+type="button"\s+onClick=\{\(\) => setIsEditing\(true\)\}\s+className="account-btn-primary"\s*>\s*Edit profile\s*<\/button>/,
  );
  assert.doesNotMatch(
    settings,
    /<button\s+onClick=\{\(\) => setIsEditing\(true\)\}\s+className="account-btn-primary"\s*>\s*Edit profile\s*<\/button>/,
  );
  assert.match(
    settings,
    /<button\s+type="button"\s+className="account-btn-secondary account-btn-secondary-full"\s+onClick=\{handleSignOut\}\s*>\s*Sign out\s*<\/button>/,
  );
  assert.doesNotMatch(
    settings,
    /<button\s+className="account-btn-secondary account-btn-secondary-full"\s+onClick=\{handleSignOut\}\s*>\s*Sign out\s*<\/button>/,
  );

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
  assert.match(
    tree,
    /<button\s+type="button"\s+data-testid="project-select-toggle"\s+className="mobile-header-select-button"/,
  );
  assert.doesNotMatch(
    tree,
    /<button\s+data-testid="project-select-toggle"\s+className="mobile-header-select-button"/,
  );
  assert.match(
    tree,
    /<button\s+type="button"\s+data-testid="project-select-toggle"\s+onClick=\{\(\) => \{\s+const next = !jobsEdit;[\s\S]*?style=\{miniSelectButtonStyle\(\)\}/,
  );
  assert.doesNotMatch(
    tree,
    /<button\s+data-testid="project-select-toggle"\s+onClick=\{\(\) => \{\s+const next = !jobsEdit;/,
  );
  assert.match(
    tree,
    /<button\s+type="button"\s+className="mobile-header-select-button"\s+onClick=\{\(\) => \{\s+const next = !fileSelect;/,
  );
  assert.doesNotMatch(
    tree,
    /<button\s+className="mobile-header-select-button"\s+onClick=\{\(\) => \{\s+const next = !fileSelect;/,
  );
  assert.match(
    tree,
    /<button\s+type="button"\s+onClick=\{\(\) => \{\s+const next = !fileSelect; setFileSelect\(next\); if \(!next\) setSelFiles\(new Set\(\)\); \}\}\s+style=\{miniSelectButtonStyle\(\)\}/,
  );
  assert.doesNotMatch(
    tree,
    /<button\s+onClick=\{\(\) => \{\s+const next = !fileSelect; setFileSelect\(next\); if \(!next\) setSelFiles\(new Set\(\)\); \}\}\s+style=\{miniSelectButtonStyle\(\)\}/,
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
  assert.match(
    ledger,
    /<button type="button" onClick=\{\(\) => setPreviewOpen\(false\)\} title="Close preview" aria-label="Close preview" style=\{closeButtonStyle\(\)\}>/,
  );
  assert.doesNotMatch(
    ledger,
    /<button onClick=\{\(\) => setPreviewOpen\(false\)\} title="Close preview" aria-label="Close preview"/,
  );
  assert.match(
    ledger,
    /<button type="button" className="btn primary" style=\{\{ flex: 1, justifyContent: 'center' \}\} onClick=\{\(\) => onOpenDocument && onOpenDocument\(sel\.raw\)\}>Open file<\/button>/,
  );
  assert.doesNotMatch(
    ledger,
    /<button className="btn primary" style=\{\{ flex: 1, justifyContent: 'center' \}\} onClick=\{\(\) => onOpenDocument && onOpenDocument\(sel\.raw\)\}>Open file<\/button>/,
  );
  assert.match(
    ledger,
    /<button type="button" className="btn" title="Share" aria-label="Share" onClick=\{\(\) => onShare && onShare\(\[sel\.raw\]\)\}>/,
  );
  assert.doesNotMatch(
    ledger,
    /<button className="btn" title="Share" aria-label="Share" onClick=\{\(\) => onShare && onShare\(\[sel\.raw\]\)\}>/,
  );
  assert.match(
    ledger,
    /<button\s+type="button"\s+className="mobile-header-select-button"\s+onClick=\{\(\) => \{\s+const next = !docSelectMode;/,
  );
  assert.doesNotMatch(
    ledger,
    /<button\s+className="mobile-header-select-button"/,
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
    'tests/documentsClosePreviewButtonType.test.mjs',
    'tests/documentsPreviewOpenFileButtonType.test.mjs',
    'tests/documentsPreviewShareButtonType.test.mjs',
    'tests/archiveClosePreviewButtonType.test.mjs',
    'tests/archiveSelectButtonType.test.mjs',
    'tests/documentsSelectButtonType.test.mjs',
    'tests/projects390SelectButtonType.test.mjs',
    'tests/projectsDesktopSelectButtonType.test.mjs',
    'tests/projects390FileSelectButtonType.test.mjs',
    'tests/projectsDesktopFileSelectButtonType.test.mjs',
    'tests/accountSettingsCloseButtonType.test.mjs',
    'tests/accountSettingsSidebarTabsButtonType.test.mjs',
    'tests/accountSettingsEditProfileButtonType.test.mjs',
    'tests/accountSettingsSignOutButtonType.test.mjs',
    'tests/archiveShowDocumentsName.test.mjs',
    'tests/projectsMoreButtonType.test.mjs',
    'tests/renameModalCloseName.test.mjs',
    'tests/renameModalCancelSaveButtonType.test.mjs',
    'tests/confirmModalCancelConfirmButtonType.test.mjs',
    'tests/createProjectModalCloseName.test.mjs',
    'tests/accessManagementCloseButtonType.test.mjs',
    'tests/accessManagementInviteButtonType.test.mjs',
    'tests/manageTeamInviteButtonType.test.mjs',
    'tests/manageTeamMoreButtonType.test.mjs',
  ];
  for (const rel of official) {
    const src = read(rel);
    assert.match(src, /role="dialog"|KeyboardShortcutsOverlay|AccessManagementModal|templates-module-edit-title|role="menuitem"|Document actions|Show and sort|Template actions|Project actions|Sort|Export Space 1|Excel actions|create-bookmark-group-title|add-bookmarks-to-group-title|Add bookmark|Clear search|aria-label="Color"|aria-label=\{label\}|aria-label="Opacity"|aria-label="Permission"|Share link role|type="button"|Click to rename|Drag to rearrange|data-manage-team-edit|data-manage-team-invite|aria-label=\{open \? 'Collapse' : 'Expand'\}|New template|Tap to rename|Entity name|New category|New entity|Edit color|drag to reorder|catCount|New module|aria-label="New module"|Module Select|Category Select|Template-list Select|Entity Select|Category drag-title|Manage team|documents-desktop-upload|Close preview|Open file|title="Share"|archive-select-row|documents-select-row|mobile-header-select-button|docSelectMode|jobsEdit|fileSelect|miniSelectButtonStyle|account-settings-close|account-sidebar-btn|Edit profile|Sign out|Show documents|Hide documents|Rename document|title="Close"|Cancel|ConfirmModal|handleConfirm|Create project|CreateProjectModal|access-management-modal-title/);
  }

  assert.match(
    read('src/home/ArchiveScreen.jsx'),
    /aria-label=\{open \? `Hide \$\{label\}` : `Show \$\{label\}`\}/,
  );
  assert.match(
    read('src/home/ArchiveScreen.jsx'),
    /aria-label=\{expanded \? 'Hide documents' : 'Show documents'\}/,
  );
  const moreButtons = [...tree.matchAll(/<button[\s\S]{0,800}title="More"/g)].map((row) => row[0]);
  assert.equal(moreButtons.length, 6);
  for (const tag of moreButtons) {
    assert.match(tag, /type="button"/);
  }
  assert.equal((tree.match(/title="More"/g) || []).length, 6);
  assert.equal(
    tree.match(/<button(?![^>]*type="button")[\s\S]{0,800}title="More"/),
    null,
  );
  const rename = read('src/home/BulkModals.jsx');
  const renameStart = rename.indexOf('export function RenameModal');
  const renameSlice = rename.slice(renameStart);
  assert.match(
    renameSlice,
    /<button type="button" onClick=\{onClose\} title="Close" aria-label="Close"/,
  );
  assert.doesNotMatch(
    renameSlice,
    /<button onClick=\{onClose\} title="Close" style=\{closeButtonStyle/,
  );
  assert.match(renameSlice, /title = 'Rename'/);
  assert.match(
    renameSlice,
    /<button type="button" onClick=\{onClose\} style=\{\{ minHeight: 44, background: 'transparent'/,
  );
  assert.match(
    renameSlice,
    /<button\s+type="button"\s+disabled=\{!trimmed\}\s+onClick=\{submit\}/,
  );
  assert.doesNotMatch(
    renameSlice,
    /<button onClick=\{onClose\} style=\{\{ minHeight: 44, background: 'transparent'/,
  );
  assert.doesNotMatch(
    renameSlice,
    /<button\s+disabled=\{!trimmed\}\s+onClick=\{submit\}/,
  );
  const confirmStart = rename.indexOf('export function ConfirmModal');
  const confirmEnd = rename.indexOf('export function RenameModal');
  const confirmSlice = rename.slice(confirmStart, confirmEnd);
  assert.match(
    confirmSlice,
    /<button type="button" disabled=\{submitting\} onClick=\{onClose\} title="Close" aria-label="Close"/,
  );
  assert.match(
    confirmSlice,
    /<button type="button" disabled=\{submitting\} onClick=\{onClose\} style=\{\{ background: 'transparent'/,
  );
  assert.match(
    confirmSlice,
    /<button\s+type="button"\s+disabled=\{submitting\}\s+onClick=\{handleConfirm\}/,
  );
  assert.doesNotMatch(
    confirmSlice,
    /<button disabled=\{submitting\} onClick=\{onClose\} title="Close" aria-label="Close"/,
  );
  assert.doesNotMatch(
    confirmSlice,
    /<button\s+disabled=\{submitting\}\s+onClick=\{handleConfirm\}/,
  );
  const createProject = read('src/home/CreateProjectModal.jsx');
  assert.match(
    createProject,
    /<button type="button" title="Close" aria-label="Close" disabled=\{busy\} onClick=\{onCancel\} style=\{closeButtonStyle/,
  );
  assert.doesNotMatch(
    createProject,
    /<button type="button" title="Close" disabled=\{busy\} onClick=\{onCancel\} style=\{closeButtonStyle/,
  );

  assert.match(read('src/PDFSidebar.jsx'), /openPanel\(tab\.id\)/);
  assert.match(shell, /document\.addEventListener\('pointerdown', onDown, true\)/);
  const clusterStart = shell.indexOf('data-undo-redo-controls="true"');
  const cluster = shell.slice(clusterStart, clusterStart + 1800);
  assert.match(cluster, /<button\s+type="button"\s+onClick=\{topToolbarApi\.onUndo/);
  assert.match(cluster, /<button\s+type="button"\s+onClick=\{topToolbarApi\.onRedo/);
  const chromeExportStart = shell.indexOf('Export annotated PDF — browser-visible entry point');
  assert.match(
    shell.slice(chromeExportStart, chromeExportStart + 700),
    /<button\s+type="button"\s+onClick=\{bottomToolbarApi\.exportAnnotatedPdf\}/,
  );
  assert.match(
    shell.slice(shell.indexOf('{/* Draw category */}'), shell.indexOf('{/* Draw category */}') + 1400),
    /<button\s+type="button"/,
  );
  assert.match(
    shell.slice(shell.indexOf('{/* Shapes category */}'), shell.indexOf('{/* Shapes category */}') + 1400),
    /<button\s+type="button"/,
  );
  assert.match(
    shell.slice(shell.indexOf('{/* Text category */}'), shell.indexOf('{/* Text category */}') + 1400),
    /<button\s+type="button"/,
  );
  const collapsedStart = shell.indexOf('// Collapsed 48px rail — vertical stack.');
  const expandedStart = shell.indexOf('// Expanded 320px survey panel — horizontal row pinned to the');
  const collapsed = shell.slice(collapsedStart, expandedStart);
  const expanded = shell.slice(expandedStart, expandedStart + 2800);
  assert.match(collapsed, /<button\s+type="button"\s+onClick=\{api\.zoomIn\}/);
  assert.match(collapsed, /<button\s+type="button"\s+onClick=\{api\.zoomOut\}/);
  assert.match(collapsed, /<button\s+type="button"\s+onClick=\{api\.goToPreviousPage\}/);
  assert.match(collapsed, /<button\s+type="button"\s+onClick=\{api\.goToNextPage\}/);
  assert.doesNotMatch(collapsed, /<button\s+onClick=\{api\.zoomIn\}/);
  assert.doesNotMatch(collapsed, /<button\s+onClick=\{api\.goToNextPage\}/);
  assert.match(expanded, /<button\s+type="button"\s+onClick=\{api\.zoomIn\}/);
  assert.match(expanded, /<button\s+type="button"\s+onClick=\{api\.goToPreviousPage\}/);
  assert.doesNotMatch(expanded, /<button\s+onClick=\{api\.zoomOut\}/);
  const editStart = shell.indexOf('{/* 2026-05-25: Rich-text edit entry button.');
  assert.ok(editStart > 0, 'Edit text chrome');
  assert.match(
    shell.slice(editStart, editStart + 1800),
    /<button\s+type="button"\s+onClick=\{\(\) => bottomToolbarApi\.onEnterTextEdit\(\)\}/,
  );
  assert.doesNotMatch(
    shell.slice(editStart, editStart + 1800),
    /<button\s+onClick=\{\(\) => bottomToolbarApi\.onEnterTextEdit\(\)\}/,
  );
  const viewer = read('src/PDFViewer.jsx');
  const reviewStart = viewer.indexOf("{activeCategoryDropdown === 'review' && (");
  assert.ok(reviewStart > 0, 'review category sub-toolbar');
  assert.match(
    viewer.slice(reviewStart, reviewStart + 2800),
    /const button = \(\s*<button\s+type="button"\s+key=\{t\.id\}/,
  );
  assert.doesNotMatch(
    viewer.slice(reviewStart, reviewStart + 2800),
    /const button = \(\s*<button\s+key=\{t\.id\}/,
  );
  const shapeStart = viewer.indexOf("{activeCategoryDropdown === 'shape' && (");
  assert.ok(shapeStart > 0, 'shape category sub-toolbar');
  assert.match(
    viewer.slice(shapeStart, shapeStart + 2800),
    /const button = \(\s*<button\s+type="button"\s+key=\{t\.id\}/,
  );
  assert.doesNotMatch(
    viewer.slice(shapeStart, shapeStart + 2800),
    /const button = \(\s*<button\s+key=\{t\.id\}/,
  );
  const drawStart = viewer.indexOf("{activeCategoryDropdown === 'draw' && (");
  assert.ok(drawStart > 0, 'draw category sub-toolbar');
  assert.match(
    viewer.slice(drawStart, drawStart + 2800),
    /const button = \(\s*<button\s+type="button"\s+key=\{t\.id\}/,
  );
  assert.doesNotMatch(
    viewer.slice(drawStart, drawStart + 2800),
    /const button = \(\s*<button\s+key=\{t\.id\}/,
  );
  const create = read('src/components/CreateCategoryModal.jsx');
  const createActions = create.slice(create.indexOf('{/* Action buttons */}'));
  assert.match(createActions, /<button\s+type="button"\s+onClick=\{onClose\}/);
  assert.match(createActions, /<button\s+type="button"\s+onClick=\{handleConfirm\}\s+disabled=\{!canConfirm\}/);
  assert.doesNotMatch(createActions, /<button\s+onClick=\{onClose\}/);
  assert.doesNotMatch(createActions, /<button\s+onClick=\{handleConfirm\}\s+disabled=\{!canConfirm\}/);
  assert.match(create, /aria-labelledby="create-category-modal-title"/);
  assert.doesNotMatch(read('src/DevTestRoute.jsx'), /cloudSync: true/);
  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('hunt after Survey category-main / arrow type looks past Close type and leftover-18', () => {
  const spec = read('debug/scenarios/e2e-after-survey-category-main-arrow-button-type-independent-hunt.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /Package%202%20-%20Rev%204%20--%20IC\.pdf/);
  assert.match(spec, /surveyTransitionE2E=1/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /AFTER_SURVEY_CATEGORY_MAIN_ARROW_BUTTON_TYPE_INDEPENDENT_HUNT/);
  assert.match(spec, /survey\.closeType/);
  assert.match(spec, /survey\.closeName/);
  assert.match(spec, /survey\.implicitSubmit/);
  assert.match(spec, /survey\.categoryMainType/);
  assert.match(spec, /survey\.categoryMainName/);
  assert.match(spec, /survey\.categoryArrowType/);
  assert.match(spec, /survey\.categoryImplicitSubmit/);
  assert.match(spec, /closeType\)\.toBe\('button'\)/);
  assert.match(spec, /closeName\)\.toBe\('Close Survey panel'\)/);
  assert.match(spec, /categoryMainType\)\.toBe\('button'\)/);
  assert.match(spec, /categoryMainName\)\.toMatch\(\/Walls\/\)/);
  assert.match(spec, /categoryImplicitSubmit\)\.toEqual\(\[\]\)/);
  assert.match(spec, /bookmarks\.expandType/);
  assert.match(spec, /bookmarks\.collapseType/);
  assert.match(spec, /bookmarks\.addToGroupType/);
  assert.match(spec, /bookmarks\.implicitSubmit/);
  assert.match(spec, /bookmarks\.editType/);
  assert.match(spec, /bookmarks\.editName/);
  assert.match(spec, /bookmarks\.doneType/);
  assert.match(spec, /bookmarks\.doneName/);
  assert.match(spec, /bookmarks\.deleteType/);
  assert.match(spec, /addToGroupType\)\.toBe\('button'\)/);
  assert.match(spec, /afterExpandType\)\.toBe\('button'\)/);
  assert.match(spec, /editType\)\.toBe\('button'\)/);
  assert.match(spec, /editName\)\.toBe\('Edit'\)/);
  assert.match(spec, /doneType\)\.toBe\('button'\)/);
  assert.match(spec, /doneName\)\.toBe\('Done'\)/);
  assert.match(spec, /deleteType\)\.toBe\('button'\)/);
  assert.match(spec, /deleteName\)\.toMatch\(\/\^Delete \(group\|bookmark\) \//);
  assert.match(spec, /edit\.click\(\)/);
  assert.match(spec, /done\.click\(\)/);
  assert.doesNotMatch(spec, /name: 'Add bookmark to group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New bookmark group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create bookmark group'[^\n]*\.click\(/);
  assert.match(spec, /editor\.undoType/);
  assert.match(spec, /editor\.redoType/);
  assert.match(spec, /editor\.exportType/);
  assert.match(spec, /editor\.drawType/);
  assert.match(spec, /editor\.shapesType/);
  assert.match(spec, /editor\.textType/);
  assert.match(spec, /editor\.panType/);
  assert.match(spec, /editor\.selectType/);
  assert.match(spec, /editor\.zoomInType/);
  assert.match(spec, /editor\.zoomOutType/);
  assert.match(spec, /editor\.prevPageType/);
  assert.match(spec, /editor\.nextPageType/);
  assert.match(spec, /editor\.editTextType/);
  assert.match(spec, /editor\.editTextName/);
  assert.match(spec, /editor\.editTextDisabled/);
  assert.match(spec, /editor\.fontColorAfterText/);
  assert.match(spec, /editor\.boldAfterText/);
  assert.match(spec, /editor\.italicAfterText/);
  assert.match(spec, /editor\.subTextType/);
  assert.match(spec, /editor\.subCalloutType/);
  assert.match(spec, /editor\.subTextName/);
  assert.match(spec, /editor\.subCalloutName/);
  assert.match(spec, /editor\.subRectType/);
  assert.match(spec, /editor\.subEllipseType/);
  assert.match(spec, /editor\.subLineType/);
  assert.match(spec, /editor\.subArrowType/);
  assert.match(spec, /editor\.subCounterType/);
  assert.match(spec, /shapesArmedImplicitSubmit/);
  assert.match(spec, /editor\.subPenType/);
  assert.match(spec, /editor\.subHighlighterType/);
  assert.match(spec, /editor\.subEraserType/);
  assert.match(spec, /drawArmedImplicitSubmit/);
  assert.match(spec, /armedImplicitSubmit/);
  assert.match(spec, /subRectType\)\.toBe\('button'\)/);
  assert.match(spec, /subEllipseType\)\.toBe\('button'\)/);
  assert.match(spec, /subLineType\)\.toBe\('button'\)/);
  assert.match(spec, /subArrowType\)\.toBe\('button'\)/);
  assert.match(spec, /subCounterType\)\.toBe\('button'\)/);
  assert.match(spec, /shapesArmedImplicitSubmit\.some\(\(name\) => name === 'Rectangle'\)\)\.toBe\(false\)/);
  assert.match(spec, /shapesArmedImplicitSubmit\.some\(\(name\) => name === 'Counter'\)\)\.toBe\(false\)/);
  assert.match(spec, /subPenType\)\.toBe\('button'\)/);
  assert.match(spec, /subHighlighterType\)\.toBe\('button'\)/);
  assert.match(spec, /subEraserType\)\.toBe\('button'\)/);
  assert.match(spec, /subPenName\)\.toBe\('Pen'\)/);
  assert.match(spec, /subHighlighterName\)\.toBe\('Highlighter'\)/);
  assert.match(spec, /drawArmedImplicitSubmit\.some\(\(name\) => name === 'Pen'\)\)\.toBe\(false\)/);
  assert.match(spec, /drawArmedImplicitSubmit\.some\(\(name\) => name === 'Highlighter'\)\)\.toBe\(false\)/);
  assert.match(spec, /drawArmedImplicitSubmit\.some\(\(name\) => name === 'Partial erase'\)\)\.toBe\(false\)/);
  assert.match(spec, /editTextType\)\.toBe\('button'\)/);
  assert.match(spec, /editTextName\)\.toBe\('Edit text'\)/);
  assert.match(spec, /armedImplicitSubmit\.some\(\(row\) => row\.name === 'Edit text'\)\)\.toBe\(false\)/);
  assert.match(spec, /armedImplicitSubmit\.some\(\(row\) => row\.name === 'Text'\)\)\.toBe\(false\)/);
  assert.match(spec, /armedImplicitSubmit\.some\(\(row\) => row\.name === 'Callout'\)\)\.toBe\(false\)/);
  assert.match(spec, /subTextType\)\.toBe\('button'\)/);
  assert.match(spec, /subTextName\)\.toBe\('Text'\)/);
  assert.match(spec, /subCalloutType\)\.toBe\('button'\)/);
  assert.match(spec, /subCalloutName\)\.toBe\('Callout'\)/);
  assert.match(spec, /data-undo-redo-controls/);
  assert.match(spec, /Export annotated PDF/);
  assert.match(spec, /access\.closeType/);
  assert.match(spec, /Document Access/);
  assert.match(spec, /Delete 1 category\?/);
  assert.match(spec, /confirm\.cancelType/);
  assert.match(spec, /confirm\.applyType/);
  assert.match(spec, /confirm\.closeType/);
  assert.match(spec, /createProject\.closeTitle/);
  assert.match(spec, /createProject\.closeLabel/);
  assert.match(spec, /createProject\.closeNamed/);
  assert.match(spec, /Create project/);
  assert.match(spec, /Two Category Template/);
  assert.match(spec, /workflowE2E=1/);
  assert.match(spec, /name: 'New project'[^\n]*\.click\(/);
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
  assert.match(spec, /exportType\)\.toBe\('button'\)/);
  assert.match(spec, /drawType\)\.toBe\('button'\)/);
  assert.match(spec, /shapesType\)\.toBe\('button'\)/);
  assert.match(spec, /textType\)\.toBe\('button'\)/);
  assert.match(spec, /panType\)\.toBe\('button'\)/);
  assert.match(spec, /selectType\)\.toBe\('button'\)/);
  assert.match(spec, /zoomInType\)\.toBe\('button'\)/);
  assert.match(spec, /zoomOutType\)\.toBe\('button'\)/);
  assert.match(spec, /prevPageType\)\.toBe\('button'\)/);
  assert.match(spec, /nextPageType\)\.toBe\('button'\)/);
  assert.match(spec, /implicitSubmit\.some\(\(row\) => row\.name === 'Zoom in'\)\)\.toBe\(false\)/);
  assert.match(spec, /implicitSubmit\.some\(\(row\) => row\.name === 'Zoom out'\)\)\.toBe\(false\)/);
  assert.match(spec, /implicitSubmit\.some\(\(row\) => row\.name === 'Previous page'\)\)\.toBe\(false\)/);
  assert.match(spec, /implicitSubmit\.some\(\(row\) => row\.name === 'Next page'\)\)\.toBe\(false\)/);
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
  assert.match(spec, /closePreviewType/);
  assert.match(spec, /closePreviewName/);
  assert.match(spec, /previewOpenFileType/);
  assert.match(spec, /previewShareType/);
  assert.match(spec, /implicitSubmit/);
  assert.match(spec, /data-page-number/);
  assert.match(spec, /tapRename390/);
  assert.match(spec, /tapRename390Label/);
  assert.match(spec, /toBe\('Tap to rename'\)/);
  assert.match(spec, /manageTeamType\)\.toBe\('button'\)/);
  assert.match(spec, /manageTeam390Type\)\.toBe\('button'\)/);
  assert.match(spec, /teamInviteType/);
  assert.match(spec, /teamInviteName/);
  assert.match(spec, /teamDoneType/);
  assert.match(spec, /teamDoneName/);
  assert.match(spec, /teamImplicitSubmit/);
  assert.match(spec, /teamInvite390Type/);
  assert.match(spec, /teamDone390Type/);
  assert.match(spec, /teamAfterEscape390/);
  assert.match(spec, /teamInviteType\)\.toBe\('button'\)/);
  assert.match(spec, /teamInviteName\)\.toBe\('Invite'\)/);
  assert.match(spec, /teamDoneType\)\.toBe\('button'\)/);
  assert.match(spec, /teamDoneName\)\.toBe\('Done'\)/);
  assert.match(spec, /teamImplicitSubmit\.some\(\(row\) => row\.name === 'Invite'\)\)\.toBe\(false\)/);
  assert.match(spec, /teamImplicitSubmit\.some\(\(row\) => row\.name === 'Done'\)\)\.toBe\(false\)/);
  assert.match(spec, /teamImplicitSubmit\.some\(\(row\) => row\.name === 'More'\)\)\.toBe\(false\)/);
  assert.match(spec, /teamMoreType/);
  assert.match(spec, /teamMoreName/);
  assert.match(spec, /teamMoreTitle/);
  assert.match(spec, /teamMore390Type/);
  assert.match(spec, /teamMoreType\)\.toBe\('button'\)/);
  assert.match(spec, /teamMoreName\)\.toBe\('More'\)/);
  assert.match(spec, /teamMoreTitle\)\.toBe\('More'\)/);
  assert.match(spec, /teamMore390Type\)\.toBe\('button'\)/);
  assert.match(spec, /teamInvite390Type\)\.toBe\('button'\)/);
  assert.match(spec, /teamDone390Type\)\.toBe\('button'\)/);
  assert.match(spec, /teamAfterEscape390\)\.toBe\(0\)/);
  assert.match(spec, /uploadType\)\.toBe\('button'\)/);
  assert.match(spec, /mobileUploadType\)\.toBe\('button'\)/);
  assert.match(spec, /closePreviewType\)\.toBe\('button'\)/);
  assert.match(spec, /closePreviewName\)\.toBe\('Close preview'\)/);
  assert.match(spec, /previewOpenFileType\)\.toBe\('button'\)/);
  assert.match(spec, /previewShareCount\)\.toBeGreaterThan\(0\)/);
  assert.match(spec, /previewShareType\)\.toBe\('button'\)/);
  assert.match(spec, /implicitSubmit\.some\(\(row\) => row\.name === 'Open file'\)\)\.toBe\(false\)/);
  assert.match(spec, /implicitSubmit\.some\(\(row\) => row\.name === 'Share' && String\(row\.className/);
  assert.match(spec, /archive\.closePreviewCount/);
  assert.match(spec, /archive\.closePreviewType/);
  assert.match(spec, /closePreviewBeforeSelect/);
  assert.match(spec, /closePreviewAfterEscape/);
  assert.match(spec, /archive\.implicitSubmit/);
  assert.match(spec, /archive\.selectType/);
  assert.match(spec, /documentsSelectType/);
  assert.match(spec, /documentsSelectName/);
  assert.match(spec, /selectType\)\.toBe\('button'\)/);
  assert.match(spec, /selectName\)\.toBe\('Select'\)/);
  assert.match(spec, /documentsSelectType\)\.toBe\('button'\)/);
  assert.match(spec, /select390Type/);
  assert.match(spec, /select390Name/);
  assert.match(spec, /select390Count/);
  assert.match(spec, /select390Visible/);
  assert.match(spec, /desktopSelectType/);
  assert.match(spec, /desktopSelectName/);
  assert.match(spec, /fileSelect390Type/);
  assert.match(spec, /fileSelect390Name/);
  assert.match(spec, /select390Type\)\.toBe\('button'\)/);
  assert.match(spec, /select390Name\)\.toBe\('Select'\)/);
  assert.match(spec, /select390Visible\)\.toBe\(true\)/);
  assert.match(spec, /desktopSelectType\)\.toBe\('button'\)/);
  assert.match(spec, /desktopSelectName\)\.toBe\('Select'\)/);
  assert.match(spec, /fileSelect390Type\)\.toBe\('button'\)/);
  assert.match(spec, /fileSelect390Name\)\.toBe\('Select'\)/);
  assert.match(spec, /desktopFileSelect/);
  assert.match(spec, /desktopFileSelect\.type\)\.toBe\('button'\)/);
  assert.match(spec, /desktopFileSelect\.name\)\.toBe\('Select'\)/);
  assert.match(spec, /settingsCloseType/);
  assert.match(spec, /settingsCloseName/);
  assert.match(spec, /settingsCloseAfterEscape/);
  assert.match(spec, /settingsNamed/);
  assert.match(spec, /settingsGeneral/);
  assert.match(spec, /settingsCloseType\)\.toBe\('button'\)/);
  assert.match(spec, /settingsCloseName\)\.toBe\('Close'\)/);
  assert.match(spec, /settingsCloseAfterEscape\)\.toBe\(0\)/);
  assert.match(spec, /settingsGeneralType/);
  assert.match(spec, /settingsConnectedType/);
  assert.match(spec, /settingsSubscriptionType/);
  assert.match(spec, /settingsSidebarCount/);
  assert.match(spec, /settingsImplicitSubmit/);
  assert.match(spec, /settingsGeneralType\)\.toBe\('button'\)/);
  assert.match(spec, /settingsConnectedType\)\.toBe\('button'\)/);
  assert.match(spec, /settingsSubscriptionType\)\.toBe\('button'\)/);
  assert.match(spec, /settingsSidebarCount\)\.toBe\(3\)/);
  assert.match(spec, /settingsImplicitSubmit\.some\(\(row\) => row\.name === 'General'\)\)\.toBe\(false\)/);
  assert.match(spec, /settingsImplicitSubmit\.some\(\(row\) => row\.name === 'Connected services'\)\)\.toBe\(false\)/);
  assert.match(spec, /settingsImplicitSubmit\.some\(\(row\) => row\.name === 'Subscription'\)\)\.toBe\(false\)/);
  assert.match(spec, /settingsEditProfileType/);
  assert.match(spec, /settingsEditProfileName/);
  assert.match(spec, /settingsEditProfileType\)\.toBe\('button'\)/);
  assert.match(spec, /settingsEditProfileName\)\.toBe\('Edit profile'\)/);
  assert.match(spec, /settingsImplicitSubmit\.some\(\(row\) => row\.name === 'Edit profile'\)\)\.toBe\(false\)/);
  assert.match(spec, /settingsSignOut/);
  assert.match(spec, /settingsSignOutType/);
  assert.match(spec, /settingsSignOutName/);
  assert.match(spec, /settingsSignOutType\)\.toBe\('button'\)/);
  assert.match(spec, /settingsSignOutName\)\.toBe\('Sign out'\)/);
  assert.match(spec, /settingsImplicitSubmit\.some\(\(row\) => row\.name === 'Sign out'\)\)\.toBe\(false\)/);
  assert.match(spec, /moreType/);
  assert.match(spec, /moreTitle/);
  assert.match(spec, /fileRowMoreType/);
  assert.match(spec, /fileRowMoreTitle/);
  assert.match(spec, /more390Type/);
  assert.match(spec, /more390Title/);
  assert.match(spec, /moreType\)\.toBe\('button'\)/);
  assert.match(spec, /moreTitle\)\.toBe\('More'\)/);
  assert.match(spec, /fileRowMoreType\)\.toBe\('button'\)/);
  assert.match(spec, /fileRowMoreTitle\)\.toBe\('More'\)/);
  assert.match(spec, /more390Type\)\.toBe\('button'\)/);
  assert.match(spec, /more390Title\)\.toBe\('More'\)/);
  assert.match(spec, /renameCloseCount/);
  assert.match(spec, /renameCloseType/);
  assert.match(spec, /renameCloseLabel/);
  assert.match(spec, /renameCloseTitle/);
  assert.match(spec, /renameCloseAfterEscape/);
  assert.match(spec, /renameNameValue/);
  assert.match(spec, /Rename document/);
  assert.match(spec, /renameCloseType\)\.toBe\('button'\)/);
  assert.match(spec, /renameCloseLabel\)\.toBe\('Close'\)/);
  assert.match(spec, /renameCloseTitle\)\.toBe\('Close'\)/);
  assert.match(spec, /renameCloseAfterEscape\)\.toBe\(0\)/);
  assert.match(spec, /implicitSubmit\.some\(\(row\) => row\.name === 'Close'\)\)\.toBe\(false\)/);
  assert.match(spec, /renameCancelType/);
  assert.match(spec, /renameCancelName/);
  assert.match(spec, /renameSaveType/);
  assert.match(spec, /renameSaveName/);
  assert.match(spec, /renameCancelType\)\.toBe\('button'\)/);
  assert.match(spec, /renameCancelName\)\.toBe\('Cancel'\)/);
  assert.match(spec, /renameSaveType\)\.toBe\('button'\)/);
  assert.match(spec, /renameSaveName\)\.toBe\('Save'\)/);
  assert.match(spec, /implicitSubmit\.some\(\(row\) => row\.name === 'Cancel'\)\)\.toBe\(false\)/);
  assert.match(spec, /implicitSubmit\.some\(\(row\) => row\.name === 'Save'\)\)\.toBe\(false\)/);
  assert.match(spec, /showDocumentsCount/);
  assert.match(spec, /showDocumentsType/);
  assert.match(spec, /showDocumentsLabel/);
  assert.match(spec, /showDocumentsTitle/);
  assert.match(spec, /showDocumentsNamed/);
  assert.match(spec, /showDocumentsType\)\.toBe\('button'\)/);
  assert.match(spec, /showDocumentsLabel\)\.toBe\('Show documents'\)/);
  assert.match(spec, /showDocumentsTitle\)\.toBe\('Show documents'\)/);
  assert.match(spec, /closePreviewType\)\.toBe\('button'\)/);
  assert.match(spec, /closePreviewName\)\.toBe\('Close preview'\)/);
  assert.match(spec, /implicitSubmit\.some\(\(row\) => row\.name === 'Close preview'\)\)\.toBe\(false\)/);
  assert.match(spec, /confirm\.cancelType\)\.toBe\('button'\)/);
  assert.match(spec, /confirm\.cancelName\)\.toBe\('Cancel'\)/);
  assert.match(spec, /confirm\.applyType\)\.toBe\('button'\)/);
  assert.match(spec, /confirm\.applyName\)\.toBe\('Delete category'\)/);
  assert.match(spec, /confirm\.closeType\)\.toBe\('button'\)/);
  assert.match(spec, /confirm\.closeLabel\)\.toBe\('Close'\)/);
  assert.match(spec, /confirm\.implicitSubmit\)\.toEqual\(\[\]\)/);
  assert.match(spec, /confirm\.afterCancel\)\.toBe\(0\)/);
  assert.match(spec, /createCategory\.cancelType\)\.toBe\('button'\)/);
  assert.match(spec, /createCategory\.cancelName\)\.toBe\('Cancel'\)/);
  assert.match(spec, /createCategory\.applyType\)\.toBe\('button'\)/);
  assert.match(spec, /createCategory\.applyName\)\.toBe\('Create category'\)/);
  assert.match(spec, /createCategory\.applyDisabled\)\.toBe\(true\)/);
  assert.match(spec, /createCategory\.implicitSubmit\)\.toEqual\(\[\]\)/);
  assert.match(spec, /createCategory\.afterCancel\)\.toBe\(0\)/);
  assert.match(spec, /createProject\.closeType\)\.toBe\('button'\)/);
  assert.match(spec, /createProject\.closeTitle\)\.toBe\('Close'\)/);
  assert.match(spec, /createProject\.closeLabel\)\.toBe\('Close'\)/);
  assert.match(spec, /createProject\.closeAccname\)\.toBe\('Close'\)/);
  assert.match(spec, /createProject\.closeNamed\)\.toBe\(1\)/);
  assert.match(spec, /createProject\.implicitSubmit\)\.toEqual\(\[\]\)/);
  assert.match(spec, /createProject\.afterClose\)\.toBe\(0\)/);
  assert.match(spec, /createProject\.afterCancel\)\.toBe\(0\)/);
  assert.match(spec, /access\.closeType\)\.toBe\('button'\)/);
  assert.match(spec, /access\.closeLabel\)\.toBe\('Close'\)/);
  assert.match(spec, /access\.closeTitle\)\.toBe\('Close'\)/);
  assert.match(spec, /access\.closeAccname\)\.toBe\('Close'\)/);
  assert.match(spec, /access\.inviteType\)\.toBe\('button'\)/);
  assert.match(spec, /access\.doneType\)\.toBe\('button'\)/);
  assert.match(spec, /access\.implicitSubmit\.some\(\(row\) => row\.name === 'Close'\)\)\.toBe\(false\)/);
  assert.match(spec, /access\.implicitSubmit\.some\(\(row\) => row\.name === 'Invite'\)\)\.toBe\(false\)/);
  assert.match(spec, /access\.implicitSubmit\.some\(\(row\) => row\.name === 'Done'\)\)\.toBe\(false\)/);
  assert.match(spec, /access\.afterClose\)\.toBe\(0\)/);
  assert.match(spec, /access\.sendAfterClose\)\.toBe\(0\)/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /collapsed rail Spaces must be live/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload PDF'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Close preview'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.match(spec, /name: 'Share', exact: true \}\)\.click\(/);
  assert.doesNotMatch(spec, /name: 'Invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Done'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'View activity'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Change role'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Remove from team'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Resend invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Invite user'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Copy email'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Revoke invite'[^\n]*\.click\(/);
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
  assert.doesNotMatch(spec, /name: 'Save'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete categories'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Confirm'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /createApply\.click\(/);
  assert.doesNotMatch(spec, /survey-marker-category-main[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Send viewer invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Fill'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Border'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Transparent'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Previous match \(Shift\+Enter\)'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Next match \(Enter\)'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add files'[^\n]*\.click\(/);
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
  assert.doesNotMatch(spec, /name: 'Edit profile'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign out'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Start trial'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Connected services'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Subscription'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /account-settings-close[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit text'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Font color'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Bold'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Italic'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /dblclick|dblClick|doubleClick/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
});
