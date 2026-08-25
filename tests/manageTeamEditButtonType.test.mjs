import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: ManageTeamModal Edit-mode All / Change role /
// Copy email / Remove from team (and compile-sibling role trigger /
// options) are type=button.
// Live proof: debug/scenarios/e2e-manage-team-edit-button-type.spec.mjs
// Distinct from leftover-18 / AuthModal remaining type (already
// typed after Close) / AuthModal Close type / Manage Team search
// field name / Manage Team Invite / Done / More type / Activity
// unnamed. Do not click All / None / Change role / Copy email /
// Remove / Invite / Send / Sign in apply. Opening Edit is setup.
// Role trigger stays 0 on creator-only seed.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Manage Team Edit All / Change role / Copy email / Remove are type=button; apply stays parked', () => {
  const src = read('src/home/ManageTeamModal.jsx');
  const modalStart = src.indexOf('/* ============ Manage Team modal ============ */');
  const modal = src.slice(modalStart);
  assert.match(src, /export default function ManageTeamModal/);
  assert.match(modal, /aria-label="Manage Team"/);
  assert.match(
    modal,
    /<button type="button" title=\{title\} onClick=\{\(e\) => \{ if \(disabled\) return; e\.stopPropagation\(\); onClick\(\); \}\}/,
  );
  assert.doesNotMatch(
    modal,
    /<button title=\{title\} onClick=\{\(e\) => \{ if \(disabled\) return; e\.stopPropagation\(\); onClick\(\); \}\}/,
  );
  assert.match(
    modal,
    /<button type="button" onClick=\{\(e\) => \{ e\.stopPropagation\(\); if \(allSel\) setSelectedIds\(new Set\(\)\); else setSelectedIds\(new Set\(selectable\.map\(m => m\.id\)\)\); \}\}/,
  );
  assert.doesNotMatch(
    modal,
    /<button onClick=\{\(e\) => \{ e\.stopPropagation\(\); if \(allSel\) setSelectedIds\(new Set\(\)\); else setSelectedIds\(new Set\(selectable\.map\(m => m\.id\)\)\); \}\}/,
  );
  assert.match(modal, /<button type="button" data-kal31-role-trigger="true"/);
  assert.doesNotMatch(modal, /<button data-kal31-role-trigger="true"/);
  assert.match(modal, /<button key=\{r\} type="button" onClick=\{\(\) => setRoleBulk\(r\)\}/);
  assert.match(modal, /<button key=\{r\} type="button" data-kal31-role-option=/);
  assert.match(modal, /<button type="button" data-manage-team-edit /);
  assert.match(modal, /<button type="button" data-manage-team-invite /);
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);
  assert.doesNotMatch(src, /create-checkout-session|Turnstile|msalInstance/);
  assert.match(read('src/components/AuthModal.jsx'), /type="submit"/);
  assert.match(
    read('src/components/AuthModal.jsx'),
    /<button\s+type="button"\s+className="auth-google-btn"/,
  );
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
});

test('live spec covers Manage Team Edit type intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-manage-team-edit-button-type.spec.mjs');
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /hubPreview=1&empty=1/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /Tower 5 — Security/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Manage Team', exact: true \}\)/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /enterEdit\(dialog\)/);
  assert.match(spec, /name: 'All'/);
  assert.match(spec, /name: 'Change role'/);
  assert.match(spec, /name: 'Copy email'/);
  assert.match(spec, /name: 'Remove from team'/);
  assert.match(spec, /data-kal31-role-trigger/);
  assert.match(spec, /accname/);
  assert.match(spec, /closest\('form'\)/);
  assert.match(spec, /implicit/);
  assert.match(spec, /390/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /desktopManageTeam\(page\)\.click\(\)/);
  assert.match(spec, /mobileTeam\.click\(\)/);
  assert.match(spec, /data-manage-team-edit/);
  assert.match(spec, /Welcome back/);
  assert.match(spec, /Continue with Google/);
  assert.match(spec, /Forgot password\?/);
  assert.match(spec, /Continue without an account/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'All'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'None'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Change role'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Copy email'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Remove from team'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Send'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign in'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Continue with Google'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Continue without an account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Forgot password'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Select'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit profile'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign out'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Subscription'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'View activity'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
  assert.doesNotMatch(spec, /dragTo\(|manualDrag|dispatchEvent\(new MouseEvent\('drag/);
  assert.doesNotMatch(spec, /dblclick|dblClick|doubleClick/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
});
