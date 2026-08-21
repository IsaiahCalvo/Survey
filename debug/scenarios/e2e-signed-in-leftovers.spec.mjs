import { test, expect } from '@playwright/test';

// Live leftovers that a single signed-in user can attempt.
// Do not wipe. Do not click Stripe. Do not invent captcha / MSAL / Capacitor.
// Do not stamp file.id on ?testPdf=. Do not send invite emails.

function sanitizeAuthLog(text) {
  return String(text || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]');
}

async function waitSignedInHub(page) {
  const pageErrors = [];
  const authLogs = [];
  page.on('pageerror', (err) => pageErrors.push(String(err?.message || err)));
  page.on('console', (msg) => {
    const text = msg.text();
    if (/dev-auto-login|captcha|sign-in FAILED|creds NOT loaded/i.test(text)) {
      authLogs.push(sanitizeAuthLog(text).slice(0, 180));
    }
  });
  await page.addInitScript(() => { window.__AUTH_DEBUG = true; });
  await page.goto('/');
  const envFlags = { fromFile: true };

  const guest = page.locator('.profile-signin');
  const authModal = page.locator('.auth-modal');
  const accountMenu = page.getByRole('button', { name: 'Open account menu' });
  const firstDoc = page.locator('.documents-desktop-card [data-document-id]').first();
  const skeleton = page.locator('.hub-skeleton-block');
  const emptyDocs = page.getByText('No documents yet');
  const loadError = page.getByText(/could not be loaded|Failed to load/i);

  // Guest Sign in is visible while auth is still loading. Wait for the
  // account menu (or a stable guest after auto-login has logged).
  try {
    await accountMenu.waitFor({ state: 'visible', timeout: 45_000 });
  } catch {
    return {
      signedIn: false,
      state: (await authModal.count()) ? 'auth' : 'guest',
      envFlags,
      authLogs,
      pageErrors,
    };
  }

  await expect.poll(async () => {
    if (await firstDoc.count()) return 'docs';
    if (await loadError.count()) return 'error';
    if ((await skeleton.count()) > 0) return 'loading';
    if (await emptyDocs.first().isVisible()) return 'empty';
    return 'loading';
  }, { timeout: 45_000 }).not.toBe('loading');

  const docs = await firstDoc.count();
  const state = docs ? 'docs' : ((await loadError.count()) ? 'error' : 'empty');
  return { signedIn: true, state, envFlags, authLogs, pageErrors };
}

