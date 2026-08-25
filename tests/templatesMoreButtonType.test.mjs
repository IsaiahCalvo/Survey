import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: TemplatesEditor list / entity / 390 list More
// triggers are type=button.
// Live proof: debug/scenarios/e2e-templates-more-button-type.spec.mjs
// Distinct from leftover-18 / Templates More menu name /
// Documents More menuitem type-null / Projects More type /
// Survey toolbar category chips type / Manage Team Edit type.
// New template / Share / Delete / Duplicate / Move/Copy / Rename
// apply stay parked. Do not replay menu name. Do not type
// MoreMenu menuitems.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Templates More triggers are type=button; menuitem apply stays parked', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const moreButtons = [...editor.matchAll(/<button[\s\S]{0,900}title="More"/g)].map((row) => row[0]);
  assert.equal(moreButtons.length, 4, 'desktop list + desktop entity + 390 list + 390 entity More triggers');
  for (const tag of moreButtons) {
    assert.match(tag, /type="button"/);
  }
  assert.equal((editor.match(/title="More"/g) || []).length, 4);
  assert.equal(
    editor.match(/<button(?![^>]*type="button")[^>]*title="More"/),
    null,
  );
  assert.equal(
    editor.match(/<button(?![^>]*type="button")[\s\S]{0,900}title="More"/),
    null,
  );
  assert.match(editor, /title="More" aria-label="More"/);
  const menuStart = editor.indexOf('function MoreMenu');
  const menuSlice = editor.slice(menuStart, menuStart + 1800);
  assert.match(menuSlice, /aria-label=\{ariaLabel\}/);
  assert.match(menuSlice, /role="menuitem"/);
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
  const moreButtons = [...tree.matchAll(/<button[\s\S]{0,800}title="More"/g)].map((row) => row[0]);
  for (const tag of moreButtons) {
    assert.match(tag, /type="button"/);
  }
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
});

test('live spec covers Templates More type intended + break + edge; skip leftover-18 and menuitem apply', () => {
  const spec = read('debug/scenarios/e2e-templates-more-button-type.spec.mjs');
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /hubPreview=1&empty=1/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /Security Walk-Through/);
  assert.match(spec, /name: 'More'/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /toHaveAttribute\('title', 'More'\)/);
  assert.match(spec, /accname/);
  assert.match(spec, /closest\('form'\)/);
  assert.match(spec, /\$\{TEMPLATE\} actions/);
  assert.match(spec, /\$\{ENTITY\} actions/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /desktopEntityMore/);
  assert.match(spec, /mobileTemplateMore/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete'[^\n]*\.click\(/);
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
