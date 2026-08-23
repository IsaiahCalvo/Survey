import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Invite User role comboboxes are named.
// Live proof: debug/scenarios/e2e-invite-user-role-name.spec.mjs
// Distinct from leftover-18 / nameless-menu / unnamed-dialog family
// already proved / AccessManagement dialog name / Documents Share
// Access apply / Share Permission / Manage Team role picker /
// Activity / Opacity slider name / C-01 swatch apply.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Invite User role selects are labelled; invite email + overlay buttons typed', () => {
  const team = read('src/home/ManageTeamModal.jsx');
  const start = team.indexOf('/* ============ Invite User sub-modal (REAL) ============');
  const end = team.indexOf('/* ============ Manage Team modal ============ */');
  assert.ok(start >= 0);
  assert.ok(end > start);
  const slice = team.slice(start, end);
  assert.match(slice, /aria-label="Invite User"/);
  assert.match(slice, /aria-label="Share link role"/);
  assert.match(slice, /aria-label="Invite by email role"/);
  assert.match(slice, /aria-label="Invite by email"/);
  assert.match(slice, /<select value=\{linkRole\} aria-label="Share link role"/);
  assert.match(slice, /<select value=\{emailRole\} aria-label="Invite by email role"/);
  assert.match(slice, /type="button" onClick=\{onClose\} title="Close"/);
  assert.match(slice, /<button type="button" onClick=\{copyLink\}/);
  assert.match(slice, /<button type="button" onClick=\{onClose\} style=\{\{ background: "transparent"/);
  assert.match(slice, /<button type="button" disabled=\{busy \|\| !emails\.trim/);
  assert.doesNotMatch(team, /pageSize\.width \* .*scale|pageSize \* scale/);
  assert.doesNotMatch(team, /create-checkout-session|Turnstile|msalInstance/);
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
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
});

test('live spec covers named Invite User role intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-invite-user-role-name.spec.mjs');
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /testPdf=text-search-glyph-lab\.pdf/);
  assert.match(spec, /getByRole\('combobox', \{ name: 'Share link role', exact: true \}\)/);
  assert.match(spec, /getByRole\('combobox', \{ name: 'Invite by email role', exact: true \}\)/);
  assert.match(spec, /Invite by email/);
  assert.match(spec, /Invite User/);
  assert.match(spec, /Manage team/);
  assert.match(spec, /Share template/);
  assert.match(spec, /Document Access/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /390/);
  assert.match(spec, /file\.id/);
  assert.match(spec, /toHaveValue\('Viewer'\)/);
  assert.match(spec, /toHaveValue\('Editor'\)/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Copy link'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Send Editor invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /name: 'Create group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add bookmarks'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create bookmark'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'CSV'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'PDF Pages'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open linked'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Pin project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Solid'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
});
