// Chrome-cluster E2E (wave 2): intended + break + edge Node contracts for
// survey counters/templates, bookmarks/pages, share/roles, account, billing,
// Microsoft/Excel, mobile sheets, Electron quit, and collab banners/outbox.
// Does not mount PDFViewer / Fabric / SVG canvases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deleteBookmarksById,
  isBookmarkPanelEmpty,
  prepareAtomicBookmarkEdit,
  prepareBookmarkCreate,
} from '../src/sidebar/bookmarkEditUtils.js';
import {
  applyBookmarkTreeProjection,
  flattenBookmarkTreeForSort,
  getBookmarkProjection,
} from '../src/sidebar/bookmarkReorderUtils.js';
import { isPagesPanelEmpty, resolvePageThumbnailClick } from '../src/sidebar/pagesPanelUtils.js';
import { thumbCacheKey } from '../src/services/thumbnailStore.js';
import {
  buildCounterSeriesDeletionUpdates,
  getCounterSeriesList,
  renumberCounters,
  resolveCounterSeriesPaint,
} from '../src/utils/counterNumbering.js';
import { sanitizeTemplateConfig } from '../src/utils/templateConfig.js';
import { canManageCollaborativeSpaces } from '../src/utils/collaborativeSpaceAccess.js';
import {
  INVITE_ACCEPT_STATUSES,
  acceptAnyInvite,
  inviteResultDescription,
  inviteResultHeading,
} from '../src/home/inviteAcceptState.js';
import { lastOwnerBlockReason } from '../src/home/lastOwnerGuard.js';
import {
  ACCOUNT_DELETION_CONFIRMATION,
  hasPasswordIdentity,
  isAccountDeletionConfirmation,
  passwordChangeKind,
  validatePasswordForm,
} from '../src/utils/accountPlatform.js';
import { passwordMeetsRequirements } from '../src/components/authFlow.js';
import {
  resolveBillingReturnUrl,
  withBillingResult,
} from '../supabase/functions/_shared/billingReturn.ts';
import {
  BILLING_PORTAL_RETURN_URL,
  checkoutStatusFromSubscription,
  getTierFromPriceId,
  shouldTreatCheckoutReplayAsNoop,
  trialDaysLeft,
} from '../supabase/functions/_shared/stripeWebhookPolicy.ts';
import { microsoftRedirectUriFor } from '../src/utils/microsoftOAuthRouting.js';
import { buildMarkerIdentityRecord } from '../src/services/excelIdentityRecord.js';
import {
  SHEET_CLOSE_MS,
  SHEET_DISMISS_DY,
  SHEET_DISMISS_VY,
  createSheetCloseController,
  shouldDismissSheet,
} from '../src/mobile/useMobileSheetMotion.js';
import {
  storageStateAfterResignIn,
  storageStateAfterSignedOut,
  storageStateWhenAccessRevoked,
} from '../src/components/collab/collabBannerState.js';
import { isSameReSignInUser } from '../src/components/collab/reSignInAccount.js';
import {
  STUCK_THRESHOLD_MS,
  summarizeOutboxRetry,
} from '../src/services/annotationOutboxRetryView.js';

const require = createRequire(import.meta.url);
const {
  shouldPreventFirstQuit,
  shouldQuitWhenLastWindowCloses,
  focusExistingMainWindow,
} = require('../src/electron/quitPolicy.cjs');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(root, rel), 'utf8');

const STRONG = 'Str0ng!Passw0rd';
const PRICE_ENV = {
  STRIPE_PRO_MONTHLY_PRICE_ID: 'price_pro_month',
  STRIPE_PRO_ANNUAL_PRICE_ID: 'price_pro_year',
  STRIPE_ENTERPRISE_PRICE_ID: 'price_ent',
};

const counter = (overrides = {}) => ({
  type: 'circle',
  fill: overrides.fill || '#ef4444',
  data: {
    type: 'counter',
    seriesId: 's1',
    createdAt: 1,
    seriesStart: 1,
    numberColor: '#ffffff',
    ...overrides.data,
  },
});

