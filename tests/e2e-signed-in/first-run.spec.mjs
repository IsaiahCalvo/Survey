// A brand-new person's first minute, from the website's "Start free" button:
// it opens on Create account (not Welcome back) with the password rules in
// view and Google offered, and an empty Home offers a sample drawing that
// opens straight away.
import { DESKTOP, PHONE } from '../../debug/scenarios/test-plan/tp-local-doc.mjs';
import { adminClient, expect, profileChip, test } from './helpers.mjs';

const PASSWORD = 'E2e-local-only-123!';
const EMAIL_PATTERN = /^e2e-firstrun-[a-z]+-\d+@example\.com$/;

async function removeFirstRunAccounts(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const ids = data.users.filter((user) => EMAIL_PATTERN.test(user.email || '')).map((user) => user.id);
  if (!ids.length) return;
  await admin.from('documents').delete().in('user_id', ids);
  await admin.from('user_subscriptions').delete().in('user_id', ids);
  await admin.from('users').delete().in('id', ids);
  for (const id of ids) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError) throw deleteError;
  }
}

test.describe.configure({ timeout: 120_000 });
test.beforeAll(async () => { await removeFirstRunAccounts(adminClient()); });
test.afterAll(async () => { await removeFirstRunAccounts(adminClient()); });

for (const [size, device] of [['desktop', DESKTOP], ['phone', PHONE]]) test.describe(size, () => {
  test.use(device);
  test('Start free opens Create account, and an empty Home opens a sample drawing', async ({ page }) => {
    const stamp = `${Date.now()}`;
    const person = { email: `e2e-firstrun-${size}-${stamp}@example.com`, label: 'Fay First' };

    await page.goto('/?signup=1', { waitUntil: 'domcontentloaded' });
    const dialog = page.getByRole('dialog').filter({ has: page.getByLabel('Email') });
    await expect(dialog.getByRole('heading', { name: 'Create account' })).toBeVisible({ timeout: 60_000 });
    await expect(dialog.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    // The rules are on screen before typing, and tick off as they are met.
    await expect(dialog.getByText('12+ characters')).toBeVisible();
    await dialog.getByLabel('Email').fill(person.email);
    await dialog.getByLabel('First name').fill('Fay');
    await dialog.getByLabel('Last name').fill('First');
    await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
    await dialog.getByLabel('Confirm password').fill(PASSWORD);
    await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(profileChip(page, person)).toBeVisible();

    await expect(page.getByText('No documents yet').filter({ visible: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Try a sample drawing' }).filter({ visible: true }).first().click();
    const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first();
    await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    const admin = adminClient();
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const id = users.users.find((user) => user.email === person.email)?.id;
    const { data: docs } = await admin.from('documents').select('name').eq('user_id', id);
    expect((docs || []).map((doc) => doc.name)).toEqual(['Sample floor plan.pdf']);
  });
});
