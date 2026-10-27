import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * THE CLEAN-UP NOTICE NEVER SITS ON ITS OWN REVIEW PANEL (KAL-420 follow-up,
 * 2026-10-13).
 *
 * The owner-only "Old annotations to clean up" notice paints at z 100020 inside
 * the document tab (z 5000). Its Review panel was z 210 in the same tab, so the
 * notice covered the panel's heading on a phone and stayed bright over the
 * scrim on desktop, and the desktop right rail (5600, outside the tab) hid the
 * notice's ×. Now:
 *   - the notice is hidden while its Review panel (or the sign-in dialog the
 *     sign-in notice opens) is up, and comes back on Close;
 *   - the panel is portalled to <body> at 9000: over every rail, bar, dock and
 *     sheet, under tooltips and toasts;
 *   - the notice's right edge stops at the right rail (--app-right-rail-width,
 *     from the width SurveySpacesRail publishes, utils/chromeInsets.js, like the
 *     left rail's on the left; the notice sets both on itself).
 * The real flow is checked in
 * debug/scenarios/test-plan/residue-cleanup-owner-only.spec.mjs (boxes and
 * elementFromPoint on desktop and phone).
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');
const rule = (css, selector) => {
  const at = css.indexOf(`${selector} {`);
  assert.notEqual(at, -1, `${selector} rule exists`);
  return css.slice(at, css.indexOf('}', at));
};
const zOf = (block) => {
  const m = block.match(/z-index:\s*(\d+)/);
  assert.ok(m, 'rule has a z-index');
  return Number(m[1]);
};

test('the clean-up notice is hidden while its Review panel is open', () => {
  const src = read('src/components/collab/YDocProvider.jsx');
  const gate = src.slice(src.indexOf('{cleanupResidueIds && cleanupResidueIds.length > 0'), src.indexOf('code="sync_residue_cleanup"'));
  assert.match(gate, /!reviewPanelOpen/, 'the residue notice gate checks the panel');
  // Close only closes the panel; the notice state (residue ids) is kept, so
  // the notice comes back.
  assert.match(src, /onClose=\{\(\) => setReviewPanelOpen\(false\)\}/);
});

test('the sign-in notice steps aside while its sign-in dialog is open', () => {
  const src = read('src/components/collab/YDocProvider.jsx');
  const at = src.indexOf('const showBanner =');
  const decl = src.slice(at, src.indexOf(';', at));
  assert.match(decl, /login_expiry_failure' && reSignInModalOpen/);
});

test('the Review panel is portalled to <body> and shown only for the tab on screen', () => {
  const panel = read('src/components/collab/CleanupResidueReviewPanel.jsx');
  assert.match(panel, /import \{ createPortal \} from 'react-dom'/);
  assert.match(panel, /createPortal\(node, document\.body\)/);
  const provider = read('src/components/collab/YDocProvider.jsx');
  assert.match(provider, /isOpen=\{reviewPanelOpen && isActive !== false\}/);
});

test('the Review panel sits over the chrome and sheets, under tooltips and toasts', () => {
  const panelZ = zOf(rule(read('src/components/collab/CleanupResidueReviewPanel.css'), '.cleanup-residue-review__backdrop'));
  // Rails (AppShell inline 5600), the selection quick bar, the phone dock and
  // the phone sheets (up to 7400) are below it.
  const quickBarZ = zOf(rule(read('src/components/SelectionQuickBar.css'), '.selection-quick-bar'));
  assert.ok(panelZ > 5600, 'above the rails');
  assert.ok(panelZ > quickBarZ, 'above the selection quick bar');
  assert.ok(panelZ > 7400, 'above the phone sheets');
  // The phone delete confirmation uses the same level.
  assert.match(read('src/components/collab/ConfirmDeleteModal.css'), new RegExp(`z-index: ${panelZ};`));
  // Tooltips (Tooltip.jsx 10000) and toasts (ToastHost / UndoToast 100000)
  // stay above it, so a clean-up error is never hidden.
  assert.match(read('src/components/Tooltip.jsx'), /zIndex: 10000/);
  assert.ok(panelZ < 10000, 'under tooltips');
  const toastZ = zOf(rule(read('src/components/ToastHost.css'), '.app-toast-host'));
  assert.ok(panelZ < toastZ, 'under the toast stack');
});

test('the notice keeps its z-index and stops at the right rail', () => {
  const css = read('src/components/collab/StorageFailureBanner.css');
  const banner = rule(css, '.storage-banner');
  // Its order among the document tab's own layers is unchanged.
  assert.equal(zOf(banner), 100020);
  assert.match(banner, /right:\s*var\(--app-right-rail-width, 48px\);/);
  assert.match(banner, /left:\s*var\(--app-sidebar-width, 48px\);/);
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /publishChromeInset\('right', mobileMode \? '0px' : `\$\{desktopSurveyPanelShown \? 48 \+ 320 : 48\}px`\)/);
  // Unmount clears the width so later UI falls back to its default (Bugbot #831).
  assert.match(rail, /publishSideRoom\(\{ rightCover: 48 \}\);[\s\S]{0,160}publishChromeInset\('right', null\)/);
  // Closing a tab behind the front one leaves the front rail's values alone.
  assert.match(rail, /if \(!tabActiveRef\.current\) return;\s*publishSideRoom\(\{ rightCover: 48 \}\);/);
  // The notice puts both widths on itself, never on :root (a :root custom
  // property restyles the whole document on every change).
  const notice = read('src/components/collab/StorageFailureBanner.jsx');
  assert.match(notice, /style=\{chromeInsetVars\(chromeInsets\)\}/);
  assert.doesNotMatch(rail + read('src/PDFSidebar.jsx'), /setProperty\('--app-(sidebar|right-rail)-width'/);
});

test('on a phone the notice links drop under the text', () => {
  const css = read('src/components/collab/StorageFailureBanner.css');
  const at = css.indexOf('@media screen and (max-width: 599px)');
  assert.notEqual(at, -1, 'phone rule exists');
  const phone = css.slice(at);
  assert.match(phone, /\.storage-banner \{[^}]*flex-wrap: wrap;/);
  assert.match(phone, /\.storage-banner__text \{[^}]*flex: 1 1 calc\(100% - 72px\);/);
  assert.match(phone, /\.storage-banner > \.storage-banner__actions,\s*\n\s*\.storage-banner > \.storage-banner__action \{[^}]*order: 4;/);
});
