import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Templates desktop Template-list Select is type=button.
// Live proof: debug/scenarios/e2e-template-list-select-button-type.spec.mjs
// Distinct from leftover-18 / nameless-menu / unnamed-dialog family
// already proved / Category Select type / Module Select type / New
// module name / New module type / Module count chrome / Category
// drag titles / Edit color type / New entity type / New category
// type / Entity name / New template type / Templates Expand /
// Templates Click to rename / Drag to rearrange / Invite-open
// Edit type / Share-open hub chrome type. Select apply / Edit
// modules New module stay parked.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Template-list Select is type=button; apply stays parked', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
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
    /<p className="micro" style=\{\{ margin: 0 \}\}>Module<\/p>\s*<button\s+type="button"\s+onClick=\{\(\) => \{ setModEdit\(true\); setSelMods\(new Set\(\)\); \}\}/,
  );
  assert.match(
    editor,
    /<p className="micro" style=\{\{ margin: 0 \}\}>Categories<\/p>[\s\S]{0,280}<button\s+type="button"\s+onClick=\{\(\) => \{ const next = !catEdit;/,
  );
  assert.match(
    editor,
    /title="New module"[\s\S]{0,80}aria-label="New module"|aria-label="New module"[\s\S]{0,80}title="New module"/,
  );
  assert.match(editor, /<button\s+type="button"\s+onClick=\{addModule\}\s+title="New module"/);
  assert.match(editor, /placeholder="Entity name"[\s\S]{0,80}aria-label="Entity name"|aria-label="Entity name"[\s\S]{0,80}placeholder="Entity name"/);
  assert.equal(editor.match(/<button(?![^>]*type="button")[^>]*>[\s\S]{0,80}New entity/), null);
  assert.equal(editor.match(/<button(?![^>]*type="button")[^>]*>[\s\S]{0,80}New category/), null);
  assert.equal(editor.match(/<button(?![^>]*type="button")[^>]*>[\s\S]{0,80}New template/), null);
  assert.doesNotMatch(editor, /pageSize\.width \* .*scale|pageSize \* scale/);
  assert.doesNotMatch(editor, /create-checkout-session|Turnstile|msalInstance/);
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
  assert.match(read('src/reorder/DragRearrangeHandle.jsx'), /aria-label=\{title\}/);
  assert.match(editor, /aria-label=\{open \? 'Collapse' : 'Expand'\}/);
  assert.match(editor, /aria-label=\{showCount \? `\$\{mod\.name\} \$\{catCount\}` : mod\.name\}/);
  assert.equal(editor.match(/<button(?![^>]*type="button")[^>]*>[\s\S]{0,80}New template/), null);
  assert.equal(editor.match(/<button(?![^>]*type="button")[^>]*>[\s\S]{0,80}New category/), null);
  assert.equal(editor.match(/<button(?![^>]*type="button")[^>]*>[\s\S]{0,80}New entity/), null);
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
});

test('live spec covers Template-list Select type intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-template-list-select-button-type.spec.mjs');
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /hubPreview=1&empty=1/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /Template-list Select/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /toHaveText\('Select'\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /Entity name/);
  assert.match(spec, /New module/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'New category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New entity'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New module'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit color'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Select'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Entity name'[^\n]*\.fill\(/);
  assert.doesNotMatch(spec, /name: 'Send viewer invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Copy link'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New template'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pin project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add bookmarks'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create bookmark'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'CSV'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'PDF Pages'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open linked'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Click to rename'[^\n]*\.fill\(/);
  assert.doesNotMatch(spec, /name: 'Tap to rename'[^\n]*\.fill\(/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
});
