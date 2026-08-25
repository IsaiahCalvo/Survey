import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Documents desktop File / Project / Last edited /
// Size sort headers are type=button. Live proof:
// debug/scenarios/e2e-documents-desktop-sort-headers.spec.mjs
// Distinct from leftover-18 / 390 MobileRailNav Escape / Documents
// mobile sort menu name / Documents More. Do not click Upload /
// Share / Open file / Select / Restore. Do not stamp file.id.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Documents desktop sort headers are type=button; apply stays parked', () => {
  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /const sortHeaderButton = \(key, label, extra = \{\}\) => \(/);
  assert.match(ledger, /<button\s+type="button"\s+onClick=\{\(\) => onHeaderClick\(key\)\}/);
  assert.match(ledger, /\{sortHeaderButton\('name', 'File'/);
  assert.match(ledger, /\{sortHeaderButton\('project', 'Project'\)\}/);
  assert.match(ledger, /\{sortHeaderButton\('edited', 'Last edited'\)\}/);
  assert.match(ledger, /\{sortHeaderButton\('size', 'Size'\)\}/);
  assert.doesNotMatch(
    ledger,
    /<span onClick=\{\(\) => onHeaderClick\('name'\)\}/,
  );
  assert.doesNotMatch(
    ledger,
    /<span onClick=\{\(\) => onHeaderClick\('project'\)\}/,
  );
  assert.doesNotMatch(
    ledger,
    /<span onClick=\{\(\) => onHeaderClick\('edited'\)\}/,
  );
  assert.doesNotMatch(
    ledger,
    /<span onClick=\{\(\) => onHeaderClick\('size'\)\}/,
  );
  assert.doesNotMatch(ledger, /pageSize\.width \* .*scale|pageSize \* scale/);
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

test('live Documents desktop sort header spec exists and parks apply', () => {
  const spec = read('debug/scenarios/e2e-documents-desktop-sort-headers.spec.mjs');
  assert.match(spec, /Documents desktop sort headers are buttons; File sorts; Escape does not apply/);
  assert.match(spec, /Documents desktop sort headers break \+ edge; leftover-18 skipped/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /hubPreview=1&empty=1/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /getByRole\('button', \{ name: \/\^File\/i \}\)/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /keyboard\.press\('Enter'\)/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
});
