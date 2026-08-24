import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: ConfirmModal Cancel / Confirm (and Close) are type=button.
// Live proof: debug/scenarios/e2e-confirm-modal-cancel-confirm-button-type.spec.mjs
// Distinct from leftover-18 / nameless-menu / unnamed-dialog family
// already proved / ConfirmModal name / Rename Cancel/Save type /
// Rename Close name / Projects More type / Documents More name /
// Archive Show documents name / Account Settings Close type /
// Click to rename / Projects Tap to rename. Confirm apply /
// Delete forever / Select apply / Open file apply / Share apply /
// Upload apply / Delete account / Create project stay parked.
// Do not replay ConfirmModal name. Do not click Confirm.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Confirm Cancel / Confirm are type=button; Confirm apply stays parked', () => {
  const src = read('src/home/BulkModals.jsx');
  const start = src.indexOf('export function ConfirmModal');
  const end = src.indexOf('export function RenameModal');
  assert.ok(start > 0 && end > start, 'ConfirmModal export');
  const slice = src.slice(start, end);
  assert.match(
    slice,
    /<button type="button" disabled=\{submitting\} onClick=\{onClose\} title="Close" aria-label="Close"/,
  );
  assert.match(
    slice,
    /<button type="button" disabled=\{submitting\} onClick=\{onClose\} style=\{\{ background: 'transparent'/,
  );
  assert.match(
    slice,
    /<button\s+type="button"\s+disabled=\{submitting\}\s+onClick=\{handleConfirm\}/,
  );
  assert.doesNotMatch(
    slice,
    /<button disabled=\{submitting\} onClick=\{onClose\} title="Close" aria-label="Close"/,
  );
  assert.doesNotMatch(
    slice,
    /<button disabled=\{submitting\} onClick=\{onClose\} style=\{\{ background: 'transparent'/,
  );
  assert.doesNotMatch(
    slice,
    /<button\s+disabled=\{submitting\}\s+onClick=\{handleConfirm\}/,
  );
  assert.match(slice, />Cancel<\/button>/);
  assert.match(slice, /aria-labelledby="confirm-modal-title"/);
  assert.match(slice, /id="confirm-modal-title"/);
  assert.match(slice, /confirmLabel = 'Confirm'/);
  assert.match(read('src/SurveySpacesRail.jsx'), /confirmLabel: `Delete categor/);
  assert.match(read('src/home/ArchiveScreen.jsx'), /<ConfirmModal[\s\S]*?title=\{DELETE_FOREVER_COPY\.title\}/);
  assert.doesNotMatch(src, /pageSize\.width \* .*scale|pageSize \* scale/);
  assert.doesNotMatch(src, /create-checkout-session|Turnstile|msalInstance/);
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
  const renameStart = confirm.indexOf('export function RenameModal');
  assert.match(confirm.slice(renameStart), /<button type="button" onClick=\{onClose\} style=\{\{ minHeight: 44, background: 'transparent'/);
  assert.match(confirm.slice(renameStart), /<button\s+type="button"\s+disabled=\{!trimmed\}\s+onClick=\{submit\}/);
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
  assert.match(read('src/reorder/DragRearrangeHandle.jsx'), /aria-label=\{title\}/);
  assert.match(editor, /aria-label=\{open \? 'Collapse' : 'Expand'\}/);
  assert.match(
    read('src/home/ArchiveScreen.jsx'),
    /aria-label=\{open \? `Hide \$\{label\}` : `Show \$\{label\}`\}/,
  );
  const moreButtons = [...tree.matchAll(/<button[\s\S]{0,800}title="More"/g)].map((row) => row[0]);
  assert.equal(moreButtons.length, 6);
  for (const tag of moreButtons) {
    assert.match(tag, /type="button"/);
  }
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
  assert.match(read('src/home/CreateProjectModal.jsx'), /aria-label="Create project"/);
  assert.match(read('src/home/CreateProjectModal.jsx'), /title="Close"/);
});

test('live spec covers Confirm Cancel/Confirm type intended + break + edge; skip leftover-18 and Confirm apply', () => {
  const spec = read('debug/scenarios/e2e-confirm-modal-cancel-confirm-button-type.spec.mjs');
  assert.match(spec, /surveyTransitionE2E=1/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /Delete 1 category\?/);
  assert.match(spec, /Delete 2 categories\?/);
  assert.match(spec, /name: 'Cancel'/);
  assert.match(spec, /name: 'Delete category'/);
  assert.match(spec, /'Delete categories'/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /accname/);
  assert.match(spec, /closest\('form'\)/);
  assert.match(spec, /implicit/);
  assert.match(spec, /390/);
  assert.match(spec, /confirmCancel\(page, 'Delete 1 category\?'\)\.click\(\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /confirmClose\(page, 'Delete 2 categories\?'\)\.click\(\)/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Delete category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete categories'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Confirm'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Save'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Select'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'All'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'None'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Close preview'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New entity'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New module'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit color'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Send viewer invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Copy link'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Add files'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New template'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Edit profile'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign out'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete account'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Subscription'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Manage team'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Lock document'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Get link to project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
  assert.doesNotMatch(spec, /dragTo\(|manualDrag|dispatchEvent\(new MouseEvent\('drag/);
  assert.doesNotMatch(spec, /dblclick|dblClick|doubleClick/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
});
