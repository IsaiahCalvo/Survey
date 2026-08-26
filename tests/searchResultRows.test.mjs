import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Search result rows are role=button
// with tabIndex=0 + Jump to match aria-label. Live proof:
// debug/scenarios/e2e-search-result-rows.spec.mjs
// Distinct from leftover-18 / Templates desktop template rows /
// Projects desktop project rows / Documents desktop rows /
// Search Previous/Next type / Search Clear / Search field name /
// Bookmarks desktop rows / Projects file rows (Open file) /
// Activity File / Edited / MoveCopy Close/Cancel/Confirm.
// Filling a query is setup only. Do not apply Export / save.
// Do not stamp file.id.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Search result rows are role=button; apply stays parked', () => {
  const search = read('src/sidebar/SearchTextPanel.jsx');
  const start = search.indexOf('const SearchResultRow = memo(function SearchResultRow');
  const end = search.indexOf('const SearchTextPanel = ({');
  assert.ok(start > 0 && end > start);
  const slice = search.slice(start, end);
  assert.match(slice, /role="button"/);
  assert.match(slice, /tabIndex=\{0\}/);
  assert.match(slice, /aria-label=\{`Jump to match \$\{index \+ 1\} on page \$\{result\.pageNumber\}`\}/);
  assert.match(slice, /onClick=\{\(\) => onSelect\(result, index\)\}/);
  assert.match(slice, /onKeyDown=\{\(e\) => \{/);
  assert.match(slice, /if \(e\.key !== 'Enter' && e\.key !== ' '\) return;/);
  assert.match(slice, /onSelect\(result, index\)/);
  assert.match(search, /aria-label="Search text in PDF"/);
  assert.match(search, /aria-label="Clear search"/);
  assert.match(search, /aria-label="Previous match \(Shift\+Enter\)"/);
  assert.match(search, /aria-label="Next match \(Enter\)"/);
  assert.doesNotMatch(search, /pageSize\.width \* .*scale|pageSize \* scale/);
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
  const screen = read('src/home/ArchiveScreen.jsx');
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
  const rowStart = ledger.indexOf('{docs.map((d) => {');
  const rowEnd = ledger.indexOf('className="documents-mobile-list');
  assert.match(ledger.slice(rowStart, rowEnd), /aria-label=\{`Preview \$\{d\.name\}`\}/);
  assert.match(screen, /\{sortHeaderButton\('name', 'Name'/);
  assert.match(read('src/AppShell.jsx'), /<button\s+type="button"\s+data-select-mode-caret="true"/);
  assert.match(team, /<span onClick=\{\(\) => click\("file"\)\}/);
  assert.match(team, /<span onClick=\{\(\) => click\("edited"\)\}/);
  const leftStart = tree.indexOf('{/* LEFT — tree */}');
  const leftEnd = tree.indexOf('{/* RIGHT — open project */}');
  assert.match(tree.slice(leftStart, leftEnd), /aria-label=\{`Open project \$\{p\.name\}`\}/);
  const tplStart = editor.indexOf('{/* ---------- LEFT: Templates ---------- */}');
  const tplEnd = editor.indexOf('{/* ---------- MIDDLE: Modules + expandable category checklists ---------- */}');
  assert.match(editor.slice(tplStart, tplEnd), /aria-label=\{`Open template \$\{t\.name\}`\}/);
  const bookmarkRow = bookmarks.indexOf('data-bookmark-row-id={isClone ? undefined : item.id}');
  assert.ok(bookmarkRow > 0);
  assert.doesNotMatch(bookmarks.slice(bookmarkRow, bookmarkRow + 900), /Jump to match/);
});

test('live Search result rows spec exists and parks apply', () => {
  const spec = read('debug/scenarios/e2e-search-result-rows.spec.mjs');
  assert.match(spec, /Search result rows are buttons; Tab reaches them; Enter jumps/);
  assert.match(spec, /Search result rows break \+ edge; leftover-18 skipped/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1&empty=1/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /getByRole\('button', \{ name: \/\^Jump to match \//);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /keyboard\.press\('Enter'\)/);
  assert.match(spec, /keyboard\.press\('Tab'\)/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Previous match[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Next match[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Export'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add bookmark'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create bookmark group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
});
