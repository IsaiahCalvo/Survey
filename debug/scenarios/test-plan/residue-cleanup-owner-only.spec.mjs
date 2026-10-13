// KAL-420 test 9 (Phase 35 AC #9): the "Old annotations to clean up" notice
// and its Review panel show ONLY to the document's owner, once per document.
//
// Two people on the in-memory backend (tp-fake-backend.mjs; no network, no
// database): A = 'dev-test-user' owns the document, B = 'dev-test-user-b' is
// an editor it is shared with. The document has not moved to the live mark
// store yet (cutover not sealed) and its old mark table holds 3 of A's marks
// and 1 of B's. Both windows carry the dev seam window.__phase35SeedResidue
// = true ("treat the first 3 of MY marks in the old table as left-over"), so
// the ONLY thing that keeps B from seeing the notice is the owner check in
// YDocProvider's cleanup audit.
//
// Each window gets a signed-in Supabase session in local storage (the audit
// reads the viewer from supabase.auth.getSession(); the dev route has none
// otherwise). The token is a dummy: the fake backend never checks it.
//
// Run (not in CI; .env needs VITE_SUPABASE_URL/KEY so the client exists):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5491 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/residue-cleanup-owner-only.spec.mjs
// Start the dev server first and open the app once: on a cold server the
// first viewer load can take longer than the 90 s page wait. Screenshots go
// to TP_OUT (default: the shared test-plan output folder).
import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { DESKTOP, OUT_DIR, PHONE, report } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import { openWindow } from './tp-actions.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 300_000 });

// A small fixture: the PDF itself does not matter here, and the big one costs
// memory on a busy test machine.
const PDF = 'landscape-sheets.pdf';
const A_USER = { id: 'dev-test-user', email: 'dev@example.invalid' };
const B_USER = {
  id: 'dev-test-user-b',
  email: 'bo.reed@example.invalid',
  user_metadata: { first_name: 'Bo', last_name: 'Reed', full_name: 'Bo Reed' },
};
const DISMISSED_KEY = 'phase35.dismissedCleanupBanners';

