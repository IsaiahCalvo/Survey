import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: TemplatesEditor 390 category title inputs are
// named title + aria-label="Tap to rename" (desktop sibling stays
// Click to rename). Live proof:
// debug/scenarios/e2e-templates-390-category-title-name.spec.mjs
// Distinct from leftover-18 / Templates checklist item field
// name / desktop Templates Click to rename / Projects Tap to
// rename / Templates checklist chrome type / Templates entity
// color layer type / Templates More trigger type / Templates
// More menu name. Rename apply stays parked. Do not replay
// checklist item field name. Do not type MoreMenu menuitems.
// Do not open Edit-modules.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('390 Templates category titles are named Tap to rename; desktop sibling stays Click to rename', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const mobile = editor.indexOf('data-mobile-category-id={c.id}');
  assert.ok(mobile > 0, '390 category title input');
  const mobileSlice = editor.slice(mobile, mobile + 280);
  assert.match(mobileSlice, /title="Tap to rename"/);
  assert.match(mobileSlice, /aria-label="Tap to rename"/);
  assert.doesNotMatch(mobileSlice, /placeholder=/);

  const desktop = editor.indexOf('className="inline-edit cat-title"\n                          defaultValue={c.name}');
  assert.ok(desktop > 0, 'desktop category title input');
  const desktopSlice = editor.slice(desktop, desktop + 280);
  assert.match(desktopSlice, /title="Click to rename"/);
  assert.match(desktopSlice, /aria-label="Click to rename"/);

  const mobileTpl = editor.indexOf('data-template-title=""\n                    title="Tap to rename"');
  assert.ok(mobileTpl > 0, '390 template title already Tap to rename');

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
  const layerStart = editor.indexOf("{[['fill', 'Fill'], ['border', 'Border']].map(([k, label], i) => (");
  assert.ok(layerStart > 0, 'desktop Fill / Border map');
  assert.match(editor.slice(layerStart, layerStart + 420), /<button\s+key=\{k\}\s+type="button"/);
  assert.match(editor, /placeholder="Add checklist item"[\s\S]{0,80}aria-label="Checklist item"|aria-label="Checklist item"[\s\S]{0,80}placeholder="Add checklist item"/);
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
});

test('live spec covers 390 Templates category title name intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-templates-390-category-title-name.spec.mjs');
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /hubPreview=1&empty=1/);
  assert.match(spec, /templates-mobile-browser/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /Security Walk-Through/);
  assert.match(spec, /Cameras/);
  assert.match(spec, /Tap to rename/);
  assert.match(spec, /Click to rename/);
  assert.match(spec, /toHaveAttribute\('aria-label', 'Tap to rename'\)/);
  assert.match(spec, /toHaveAttribute\('title', 'Tap to rename'\)/);
  assert.match(spec, /toHaveAttribute\('aria-label', 'Click to rename'\)/);
  assert.match(spec, /accname/);
  assert.match(spec, /closest\('form'\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /data-mobile-category-id/);
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
  assert.doesNotMatch(spec, /name: 'New category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign out'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create space'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Walls'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Transparent'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
  assert.doesNotMatch(spec, /\.fill\(/);
  assert.doesNotMatch(spec, /name: 'Click to rename'[^\n]*\.fill\(/);
  assert.doesNotMatch(spec, /name: 'Tap to rename'[^\n]*\.fill\(/);
});
