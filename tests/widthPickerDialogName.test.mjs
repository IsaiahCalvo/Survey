import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: AnnotationSizeControl is a named dialog. Live proof:
// debug/scenarios/e2e-width-picker-dialog-name.spec.mjs
// Distinct from leftover-18 / nameless-menu / unnamed-dialog family
// already proved / Style-Width dismiss / Width preset apply /
// Color picker name / Search clear name / Add bookmark name / Activity.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Width picker is labelled dialog; Width presets trigger is type=button haspopup=dialog', () => {
  const control = read('src/components/AnnotationSizeControl.jsx');
  const start = control.indexOf('data-annotation-size-popover="true"');
  assert.ok(start >= 0);
  const slice = control.slice(Math.max(0, start - 80), start + 180);
  assert.match(slice, /role="dialog"/);
  assert.match(slice, /aria-label=\{label\}/);
  assert.match(control, /aria-label=\{\`\$\{label\} presets\`\}/);
  assert.match(control, /aria-haspopup="dialog"/);
  assert.match(control, /aria-expanded=\{open\}/);
  assert.match(control, /type="button"/);
  assert.doesNotMatch(control, /pageSize\.width \* .*scale|pageSize \* scale/);

  const shell = read('src/AppShell.jsx');
  assert.match(shell, /label=\{bottomToolbarApi\.contextTool === 'counter' \|\| bottomToolbarApi\.activeTool === 'eraser' \? 'Size' : 'Width'\}/);
  assert.match(read('src/components/CompactColorPicker.jsx'), /aria-label="Color"/);
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
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
});

test('live spec covers named Width picker intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-width-picker-dialog-name.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Width', exact: true \}\)/);
  assert.match(spec, /name: 'Width presets'/);
  assert.match(spec, /name: 'Shapes'/);
  assert.match(spec, /#chrome-sub-toolbar-host/);
  assert.match(spec, /btn-active\|is-active/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /Version history/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Create group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add bookmarks'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create bookmark'[^\n]*\.click\(/);
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