// The app's auth storage key is sb-<project ref>-auth-token (supabaseClient.js).
function authStorageKey() {
  for (const file of ['.env.local', '.env']) {
    try {
      const m = readFileSync(file, 'utf8').match(/^VITE_SUPABASE_URL=["']?([^"'\s]+)/m);
      if (m) return `sb-${new URL(m[1]).hostname.split('.')[0]}-auth-token`;
    } catch { /* try the next file */ }
  }
  throw new Error('VITE_SUPABASE_URL not found in .env / .env.local');
}

function fakeSession(user) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const exp = Math.floor(Date.now() / 1000) + 24 * 3600;
  return {
    access_token: `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, role: 'authenticated', exp, email: user.email })}.fake`,
    token_type: 'bearer',
    expires_in: 24 * 3600,
    expires_at: exp,
    refresh_token: 'fake-refresh',
    user: { id: user.id, aud: 'authenticated', role: 'authenticated', email: user.email, user_metadata: user.user_metadata || {}, app_metadata: {} },
  };
}

function legacyRow(docId, userId, annotationId, page, left) {
  return {
    id: `row-${annotationId}`,
    document_id: docId,
    user_id: userId,
    annotation_id: annotationId,
    annotation_type: 'square',
    page_number: page,
    annotation_data: {
      fabricObject: { type: 'rect', id: annotationId, left, top: 120, width: 60, height: 40, fill: 'transparent', stroke: '#e53935', strokeWidth: 2, authorId: userId },
    },
    created_at: '2026-04-20T10:00:00.000Z',
    updated_at: '2026-04-20T10:00:00.000Z',
  };
}

// Not yet sealed onto the live mark store: the audit only runs for such
// documents (a sealed document renders from the Y.Doc, so old rows are moot).
// Opening one seals it, so the test un-seals it again before every open:
// otherwise a later window would skip the audit for THAT reason and the test
// would prove nothing about the owner check or the one-shot dismissal.
const unseal = (backend) => { backend.table('documents')[0].cutover_completed_at = null; };

function makeBackend(docId) {
  const backend = new FakeBackend({ documentId: docId });
  unseal(backend);
  backend.seedDocumentCollaborator({ userId: B_USER.id, role: 'editor', email: B_USER.email });
  const rows = backend.table('document_annotations');
  rows.push(legacyRow(docId, A_USER.id, 'a-old-1', 1, 100));
  rows.push(legacyRow(docId, A_USER.id, 'a-old-2', 1, 200));
  rows.push(legacyRow(docId, A_USER.id, 'a-old-3', 1, 300));
  rows.push(legacyRow(docId, B_USER.id, 'b-old-1', 1, 400));
  return backend;
}

async function openAs(browser, backend, docId, user, device, phone) {
  const key = authStorageKey();
  // openWindow creates the context; the session must be in storage before
  // the app boots, so wrap newContext to add it first.
  const realNewContext = browser.newContext.bind(browser);
  const patched = Object.create(browser);
  patched.newContext = async (opts) => {
    const context = await realNewContext(opts);
    await context.addInitScript(({ k, s }) => {
      try { localStorage.setItem(k, JSON.stringify(s)); } catch { /* private mode */ }
      window.__phase35SeedResidue = true;
    }, { k: key, s: fakeSession(user) });
    return context;
  };
  return openWindow(patched, backend, docId, PDF, {
    device,
    phone,
    user: user.id === A_USER.id ? null : user,
  });
}

const banner = (page) => page.locator('[role="alert"]').filter({ hasText: 'Old annotations to clean up' }).first();
const panel = (page) => page.locator('.cleanup-residue-review__card');

async function bannerShows(page, ms = 12_000) {
  try { await banner(page).waitFor({ state: 'visible', timeout: ms }); return true; } catch { return false; }
}

async function inViewport(page, locator) {
  const box = await locator.boundingBox();
  const vp = page.viewportSize();
  return Boolean(box) && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width + 0.5 && box.y + box.height <= vp.height + 0.5;
}

for (const variant of [
  { name: 'desktop', device: DESKTOP, phone: false },
  { name: 'phone', device: PHONE, phone: true },
]) {
  test(`KAL-420 test 9 [${variant.name}]: only the owner sees the clean-up notice and Review panel, once`, async ({ browser }) => {
    const docId = variant.phone ? '7e57d0c0-0000-4000-8000-000000000422' : '7e57d0c0-0000-4000-8000-000000000420';
    const backend = makeBackend(docId);
    const shot = (n) => `${OUT_DIR}/kal420-${variant.name}-${n}.png`;

    // B (editor, not owner) opens first: same seam, same old rows, no notice.
    const B = await openAs(browser, backend, docId, B_USER, variant.device, variant.phone);
    const bRole = backend.documentRoleFor(B_USER.id);
    const bSaw = await bannerShows(B.page, 8000);
    const bPanel = await panel(B.page).count();
    await B.page.screenshot({ path: shot('B-editor-no-notice') });

    // A (owner) opens: the notice shows with Review + Clean up.
    unseal(backend);
    const A = await openAs(browser, backend, docId, A_USER, variant.device, variant.phone);
    const aSaw = await bannerShows(A.page);
    const aBannerOnScreen = aSaw && await inViewport(A.page, banner(A.page));
    await A.page.screenshot({ path: shot('A-owner-notice') });

    // Review: the panel lists exactly A's 3 old marks (never B's).
    await A.page.getByRole('button', { name: 'Review old annotations' }).click();
    await panel(A.page).waitFor({ state: 'visible', timeout: 5000 });
    const heading = (await A.page.locator('#cleanup-residue-review-heading').textContent())?.trim();
    const listed = await A.page.locator('.cleanup-residue-review__sample-row code').allTextContents();
    const panelOnScreen = await inViewport(A.page, panel(A.page));
    await A.page.screenshot({ path: shot('A-owner-review-panel') });

    // Close keeps everything (no rows touched, notice still there).
    await A.page.getByRole('button', { name: 'Close review panel' }).click();
    await panel(A.page).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    const panelClosed = (await panel(A.page).count()) === 0;
    const rowsAfterClose = backend.table('document_annotations').length;
    const stillAfterClose = await banner(A.page).isVisible();

    let finishedBy;
    if (variant.phone) {
      // Phone: the × hides it for good without deleting anything.
      await A.page.getByRole('button', { name: 'Dismiss banner' }).click();
      finishedBy = 'dismiss';
    } else {
      // Desktop: Clean up all 3 from the panel removes only A's 3 rows.
      await A.page.getByRole('button', { name: 'Review old annotations' }).click();
      await A.page.getByRole('button', { name: 'Clean up all 3 annotations' }).click();
      finishedBy = 'clean-up';
    }
    await banner(A.page).waitFor({ state: 'hidden', timeout: 8000 });
    const rowsLeft = backend.table('document_annotations').map((r) => r.annotation_id).sort();
    const dismissedStored = await A.page.evaluate((k) => localStorage.getItem(k), DISMISSED_KEY);

    // One-shot: reopen the document — the notice does not come back.
    unseal(backend);
    await A.page.reload();
    await A.page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().waitFor({ timeout: 90_000 });
    const aSawAgain = await bannerShows(A.page, 8000);
    await A.page.screenshot({ path: shot('A-owner-after-reopen') });

    // B reopens too: still nothing.
    unseal(backend);
    await B.page.reload();
    await B.page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().waitFor({ timeout: 90_000 });
    const bSawAfter = await bannerShows(B.page, 6000);

    const errors = [...A.errors, ...B.errors];
    const expectedRows = variant.phone ? ['a-old-1', 'a-old-2', 'a-old-3', 'b-old-1'] : ['b-old-1'];
    const ok = bRole === 'editor' && !bSaw && bPanel === 0
      && aSaw && aBannerOnScreen
      && heading === '3 annotations to clean up'
      && JSON.stringify([...listed].sort()) === JSON.stringify(['a-old-1', 'a-old-2', 'a-old-3'])
      && panelOnScreen && panelClosed && stillAfterClose && rowsAfterClose === 4
      && JSON.stringify(rowsLeft) === JSON.stringify(expectedRows)
      && Boolean(dismissedStored && dismissedStored.includes(docId))
      && !aSawAgain && !bSawAfter && errors.length === 0;
    report('KAL-420-9', ok ? 'PASS' : 'FAIL', `B (role ${bRole}) saw notice=${bSaw}, panel=${bPanel}; A (owner) saw notice=${aSaw} (on screen ${aBannerOnScreen}); Review heading "${heading}", listed ${JSON.stringify(listed)} (on screen ${panelOnScreen}); Close -> panel gone=${panelClosed}, notice kept=${stillAfterClose}, rows ${rowsAfterClose}/4; finished by ${finishedBy} -> rows left ${JSON.stringify(rowsLeft)}, stored dismissal=${dismissedStored}; after reopen A saw it=${aSawAgain}, B saw it=${bSawAfter}; errors=${JSON.stringify(errors).slice(0, 300)}`, `two-accounts-${variant.name}`);
    await A.context.close();
    await B.context.close();
    expect(ok).toBe(true);
  });
}
