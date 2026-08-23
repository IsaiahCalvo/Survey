// Unlisted user-facing controls the 59-row FEATURE-MATRIX did not enumerate.
// Node contracts only — no PDFViewer mount, no fake cloud IDs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseEmails } from '../src/home/shareInviteParse.js';
import {
  applyPageRotation,
  clampCopies,
  clampRangeToMax,
  compactRange,
  filterRangeChars,
  parseCustomInches,
  parseRange,
  sanitizeRangeInput,
} from '../src/components/printRangeUtils.js';
import { coercePageNumber } from '../src/utils/bookmarkPageIds.js';
import { resolvePageThumbnailClick } from '../src/sidebar/pagesPanelUtils.js';
import { getSyncStatusViewModel } from '../src/utils/syncStatusViewModel.js';
import { normalizeMobilePresence, getMobileSyncPresentation } from '../src/mobile/mobilePdfViewerModel.js';
import {
  canUnlinkProvider,
  describeProfileSaveOutcome,
  validatePasswordForm,
} from '../src/utils/accountPlatform.js';
import { passwordMeetsRequirements } from '../src/components/authFlow.js';
import {
  FORM_TOOLS,
  buildFormFieldUpdate,
  isFormTool,
} from '../src/components/formDesignerTools.js';
import { ARROWHEAD_STYLE_LABELS } from '../src/components/Callout/types.js';
import { ZOOM_MODES, clampScale } from '../src/utils/zoomController.js';
import { passwordChangeKind, isAccountDeletionConfirmation, ACCOUNT_DELETION_CONFIRMATION } from '../src/utils/accountPlatform.js';
import { canManageCollaborativeSpaces } from '../src/utils/collaborativeSpaceAccess.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const overlaySrc = read('src/components/KeyboardShortcutsOverlay.jsx');
const shareSrc = read('src/home/ShareModal.jsx');
const accountSrc = read('src/components/AccountSettings.jsx');
const sidebarSrc = read('src/PDFSidebar.jsx');
const menuSrc = read('src/hooks/useAnnotationContextMenu.jsx');
const pagesSrc = read('src/sidebar/PagesPanel.jsx');
const printSrc = read('src/components/PrintPanel.jsx');
const appShellSrc = read('src/AppShell.jsx');
const formPropsSrc = read('src/components/FormFieldPropertiesPanel.jsx');
const syncSrc = read('src/components/SyncStatusChip.jsx');
const mobileSrc = read('src/mobile/MobilePdfViewerChrome.jsx');
const counterStartSrc = read('src/components/CounterStartNumberField.jsx');

