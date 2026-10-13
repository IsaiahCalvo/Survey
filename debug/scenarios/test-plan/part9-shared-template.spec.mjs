// TEST-PLAN item 62 with TWO ACCOUNTS on the in-memory backend (2026-10-07).
//
// On the real backend item 62 failed: collaborator B never got owner A's
// survey template, so B's Survey panel said "No templates available" and A's
// survey markers never showed in B. Owner's decision: people a document is
// shared with get its survey template ("Yes, they can use and edit it").
//
// Here window A is the document's owner ('dev-test-user', who owns the
// template row) and window B is a second person ('dev-test-user-b') the
// document is shared with as editor. tp-fake-backend.mjs answers the template
// tables under the real row-level rules (only the template's owner can add a
// template_collaborators row; a collaborator can read the template). Nothing
// gives B the template except the app: A's viewer grants it when A works on
// the shared document. No network, no database.
// Run (not in CI; .env needs VITE_SUPABASE_URL/KEY so the client exists):
//   PW_CHROMIUM_PATH=/opt/pw-browsers/chromium PLAYWRIGHT_BASE_URL=http://127.0.0.1:5491 \
//     npx playwright test --config debug/playwright.config.mjs debug/scenarios/test-plan/part9-shared-template.spec.mjs
import { test, expect } from '@playwright/test';
import { OUT_DIR, report } from './tp-local-doc.mjs';
import { FakeBackend } from './tp-fake-backend.mjs';
import { openWindow, selectTool, waitFor } from './tp-actions.mjs';
import { TEMPLATES, enterSurvey, firstVisible, placeMarker, surveyMarkers } from './lib.mjs';

test.use({
  video: 'off',
  ...(process.env.PW_CHROMIUM_PATH ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } } : {}),
});
test.describe.configure({ timeout: 300_000 });

const PDF = 'Package 2 - Rev 4 -- IC.pdf';
// cloudLibrary: the templates lists read from the backend (as in production).
const WIN = { device: { viewport: { width: 1200, height: 900 } }, cloudLibrary: true };
const VARIANT = 'two-accounts-local-backend';
const B_USER = {
  id: 'dev-test-user-b',
  email: 'bo.reed@example.invalid',
  user_metadata: { first_name: 'Bo', last_name: 'Reed', full_name: 'Bo Reed' },
};

const pickerBadges = (page) => page.evaluate(() => [...document.querySelectorAll('[data-shared-template-owner]')]
  .filter((e) => e.getBoundingClientRect().width > 0)
  .map((e) => ({ owner: e.getAttribute('data-shared-template-owner'), role: e.getAttribute('data-shared-template-role'), label: e.getAttribute('aria-label'), text: e.textContent, bg: getComputedStyle(e).backgroundColor })));

