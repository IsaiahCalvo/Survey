import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: AuthModal Close is type=button.
// Live proof: debug/scenarios/e2e-auth-modal-close-button-type.spec.mjs
// Distinct from leftover-18 A-01 Sign in apply / Manage Team search
// field name / Account Settings Connect type / Settings Close type /
// AccessManagement Close type. Do not click Sign in / Create account /
// Continue with Google / Send reset / Continue without an account.
// Close / Escape dismiss only. Do not stamp file.id.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('AuthModal Close is type=button; Sign in apply stays parked', () => {
  const auth = read('src/components/AuthModal.jsx');
  assert.match(
    auth,
    /<button type="button" className="auth-modal-close" onClick=\{handleClose\} aria-label="Close">/,
  );
  assert.equal(
    (auth.match(/<button type="button" className="auth-modal-close" onClick=\{handleClose\} aria-label="Close">/g) || []).length,
    1,
  );
  assert.doesNotMatch(
    auth,
    /<button className="auth-modal-close" onClick=\{handleClose\} aria-label="Close">/,
  );
  assert.match(auth, /aria-labelledby="auth-modal-title"/);
  assert.match(auth, /useFocusTrap\(modalRef, isOpen, \{ onEscape: handleClose \}\)/);
  assert.match(auth, /type="submit"/);
  assert.doesNotMatch(auth, /pageSize\.width \* .*scale|pageSize \* scale/);
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
  assert.match(settings, /<button type="button" className="account-settings-close" onClick=\{onClose\} aria-label="Close">/);
  assert.match(create, /aria-labelledby="create-category-modal-title"/);
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);
  assert.match(access, /aria-labelledby="access-management-modal-title"/);
  assert.match(editor, /aria-labelledby="templates-module-edit-title"/);
  assert.match(bookmarks, /aria-label="Add bookmark"/);
  assert.match(bookmarks, /aria-label="Drag to reorder"/);
  assert.match(search, /aria-label="Search text in PDF"/);
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
  assert.match(team.slice(team.indexOf('/* ============ Manage Team modal ============ */')), /aria-label="Find a teammate"/);
  assert.match(team.slice(team.indexOf('/* ============ Manage Team modal ============ */')), /<button type="button" data-manage-team-edit /);
  assert.match(tree, /title="Click to rename"[\s\S]{0,80}aria-label="Click to rename"|aria-label="Click to rename"[\s\S]{0,80}title="Click to rename"/);
  assert.match(read('src/reorder/DragRearrangeHandle.jsx'), /aria-label=\{title\}/);
  assert.match(editor, /aria-label=\{open \? 'Collapse' : 'Expand'\}/);
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
  assert.match(read('src/home/CreateProjectModal.jsx'), /aria-label="Create project"/);
  assert.match(read('src/home/CreateProjectModal.jsx'), /title="Close"/);
});

test('live spec covers AuthModal Close type intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-auth-modal-close-button-type.spec.mjs');
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /hubPreview=1&empty=1&guest=1/);
  assert.match(spec, /hubPreview=1&guest=1&tab=projects/);
  assert.match(spec, /name: 'Sign in'/);
  assert.match(spec, /Open account menu' \}\)\.count\(\)\)\.toBe\(0\)/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /auth-modal-close|name: 'Close'/);
  assert.match(spec, /Welcome back/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /toHaveAttribute\('aria-label', 'Close'\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /Find a teammate/);
  assert.match(spec, /Search text in PDF/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /dragTo\(|manualDrag|dispatchEvent\(new MouseEvent\('drag/);
  assert.doesNotMatch(spec, /name: 'Sign in'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create an account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Continue with Google'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Continue without an account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Forgot password'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Connect'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Send'[^\n]*\.click\(/);
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
  assert.doesNotMatch(spec, /name: 'Close preview'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'All'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'None'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit profile'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign out'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Subscription'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Manage team'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
  assert.doesNotMatch(spec, /dblclick|dblClick|doubleClick/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /\.fill\(/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /auth-modal-close[^\n]*\.click\(/);
});
