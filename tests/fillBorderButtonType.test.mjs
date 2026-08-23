import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Color picker Fill / Border tabs are type=button.
// Live proof: debug/scenarios/e2e-fill-border-button-type.spec.mjs
// Distinct from leftover-18 / nameless-menu / unnamed-dialog family
// already proved / C-01 swatch apply / Invite User role name /
// Share Permission / Opacity slider name / Color picker name.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Color picker Fill / Border tabs are type=button; names stay the visible labels', () => {
  const shell = read('src/AppShell.jsx');
  const start = shell.indexOf("const secondTabLabel = isCounter ? 'Number' : 'Border'");
  const end = shell.indexOf('<CompactColorPicker', start);
  assert.ok(start >= 0);
  assert.ok(end > start);
  const slice = shell.slice(start, end);
  assert.match(slice, /\[\['fill', 'Fill'\], \['border', secondTabLabel\]\]/);
  assert.match(slice, /<button\s+key=\{k\}\s+type="button"/);
  assert.doesNotMatch(slice, /pageSize\.width \* .*scale|pageSize \* scale/);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
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
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
});

test('live spec covers Fill / Border type=button intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-fill-border-button-type.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /getByRole\('dialog', \{ name: 'Color', exact: true \}\)/);
  assert.match(spec, /name: 'Shapes'/);
  assert.match(spec, /#chrome-sub-toolbar-host/);
  assert.match(spec, /data-annotation-color-picker/);
  assert.match(spec, /name: 'Fill'/);
  assert.match(spec, /name: 'Border'/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /Version history/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Fill'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Border'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Transparent'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Hex color'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add bookmarks'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create bookmark'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'CSV'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'PDF Pages'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open linked'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pin project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Copy link'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
});
