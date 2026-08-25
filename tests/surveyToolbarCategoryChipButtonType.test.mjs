import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: PDFViewer survey sub-toolbar category chips
// (post-template Walls / Windows) are type=button.
// Live proof: debug/scenarios/e2e-survey-toolbar-category-chip-button-type.spec.mjs
// Distinct from leftover-18 / Survey category-main / arrow type /
// Survey Close type / CreateCategoryModal type / Draw / Shapes /
// Text sub-toolbar type. Two Category Template pick is setup only.
// Do not click the chips (arm). Do not click Create category
// confirm / Delete category / New entity / Y/N/N-A.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('Survey toolbar category chips are type=button; Create category apply stays parked', () => {
  const viewer = read('src/PDFViewer.jsx');
  const surveyStart = viewer.indexOf("{activeCategoryDropdown === 'survey' && (() => {");
  assert.ok(surveyStart > 0, 'survey sub-toolbar');
  const chip = viewer.indexOf('const glyph = getCategoryGlyphLabel(category.name);', surveyStart);
  assert.ok(chip > surveyStart, 'category glyph chips');
  const chipSlice = viewer.slice(chip, chip + 1800);
  assert.match(chipSlice, /<button\s+type="button"/);
  assert.match(chipSlice, /setSelectedCategoryId\(category\.id\)/);
  assert.match(chipSlice, /setActiveTool\('survey-marker'\)/);
  assert.match(chipSlice, /aria-label=\{category\.name \|\| 'Untitled category'\}/);
  assert.doesNotMatch(chipSlice, /<button\s+key=\{category\.id\}/);
  assert.match(viewer, /handleSelectSurveyTemplate/);
  assert.match(viewer, /setActiveCategoryDropdown\('survey'\)/);
  assert.doesNotMatch(viewer, /pageSize\.width \* .*scale|pageSize \* scale/);
  assert.doesNotMatch(viewer, /create-checkout-session|Turnstile|msalInstance/);

  const rail = read('src/SurveySpacesRail.jsx');
  const main = rail.indexOf('className="survey-marker-category-main"');
  assert.ok(main > 0, 'category-main still typed');
  assert.match(rail.slice(Math.max(0, main - 1600), main + 40), /<button\s+type="button"/);
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
  assert.match(bookmarks, /aria-label="Drag to reorder"/);
  assert.match(search, /aria-label="Search text in PDF"/);
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
  assert.match(team.slice(team.indexOf('/* ============ Manage Team modal ============ */')), /aria-label="Find a teammate"/);
  assert.match(team.slice(team.indexOf('/* ============ Manage Team modal ============ */')), /<button type="button" data-manage-team-edit /);
  assert.match(tree, /title="Click to rename"[\s\S]{0,80}aria-label="Click to rename"|aria-label="Click to rename"[\s\S]{0,80}title="Click to rename"/);
  assert.match(read('src/reorder/DragRearrangeHandle.jsx'), /aria-label=\{title\}/);
  assert.match(editor, /aria-label=\{open \? 'Collapse' : 'Expand'\}/);
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
  assert.match(read('src/home/CreateProjectModal.jsx'), /aria-label="Create project"/);
});

test('live spec covers Survey toolbar category chips type intended + break + edge; skip leftover-18 and apply', () => {
  const spec = read('debug/scenarios/e2e-survey-toolbar-category-chip-button-type.spec.mjs');
  assert.match(spec, /surveyTransitionE2E=1/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /Two Category Template/);
  assert.match(spec, /chrome-sub-toolbar-host/);
  assert.match(spec, /toolbarChip\(page, 'Walls'\)/);
  assert.match(spec, /toolbarChip\(page, 'Windows'\)/);
  assert.match(spec, /Survey module/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /accname/);
  assert.match(spec, /closest\('form'\)/);
  assert.match(spec, /implicit/);
  assert.match(spec, /390/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /Open survey/);
  assert.match(spec, /data-survey-marker-id/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /name: 'Create category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /survey-marker-category-create-button[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Walls'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Windows'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Export Excel'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sync Microsoft 365'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Export annotated PDF'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Select'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Upload'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'New entity'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create space'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Font color'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Bold'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Italic'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign in'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Continue with Google'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
  assert.doesNotMatch(spec, /dragTo\(|manualDrag|dispatchEvent\(new MouseEvent\('drag/);
  assert.doesNotMatch(spec, /dblclick|dblClick|doubleClick/);
  assert.doesNotMatch(spec, /selectOption/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
});
