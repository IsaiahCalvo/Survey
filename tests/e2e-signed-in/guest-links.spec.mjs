// Guest links (Nightly, flag 'guest-links'), end to end in the app: the owner
// makes a link in Document access; someone with no account opens it in a fresh
// browser, types a name, joins, and lands in that document as a guest. The
// database rules are covered in guest-links-security.spec.mjs.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, clientFromPageSession, expect, pickValue, signIn, test } from './helpers.mjs';

const FLAG = () => localStorage.setItem('survey.flag.guest-links', '1');

test('owner makes a guest link; a guest with no account joins and opens the document', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const ownerId = (await owner.auth.getUser()).data.user.id;
  const bytes = readFileSync(E2E_DOCUMENT.fixture);
  const docId = crypto.randomUUID();
  const name = `Guest walk ${RUN}.pdf`;
  const path = `${ownerId}/${docId}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
  }));

  const guestContext = await browser.newContext();
  await guestContext.route(
    (url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
  try {
    // The owner: Documents → the file → Share → Guest links → Make link.
    await page.addInitScript(FLAG);
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(name, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Share', exact: true }).filter({ visible: true }).first().click();
    const access = page.getByRole('dialog', { name: `Document access: ${name}` });
    const section = access.getByTestId('guest-links');
    await expect(section).toBeVisible();
    await pickValue(page, section, 'Guests', 'Can mark up and comment');
    await pickValue(page, section, 'Link works', 'For 1 day');
    await section.locator('[data-guest-make]').click();
    const url = await section.locator('[data-guest-url]').inputValue();
    expect(url).toMatch(/\/\?guest=[0-9a-f]{64}$/);
    await expect(section.locator('[data-guest-link]')).toHaveCount(1);
    await expect(section.locator('[data-guest-link]')).toContainText('Mark up and comment');
    await expect(section.locator('[data-guest-link]')).toContainText('Nobody yet');

    // The guest: a browser that has never signed in.
    const guest = await guestContext.newPage();
    await guest.addInitScript(FLAG);
    await guest.goto(url, { waitUntil: 'domcontentloaded' });
    const join = guest.getByTestId('guest-join');
    await expect(join).toBeVisible({ timeout: 60_000 });
    await expect(guest.getByRole('dialog', { name: 'Welcome back' })).toHaveCount(0);
    // Nothing happens until there is a name and the terms are agreed to.
    await join.locator('[data-guest-join]').click();
    await expect(join.getByRole('alert')).toContainText('Type your name');
    await join.locator('[data-guest-name]').fill('Gus Guest');
    await join.locator('[data-guest-join]').click();
    await expect(join.getByRole('alert')).toContainText('Agree to the terms');
    await join.locator('[data-guest-terms]').check();
    await join.locator('[data-guest-join]').click();

    // In: the document opens, the secret is gone from the address, and a badge
    // says who they are here.
    await expect(guest.getByRole('button', { name: `Close ${name}` })).toBeVisible({ timeout: 60_000 });
    await expect(guest.getByText('Type your name in the box:')).toBeVisible({ timeout: 60_000 });
    expect(guest.url()).not.toContain('guest=');
    await expect(guest.getByTestId('guest-badge')).toContainText('Guest: Gus Guest');
    await expect(guest.getByText('View-only access', { exact: true })).toHaveCount(0);

    // The owner sees who came in.
    await access.getByRole('button', { name: 'Done' }).click();
    await page.getByRole('button', { name: 'Share', exact: true }).filter({ visible: true }).first().click();
    await expect(access.getByTestId('guest-links').locator('[data-guest-link]')).toContainText('Gus Guest');

    // Turning it off cuts the guest off on the server at once.
    await access.getByTestId('guest-links').locator('[data-guest-revoke]').click();
    await expect(access.getByTestId('guest-links').locator('[data-guest-link]')).toHaveCount(0);
    const guestApi = await clientFromPageSession(guest);
    expect((await guestApi.from('documents').select('id').eq('id', docId)).data).toEqual([]);
    const guestRows = await must('guest rows', admin.from('document_guests').select('display_name').eq('document_id', docId));
    expect(guestRows.map((r) => r.display_name)).toEqual(['Gus Guest']);

    // Leaving signs the guest out.
    await guest.getByTestId('guest-badge').getByRole('button', { name: 'Leave' }).click();
    await expect(guest.getByTestId('guest-badge')).toHaveCount(0, { timeout: 30_000 });
  } finally {
    await guestContext.close();
    await admin.from('documents').delete().eq('id', docId);
    await admin.storage.from('documents').remove([path]);
  }
});
