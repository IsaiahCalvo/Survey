import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contract: desktop AppShell Undo / Redo are type=button.
// Live proof: debug/scenarios/e2e-undo-redo-button-type.spec.mjs
// Distinct from leftover-18 / History Version history trigger 0 /
// mobile header Undo / Redo already typed / nameless-menu /
// unnamed-dialog family already proved / Manage Team More type /
// Select-type family. Export / Draw / Shapes / Text type-null stay
// later hosts. Invite / Send / Done apply / Save / Select apply /
// Open file apply / Share apply / Upload apply / Delete account
// stay parked.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('desktop AppShell Undo / Redo are type=button; mobile sibling already typed', () => {
  const shell = read('src/AppShell.jsx');
  const clusterStart = shell.indexOf('data-undo-redo-controls="true"');
  assert.ok(clusterStart > 0, 'desktop Undo/Redo cluster');
  const cluster = shell.slice(clusterStart, clusterStart + 1800);
  assert.match(
    cluster,
    /<button\s+type="button"\s+onClick=\{topToolbarApi\.onUndo \|\| \(\(\) => \{\}\)\}/,
  );
  assert.doesNotMatch(
    cluster,
    /<button\s+onClick=\{topToolbarApi\.onUndo \|\| \(\(\) => \{\}\)\}/,
  );
  assert.match(
    cluster,
    /<button\s+type="button"\s+onClick=\{topToolbarApi\.onRedo \|\| \(\(\) => \{\}\)\}/,
  );
  assert.doesNotMatch(
    cluster,
    /<button\s+onClick=\{topToolbarApi\.onRedo \|\| \(\(\) => \{\}\)\}/,
  );
  assert.match(cluster, /aria-label="Undo"/);
  assert.match(cluster, /aria-label="Redo"/);
  assert.equal((cluster.match(/type="button"/g) || []).length, 2);

  const mobile = read('src/mobile/MobilePdfViewerChrome.jsx');
  const mobileStart = mobile.indexOf('className="mobile-pdf-header__history"');
  const mobileCluster = mobile.slice(mobileStart, mobileStart + 900);
  assert.match(mobileCluster, /type="button"[\s\S]*aria-label="Undo"/);
  assert.match(mobileCluster, /type="button"[\s\S]*aria-label="Redo"/);

  assert.doesNotMatch(shell, /pageSize\.width \* .*scale|pageSize \* scale/);
  assert.doesNotMatch(shell, /create-checkout-session|Turnstile|msalInstance/);
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
  assert.match(
    confirm.slice(confirmStart, confirmEnd),
    /<button type="button" disabled=\{submitting\} onClick=\{onClose\} title="Close" aria-label="Close"/,
  );
  const renameStart = confirm.indexOf('export function RenameModal');
  assert.match(
    confirm.slice(renameStart),
    /<button type="button" onClick=\{onClose\} title="Close" aria-label="Close"/,
  );
  assert.match(settings, /aria-labelledby="account-settings-title"/);
  assert.match(create, /aria-labelledby="create-category-modal-title"/);
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);
  assert.match(access, /aria-labelledby="access-management-modal-title"/);
  assert.match(
    access,
    /<button type="button" onClick=\{\(\) => setInviteOpen\(true\)\} data-kal31-invite-btn="true"/,
  );
  assert.match(
    access,
    /<button type="button" onClick=\{onClose\} style=\{\{ background: C\.gold, color: '#15110a', border: 0, borderRadius: 6, padding: '5px 14px', height: 28, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' \}\}>Done<\/button>/,
  );
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
  assert.match(
    team.slice(team.indexOf('/* ============ Manage Team modal ============ */')),
    /<button type="button" data-manage-team-invite /,
  );
  const moreButtons = [...team.slice(team.indexOf('/* ============ Manage Team modal ============ */')).matchAll(/<button[\s\S]{0,400}title="More" aria-label="More"/g)].map((row) => row[0]);
  assert.equal(moreButtons.length, 2);
  for (const tag of moreButtons) {
    assert.match(tag, /type="button"/);
  }
  assert.match(tree, /title="Click to rename"[\s\S]{0,80}aria-label="Click to rename"|aria-label="Click to rename"[\s\S]{0,80}title="Click to rename"/);
  assert.match(read('src/reorder/DragRearrangeHandle.jsx'), /aria-label=\{title\}/);
  assert.match(editor, /aria-label=\{open \? 'Collapse' : 'Expand'\}/);
  assert.match(
    read('src/home/ArchiveScreen.jsx'),
    /aria-label=\{open \? `Hide \$\{label\}` : `Show \$\{label\}`\}/,
  );
  const treeMore = [...tree.matchAll(/<button[\s\S]{0,800}title="More"/g)].map((row) => row[0]);
  assert.equal(treeMore.length, 6);
  for (const tag of treeMore) {
    assert.match(tag, /type="button"/);
  }
  assert.match(prompt, /export function PromptModal/);
  assert.match(prompt, /title = ''/);
  assert.match(read('src/home/CreateProjectModal.jsx'), /aria-label="Create project"/);
  assert.match(
    read('src/home/CreateProjectModal.jsx'),
    /<button type="button" title="Close" aria-label="Close" disabled=\{busy\} onClick=\{onCancel\} style=\{closeButtonStyle/,
  );
});

test('live spec covers Undo / Redo type intended + break + edge; skip leftover-18 apply', () => {
  const spec = read('debug/scenarios/e2e-undo-redo-button-type.spec.mjs');
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /hubPreview=1&empty=1/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&tab=documents/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /data-undo-redo-controls="true"/);
  assert.match(spec, /toHaveAttribute\('type', 'button'\)/);
  assert.match(spec, /expectTypedControl\(undo, 'Undo'\)/);
  assert.match(spec, /expectTypedControl\(redo, 'Redo'\)/);
  assert.match(spec, /accname/);
  assert.match(spec, /closest\('form'\)/);
  assert.match(spec, /implicit/);
  assert.match(spec, /name === 'Undo'/);
  assert.match(spec, /name === 'Redo'/);
  assert.match(spec, /390/);
  assert.match(spec, /mobile-pdf-header__history/);
  assert.match(spec, /armRectangle/);
  assert.match(spec, /undo\.click\(\)/);
  assert.match(spec, /redo\.click\(\)/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /createDocumentInvite\(/);
  assert.doesNotMatch(spec, /Sharing needs a signed-in cloud account/);
  assert.doesNotMatch(spec, /name: 'Invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Done'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Send'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Save'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete forever'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Select'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'All'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'None'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Close preview'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Open file'[^\n]*\.click\(/);
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
  assert.doesNotMatch(spec, /name: 'Lock document'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Get link to project'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Confirm'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete category'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Export annotated PDF'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /setInputFiles|waitForEvent\('filechooser'/);
  assert.doesNotMatch(spec, /waitForEvent\('download'/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
  assert.doesNotMatch(spec, /click-outside must close Selection Mode after P/);
});
