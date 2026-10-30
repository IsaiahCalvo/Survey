// /kits admin page: an app admin (the seeded owner, a local-only flag admin)
// publishes a kit and gives it to a customer through the kits-admin function;
// the customer then sees it. Non-admins are refused by the server, not just
// the page. The local stack has no edge runtime, so the function's request is
// answered by its own logic (supabase/functions/_shared/kitsAdmin.js) run in
// Node with the caller's token.
import { execFileSync } from 'node:child_process';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const KIT_ID = 'e2e-admin-made';
const VERSION = `1.0.${Date.now() % 100000}`;

function runFunction(auth, payload) {
  return JSON.parse(execFileSync('node', ['tests/e2e-signed-in/kitsAdminRunner.mjs'], {
    input: JSON.stringify({ auth, payload }), encoding: 'utf8', env: process.env,
  }));
}

async function routeFunction(page) {
  await page.route('**/functions/v1/kits-admin', async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, body: 'ok' });
    const { status, body } = runFunction(req.headers().authorization || '', req.postDataJSON());
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test.afterAll(async () => {
  await adminClient().from('account_kits').delete().eq('kit_id', KIT_ID);
});

test('an admin publishes a kit on /kits, gives it to a customer, and the customer sees it', async ({ page, browser }) => {
  await routeFunction(page);
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.goto('/kits');
  await expect(page.getByRole('heading', { name: 'Kits' })).toBeVisible({ timeout: 30_000 });

  const json = page.getByLabel('Kit (JSON)');
  const kit = JSON.parse(await json.inputValue());
  await json.fill(JSON.stringify({ ...kit, id: KIT_ID, version: VERSION, label: 'Admin made (E2E)' }));
  await page.getByRole('button', { name: 'Publish kit' }).click();
  await expect(page.getByRole('status')).toHaveText(`Published ${KIT_ID}@${VERSION}.`);

  // The same version again is refused by the server.
  await page.getByRole('button', { name: 'Publish kit' }).click();
  await expect(page.getByRole('status')).toContainText('already exists');

  await page.getByLabel('Customer email').fill(E2E_ACCOUNTS.editor.email);
  await page.getByLabel('Kit', { exact: true }).selectOption(`${KIT_ID}@${VERSION}`);
  await page.getByRole('button', { name: 'Give kit' }).click();
  await expect(page.getByRole('status')).toContainText(`Gave ${KIT_ID}@${VERSION} to ${E2E_ACCOUNTS.editor.email}`);
  await expect(page.getByText(`${E2E_ACCOUNTS.editor.email} · ${KIT_ID}@${VERSION}`)).toBeVisible();

  // The customer signs in and finds it in the template editor.
  const other = await browser.newContext();
  const customer = await other.newPage();
  await signIn(customer, E2E_ACCOUNTS.editor);
  await customer.getByRole('tab', { name: /Templates/ }).or(customer.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  const layout = customer.getByRole('button', { name: 'Excel layout', exact: true }).filter({ visible: true }).first();
  if (!(await layout.isVisible().catch(() => false))) {
    await customer.getByRole('button', { name: /New template|Create template|Add template/ }).filter({ visible: true }).first().click();
  }
  await layout.click();
  await expect(customer.getByRole('listbox', { name: 'Excel layout' }).getByRole('option', { name: /Admin made \(E2E\)/ })).toHaveCount(1);
  await other.close();

  await page.getByRole('button', { name: `Take ${KIT_ID} from ${E2E_ACCOUNTS.editor.email}` }).click();
  await expect(page.getByRole('status')).toContainText(`Took ${KIT_ID}`);
});

test('someone not on the admin list is refused by the server', async ({ page }) => {
  await routeFunction(page);
  await signIn(page, E2E_ACCOUNTS.pro);
  await page.goto('/kits');
  await expect(page.getByText('This page is only for the people who run Survey.')).toBeVisible({ timeout: 30_000 });
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
    return JSON.parse(localStorage.getItem(key)).access_token;
  });
  for (const payload of [
    { action: 'list' },
    { action: 'publish', kit: { id: 'x' } },
    { action: 'assign', email: E2E_ACCOUNTS.pro.email, kitId: KIT_ID, version: VERSION },
  ]) {
    expect(runFunction(`Bearer ${token}`, payload).status).toBe(403);
  }
  expect(runFunction('Bearer not-a-token', { action: 'list' }).status).toBe(401);
});
