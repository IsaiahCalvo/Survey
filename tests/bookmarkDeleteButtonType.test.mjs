import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Bookmarks edit-mode Delete bookmark / Delete group
// is type=button. Live proof:
// debug/scenarios/e2e-bookmark-delete-button-type.spec.mjs
// Distinct from leftover-18 / nameless-menu / unnamed-dialog family
// already proved / Create bookmark group / Add bookmarks to group /
// Add bookmark dialogs / Expand group / Add bookmark to group type /
// Bookmarks Edit / Done type / CreateCategoryModal type / Draw /
// Shapes / Text sub-toolbar type / Edit text type / Zoom/page-nav
// type / Export/Draw/Shapes/Text category type / Undo/Redo type.
// Opening Edit is setup only. Do not click Delete bookmark / Delete
// group. Dismiss with Escape / Done. Do not create a bookmark group.
// Do not apply Add bookmark. Font color / Bold / Italic stay behind
// richTextEditor.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Bookmarks edit-mode Delete is type=button; delete apply stays parked', () => {
  const panel = read('src/sidebar/BookmarksPanel.jsx');
  const desktopDelete = panel.indexOf("aria-label={isFolder ? `Delete group ${item.name}` : `Delete bookmark ${item.name}`}");
  assert.ok(desktopDelete > 0, 'desktop Delete aria-label');
  const desktop = panel.slice(Math.max(0, desktopDelete - 400), desktopDelete + 80);
  assert.match(desktop, /{isEditMode && !isClone && \(/);
  assert.match(desktop, /<button\s+type="button"/);
  assert.match(desktop, /onDelete\?\.\(item\.id\)/);
  assert.doesNotMatch(
    desktop,
    /<button\s+onClick=\{\(event\) => \{/,
  );

  const mobileDelete = panel.lastIndexOf("aria-label={isFolder ? `Delete group ${item.name}` : `Delete bookmark ${item.name}`}");
  assert.ok(mobileDelete > desktopDelete, 'mobile Delete aria-label');
  const mobile = panel.slice(Math.max(0, mobileDelete - 280), mobileDelete + 40);
  assert.match(mobile, /<button\s+type="button"/);
  assert.match(mobile, /className="mobile-bookmark-move mobile-bookmark-delete"/);

  assert.match(panel, /\{isEditMode \? 'Done' : 'Edit'\}/);
  assert.match(panel, /aria-label="Add bookmark"/);
  assert.match(panel, /aria-labelledby="create-bookmark-group-title"/);
  assert.match(panel, /useFocusTrap\(createGroupDialogRef, showBookmarkGroupModal, \{ onEscape: closeCreateGroupModal \}\)/);
  assert.doesNotMatch(panel, /pageSize\.width \* .*scale|pageSize \* scale/);
  assert.doesNotMatch(panel, /create-checkout-session|Turnstile|msalInstance/);
  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('sibling compile-visible dialogs stay named; PromptModal lock stays gated', () => {
  const confirm = read('src/home/BulkModals.jsx');
  const settings = read('src/components/AccountSettings.jsx');
  const create = read('src/components/CreateCategoryModal.jsx');
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  const access = read('src/home/AccessManagementModal.jsx');
  const editor = read('src/home/TemplatesEditor.jsx');
  const prompt = read('src/components/dialogPrompts.jsx');
  const bookmarks = read('src/sidebar/BookmarksPanel.jsx');
  const search = read('src/sidebar/SearchTextPanel.jsx');
  const picker = read('src/components/CompactColorPicker.jsx');
  const size = read('src/components/AnnotationSizeControl.jsx');
  const dropdown = read('src/components/AnnotationDropdown.jsx');
  const share = read('src/home/ShareModal.jsx');
  const team = read('src/home/ManageTeamModal.jsx');
  const tree = read('src/home/ProjectsFolderTree.jsx');
  const confirmStart = confirm.indexOf('export function ConfirmModal');
  const confirmEnd = confirm.indexOf('export function RenameModal');
  assert.match(confirm.slice(confirmStart, confirmEnd), /aria-labelledby="confirm-modal-title"/);
  assert.match(
    confirm.slice(confirmStart, confirmEnd),
    /<button type="button" disabled=\{submitting\} onClick=\{onClose\} title="Close" aria-label="Close"/,
  );
  const renameStart = confirm.indexOf('export function RenameModal');
  assert.match(confirm.slice(renameStart), /<button type="button" onClick=\{onClose\} style=\{\{ minHeight: 44, background: 'transparent'/);
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(create, /aria-labelledby="create-category-modal-title"/);
  assert.match(create, /<button\s+type="button"\s+onClick=\{onClose\}/);
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);
  assert.match(access, /aria-labelledby="access-management-modal-title"/);
  assert.match(editor, /aria-labelledby="templates-module-edit-title"/);
  assert.match(bookmarks, /aria-label="Add bookmark"/);
  assert.match(search, /aria-label="Clear search"/);
  assert.match(picker, /aria-label="Color"/);
  assert.match(picker, /aria-label="Opacity"/);
  assert.match(size, /aria-label=\{label\}/);
  assert.match(dropdown, /aria-label=\{label\}/);
  assert.match(share, /aria-label="Permission"/);
  assert.match(share, /aria-label="Invite by email"/);
  const inviteStart = team.indexOf('/* ============ Invite User sub-modal (REAL) ============');
  const inviteEnd = team.indexOf('/* ============ Manage Team modal ============ */');
  assert.match(team.slice(inviteStart, inviteEnd), /aria-label="Share link role"/);
  assert.match(team.slice(inviteStart, inviteEnd), /aria-label="Invite by email role"/);
  assert.match(team.slice(team.indexOf('/* ============ Manage Team modal ============ */')), /<button type="button" data-manage-team-edit /);
  assert.match(tree, /title="Click to rename"[\s\S]{0,80}aria-label="Click to rename"|aria-label="Click to rename"[\s\S]{0,80}title="Click to rename"/);
  assert.match(read('src/reorder/DragRearrangeHandle.jsx'), /aria-label=\{title\}/);
  assert.match(editor, /aria-label=\{open \? 'Collapse' : 'Expand'\}/);
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
  assert.match(read('src/home/CreateProjectModal.jsx'), /aria-label="Create project"/);
  assert.match(read('src/home/CreateProjectModal.jsx'), /title="Close"/);
});

test('live spec covers Delete type intended + break + edge; skip leftover-18 and delete apply', () => {
  const spec = read('debug/scenarios/e2e-bookmark-delete-button-type.spec.mjs');
  assert.match(spec, /Package%202%20-%20Rev%204%20--%20IC\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=se011\.pdf/);
  assert.match(spec, /name: 'Edit'/);
  assert.match(spec, /name: 'Done'/);
  assert.match(spec, /Delete \(group\|bookmark\)/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /accname/);
  assert.match(spec, /closest\('form'\)/);
  assert.match(spec, /implicit/);
  assert.match(spec, /390/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /Open pages, search, and bookmarks/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Add bookmark to group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New bookmark group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create bookmark group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add bookmarks'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create bookmark'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Save'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Select'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'All'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'None'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Close preview'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New entity'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New module'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit color'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Send viewer invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Copy link'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New template'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit profile'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign out'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Subscription'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Manage team'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Lock document'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Get link to project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Font color'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Bold'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Italic'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete bookmark'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /\/\^Delete \(group\|bookmark\) \/[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /window\.confirm/);
  assert.doesNotMatch(spec, /fill\(/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
  assert.doesNotMatch(spec, /dragTo\(|manualDrag|dispatchEvent\(new MouseEvent\('drag/);
  assert.doesNotMatch(spec, /dblclick|dblClick|doubleClick/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
});