test('signed-in leftovers: document, named revisions, share mint, outbox, presence', async ({ page }) => {
  test.setTimeout(240_000);
  page.on('dialog', (dialog) => dialog.dismiss().catch(() => {}));

  const boot = await waitSignedInHub(page);
  console.log('AUTOLOGIN', JSON.stringify({
    signedIn: boot.signedIn,
    state: boot.state,
    href: page.url(),
    pageErrorCount: (boot.pageErrors || []).length,
    authLogs: boot.authLogs || [],
  }));
  if (!boot.signedIn) {
    test.info().annotations.push({ type: 'blocker', description: `auto-login did not produce a hub session (${boot.state})` });
    return;
  }

  const firstDoc = page.locator('.documents-desktop-card [data-document-id]').first();
  const emptyDocs = page.getByText('No documents yet').first();
  const hasDoc = await firstDoc.count();
  if (!hasDoc) {
    const emptyVisible = await emptyDocs.isVisible().catch(() => false);
    console.log('OPEN_DOC', JSON.stringify({
      opened: false,
      reason: boot.state === 'error' ? 'documents load error' : 'no documents on this account',
      emptyVisible,
    }));
    test.info().annotations.push({ type: 'blocker', description: boot.state === 'error' ? 'signed-in documents load error' : 'signed-in hub has no documents to open' });
    return;
  }

  const docId = await firstDoc.getAttribute('data-document-id');
  await firstDoc.click({ timeout: 10_000 });
  const openFile = page.getByRole('button', { name: 'Open file' });
  await expect(openFile).toBeVisible({ timeout: 15_000 });
  await openFile.click();

  await expect(page.getByRole('button', { name: 'Draw', exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.locator('[data-svg-annotation-layer="1"]')).toBeVisible({ timeout: 60_000 });
  console.log('OPEN_DOC', JSON.stringify({
    opened: true,
    documentIdPresent: Boolean(docId),
    documentIdLooksUuid: /^[0-9a-f-]{36}$/i.test(docId || ''),
  }));

  // A-07 cloud named revisions — observe only; do not invent a new named snapshot.
  const historyBtn = page.getByRole('button', { name: 'Version history' });
  await expect(historyBtn).toBeVisible({ timeout: 15_000 });
  await historyBtn.click();
  const revisionsPanel = page.getByTestId('kal48-revisions-panel');
  await expect(revisionsPanel).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => {
    const loading = await revisionsPanel.getByText('Loading…').count();
    return loading === 0;
  }, { timeout: 20_000 }).toBe(true);

  const namedRows = revisionsPanel.locator('[data-testid^="kal48-revision-row-"]');
  const namedCount = await namedRows.count();
  const emptyCopy = await revisionsPanel.getByText(/No history yet|save a named version/i).count();
  const eventRows = await revisionsPanel.locator('[data-testid^="document-history-event-"]').count();
  const saveVersion = await revisionsPanel.getByTestId('kal48-save-revision').count();
  let openedNamed = false;
  if (namedCount > 0) {
    await namedRows.first().click();
    openedNamed = await page.getByText(/Viewing revision v/i).count() > 0;
    const returnCurrent = page.getByRole('button', { name: 'Return to current' });
    if (await returnCurrent.count()) await returnCurrent.click();
  }
  console.log('NAMED_REVISIONS', JSON.stringify({
    namedCount,
    eventRows,
    emptyCopy: emptyCopy > 0,
    saveVersionVisible: saveVersion > 0,
    openedNamed,
  }));

  // Presence: self row is allowed; two-client roster is not proven here.
  const presenceCaption = page.getByText(/just you|\d+ viewing/i);
  const presenceVisible = await presenceCaption.count();
  const viewingCountText = presenceVisible ? (await presenceCaption.first().textContent()) : null;
  const twoClient = /([2-9]|\d{2,}) viewing/.test(viewingCountText || '');
  console.log('PRESENCE', JSON.stringify({
    visible: presenceVisible > 0,
    caption: viewingCountText,
    twoClientRoster: twoClient,
  }));

  // Outbox Retry — only flush if a pending/offline chip already exists.
  const retryNow = page.getByRole('button', { name: 'Retry now' });
  const syncChip = page.getByRole('button', { name: /Up to date|Saving|Syncing|Offline|Sync error/i }).first();
  const syncLabel = await syncChip.getAttribute('aria-label').catch(() => null);
  const pendingLike = /Offline|saved locally|Sync error|Saving/i.test(syncLabel || '');
  let retried = false;
  if (pendingLike) {
    await syncChip.click();
    if (await retryNow.count()) {
      await retryNow.click();
      retried = true;
    }
  }
  console.log('OUTBOX_RETRY', JSON.stringify({
    syncLabel,
    pendingLike,
    retried,
    retryVisible: await retryNow.count(),
  }));

  // Share copy-link mint from hub (owner path: Manage Access → Invite → Copy link).
  await page.goto('/');
  await expect(page.locator('.documents-desktop-card [data-document-id]').first()).toBeVisible({ timeout: 45_000 });
  await page.locator('.documents-desktop-card [data-document-id]').first().click({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Share' }).click();

  const manage = page.getByText(/Manage access|collaborator|Invite/i).first();
  const shareDialog = page.getByRole('dialog', { name: /Share document|Share /i });
  await expect.poll(async () => (
    (await page.getByRole('button', { name: 'Invite' }).count())
    + (await shareDialog.count())
  ), { timeout: 15_000 }).toBeGreaterThan(0);

  if (await page.getByRole('button', { name: 'Invite' }).count()) {
    await page.getByRole('button', { name: 'Invite' }).click();
  }

  const copyLink = page.getByRole('button', { name: 'Copy link' });
  await expect(copyLink).toBeVisible({ timeout: 10_000 });
  await copyLink.click();

  let mintResult = 'wait';
  let shareText = '';
  await expect.poll(async () => {
    shareText = await page.locator('[role="dialog"]').filter({ has: copyLink }).textContent() || '';
    if (/Link copied|invite\/|surveytool\.app\/invite/i.test(shareText)) {
      mintResult = 'minted';
      return 'minted';
    }
    if (/Could not create invite|signed-in cloud|Free plan|target .* id|Must be signed in/i.test(shareText)) {
      mintResult = 'blocked';
      return 'blocked';
    }
    return 'wait';
  }, { timeout: 20_000 }).not.toBe('wait');

  const fakeUrl = /https:\/\/surveytool\.app\/invite\/fake/i.test(shareText);
  const errorHint = (shareText.match(/Could not create invite[^.]*|Free plan[^.]*/i) || [null])[0];
  console.log('SHARE_MINT', JSON.stringify({
    result: mintResult,
    fakeUrl,
    errorHint: errorHint ? errorHint.slice(0, 80) : null,
    copyVisible: true,
    stripeNotClicked: true,
    emailNotSent: true,
  }));

  expect(fakeUrl).toBe(false);
});
