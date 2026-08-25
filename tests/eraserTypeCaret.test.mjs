import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Eraser Type caret is type=button, sibling of
// Partial erase (not a nested nameless div). Live proof:
// debug/scenarios/e2e-eraser-type-caret.spec.mjs
// Distinct from leftover-18 / Eraser Type menuitem / Selection
// mode caret / Highlighter caret / Counter caret.
// Do not click Partial erase / Full stroke erase menuitem apply.
// Do not apply Eraser create / Pen / Highlighter. Do not stamp file.id.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Eraser Type caret is type=button; apply stays parked', () => {
  const src = read('src/PDFViewer.jsx');
  const start = src.indexOf('data-eraser-caret-button={isEraser ? \'true\' : undefined}');
  const end = src.indexOf('data-eraser-caret-popup={isEraser ? \'true\' : undefined}');
  assert.ok(start > 0 && end > start);
  const slice = src.slice(start - 120, end);
  assert.match(slice, /<button\s+type="button"/);
  assert.match(slice, /aria-label=\{isHighlighterSplitMenu \? 'SurveyMarker Type' : 'Eraser Type'\}/);
  assert.doesNotMatch(slice, /role="button"/);
  assert.match(
    src.slice(src.indexOf("aria-label={isHighlighter ? 'Highlighter'"), start),
    /<\/button>/,
  );
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);
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
  assert.match(screen, /\{sortHeaderButton\('name', 'Name'/);
  assert.match(read('src/AppShell.jsx'), /<button\s+type="button"\s+data-select-mode-caret="true"/);
  assert.match(team, /<span onClick=\{\(\) => click\("file"\)\}/);
  assert.match(team, /<span onClick=\{\(\) => click\("edited"\)\}/);
});

test('live Eraser Type caret spec exists and parks apply', () => {
  const spec = read('debug/scenarios/e2e-eraser-type-caret.spec.mjs');
  assert.match(spec, /Eraser Type caret is a button; Tab reaches it; Escape does not apply/);
  assert.match(spec, /Eraser Type caret break \+ edge; leftover-18 skipped/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /hubPreview=1&empty=1/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /getByRole\('button', \{ name: 'Eraser Type', exact: true \}\)/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /keyboard\.press\('Enter'\)/);
  assert.match(spec, /keyboard\.press\('Tab'\)/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /name: \/\^Partial erase\/[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: \/\^Full stroke erase\/[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pen'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Highlighter'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Change role'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'View activity'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
});
