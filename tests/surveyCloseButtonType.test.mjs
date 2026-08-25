import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: Survey header Close Survey panel is type=button.
// Live proof: debug/scenarios/e2e-survey-close-button-type.spec.mjs
// Distinct from leftover-18 / nameless-menu / unnamed-dialog family
// already proved / CreateCategoryModal type / Collapse / Expand
// Survey panel type / Bookmarks Delete type / Bookmarks Edit / Done
// type / Bookmarks group chrome type / Draw / Shapes / Text
// sub-toolbar type / Edit text type / Zoom/page-nav type /
// Export/Draw/Shapes/Text category type / Undo/Redo type.
// Two Category Template pick is setup only. Do not click Create
// category confirm. Do not click Export Excel / Sync Microsoft 365.
// Font color / Bold / Italic stay behind richTextEditor.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Survey header Close is type=button; Create category apply stays parked', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const headerClose = rail.indexOf("className=\"btn btn-icon btn-icon-sm\"\n                        aria-label=\"Close Survey panel\"");
  assert.ok(headerClose > 0, 'header Close Survey panel');
  const slice = rail.slice(Math.max(0, headerClose - 500), headerClose + 80);
  assert.match(slice, /<button\s+type="button"/);
  assert.match(slice, /exitSurveyMode\(\)/);
  assert.match(slice, /dismissSurveySheet\(\)/);
  assert.doesNotMatch(slice, /<button\s+onClick=\{\(\) => \{/);

  const backdrop = rail.indexOf('className="mobile-pdf-sheet-backdrop"');
  assert.ok(backdrop > 0);
  assert.match(rail.slice(Math.max(0, backdrop - 200), backdrop + 80), /<button\s+type="button"/);
  assert.match(rail, /aria-label="Collapse Survey panel"/);
  assert.match(rail, /aria-label="Expand Survey panel"/);
  assert.match(rail, /className="mobile-survey-picker-close"/);
  const pickerClose = rail.indexOf('className="mobile-survey-picker-close"');
  assert.match(rail.slice(Math.max(0, pickerClose - 180), pickerClose + 40), /<button\s+type="button"/);

  const create = read('src/components/CreateCategoryModal.jsx');
  assert.match(create, /aria-labelledby="create-category-modal-title"/);
  assert.match(create, /<button\s+type="button"\s+onClick=\{onClose\}/);
  assert.doesNotMatch(rail, /pageSize\.width \* .*scale|pageSize \* scale/);
  assert.doesNotMatch(rail, /create-checkout-session|Turnstile|msalInstance/);
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
  const bookmarkDeleteLabel = bookmarks.indexOf("aria-label={isFolder ? `Delete group ${item.name}` : `Delete bookmark ${item.name}`}");
  assert.ok(bookmarkDeleteLabel > 0);
  assert.match(bookmarks.slice(Math.max(0, bookmarkDeleteLabel - 400), bookmarkDeleteLabel + 40), /<button\s+type="button"/);
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
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
  assert.match(read('src/home/CreateProjectModal.jsx'), /aria-label="Create project"/);
  assert.match(read('src/home/CreateProjectModal.jsx'), /title="Close"/);
});

test('live spec covers Survey Close type intended + break + edge; skip leftover-18 and Create apply', () => {
  const spec = read('debug/scenarios/e2e-survey-close-button-type.spec.mjs');
  assert.match(spec, /surveyTransitionE2E=1/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /Two Category Template/);
  assert.match(spec, /Close Survey panel/);
  assert.match(spec, /Collapse Survey panel/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /accname/);
  assert.match(spec, /closest\('form'\)/);
  assert.match(spec, /implicit/);
  assert.match(spec, /390/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /Open survey/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Create category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /survey-marker-category-create-button[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Export Excel'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sync Microsoft 365'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Export annotated PDF'[^\n]*\.click\(/);
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
  assert.doesNotMatch(spec, /name: 'Create bookmark group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create space'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Font color'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Bold'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Italic'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete group'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete bookmark'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /window\.confirm/);
  assert.doesNotMatch(spec, /fill\(/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
  assert.doesNotMatch(spec, /dragTo\(|manualDrag|dispatchEvent\(new MouseEvent\('drag/);
  assert.doesNotMatch(spec, /dblclick|dblClick|doubleClick/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
});