// ── S-05 Counter ──────────────────────────────────────────────────────────

test('S-05 intended: series numbers from seriesStart and createdAt order', () => {
  const pages = {
    1: { objects: [counter({ data: { createdAt: 30, seriesStart: 5 } })] },
    2: { objects: [counter({ data: { createdAt: 10, seriesStart: 5 } }), counter({ data: { createdAt: 20, seriesStart: 99 } })] },
  };
  renumberCounters(pages);
  const nums = [...pages[2].objects, ...pages[1].objects].map((obj) => obj.data.displayNumber);
  assert.deepEqual(nums, [5, 6, 7]);
  assert.equal(pages[1].objects[0].data.seriesStart, 5);
});

test('S-05 intended: fill and numberColor ride with the active series', () => {
  const pages = {
    1: {
      objects: [
        counter({ fill: '#0000ff', data: { numberColor: '#ffff00', createdAt: 1 } }),
        counter({ fill: '#00ff00', data: { seriesId: 's2', numberColor: '#111111', createdAt: 2 } }),
      ],
    },
  };
  const list = getCounterSeriesList(pages);
  assert.deepEqual(resolveCounterSeriesPaint(list, 's1'), { fill: '#0000ff', numberColor: '#ffff00' });
  assert.deepEqual(resolveCounterSeriesPaint(list, 's2'), { fill: '#00ff00', numberColor: '#111111' });
});

test('S-05 break: last-in-series delete leaves the remaining pin as  seriesStart', () => {
  const pages = {
    1: {
      objects: [
        counter({ data: { createdAt: 1, seriesStart: 3 } }),
        counter({ data: { createdAt: 2, seriesStart: 3 } }),
      ],
    },
  };
  const plan = buildCounterSeriesDeletionUpdates(pages, 'missing');
  assert.equal(plan.removedCount, 0);
  const after = {
    1: { objects: [pages[1].objects[0]] },
  };
  renumberCounters(after);
  assert.equal(after[1].objects[0].data.displayNumber, 3);
});

test('S-05 edge: empty / invalid / legacy pins do not invent a series', () => {
  assert.equal(renumberCounters(null), null);
  assert.deepEqual(getCounterSeriesList(undefined), []);
  assert.deepEqual(buildCounterSeriesDeletionUpdates({ 1: { objects: [] } }, '').removedCount, 0);
  const pages = { 1: { objects: [counter({ data: { seriesId: undefined, createdAt: 1 } })] } };
  assert.deepEqual(getCounterSeriesList(pages), []);
  renumberCounters(pages);
  assert.equal(pages[1].objects[0].data.displayNumber, 1);
  assert.deepEqual(
    resolveCounterSeriesPaint([], 'ghost', '#ef4444', '#ffffff'),
    { fill: '#ef4444', numberColor: '#ffffff' },
  );
});

// ── U-01 / U-02 / U-03 Survey rail / spaces / templates ───────────────────

test('U-01 intended: survey rail category pick dismisses the sheet, never resets the PDF', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /dismissSurveySheet\(\)/);
  assert.match(rail, /setSelectedCategoryId\(category\.id\)/);
  assert.doesNotMatch(rail, /setPdfDoc\(/);
});

test('U-02 intended + break: spaces require Advanced Survey and an editing role', () => {
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: true, documentId: 'd', documentOwnerId: 'o', viewerId: 'o', documentRole: 'viewer',
  }), true);
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: true, documentId: 'd', documentOwnerId: 'o', viewerId: 'e', documentRole: 'editor',
  }), true);
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: true, documentId: 'd', documentOwnerId: 'o', viewerId: 'v', documentRole: 'viewer',
  }), false);
  assert.equal(canManageCollaborativeSpaces({
    hasAdvancedSurvey: false, documentId: 'd', documentOwnerId: 'o', viewerId: 'o', documentRole: 'owner',
  }), false);
});