test('62 [Y3] two accounts: B gets A\'s survey template through the shared document and sees A\'s markers live', async ({ browser }) => {
  const docId = '7e57d0c0-0000-4000-8000-000000000162';
  const backend = new FakeBackend({ documentId: docId });
  const tpl = backend.seedTemplate({ config: TEMPLATES[0] });
  backend.seedDocumentCollaborator({ userId: B_USER.id, role: 'editor', email: B_USER.email });

  // Before: B can neither read the template nor give it to themselves.
  const bCanReadBefore = backend.canAccessTemplate(B_USER.id, tpl.id, 'viewer');
  const bCanGrantSelf = backend.canInsert(B_USER.id, 'template_collaborators', { template_id: tpl.id, user_id: B_USER.id });

  // A (owner) opens the document; A's template comes from A's own rows.
  const A = await openWindow(browser, backend, docId, PDF, WIN);
  await enterSurvey(A.page);
  await placeMarker(A.page, 200, 640, 240, 680);
  const tGrant0 = Date.now();
  const grant = await waitFor(() => backend.table('template_collaborators')
    .find((r) => r.template_id === tpl.id && r.user_id === B_USER.id), { timeout: 20_000 });
  const grantMs = Date.now() - tGrant0;
  const stampedName = backend.table('templates').find((t) => t.id === tpl.id)?.config?.ownerName ?? null;

  // B opens the shared document.
  const B = await openWindow(browser, backend, docId, PDF, { ...WIN, user: B_USER });
  const open = (await firstVisible(B.page.getByRole('button', { name: 'Open survey' })))
    || (await firstVisible(B.page.locator('button[aria-label*="urvey" i]')));
  await open.click();
  await B.page.waitForTimeout(1000);
  const bPicker = await B.page.evaluate(() => (document.querySelector('.survey-rail') || document.body).innerText.replace(/\s+/g, ' ').slice(0, 200));
  const badges = await pickerBadges(B.page);
  await B.page.screenshot({ path: `${OUT_DIR}/62-two-accounts-B-picker.png` });
  const tplButton = await firstVisible(B.page.getByRole('button', { name: /Test Plan Template/ }));
  if (tplButton) { await tplButton.click(); await B.page.waitForTimeout(1200); }

  // A's marker shows in B (inside B's Survey, with A's template).
  const m0 = await waitFor(async () => (await surveyMarkers(B.page))[0], { timeout: 15_000 });
  const a0 = (await surveyMarkers(A.page))[0];

  // A moves it; B follows.
  await A.page.evaluate(() => document.activeElement?.blur?.());
  await A.page.mouse.click(5, 450);
  await selectTool(A.page);
  await A.page.mouse.move(a0.x - 45, a0.y - 45);
  await A.page.mouse.down();
  await A.page.mouse.move(a0.x + 45, a0.y + 45, { steps: 8 });
  await A.page.mouse.up();
  await A.page.waitForTimeout(500);
  await A.page.mouse.move(a0.x, a0.y);
  await A.page.mouse.down();
  for (let k = 1; k <= 8; k += 1) await A.page.mouse.move(a0.x + k * 8, a0.y, { steps: 2 });
  await A.page.mouse.up();
  const tUp = Date.now();
  const aEnd = await waitFor(async () => { const m = (await surveyMarkers(A.page))[0]; return m && m.x > a0.x + 20 ? m : null; }, { timeout: 5000 });
  const seen = await waitFor(async () => { const m = (await surveyMarkers(B.page))[0]; return m && aEnd && Math.abs(m.x - aEnd.x) <= 2 ? m : null; }, { timeout: 10_000, every: 40 });
  const lagMs = Date.now() - tUp;
  await B.page.screenshot({ path: `${OUT_DIR}/62-two-accounts-B-after-move.png` });

  // B (editor on the document -> editor on the template) places a marker of
  // their own with A's template, and A sees it.
  const aBefore = (await surveyMarkers(A.page)).length;
  await placeMarker(B.page, 300, 640, 340, 680, 'Doors');
  const aSeesB = await waitFor(async () => ((await surveyMarkers(A.page)).length > aBefore ? true : null), { timeout: 15_000 });
  await A.page.screenshot({ path: `${OUT_DIR}/62-two-accounts-A-sees-B.png` });

  // Reload B: the template and the markers are still there.
  await B.page.reload();
  await B.page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().waitFor({ timeout: 90_000 });
  await B.page.waitForTimeout(3000);
  await enterSurvey(B.page);
  const keptAfterReload = await waitFor(async () => ((await surveyMarkers(B.page)).length >= 2 ? (await surveyMarkers(B.page)).length : null), { timeout: 15_000 });

  const errors = [...A.errors, ...B.errors];
  const badge = badges[0] || null;
  const ok = !bCanReadBefore && !bCanGrantSelf
    && Boolean(grant) && grant.role === 'editor'
    && Boolean(badge) && badge.owner === 'dev-test-user' && badge.text === 'DU'
    && Boolean(m0) && Boolean(aEnd) && Boolean(seen) && lagMs <= 1500
    && Boolean(aSeesB) && Boolean(keptAfterReload) && errors.length === 0;
  report(62, ok ? 'PASS' : 'FAIL', `before: B could read A's template=${bCanReadBefore}, could grant it to self=${bCanGrantSelf}; A entered Survey with own template and placed a marker; A's app granted B "${grant?.role}" ${grantMs} ms later (owner name stamped "${stampedName}"); B's Survey picker "${bPicker}" with badge ${JSON.stringify(badge)}; A's marker shown in B=${Boolean(m0)}; A moved it ${a0?.x} -> ${aEnd?.x}px, B showed it ${lagMs} ms after A let go; B placed a Doors marker with A's template, A saw it=${Boolean(aSeesB)}; after B reloaded, markers shown=${keptAfterReload}; errors=${JSON.stringify(errors).slice(0, 300)}; shots=62-two-accounts-B-picker.png/62-two-accounts-B-after-move.png/62-two-accounts-A-sees-B.png`, VARIANT);
  await A.context.close();
  await B.context.close();
  expect(ok).toBe(true);
});
