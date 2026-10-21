// The launch path a new person takes, end to end on the local stack: sign up,
// upload a PDF, mark it up, export it, share it, and the person they share
// with signs up from the link and opens the same markup.
import { readFileSync } from 'node:fs';
import { PDFDict, PDFDocument, PDFName } from 'pdf-lib';
import { dragPage, tool } from '../../debug/scenarios/test-plan/tp-actions.mjs';
import { DESKTOP, PHONE } from '../../debug/scenarios/test-plan/tp-local-doc.mjs';
import { adminClient, clientFromPageSession, expect, profileChip, test } from './helpers.mjs';

const FIXTURE = 'debug/fixtures/clickable-link-test.pdf';
const FILE_NAME = 'clickable-link-test.pdf';
const PASSWORD = 'E2e-local-only-123!';
const RECT_HEX = Buffer.from('Rect').toString('hex');
const EMAIL_PATTERN = /^e2e-journey-[a-z]+-\d+@example\.com$/;

test.use({ acceptDownloads: true });
test.describe.configure({ timeout: 180_000 });

async function signUp(page, { email, firstName, lastName }) {
  const dialog = page.getByRole('dialog').filter({ has: page.getByLabel('Email') });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole('button', { name: 'Create an account' }).click();
  await dialog.getByLabel('Email').fill(email);
  await dialog.getByLabel('First name').fill(firstName);
  await dialog.getByLabel('Last name').fill(lastName);
  await dialog.getByLabel('Password', { exact: true }).fill(PASSWORD);
  await dialog.getByLabel('Confirm password').fill(PASSWORD);
  await dialog.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(dialog).toBeHidden();
}

// Page 1 is drawn and its markup layer is up (phones draw no text layer).
async function expectPageDrawn(page) {
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await expect(pageDiv.locator('[data-svg-annotation-layer="1"]').first()).toBeAttached();
}

async function squareCount(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const annots = pdf.getPage(0).node.Annots();
  if (!annots) return 0;
  return annots.asArray()
    .map((ref) => pdf.context.lookup(ref, PDFDict).get(PDFName.of('Subtype')))
    .filter((subtype) => subtype === PDFName.of('Square')).length;
}

async function userIdFor(admin, email) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users.find((user) => user.email === email)?.id;
}

// Accounts this spec made, found by their email pattern so a failed run is
// cleaned up by the next one too.
async function removeJourneyAccounts(admin) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const ids = data.users.filter((user) => EMAIL_PATTERN.test(user.email || '')).map((user) => user.id);
  if (!ids.length) return;
  const { data: docs } = await admin.from('documents').select('id').in('user_id', ids);
  const docIds = (docs || []).map((doc) => doc.id);
  if (docIds.length) {
    await admin.from('document_invites').delete().in('document_id', docIds);
    await admin.from('document_collaborators').delete().in('document_id', docIds);
    await admin.from('documents').delete().in('id', docIds);
  }
  await admin.from('user_subscriptions').delete().in('user_id', ids);
  await admin.from('users').delete().in('id', ids);
  for (const id of ids) {
    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError) throw deleteError;
  }
}

test.beforeAll(async () => { await removeJourneyAccounts(adminClient()); });
test.afterAll(async () => { await removeJourneyAccounts(adminClient()); });