test('U-03 intended + edge: template persist strips supabaseId; overwrite modal warns', () => {
  const raw = { id: 't1', name: 'Site', supabaseId: 'row-9', modules: [] };
  assert.deepEqual(sanitizeTemplateConfig(raw), { id: 't1', name: 'Site', modules: [] });
  assert.equal(raw.supabaseId, 'row-9');
  assert.equal(sanitizeTemplateConfig(null), null);
  const modal = read('src/components/TemplateOverwriteWarningModal.jsx');
  assert.match(modal, /reason === 'file-exists'/);
  assert.match(modal, /existingTemplateName/);
  assert.match(modal, /onConfirm/);
  assert.match(modal, /onCancel/);
});

// ── V-06 Pages panel ──────────────────────────────────────────────────────

test('V-06 intended: thumbnail click jumps; collapse flips; cache keys on file change', () => {
  assert.deepEqual(
    resolvePageThumbnailClick({ pageNumber: 3, numPages: 10 }),
    { kind: 'navigate', pageNumber: 3 },
  );
  const nextSidebarCollapsed = (isCollapsed) => !isCollapsed;
  assert.equal(nextSidebarCollapsed(false), true);
  assert.equal(nextSidebarCollapsed(true), false);
  assert.notEqual(
    thumbCacheKey({ id: 'doc', file_path: 'u1/aaaa.pdf' }),
    thumbCacheKey({ id: 'doc', file_path: 'u1/bbbb.pdf' }),
  );
});

test('V-06 break: out-of-range and non-integer pages are ignored', () => {
  assert.deepEqual(resolvePageThumbnailClick({ pageNumber: 0, numPages: 2 }), { kind: 'ignore' });
  assert.deepEqual(resolvePageThumbnailClick({ pageNumber: 9, numPages: 2 }), { kind: 'ignore' });
  assert.deepEqual(resolvePageThumbnailClick({ pageNumber: 'x' }), { kind: 'ignore' });
});

test('V-06 edge: 1-page jump works; empty doc; mobile select does not navigate', () => {
  assert.deepEqual(
    resolvePageThumbnailClick({ pageNumber: 1, numPages: 1 }),
    { kind: 'navigate', pageNumber: 1 },
  );
  assert.equal(isPagesPanelEmpty(0), true);
  assert.equal(isPagesPanelEmpty(1), false);
  assert.deepEqual(
    resolvePageThumbnailClick({ pageNumber: 2, numPages: 8, mobileMode: true, mobileSelectMode: true }),
    { kind: 'toggle-select', pageNumber: 2 },
  );
});

// ── V-07 Bookmarks ────────────────────────────────────────────────────────

test('V-07 intended: create, rename, reorder, delete', () => {
  const created = prepareBookmarkCreate({
    bookmarks: [],
    name: '  Roof  ',
    page: '2',
    numPages: 4,
  });
  assert.deepEqual(created, { ok: true, updates: { name: 'Roof', pageIds: [2] } });

  const bookmarks = [
    { id: 'a', name: 'Entrance', type: 'bookmark', pageIds: [1] },
    { id: 'b', name: 'Roof', type: 'bookmark', pageIds: [2] },
  ];
  assert.deepEqual(prepareAtomicBookmarkEdit({
    bookmarks, bookmark: bookmarks[0], name: 'Main', page: '3', numPages: 4,
  }).updates, { name: 'Main', pageIds: [3] });

  const tree = [
    { id: 'cover', name: 'cover', type: 'bookmark', pageIds: [1], order: 0 },
    { id: 'riser', name: 'riser', type: 'bookmark', pageIds: [2], order: 1 },
  ];
  const visible = flattenBookmarkTreeForSort(tree);
  const projection = getBookmarkProjection(visible, 'riser', 'cover', 0);
  const next = applyBookmarkTreeProjection(tree, 'riser', 'cover', projection);
  assert.deepEqual(next.map((item) => item.id), ['riser', 'cover']);

  assert.deepEqual(
    deleteBookmarksById(bookmarks, 'a').map((item) => item.id),
    ['b'],
  );
});

