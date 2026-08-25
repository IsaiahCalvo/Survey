import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Archive desktop Name / Type / Archived /
// Days remaining sort headers are type=button. Live proof:
// debug/scenarios/e2e-archive-desktop-sort-headers.spec.mjs
// Distinct from leftover-18 / Documents desktop sort headers /
// 390 Archive filter menu / Archive Show documents. Do not click
// Restore / Delete forever / Permanently delete / Select. Do not
// stamp file.id.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Archive desktop sort headers are type=button; apply stays parked', () => {
  const screen = read('src/home/ArchiveScreen.jsx');
  assert.match(screen, /const sortHeaderButton = \(key, label, extra = \{\}\) => \(/);
  assert.match(screen, /<button\s+type="button"\s+onClick=\{\(\) => onHeaderClick\(key\)\}/);
  assert.match(screen, /\{sortHeaderButton\('name', 'Name'/);
  assert.match(screen, /\{sortHeaderButton\('type', 'Type'\)\}/);
  assert.match(screen, /\{sortHeaderButton\('archived', 'Archived'\)\}/);
  assert.match(screen, /\{sortHeaderButton\('days', 'Days remaining'\)\}/);
  assert.doesNotMatch(
    screen,
    /<span onClick=\{\(\) => onHeaderClick\('name'\)\}/,
  );
  assert.doesNotMatch(
    screen,
    /<span onClick=\{\(\) => onHeaderClick\('type'\)\}/,
  );
  assert.doesNotMatch(
    screen,
    /<span onClick=\{\(\) => onHeaderClick\('archived'\)\}/,
  );
  assert.doesNotMatch(
    screen,
    /<span onClick=\{\(\) => onHeaderClick\('days'\)\}/,
  );
  assert.doesNotMatch(screen, /const headerCell = /);
  assert.doesNotMatch(screen, /pageSize\.width \* .*scale|pageSize \* scale/);
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
  const ledger = read('src/home/DocumentsLedger.jsx');
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
  assert.match(ledger, /\{sortHeaderButton\('name', 'File'/);
});

test('live Archive desktop sort header spec exists and parks apply', () => {
  const spec = read('debug/scenarios/e2e-archive-desktop-sort-headers.spec.mjs');
  assert.match(spec, /Archive desktop sort headers are buttons; Name sorts; Escape does not apply/);
  assert.match(spec, /Archive desktop sort headers break \+ edge; leftover-18 skipped/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&empty=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /getByRole\('button', \{ name: \/\^Name\/i \}\)/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /keyboard\.press\('Enter'\)/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Permanently delete'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Select'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
});
