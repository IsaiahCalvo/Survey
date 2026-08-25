import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('official leftover files besides isolated 8448 match live source after Manage Team sort headers', () => {
  const overlay = read('src/components/KeyboardShortcutsOverlay.jsx');
  assert.match(overlay, /role="dialog"/);
  assert.match(overlay, /aria-labelledby="keyboard-shortcuts-title"/);

  const auth = read('src/components/AuthModal.jsx');
  assert.match(
    auth,
    /<button type="button" className="auth-modal-close" onClick=\{handleClose\} aria-label="Close">/,
  );

  const access = read('src/home/AccessManagementModal.jsx');
  assert.match(access, /aria-labelledby="access-management-modal-title"/);
  assert.match(
    access,
    /<button type="button" onClick=\{onClose\} title="Close" aria-label="Close" style=\{closeButtonStyle/,
  );

  const invite = read('src/home/InviteAcceptPage.jsx');
  assert.match(
    invite,
    /<button type="button" onClick=\{signIn\} style=\{btnPrimary\(accent\)\}>Sign in to continue<\/button>/,
  );
  assert.match(
    invite,
    /<button type="button" onClick=\{goHome\} style=\{btnGhost\(\)\}>Back to Survey<\/button>/,
  );

  const editor = read('src/home/TemplatesEditor.jsx');
  const moreButtons = [...editor.matchAll(/<button[\s\S]{0,900}title="More"/g)].map((row) => row[0]);
  assert.equal(moreButtons.length, 4);
  for (const tag of moreButtons) {
    assert.match(tag, /type="button"/);
  }

  const shell = read('src/home/HubShell.jsx');
  const railStart = shell.indexOf('const MobileRailNav');
  const railEnd = shell.indexOf('export const HubShell');
  const rail = shell.slice(railStart, railEnd);
  assert.match(rail, /if \(event\.key !== 'Escape'\) return;/);
  assert.match(rail, /setOpen\(false\)/);

  const ledger = read('src/home/DocumentsLedger.jsx');
  assert.match(ledger, /\{sortHeaderButton\('name', 'File'/);
  assert.match(ledger, /<button\s+type="button"\s+onClick=\{\(\) => onHeaderClick\(key\)\}/);

  const screen = read('src/home/ArchiveScreen.jsx');
  assert.match(screen, /\{sortHeaderButton\('name', 'Name'/);
  assert.match(screen, /<button\s+type="button"\s+onClick=\{\(\) => onHeaderClick\(key\)\}/);

  const team = read('src/home/ManageTeamModal.jsx');
  const modalStart = team.indexOf('/* ============ Manage Team modal ============ */');
  const modal = team.slice(modalStart);
  assert.match(modal, /\{sortHeaderButton\("name", "Users"\)\}/);
  assert.match(modal, /<button\s+type="button"\s+onClick=\{\(\) => onSort\(key\)\}/);
  assert.match(team, /<span onClick=\{\(\) => click\("file"\)\}/);

  const bookmarks = read('src/sidebar/BookmarksPanel.jsx');
  assert.match(bookmarks, /aria-label="Drag to reorder"/);
  assert.match(bookmarks, /aria-label="Add bookmark"/);

  const search = read('src/sidebar/SearchTextPanel.jsx');
  assert.match(search, /aria-label="Search text in PDF"/);
  assert.match(search, /aria-label="Clear search"/);

  assert.match(read('tests/partialEraserComplexity.test.mjs'), /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
});

test('hunt after Manage Team sort headers looks past Users buttons and leftover-18', () => {
  const spec = read('debug/scenarios/e2e-after-manage-team-sort-headers-independent-hunt.spec.mjs');
  assert.match(spec, /AFTER_MANAGE_TEAM_SORT_HEADERS_INDEPENDENT_HUNT/);
  assert.match(spec, /Independent hunt after Manage Team Users \/ Role \/ Added sort/);
  assert.match(spec, /\/invite\/leftover-type-probe/);
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /hubPreview=1&tab=templates/);
  assert.match(spec, /hubPreview=1&tab=projects/);
  assert.match(spec, /hubPreview=1&tab=archive/);
  assert.match(spec, /hubPreview=1&guest=1/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /surveyTransitionE2E=1/);
  assert.match(spec, /nameType/);
  assert.match(spec, /fileType/);
  assert.match(spec, /usersType/);
  assert.match(spec, /afterEscape/);
  assert.match(spec, /signInContinueType/);
  assert.match(spec, /desktopCategoryName/);
  assert.match(spec, /listMoreType/);
  assert.match(spec, /authCloseType/);
  assert.match(spec, /signInType/);
  assert.match(spec, /roleTrigger/);
  assert.match(spec, /activityFile/);
  assert.match(spec, /fileId/);
  assert.match(spec, /nameType\)\.toBe\('button'\)/);
  assert.match(spec, /fileType\)\.toBe\('button'\)/);
  assert.match(spec, /usersType\)\.toBe\('button'\)/);
  assert.match(spec, /afterEscape\)\.toBe\(0\)/);
  assert.match(spec, /signInContinueType\)\.toBe\('button'\)/);
  assert.match(spec, /desktopCategoryName\)\.toBe\('Click to rename'\)/);
  assert.match(spec, /closeType\)\.toBe\('button'\)/);
  assert.match(spec, /signInType\)\.toBe\('submit'\)/);
  assert.match(spec, /roleTrigger\)\.toBe\(0\)/);
  assert.match(spec, /activityFile\)\.toBe\(0\)/);
  assert.match(spec, /fileId\)\.toBeNull\(\)/);
  assert.match(spec, /notes\)\.toBe\(0\)/);
  assert.match(spec, /spacesExpand\)\.toBe\(0\)/);
  assert.match(spec, /highlighterCaret\)\.toBe\(0\)/);
  assert.match(spec, /counterCaret\)\.toBe\(0\)/);
  assert.match(spec, /versionHistory\)\.toBe\(0\)/);
  assert.match(spec, /viewBox\)\.toBe\('0 0 612 792'\)/);
  assert.match(spec, /restore\)\.toBe\(0\)/);
  assert.match(spec, /deleteForever\)\.toBe\(0\)/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /name: 'Share'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Delete'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'View activity'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Change role'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Invite'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Create space'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Restore'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Transparent'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Sign in to continue'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /name: 'Documents'[^\n]*\.click\(/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
});
