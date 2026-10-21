// Pro lock (flag 'pro-lock', forced on in this browser): a Free plan account
// that clicks Survey sees the short "part of Pro" prompt with an Upgrade
// button; the same account moved to Pro by an admin can open Survey.
// Local stack only: helpers' `test` aborts every request outside LOCAL_HOSTS
// (127.0.0.1 / localhost), so nothing here can reach production.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, expect, openSampleDocument, signIn, test } from './helpers.mjs';

// The editor account is on the Free plan and can open the sample document.
const ACCOUNT = E2E_ACCOUNTS.editor;
const PROMPT = 'Survey tools are part of Pro. Upgrade to use them.';

async function setTier(tier) {
  const admin = adminClient();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const user = data.users.find((u) => u.email === ACCOUNT.email);
  if (!user) throw new Error('[E2E_SIGNED_IN] seeded editor account is missing; run npm run e2e:seed');
  const { error: upsertError } = await admin.from('user_subscriptions')
    .upsert({ user_id: user.id, tier, status: 'active' }, { onConflict: 'user_id' });
  if (upsertError) throw upsertError;
}

test.describe.configure({ timeout: 180_000 });

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { window.localStorage.setItem('survey.flag.pro-lock', '1'); } catch { /* storage off */ }
  });
});

// Put the shared seed row back however the test ends.
test.afterAll(async () => { await setTier(ACCOUNT.tier); });

test('Free plan: Survey shows the Pro prompt; after an upgrade it opens', async ({ page }) => {
  await setTier('free');
  await signIn(page, ACCOUNT);
  await openSampleDocument(page);

  const surveyTab = page.locator('.survey-rail-strip').getByRole('button', { name: 'Survey', exact: true });
  await surveyTab.click();
  const toast = page.locator('.app-toast').filter({ hasText: PROMPT });
  await expect(toast).toBeVisible();
  await expect(toast.getByRole('button', { name: 'Upgrade' })).toBeVisible();
  await expect(surveyTab).toHaveAttribute('aria-expanded', 'false');

  // An admin moves the account to Pro; the reload reads the plan again and
  // reopens the document tab.
  await setTier('pro');
  const planRead = page.waitForResponse((res) => res.url().includes('/rest/v1/user_subscriptions') && res.ok());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await planRead;
  await expect(page.getByText('Type your name in the box:')).toBeVisible({ timeout: 60_000 });
  await surveyTab.click();
  await expect(surveyTab).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#survey-rail-panel')).toBeVisible();
  await expect(page.locator('.app-toast').filter({ hasText: /Pro/ })).toHaveCount(0);
});
