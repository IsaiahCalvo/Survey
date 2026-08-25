import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: 390 hub MobileRailNav dismisses on Escape.
// Live proof: debug/scenarios/e2e-mobile-rail-nav-escape.spec.mjs
// Distinct from leftover-18 / Invite accept type / AuthModal Close
// type / profile menu Escape / Archive filter Escape.
// Do not click Documents / Projects / Templates / Archive apply
// inside the drawer. Do not stamp file.id.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('MobileRailNav listens for Escape and closes; nav apply stays parked', () => {
  const shell = read('src/home/HubShell.jsx');
  const start = shell.indexOf('const MobileRailNav');
  const end = shell.indexOf('export const HubShell');
  assert.ok(start > 0 && end > start, 'MobileRailNav slice');
  const rail = shell.slice(start, end);
  assert.match(rail, /aria-label="Open navigation"/);
  assert.match(rail, /aria-label="Mobile navigation"/);
  assert.match(rail, /if \(!open\) return undefined;/);
  assert.match(rail, /if \(event\.key !== 'Escape'\) return;/);
  assert.match(rail, /setOpen\(false\)/);
  assert.match(rail, /document\.addEventListener\('keydown', onKeyDown\)/);
  assert.match(rail, /document\.removeEventListener\('keydown', onKeyDown\)/);
  assert.doesNotMatch(rail, /pageSize\.width \* .*scale|pageSize \* scale/);
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
  const share = read('src/home/ShareModal.jsx');
  const team = read('src/home/ManageTeamModal.jsx');
  const tree = read('src/home/ProjectsFolderTree.jsx');
  const auth = read('src/components/AuthModal.jsx');
  const invite = read('src/home/InviteAcceptPage.jsx');
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
  assert.match(share, /aria-label="Permission"/);
  assert.match(share, /aria-label="Invite by email"/);
  const inviteStart = team.indexOf('/* ============ Invite User sub-modal (REAL) ============');
  const inviteEnd = team.indexOf('/* ============ Manage Team modal ============ */');
  assert.match(team.slice(inviteStart, inviteEnd), /aria-label="Share link role"/);
  assert.match(team.slice(team.indexOf('/* ============ Manage Team modal ============ */')), /aria-label="Find a teammate"/);
  assert.match(tree, /title="Click to rename"[\s\S]{0,80}aria-label="Click to rename"|aria-label="Click to rename"[\s\S]{0,80}title="Click to rename"/);
  assert.match(
    auth,
    /<button type="button" className="auth-modal-close" onClick=\{handleClose\} aria-label="Close">/,
  );
  assert.match(
    invite,
    /<button type="button" onClick=\{signIn\} style=\{btnPrimary\(accent\)\}>Sign in to continue<\/button>/,
  );
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
  assert.match(read('src/home/CreateProjectModal.jsx'), /aria-label="Create project"/);
});

test('live spec covers 390 hub rail nav Escape intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-mobile-rail-nav-escape.spec.mjs');
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /mobileNav=tabs/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /\/invite\/leftover-type-probe/);
  assert.match(spec, /reset-password/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /Open navigation/);
  assert.match(spec, /Mobile navigation/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /hub-tab-documents/);
  assert.match(spec, /Sign in to continue/);
  assert.match(spec, /Search text in PDF/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /dragTo\(|manualDrag|dispatchEvent\(new MouseEvent\('drag/);
  assert.doesNotMatch(spec, /name: 'Documents'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Projects'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Templates'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Archive'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign in'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign in to continue'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Continue with Google'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Continue without an account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Back to Survey'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Send'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Select'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign out'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Subscription'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
  assert.doesNotMatch(spec, /dblclick|dblClick|doubleClick/);
  assert.doesNotMatch(spec, /\.fill\(/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
});