for (const [size, device] of [['desktop', DESKTOP], ['phone', PHONE]]) test.describe(size, () => {
test.use(device);
test('a new person signs up, marks up, exports and shares; the invitee signs up from the link and sees it', async ({ page, browser }) => {
  const phone = size === 'phone';
  const admin = adminClient();
  const stamp = `${size}${Date.now()}`.replace(/[^0-9]/g, '') ;
  const owner = { email: `e2e-journey-owner-${stamp}@example.com`, firstName: 'Jo', lastName: 'Journey', label: 'Jo Journey' };
  const invitee = { email: `e2e-journey-invitee-${stamp}@example.com`, firstName: 'Sam', lastName: 'Shared', label: 'Sam Shared' };

  // 1. Sign up.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await signUp(page, owner);
  await expect(profileChip(page, owner)).toBeVisible();
  const ownerId = await userIdFor(admin, owner.email);
  expect(ownerId).toBeTruthy();

  // 2. Upload a PDF; it opens.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Upload', exact: true }).click(),
  ]);
  await chooser.setFiles(FIXTURE);
  await expectPageDrawn(page);
  const { data: docs } = await admin.from('documents').select('id').eq('user_id', ownerId);
  expect(docs).toHaveLength(1);
  const documentId = docs[0].id;

  // 3. Draw a rectangle; it is saved to the cloud.
  await tool(page, 'Shapes', 'Rectangle');
  await dragPage(page, 1, [[60, 80], [140, 120], [220, 160]]);
  await page.keyboard.press('Escape');
  await expect.poll(async () => {
    const { data } = await admin.from('annotation_updates').select('data').eq('document_id', documentId);
    return (data || []).some((row) => String(row.data).includes(RECT_HEX));
  }, { timeout: 30_000 }).toBe(true);

  // 4. Export the marked-up PDF.
  if (phone) await page.getByRole('button', { name: 'More document options' }).click();
  if (phone) await page.waitForTimeout(500);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export annotated PDF' }).first().click(),
  ]);
  const exported = readFileSync(await download.path());
  expect(download.suggestedFilename()).toBe('clickable-link-test-annotated.pdf');
  expect(exported.subarray(0, 5).toString()).toBe('%PDF-');
  // The fixture carries its own markups; the export adds the new rectangle.
  expect(await squareCount(exported)).toBe(await squareCount(readFileSync(FIXTURE)) + 1);

  // 5. Share. Invites need a paid plan, so move the owner to Pro first.
  const { error: upgradeError } = await admin.from('user_subscriptions')
    .upsert({ user_id: ownerId, tier: 'pro', status: 'active' }, { onConflict: 'user_id' });
  expect(upgradeError).toBeNull();
  await page.reload();
  // Desktop reopens the document tab after a reload; a phone lands on Documents.
  const back = page.getByRole('button', { name: phone ? 'Back to documents' : `Close ${FILE_NAME}` });
  const upload = page.getByRole('button', { name: 'Upload', exact: true });
  await expect(back.or(upload).first()).toBeVisible({ timeout: 60_000 });
  if (await back.isVisible()) await back.click();
  if (phone) {
    await page.getByRole('button', { name: 'More', exact: true }).first().click();
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
  } else {
    await page.getByText(FILE_NAME, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
  }
  // Share may open the access list first; Invite there opens the share dialog.
  const share = page.getByRole('dialog', { name: /^Share/ });
  const invite = page.getByRole('button', { name: 'Invite', exact: true });
  await expect(share.or(invite).first()).toBeVisible();
  if (await invite.isVisible()) await invite.click();
  await share.getByRole('button', { name: 'Copy link' }).click();
  const link = (await share.getByText(/\/invite\//).textContent()).trim();
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]+$/);

  // 6. The invitee opens the link signed out, signs up, and lands back on the
  // invite, which gives them the document with the owner's markup.
  const inviteeContext = await browser.newContext(device);
  await inviteeContext.route(
    (url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
  const guest = await inviteeContext.newPage();
  await guest.goto(link);
  await guest.getByRole('button', { name: 'Sign in to continue' }).click();
  await signUp(guest, invitee);
  await expect(guest.getByText('Welcome!')).toBeVisible({ timeout: 60_000 });
  await expect(guest.getByText('You now have viewer access to this document.')).toBeVisible();
  await guest.getByRole('button', { name: 'Open document' }).click();
  await expect(guest.getByRole('button', { name: phone ? 'Back to documents' : `Close ${FILE_NAME}` })).toBeVisible({ timeout: 60_000 });
  await expectPageDrawn(guest);
  await expect(guest.getByText('View-only access', { exact: true }).first()).toBeVisible();

  const guestClient = await clientFromPageSession(guest);
  const { data: role, error: roleError } = await guestClient.rpc('get_my_document_role', { doc_id: documentId });
  expect(roleError).toBeNull();
  expect(role).toBe('viewer');
  const { data: seen } = await guestClient.from('annotation_updates').select('data').eq('document_id', documentId);
  expect((seen || []).some((row) => String(row.data).includes(RECT_HEX))).toBe(true);
  await inviteeContext.close();
});
});
