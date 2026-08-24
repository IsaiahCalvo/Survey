import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Account Settings sidebar tabs are type=button.
// Live proof: debug/scenarios/e2e-account-settings-sidebar-tabs-button-type.spec.mjs
// Distinct from leftover-18 / nameless-menu / unnamed-dialog family
// already proved / Settings dialog name / Account Settings Close
// type / Projects desktop file Select type / Projects 390 file
// Select type / Projects desktop Select type / Projects 390
// Select type / Documents Select type / Archive Select type /
// Archive Close preview type / Documents Preview Share type /
// Documents Preview Open file type / Documents Close preview
// type / Documents Upload type / Manage team type / Category
// drag-title type / Entity Select type / Template-list Select
// type / Category Select type / Module Select type / New module
// name / New module type / Module count chrome / Category drag
// titles name / Edit color type / New entity type / New category
// type / Entity name / New template type / Templates Expand /
// Templates Click to rename / Drag to rearrange / Invite-open
// Edit type / Share-open hub chrome type.
// Edit profile / Start trial / Connect Microsoft / Manage billing /
// Delete account / Select apply / Restore / Delete forever / Close
// preview apply / Open file apply / Share apply / Upload apply stay
// parked.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Account Settings sidebar tabs are type=button; apply stays parked', () => {
  const settings = read('src/components/AccountSettings.jsx');
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
    /<button type="button" className="account-settings-close" onClick=\{onClose\} aria-label="Close">/,
  );
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /<button\s+type="button"[\s\S]{0,80}aria-label="Close"/);
  const share = read('src/home/ShareModal.jsx');
  assert.match(share, /title="Close" aria-label="Close"/);
  const tree = read('src/home/ProjectsFolderTree.jsx');
  assert.match(
    tree,
    /<button\s+type="button"\s+onClick=\{\(\) => \{\s+const next = !fileSelect; setFileSelect\(next\); if \(!next\) setSelFiles\(new Set\(\)\); \}\}\s+style=\{miniSelectButtonStyle\(\)\}/,
  );
  assert.doesNotMatch(settings, /pageSize\.width \* .*scale|pageSize \* scale/);
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
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(create, /aria-labelledby="create-category-modal-title"/);
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
  assert.match(tree, /title="Tap to rename"[\s\S]{0,80}aria-label="Tap to rename"|aria-label="Tap to rename"[\s\S]{0,80}title="Tap to rename"/);
  assert.match(
    tree,
    /<button type="button" className="btn" onClick=\{\(\) => setTeamModalProject\(open\)\}><Icon name="users" size=\{12\} \/>Manage team<\/button>/,
  );
  assert.match(read('src/reorder/DragRearrangeHandle.jsx'), /aria-label=\{title\}/);
  assert.match(editor, /aria-label=\{open \? 'Collapse' : 'Expand'\}/);
  assert.match(editor, /<button\s+type="button"\s+onClick=\{\(\) => onOpen\(index\)\}/);
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
});

test('live spec covers Account Settings sidebar tab type intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-account-settings-sidebar-tabs-button-type.spec.mjs');
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /hubPreview=1&empty=1/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /name: 'Sign in'/);
  assert.match(spec, /Open account menu' \}\)\.count\(\)\)\.toBe\(0\)/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /account-sidebar-btn/);
  assert.match(spec, /name: 'Settings'/);
  assert.match(spec, /Open account menu/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /'General'/);
  assert.match(spec, /'Connected services'/);
  assert.match(spec, /'Subscription'/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /Profile information/);
  assert.match(spec, /Start trial\|Manage billing\|Checkout/);
  assert.match(spec, /Connect Microsoft\|Sign in with Microsoft/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /dragTo\(|manualDrag|dispatchEvent\(new MouseEvent\('drag/);
  assert.doesNotMatch(spec, /name: 'New category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New entity'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New module'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit color'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Select'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Send viewer invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Copy link'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New template'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload PDF'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Close preview'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'All'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'None'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pin project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit profile'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add bookmarks'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create bookmark'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'CSV'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'PDF Pages'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open linked'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Click to rename'[^\n]*\.fill\(/);
  assert.doesNotMatch(spec, /name: 'Tap to rename'[^\n]*\.fill\(/);
  assert.doesNotMatch(spec, /name: 'Manage team'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /documents-desktop-upload[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
  assert.doesNotMatch(spec, /dblclick|dblClick|doubleClick/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
  assert.doesNotMatch(spec, /account-settings-close[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /setActiveTab\('connected-services'\)[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Connected services'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Subscription'[^\n]*\.click\(/);
});