test('UL: shortcuts overlay lists B, Open, Fit page, tools, and owns Escape', () => {
  for (const needle of [
    "description: 'Toggle sidebar'",
    "description: 'Open document'",
    "description: 'Fit page'",
    "description: 'Search text'",
    "description: 'Select annotations'",
    "description: 'Select text on the page'",
    "description: 'Pen'",
    "description: 'Highlighter'",
    "description: 'Eraser'",
    "description: 'Text'",
    "description: 'Callout'",
    "description: 'Line'",
    "description: 'Arrow'",
    "description: 'Counter'",
    "description: 'Toggle shortcuts'",
    "description: 'Close dialogs/cancel'",
    'useFocusTrap(modalContentRef, isOpen, { onEscape: closeOverlay })',
    'aria-label="Close"',
  ]) {
    assert.match(overlaySrc, new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(overlaySrc, /<Icon name="close"/);
  assert.match(overlaySrc, /onClick=\{\(\) => setIsOpen\(false\)\}/);
});

test('UL: B hotkey helpers stay in PDFSidebar (toggle + form-field / modifier gate)', () => {
  assert.match(sidebarSrc, /export function shouldToggleSidebarOnKey/);
  assert.match(sidebarSrc, /export function nextSidebarCollapsed/);
  assert.match(sidebarSrc, /return event\.key === 'b' \|\| event\.key === 'B'/);
  assert.match(sidebarSrc, /if \(isFormField\) return false/);
});

test('UL: ShareModal roles are Viewer/Editor/Owner; no fake URL; emails parse + dedupe', () => {
  assert.match(shareSrc, /const ROLE_OPTIONS = \['Viewer', 'Editor', 'Owner'\]/);
  assert.doesNotMatch(shareSrc, /Commenter/);
  assert.match(shareSrc, /Press Copy link to create a secure/);
  assert.doesNotMatch(shareSrc, /https:\/\/surveytool\.app\/invite\/fake/);
  assert.match(shareSrc, /Free plan accounts cannot create invite links/);
  assert.deepEqual(parseEmails(''), []);
  assert.deepEqual(parseEmails('not-an-email, also bad'), []);
  assert.deepEqual(parseEmails('A@Example.COM; b@x.io, a@example.com'), ['a@example.com', 'b@x.io']);
  assert.deepEqual(parseEmails('  name@example.com  name@example.com '), ['name@example.com']);
});

test('UL: AccountSettings always opens on General; email locked; delete/sign-out/usage/billing', () => {
  assert.match(accountSrc, /setActiveTab\('general'\)/);
  assert.match(accountSrc, /General/);
  assert.match(accountSrc, /Connected services/);
  assert.match(accountSrc, /Subscription/);
  assert.match(accountSrc, /Edit profile/);
  assert.match(accountSrc, /Email cannot be changed/);
  assert.match(accountSrc, /title="Email cannot be changed"/);
  assert.match(accountSrc, /Delete account/);
  assert.match(accountSrc, /Sign out/);
  assert.match(accountSrc, /Manage subscription/);
  assert.match(accountSrc, /Usage/);
  assert.match(accountSrc, /Monthly/);
  assert.match(accountSrc, /Annual/);
  assert.match(accountSrc, /Manage Billing & Payments/);
  assert.match(accountSrc, /Contact sales/);
  assert.match(accountSrc, /mailto:\$\{SURVEY_SUPPORT_EMAIL\}/);
  assert.match(accountSrc, /Email me a reset link/);
  assert.match(accountSrc, /msNeedsReconnect \? 'Reconnect' : 'Connect'/);
  assert.equal(isAccountDeletionConfirmation('delete'), false);
  assert.equal(isAccountDeletionConfirmation(ACCOUNT_DELETION_CONFIRMATION), true);
  assert.equal(passwordChangeKind({ identities: [{ provider: 'google' }] }), 'set');
});

test('UL: PDFSidebar tabs are Pages / Search / Bookmarks / Spaces + History', () => {
  assert.match(sidebarSrc, /\{ id: 'pages', label: 'Pages'/);
  assert.match(sidebarSrc, /\{ id: 'search'/);
  assert.match(sidebarSrc, /\{ id: 'bookmarks', label: 'Bookmarks'/);
  assert.match(sidebarSrc, /\{ id: 'spaces', label: 'Spaces'/);
  assert.match(sidebarSrc, /aria-label="Version history"/);
  assert.match(sidebarSrc, /aria-label="Close document panel"/);
});

test('UL: annotation context menu Cut/Copy/Paste/Delete/z-order; empty page is Paste only', () => {
  for (const label of [
    "item('Cut', 'cut'",
    "item('Copy', 'copy'",
    "item('Paste', 'paste'",
    "item('Delete', 'delete'",
    "item('Bring to front', 'bringToFront'",
    "item('Bring forward', 'bringForward'",
    "item('Send backward', 'sendBackward'",
    "item('Send to back', 'sendToBack'",
    "item('Continue pin', 'continuePin'",
  ]) {
    assert.match(menuSrc, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(menuSrc, /Empty canvas \/ page — only Paste lives here/);
  assert.match(menuSrc, /Group \/ Ungroup items intentionally omitted/);
  assert.match(menuSrc, /callout menu parity/);
  assert.match(menuSrc, /four z-order items[\s\S]*DELIBERATELY EXCLUDED/);
  assert.match(menuSrc, /item\('Continue pin', 'continuePin', \(\) => \{/);
  assert.match(menuSrc, /handleContinuePin\(ctx\)/);
});

test('UL: pages-panel context menu Cut/Copy/Paste/Duplicate/Rotate/Mirror/Reset/Delete', () => {
  for (const label of ['Copy', 'Paste', 'Duplicate', 'Rotate', 'Mirror horizontally', 'Mirror vertically', 'Reset', 'Delete']) {
    assert.match(pagesSrc, new RegExp(`>\\s*${label}\\s*<`));
  }
});

test('UL: print range — Clear 0 stays none; letters stripped; custom inches clamp', () => {
  assert.deepEqual([...parseRange('1,3,5-7', 10)], [1, 3, 5, 6, 7]);
  assert.deepEqual([...parseRange('0', 10)], []);
  assert.deepEqual([...parseRange('99', 10)], []);
  assert.equal(filterRangeChars('1a,3!'), '1,3');
  assert.equal(clampRangeToMax('0', 36), '0');
  assert.equal(clampRangeToMax('999', 36), '36');
  assert.equal(sanitizeRangeInput('0', 36), '0');
  assert.equal(sanitizeRangeInput('12-9', 36), '9-12');
  assert.equal(sanitizeRangeInput('abc', 36), '');
  assert.equal(compactRange(new Set([1, 2, 3, 7])), '1-3, 7');
  assert.equal(parseCustomInches('', 8.5), 8.5);
  assert.equal(parseCustomInches('0', 8.5), 8.5);
  assert.equal(parseCustomInches('999', 8.5), 200);
  assert.equal(parseCustomInches('11.119', 8.5), 11.12);
  assert.match(printSrc, /setPagesToPrint\('0'\)/);
  assert.match(printSrc, />All</);
  assert.match(printSrc, />Current view</);
  assert.match(printSrc, />Clear</);
  assert.match(printSrc, /Mirror H/);
  assert.match(printSrc, /Mirror V/);
  assert.match(printSrc, /aria-label="Rotate clockwise"/);
  assert.match(printSrc, /Save as PDF/);
});

test('UL: form tools + properties fields + style/arrowhead/fit catalogs', () => {
  assert.deepEqual(FORM_TOOLS.map((t) => t.id), [
    'form-textbox',
    'form-checkbox',
    'form-radio',
    'form-signature',
  ]);
  assert.equal(isFormTool('form-textbox'), true);
  assert.equal(isFormTool('pen'), false);
  const update = buildFormFieldUpdate({ name: 'Q1', value: 'x', isRequired: true, isReadOnly: false, tooltip: 'hint' });
  assert.equal(update.name, 'Q1');
  assert.match(formPropsSrc, />Name</);
  assert.match(formPropsSrc, />Default value</);
  assert.match(formPropsSrc, />Tooltip</);
  assert.match(formPropsSrc, />Required</);
  assert.match(formPropsSrc, />Read only</);
  assert.match(formPropsSrc, /Delete field/);

  assert.match(appShellSrc, /\{ value: 'solid', label: 'Solid' \}/);
  assert.match(appShellSrc, /\{ value: 'dashed', label: 'Dashed' \}/);
  assert.match(appShellSrc, /\{ value: 'dotted', label: 'Dotted' \}/);
  assert.match(appShellSrc, /\{ value: 'cloud', label: 'Cloud' \}/);
  assert.match(appShellSrc, /aria-label="Cloud bump size"/);
  assert.match(appShellSrc, /aria-label="Edit text"/);
  assert.match(appShellSrc, /\+ New Count/);
  // Counter Start extracted to CounterStartNumberField (c3e4a7c1 / 03f5f2b4).
  // Desktop + 390 share the field. Do not move the aria-label back into AppShell.
  assert.match(counterStartSrc, /aria-label="Counter start number"/);
  assert.match(counterStartSrc, /disabled=\{locked\}/);
  assert.match(appShellSrc, /<CounterStartNumberField/);
  assert.match(appShellSrc, /locked=\{startLocked\}/);
  assert.doesNotMatch(appShellSrc, /aria-label="Counter start number"/);
  assert.match(mobileSrc, /<CounterStartNumberField/);
  assert.match(mobileSrc, /className="mobile-pdf-properties__start"/);
  assert.match(mobileSrc, /locked=\{startLocked\}/);
  assert.match(appShellSrc, /aria-label="Fit options"/);
  assert.deepEqual(Object.values(ARROWHEAD_STYLE_LABELS), [
    'None',
    'Solid triangle',
    'V-shape',
    'Open circle',
    'Open triangle',
    'Horizontal line',
  ]);
  assert.equal(clampScale(0.005), 0.01);
  assert.equal(ZOOM_MODES.FIT_PAGE, 'fitPage');
  assert.equal(ZOOM_MODES.FIT_WIDTH, 'fitWidth');
  assert.equal(ZOOM_MODES.FIT_HEIGHT, 'fitHeight');
});

test('UL: sync retry + mobile style/arrowhead surfaces exist', () => {
  assert.match(syncSrc, /aria-label="Retry now"/);
  assert.match(syncSrc, /aria-label="Sync status details"/);
  assert.match(mobileSrc, /\{ value: 'dashed', label: 'Dashed' \}/);
  assert.match(mobileSrc, /arrowheadStyle/);
  assert.match(mobileSrc, /aria-label=\{`Close \$\{title \|\| 'color'\} picker`\}/);
});

test('UL-06/07: zoom 1–4000 and page field reject 0 / overshoot', () => {
  assert.match(appShellSrc, /clamp to 1-4000/);
  assert.equal(clampScale(0), 0.01);
  assert.equal(clampScale(50), 40);
  assert.equal(coercePageNumber(0, 1), null);
  assert.equal(coercePageNumber(99, 1), null);
  assert.equal(coercePageNumber(1, 1), 1);
  assert.equal(coercePageNumber(3, 120), 3);
  assert.deepEqual(resolvePageThumbnailClick({ pageNumber: 0, numPages: 1 }), { kind: 'ignore' });
  assert.deepEqual(resolvePageThumbnailClick({ pageNumber: 99, numPages: 1 }), { kind: 'ignore' });
});

test('UL-11: desktop collapse chevron vs mobile Close document panel', () => {
  assert.match(sidebarSrc, /aria-label="Close document panel"/);
  assert.match(sidebarSrc, /if \(isCollapsed\) return;/);
  assert.match(sidebarSrc, /isCollapsed \? '48px' : '272px'/);
  assert.match(sidebarSrc, /mobileMode \? 'chevronDown' : \(isCollapsed \? 'chevronRight' : 'chevronLeft'\)/);
});

test('UL-13/15/16/17: profile save + password + unlink + delete confirm edges', () => {
  assert.equal(
    validatePasswordForm({
      kind: 'change',
      currentPassword: '',
      newPassword: 'x',
      confirmPassword: 'x',
    }).error,
    'Please enter your current password to change your password',
  );
  assert.equal(
    validatePasswordForm({
      kind: 'change',
      currentPassword: 'old',
      newPassword: 'a',
      confirmPassword: 'b',
    }).error,
    'New passwords do not match',
  );
  assert.equal(
    validatePasswordForm({
      kind: 'set',
      newPassword: 'short',
      confirmPassword: 'short',
      passwordMeetsRequirements,
    }).error,
    'Password does not meet requirements',
  );
  assert.equal(
    describeProfileSaveOutcome({ attemptedName: false, attemptedPassword: false }).kind,
    'noop',
  );
  assert.match(
    describeProfileSaveOutcome({
      attemptedName: true,
      nameSaved: true,
      attemptedPassword: true,
      passwordError: 'captcha',
    }).message,
    /name was saved/,
  );
  assert.equal(
    canUnlinkProvider({ identities: [{ provider: 'google' }] }, 'google').allowed,
    false,
  );
});

test('UL-24: Share Copy link blocks free-tier and missing target id', () => {
  assert.match(shareSrc, /Free plan accounts cannot create invite links/);
  assert.match(shareSrc, /This share dialog needs a target \$\{noun\} id/);
  assert.match(shareSrc, /mintInvite\(null\)/);
});

test('UL-40/41/42/43: print copies clamp, rotate wrap, markups/color/dest catalog', () => {
  assert.equal(clampCopies(''), 1);
  assert.equal(clampCopies(0), 1);
  assert.equal(clampCopies(-4), 1);
  assert.equal(clampCopies(1000), 999);
  assert.equal(clampCopies(12), 12);
  assert.equal(applyPageRotation(0, 90), 90);
  assert.equal(applyPageRotation(270, 90), 0);
  assert.equal(applyPageRotation(0, -90), 270);
  assert.match(printSrc, />Markups</);
  assert.match(printSrc, />Color</);
  assert.match(printSrc, />Collate</);
  assert.match(printSrc, />Duplex</);
  assert.match(printSrc, /Save as PDF/);
  assert.match(printSrc, /\{ id: 'letter', label: 'Letter/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /const PRINT_PANEL_ENABLED = false/);
});

test('UL-44/45: sync + presence hide when cloud off; offline shows Retry', () => {
  assert.deepEqual(getSyncStatusViewModel({ stage: 'idle' }, 0).state, 'synced');
  assert.equal(getSyncStatusViewModel({ stage: 'error' }, 2).state, 'offline');
  assert.match(getSyncStatusViewModel({ stage: 'error' }, 2).label, /2 saved locally/);
  assert.equal(getMobileSyncPresentation({}, 0, false).state, 'unavailable');
  assert.equal(getMobileSyncPresentation({}, 0, false).compactMessage, '');
  const users = normalizeMobilePresence({
    presence: [
      { user_id: 'a', display_name: 'Ann', last_seen: '1' },
      { user_id: 'a', display_name: 'Ann-web', last_seen: '9' },
      { user_id: 'b', display_name: 'Bob', last_seen: '8' },
    ],
    currentUserId: 'b',
  });
  assert.equal(users[0].id, 'b');
  assert.equal(users.length, 2);
  assert.equal(normalizeMobilePresence({ presence: [] }).length, 0);
});

test('U-02: Create space is local when there is no document id', () => {
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: true,
    documentId: null,
    documentOwnerId: null,
    viewerId: 'dev-test-user',
    documentRole: null,
  }), true);
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: false,
    documentId: null,
  }), false);
  const spacesSrc = read('src/sidebar/SpacesPanel.jsx');
  assert.match(spacesSrc, /aria-label=\{canManageSpaces \? 'Create space' : 'Upgrade to Pro to create spaces'\}/);
  assert.match(spacesSrc, /onSpaceCreate\(\{\s*assignedPages: \[\]\s*\}\)/s);
  assert.doesNotMatch(spacesSrc, /const name = `Space \$\{spaces\.length \+ 1\}`/);
  const viewer = read('src/PDFViewer.jsx');
  assert.match(viewer, /let generatedName = `Space \$\{counter\}`/);
  assert.match(viewer, /documentId: pdfFile\?\.id \|\| null/);
  assert.doesNotMatch(viewer, /file\.id\s*=/);
});
