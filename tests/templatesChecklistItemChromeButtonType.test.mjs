import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: TemplatesEditor desktop Add checklist item /
// Delete item are type=button. 390 siblings already typed.
// Live proof: debug/scenarios/e2e-templates-checklist-item-chrome-button-type.spec.mjs
// Distinct from leftover-18 / Templates More trigger type /
// Templates More menu name / Documents More menuitem type-null /
// Projects More type / Survey toolbar category chips type.
// Add checklist item apply / Delete item apply stay parked.
// Do not replay More trigger type. Do not type MoreMenu menuitems.
// Do not open Edit-modules.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Templates desktop checklist Add / Delete item are type=button; apply stays parked', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const deleteStart = editor.indexOf('title="Delete item" aria-label="Delete item"');
  assert.ok(deleteStart > 0, 'desktop Delete item');
  assert.match(editor.slice(Math.max(0, deleteStart - 220), deleteStart + 40), /<button\s+type="button"/);

  const addStart = editor.indexOf("onClick={() => addItem(i)}");
  assert.ok(addStart > 0, 'desktop Add checklist item');
  assert.match(editor.slice(Math.max(0, addStart - 220), addStart + 40), /<button\s+type="button"/);
  assert.match(editor, /<span style=\{\{ fontSize: 13 \}\}>\+<\/span> Add checklist item/);

  assert.match(
    editor,
    /<button type="button" title="Delete item" aria-label="Delete item" onClick=\{\(e\) => \{ e\.stopPropagation\(\); deleteItem\(ci, it\.id\); \}\}>/,
  );
  assert.match(
    editor,
    /<button type="button" className="templates-mobile-add-line" onClick=\{\(\) => addItem\(ci\)\}>\+ Add checklist item<\/button>/,
  );

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
  assert.match(search, /aria-label="Search text in PDF"/);
  assert.match(tree, /title="More" aria-label="More"/);
  const moreButtons = [...editor.matchAll(/<button[\s\S]{0,900}title="More"/g)].map((row) => row[0]);
  assert.equal(moreButtons.length, 4);
  for (const tag of moreButtons) {
    assert.match(tag, /type="button"/);
  }
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
});

test('live spec covers Templates checklist chrome type intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-templates-checklist-item-chrome-button-type.spec.mjs');
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /hubPreview=1&empty=1/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /Security Walk-Through/);
  assert.match(spec, /Cameras/);
  assert.match(spec, /Is the camera installed\?/);
  assert.match(spec, /Add checklist item/);
  assert.match(spec, /Delete item/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /closest\('form'\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /templates-mobile-category-toggle/);
  assert.match(spec, /templates-mobile-detail/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add checklist item'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Duplicate'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Move\/Copy'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Rename'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New template'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign out'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create space'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Walls'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
});