test('V-07 break: empty name, clash, invalid page leave the list untouched', () => {
  const bookmarks = [
    { id: 'a', name: 'Entrance', type: 'bookmark', pageIds: [1] },
    { id: 'b', name: 'Roof', type: 'bookmark', pageIds: [2] },
  ];
  const snapshot = structuredClone(bookmarks);
  assert.equal(prepareBookmarkCreate({ bookmarks, name: '   ', page: '1', numPages: 4 }).ok, false);
  assert.equal(prepareBookmarkCreate({ bookmarks, name: 'Roof', page: '3', numPages: 4 }).ok, false);
  assert.equal(prepareBookmarkCreate({ bookmarks, name: 'New', page: '9', numPages: 4 }).ok, false);
  assert.equal(prepareBookmarkCreate({ bookmarks, name: 'New', page: 'abc', numPages: 4 }).ok, false);
  assert.deepEqual(bookmarks, snapshot);
});

test('V-07 edge: empty panel; deleting a folder drops descendants; missing id is a no-op', () => {
  assert.equal(isBookmarkPanelEmpty([]), true);
  assert.equal(isBookmarkPanelEmpty(null), true);
  const tree = [
    { id: 'folder', name: 'Details', type: 'folder', parentId: null },
    { id: 'child', name: 'Panel', type: 'bookmark', parentId: 'folder' },
    { id: 'keep', name: 'Keep', type: 'bookmark', parentId: null },
  ];
  assert.deepEqual(deleteBookmarksById(tree, 'folder').map((item) => item.id), ['keep']);
  assert.deepEqual(deleteBookmarksById(tree, 'missing').map((item) => item.id), ['folder', 'child', 'keep']);
});

// ── A-03 Invites + roles ──────────────────────────────────────────────────

test('A-03 intended: every accept status has heading + description', () => {
  assert.deepEqual(INVITE_ACCEPT_STATUSES, [
    'accepted', 'already_accepted', 'wrong_account', 'expired', 'revoked', 'invalid',
  ]);
  for (const status of INVITE_ACCEPT_STATUSES) {
    const heading = inviteResultHeading({ phase: 'result', result: { status } });
    const description = inviteResultDescription({ phase: 'result', result: { status } });
    assert.ok(heading.length > 0, status);
    assert.ok(description.length > 0, status);
  }
  assert.match(inviteResultHeading({ phase: 'result', result: { status: 'expired' } }), /expired/);
});

test('A-03 break: last owner cannot be demoted or removed', () => {
  const lastOwner = [{ user_id: 'o', role: 'owner' }, { user_id: 'e', role: 'editor' }];
  const twoOwners = [{ user_id: 'o', role: 'owner' }, { user_id: 'o2', role: 'owner' }];
  assert.match(
    lastOwnerBlockReason({ members: lastOwner, member: lastOwner[0], action: 'demote', nextRole: 'editor' }),
    /last owner/,
  );
  assert.match(
    lastOwnerBlockReason({ members: lastOwner, member: lastOwner[0], action: 'remove' }),
    /last owner/,
  );
  assert.equal(
    lastOwnerBlockReason({ members: twoOwners, member: twoOwners[0], action: 'demote', nextRole: 'editor' }),
    null,
  );
  assert.equal(
    lastOwnerBlockReason({ members: lastOwner, member: lastOwner[1], action: 'remove' }),
    null,
  );
});

test('A-03 edge: expired/revoked stop fall-through; only hard invalid tries the next kind', async () => {
  const calls = [];
  const accept = (kind, status) => async (token) => {
    calls.push(`${kind}:${token}`);
    return { status };
  };
  const expired = await acceptAnyInvite('tok', {
    acceptDocumentInvite: accept('doc', 'expired'),
    acceptProjectInvite: accept('proj', 'accepted'),
    acceptTemplateInvite: accept('tpl', 'accepted'),
  });
  assert.equal(expired.status, 'expired');
  assert.equal(expired.kind, 'document');
  assert.deepEqual(calls, ['doc:tok']);

  calls.length = 0;
  const accepted = await acceptAnyInvite('tok', {
    acceptDocumentInvite: accept('doc', 'invalid'),
    acceptProjectInvite: accept('proj', 'invalid'),
    acceptTemplateInvite: accept('tpl', 'accepted'),
  });
  assert.equal(accepted.kind, 'template');
  assert.deepEqual(calls, ['doc:tok', 'proj:tok', 'tpl:tok']);

  assert.equal((await acceptAnyInvite('', {
    acceptDocumentInvite: accept('doc', 'accepted'),
    acceptProjectInvite: accept('proj', 'accepted'),
    acceptTemplateInvite: accept('tpl', 'accepted'),
  })).status, 'invalid');
});

