import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Add bookmarks to group is named via the visible title
// and Escape dismisses. Live proof:
// debug/scenarios/e2e-add-bookmarks-to-group-dialog-name.spec.mjs
// Distinct from leftover-18 / nameless-menu / unnamed-dialog family
// already proved / V-07 Create group apply / Add bookmarks apply /
// Activity / Create bookmark group name.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Add bookmarks to group dialog is labelled by the visible title; Escape wired', () => {
  const src = read('src/sidebar/BookmarksPanel.jsx');
  const start = src.indexOf('{/* Add Bookmarks to Existing Group Modal */}');
  assert.ok(start >= 0);
  const slice = src.slice(start);
  assert.match(slice, /role="dialog"/);
  assert.match(slice, /aria-modal="true"/);
  assert.match(slice, /aria-labelledby="add-bookmarks-to-group-title"/);
  assert.match(slice, /id="add-bookmarks-to-group-title"/);
  assert.match(slice, /Add bookmarks to group/);
  assert.match(slice, /aria-label="Close"/);
  assert.match(slice, /onClick=\{closeAddToGroupModal\}/);
  assert.match(src, /useFocusTrap\(addToGroupDialogRef, showAddToGroupModal, \{ onEscape: closeAddToGroupModal \}\)/);
  assert.match(src, /onClick=\{\(\) => handleOpenAddToGroup\(null\)\}/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);

  const createStart = src.indexOf('{/* Bookmark Group Creation Modal */}');
  const createEnd = src.indexOf('{/* Add Bookmarks to Existing Group Modal */}');
  assert.match(src.slice(createStart, createEnd), /aria-labelledby="create-bookmark-group-title"/);

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
  const confirmStart = confirm.indexOf('export function ConfirmModal');
  const confirmEnd = confirm.indexOf('export function RenameModal');
  assert.match(confirm.slice(confirmStart, confirmEnd), /aria-labelledby="confirm-modal-title"/);
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(create, /aria-labelledby="create-category-modal-title"/);
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);
  assert.match(access, /aria-labelledby="access-management-modal-title"/);
  assert.match(editor, /aria-labelledby="templates-module-edit-title"/);
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
});

test('live spec covers named Add bookmarks to group intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-add-bookmarks-to-group-dialog-name.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Add bookmarks to group', exact: true \}\)/);
  assert.match(spec, /add-bookmarks-to-group-title/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Create group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add bookmarks'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'CSV'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'PDF Pages'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open linked'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pin project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
});