// ── A-04 Account settings ─────────────────────────────────────────────────

test('A-04 intended: linkIdentity, typed DELETE, Google-only set-password', () => {
  const settings = read('src/components/AccountSettings.jsx');
  const platform = read('src/utils/accountPlatform.js');
  assert.match(settings, /linkGoogleIdentity\(\)/);
  assert.match(platform, /auth\.linkIdentity\(/);
  assert.doesNotMatch(platform, /signInWithOAuth/);
  assert.equal(isAccountDeletionConfirmation(ACCOUNT_DELETION_CONFIRMATION), true);
  assert.equal(passwordChangeKind({ identities: [{ provider: 'google' }] }), 'set');
  assert.equal(hasPasswordIdentity({ identities: [{ provider: 'email' }] }), true);
});

test('A-04 break: change-password without current password; weak DELETE confirm', () => {
  assert.equal(isAccountDeletionConfirmation('delete'), false);
  assert.equal(isAccountDeletionConfirmation(' DELETE '), true);
  assert.match(
    validatePasswordForm({ kind: 'change', newPassword: STRONG, confirmPassword: STRONG }).error,
    /current password/,
  );
  assert.equal(
    validatePasswordForm({
      kind: 'set',
      newPassword: STRONG,
      confirmPassword: STRONG,
      passwordMeetsRequirements,
    }).changing,
    true,
  );
});

// ── A-05 Billing return / trial / webhook ─────────────────────────────────

test('A-05 intended: success/cancel stay on the requested host; trial maps status', () => {
  const requested = 'https://surveytool.app/mobile?nativeShell=expo';
  assert.equal(resolveBillingReturnUrl(requested, 'https://surveytool.app'), requested);
  assert.equal(withBillingResult(requested, 'success'), `${requested}&billing=success`);
  assert.equal(checkoutStatusFromSubscription('trialing'), 'trialing');
  assert.equal(checkoutStatusFromSubscription('active'), 'active');
  assert.equal(getTierFromPriceId('price_pro_year', PRICE_ENV), 'pro');
  assert.equal(getTierFromPriceId('price_ent', PRICE_ENV), 'enterprise');
  assert.equal(trialDaysLeft(1_700_000_000, 1_699_740_800_000), 3);
});

test('A-05 break: open redirects, file://, javascript:, Origin null collapse to canonical', () => {
  assert.equal(resolveBillingReturnUrl('https://evil.example/steal', 'https://surveytool.app'), 'https://surveytool.app/');
  assert.equal(resolveBillingReturnUrl('javascript:alert(1)', 'https://surveytool.app'), 'https://surveytool.app/');
  assert.equal(resolveBillingReturnUrl('file:///tmp/x', 'null'), 'https://surveytool.app/');
  assert.equal(resolveBillingReturnUrl('https://surveytool.app/#secret', 'https://surveytool.app'), 'https://surveytool.app/');
  assert.equal(getTierFromPriceId('price_unknown', PRICE_ENV), 'free');
  assert.equal(getTierFromPriceId(null, PRICE_ENV), 'free');
  assert.equal(trialDaysLeft(0), 0);
});

test('A-05 edge: localhost/www allowed; identical checkout replay is a noop; CORS stays *', () => {
  assert.equal(
    resolveBillingReturnUrl('http://localhost:5173/app', 'http://localhost:5173'),
    'http://localhost:5173/app',
  );
  assert.equal(
    resolveBillingReturnUrl('https://www.surveytool.app/', 'https://surveytool.app'),
    'https://www.surveytool.app/',
  );
  const same = { stripe_subscription_id: 'sub_1', stripe_price_id: 'price_pro_month', status: 'trialing' };
  assert.equal(shouldTreatCheckoutReplayAsNoop(same, same), true);
  assert.equal(shouldTreatCheckoutReplayAsNoop(null, same), false);
  assert.equal(shouldTreatCheckoutReplayAsNoop(same, { ...same, status: 'active' }), false);
  assert.equal(BILLING_PORTAL_RETURN_URL, 'https://surveytool.app/');
  const checkout = read('supabase/functions/create-checkout-session/index.ts');
  const portal = read('supabase/functions/create-portal-session/index.ts');
  const webhook = read('supabase/functions/stripe-webhook/index.ts');
  assert.match(checkout, /Access-Control-Allow-Origin': '\*'/);
  assert.match(portal, /Access-Control-Allow-Origin': '\*'/);
  assert.match(webhook, /BILLING_PORTAL_RETURN_URL/);
  assert.doesNotMatch(webhook, /www\.google\.com/);
});

// ── A-02 / X-06 Microsoft + Excel ─────────────────────────────────────────

test('A-02 intended: Electron file:// Microsoft redirect is the production origin', () => {
  assert.equal(
    microsoftRedirectUriFor({ origin: 'null', protocol: 'file:', pathname: '/index.html' }),
    'https://surveytool.app/',
  );
  const main = read('src/electron-main.js');
  assert.match(main, /registerMicrosoftAuthIpc\(\{ ipcMain, app, shell, safeStorage \}\)/);
  const authMain = read('src/electron/msalAuthMain.js');
  assert.match(authMain, /shell\.openExternal\(url\)/);
});

test('X-06 intended + edge: identity fingerprints ignore bad row numbers', async () => {
  const values = { item: 'Door 12', answers: { a: 'Y' } };
  const rec = await buildMarkerIdentityRecord({
    values,
    exportId: 'e1',
    lastSeenRowNumber: 0,
    lastIngestSeq: 1.5,
  });
  assert.equal(rec.lastSeenRowNumber, null);
  assert.equal(rec.lastIngestSeq, null);
  assert.equal(rec.wasWrittenAsRow, true);
  const imported = await buildMarkerIdentityRecord({ values, origin: 'import', lastSeenRowNumber: 12, lastIngestSeq: 3 });
  assert.equal(imported.wasWrittenAsRow, false);
  assert.equal(imported.lastSeenRowNumber, 12);
});

// ── P-01 Mobile sheets / P2-35 ────────────────────────────────────────────

test('P-01 intended: dismiss thresholds and 170ms close timer', () => {
  assert.equal(shouldDismissSheet(SHEET_DISMISS_DY + 1, 0), true);
  assert.equal(shouldDismissSheet(0, SHEET_DISMISS_VY + 0.01), true);
  assert.equal(shouldDismissSheet(SHEET_DISMISS_DY, SHEET_DISMISS_VY), false);
  assert.equal(SHEET_CLOSE_MS, 170);
});

test('P-01 break: cancelled close cannot fire after reopen', () => {
  let captured = null;
  const controller = createSheetCloseController((fn) => { captured = fn; return 1; }, () => {});
  const fired = [];
  controller.schedule(() => fired.push('stale'), SHEET_CLOSE_MS);
  controller.cancel();
  captured();
  assert.deepEqual(fired, []);
});

test('P-01 edge: live sheet still needs a Capacitor window for finger-follow', () => {
  const hook = read('src/mobile/useMobileSheetMotion.js');
  assert.match(hook, /touchcancel/);
  assert.match(hook, /SHEET_CLOSE_MS/);
});

// ── P-03 Electron quit / single-instance ──────────────────────────────────

test('P-03 intended: first quit is deferred; second instance focuses the existing window', () => {
  assert.equal(shouldPreventFirstQuit(false), true);
  assert.equal(shouldPreventFirstQuit(true), false);
  const win = {
    destroyed: false,
    minimized: true,
    restored: false,
    focused: false,
    shown: false,
    isDestroyed() { return this.destroyed; },
    isMinimized() { return this.minimized; },
    restore() { this.minimized = false; this.restored = true; },
    show() { this.shown = true; },
    focus() { this.focused = true; },
  };
  assert.equal(focusExistingMainWindow(win), true);
  assert.equal(win.restored, true);
  assert.equal(win.focused, true);
  const main = read('src/electron-main.js');
  assert.match(main, /requestSingleInstanceLock\(\)/);
  assert.match(main, /second-instance/);
  assert.match(main, /app:beforeQuit/);
});

test('P-03 break: destroyed / missing window is a no-op; macOS keeps the app alive', () => {
  assert.equal(focusExistingMainWindow(null), false);
  assert.equal(focusExistingMainWindow({ isDestroyed: () => true }), false);
  assert.equal(shouldQuitWhenLastWindowCloses('darwin'), false);
  assert.equal(shouldQuitWhenLastWindowCloses('win32'), true);
  assert.equal(shouldQuitWhenLastWindowCloses('linux'), true);
});

test('P-03 remaining: live Open/Export/Print menus need an Electron window', () => {
  const main = read('src/electron-main.js');
  assert.match(main, /createAppMenu/);
  assert.match(main, /role: 'quit'|label: 'Quit'|app\.quit\(\)/);
});

// ── A-06 / X-01 Collab banners + outbox ───────────────────────────────────

test('A-06 intended: revoke outranks expiry through re-sign-in', () => {
  const revoked = storageStateWhenAccessRevoked({ code: 'ok', role: 'editor' });
  assert.equal(revoked.code, 'permission_revoked');
  assert.equal(storageStateAfterSignedOut({ accessRevoked: true, current: revoked }).code, 'permission_revoked');
  assert.equal(storageStateAfterResignIn({ accessRevoked: true, currentCode: 'login_expiry_failure' }).code, 'permission_revoked');
});

test('A-06 break: wrong-account re-sign-in is rejected; expiry without revoke clears', () => {
  assert.equal(isSameReSignInUser('user-1', 'user-2'), false);
  assert.equal(isSameReSignInUser('user-1', 'user-1'), true);
  assert.deepEqual(
    storageStateAfterResignIn({ accessRevoked: false, currentCode: 'login_expiry_failure' }),
    { code: 'ok', role: 'unknown' },
  );
});

test('X-01 intended + edge: outbox retry treats 30s leftovers as stuck; missing queuedAt is stuck', () => {
  const now = Date.now();
  const fresh = summarizeOutboxRetry({
    pending: [{ key: 'k1', documentId: 'doc-a', status: 'pending', queuedAt: now - 1000 }],
    now,
  });
  assert.equal(fresh.hasPending, true);
  assert.equal(fresh.stuckCount, 0);
  const stuck = summarizeOutboxRetry({
    pending: [{ key: 'k2', documentId: 'doc-a', status: 'pending', queuedAt: now - STUCK_THRESHOLD_MS - 1 }],
    now,
  });
  assert.equal(stuck.stuckCount, 1);
  const missing = summarizeOutboxRetry({
    pending: [{ key: 'k3', documentId: 'doc-a', status: 'pending' }],
    now,
  });
  assert.equal(missing.stuckCount, 1);
});

// ── Wiring: extracted helpers stay connected ──────────────────────────────

test('chrome wiring: pages, bookmarks, invites, last-owner, quit, webhook use the tested seams', () => {
  assert.match(read('src/sidebar/PagesPanel.jsx'), /resolvePageThumbnailClick\(/);
  assert.match(read('src/sidebar/BookmarksPanel.jsx'), /prepareBookmarkCreate\(/);
  assert.match(read('src/home/InviteAcceptPage.jsx'), /inviteResultHeading\(/);
  assert.match(read('src/home/AccessManagementModal.jsx'), /lastOwnerBlockReason\(/);
  assert.match(read('src/electron-main.js'), /shouldPreventFirstQuit\(isQuitting\)/);
  assert.match(read('supabase/functions/stripe-webhook/index.ts'), /trialDaysLeft\(/);
});
