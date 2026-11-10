// Share dialog extras copied from Drawboard's share dialog (Nightly flag
// share-extras): the owner listed first with "(you)" and the online dot even
// when the document has no collaborator row for them, Sort by Role / Name /
// Activity with each person's last open, and a personal message on email
// invites (Shift+Enter sends). Every layout: desktop, tablet, phone web on
// iPhone and Android sizes, the phone app on iOS and Android.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, expect, test } from './helpers.mjs';

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } }, phone: false, app: false },
  { name: 'tablet', use: { viewport: { width: 1024, height: 768 }, hasTouch: true }, phone: false, app: false },
  { name: 'phone web, 390px iPhone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone web, 360px Android', use: { viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone app, iOS 390px', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }, phone: true, app: true },
  { name: 'phone app, Android 412px', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }, phone: true, app: true },
];

async function userIdOf(admin, account) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === account.email).id;
}

async function addDoc(admin, ownerId, name) {
  const id = crypto.randomUUID();
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(name, { x: 72, y: 700, size: 20, font });
  const bytes = Buffer.from(await pdf.save());
  await must('upload', admin.storage.from('documents').upload(`${ownerId}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: ownerId, project_id: null, name, file_path: `${ownerId}/${id}.pdf`, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return {
    id,
    remove: async () => {
      await admin.from('documents').delete().eq('id', id);
      await admin.storage.from('documents').remove([`${ownerId}/${id}.pdf`]);
    },
  };
}

async function signInAt(page, account, path) {
  await page.goto(path, { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill(account.email);
  await dialog.getByLabel('Password').fill(account.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toBeHidden();
}

const visible = (locator) => locator.filter({ visible: true }).first();
const press = (layout, locator) => (layout.use.hasTouch ? locator.tap() : locator.click());
const SHOTS = process.env.E2E_SHARE_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);

async function openShare(page, layout, name) {
  const row = layout.phone
    ? visible(page.locator('.mobile-doc-card', { hasText: name }))
    : visible(page.locator('.documents-ledger-row', { hasText: name }));
  await expect(row).toBeVisible({ timeout: 45_000 });
  await press(layout, row.getByRole('button', { name: 'More' }));
  await press(layout, visible(page.getByRole('menuitem', { name: 'Share', exact: true })));
  const dialog = page.getByRole('dialog', { name: new RegExp(`Document access: ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function pickSort(page, layout, dialog, label) {
  const sort = dialog.getByTestId('access-sort');
  if (layout.phone) {
    await sort.selectOption({ label });
    return;
  }
  await press(layout, sort.getByRole('button'));
  await press(layout, visible(page.getByRole('option', { name: label, exact: true }).or(page.getByRole('menuitemradio', { name: label, exact: true }))));
}

for (const layout of LAYOUTS) {
  test.describe(`Share extras, ${layout.name}`, () => {
    test.use(layout.use);

    test('owner row, sort by role, name and activity, invite message', async ({ page }) => {
      test.setTimeout(180_000);
      const admin = adminClient();
      const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
      const editorId = await userIdOf(admin, E2E_ACCOUNTS.editor);
      const viewerId = await userIdOf(admin, E2E_ACCOUNTS.viewer);
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const name = `SX ${slug} ${RUN}.pdf`;
      const doc = await addDoc(admin, ownerId, name);
      // The owner has no collaborator row (as for most uploads); an editor and
      // a viewer do. The viewer opened it more recently than the editor.
      await must('editor', admin.from('document_collaborators').insert({ document_id: doc.id, user_id: editorId, role: 'editor', status: 'active', email: E2E_ACCOUNTS.editor.email }));
      await must('viewer', admin.from('document_collaborators').insert({ document_id: doc.id, user_id: viewerId, role: 'viewer', status: 'active', email: E2E_ACCOUNTS.viewer.email }));
      const hoursAgo = (h) => new Date(Date.now() - h * 3600_000).toISOString();
      await must('opens', admin.from('document_opens').insert([
        { user_id: editorId, document_id: doc.id, opened_at: hoursAgo(50) },
        { user_id: viewerId, document_id: doc.id, opened_at: hoursAgo(3) },
      ]));

      // The invite email call is caught here: the local stack runs no edge
      // functions, and the body is what the server would get.
      const sent = [];
      await page.route('**/functions/v1/send-invite-email', async (route) => {
        sent.push(route.request().postDataJSON());
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sent: true }) });
      });
      await page.addInitScript(() => localStorage.setItem('survey.flag.share-extras', '1'));
      try {
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        const dialog = await openShare(page, layout, name);
        const rows = dialog.locator('[data-kal31-row="member"]');
        const order = async () => rows.evaluateAll((els) => els.map((e) => e.getAttribute('data-access-user')));

        // 1. The owner is listed first, as you, with the online dot.
        await expect(dialog.locator('[data-access-sort]')).toContainText('People (3)');
        await expect(rows).toHaveCount(3);
        await expect.poll(order).toEqual([ownerId, editorId, viewerId]);
        await expect(rows.first().locator('[data-you]')).toHaveText('(you)');
        await expect(rows.first().locator('[data-online-dot]')).toHaveCount(1);
        await expect(rows.nth(1).locator('[data-you]')).toHaveCount(0);
        await expect(rows.first()).toContainText('Owner');
        await expect(rows.nth(2).locator('[data-access-opened]')).toHaveText('Opened 3 hours ago');
        await expect(rows.nth(1).locator('[data-access-opened]')).toHaveText('Opened 2 days ago');
        await expect(dialog).not.toContainText('No collaborators yet');
        await shot(page, layout, '1-people');

        // The owner's row offers only Copy email: no role change, no remove.
        await press(layout, rows.first().getByRole('button', { name: 'More' }));
        const menu = visible(page.locator('[data-access-menu-surface="true"]'));
        await expect(menu.getByRole('menuitem')).toHaveCount(1);
        await expect(menu.getByRole('menuitem', { name: 'Copy email' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();

        // 2. Sort by Activity: the viewer opened it last; the owner stays first.
        await pickSort(page, layout, dialog, 'Activity');
        await expect.poll(order).toEqual([ownerId, viewerId, editorId]);
        await pickSort(page, layout, dialog, 'Name');
        await expect.poll(order).toEqual([ownerId, editorId, viewerId]);
        await pickSort(page, layout, dialog, 'Role');
        await expect.poll(order).toEqual([ownerId, editorId, viewerId]);
        await shot(page, layout, '2-sorted');

        // 3. Invite with a personal message; Shift+Enter sends.
        await press(layout, dialog.locator('[data-kal31-invite-btn]'));
        const share = page.getByRole('dialog', { name: 'Share document' });
        await expect(share).toBeVisible();
        const address = `sx-${slug}-${RUN}@example.com`.toLowerCase();
        await share.getByPlaceholder('name@example.com, name@example.com').fill(address);
        const box = share.getByTestId('share-message');
        await box.fill('Please check page 3.\nThanks!');
        await expect(share.locator('[data-share-message]')).toContainText('28/500');
        await shot(page, layout, '3-message');
        await box.press('Shift+Enter');
        await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
        expect(sent[0].message).toBe('Please check page 3.\nThanks!');
        expect(sent[0].displayName).toBe(name);
        await expect(share.getByText(/invite/i).filter({ hasText: /sent|invited/i }).first()).toBeVisible({ timeout: 15_000 });
        await expect(box).toHaveValue('');
        // The invite row exists for that address.
        await expect.poll(async () => (await admin.from('document_invites').select('target_email').eq('document_id', doc.id)).data?.map((r) => r.target_email))
          .toEqual([address]);
      } finally {
        await doc.remove();
      }
    });
  });
}

test.describe('Share extras, flag off', () => {
  test.use(LAYOUTS[0].use);
  test('the dialog is as before', async ({ page }) => {
    test.setTimeout(120_000);
    const admin = adminClient();
    const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
    const name = `SX off ${RUN}.pdf`;
    const doc = await addDoc(admin, ownerId, name);
    try {
      await signInAt(page, E2E_ACCOUNTS.owner, '/');
      const dialog = await openShare(page, LAYOUTS[0], name);
      await expect(dialog.locator('[data-access-sort]')).toHaveCount(0);
      await expect(dialog.locator('[data-you]')).toHaveCount(0);
      await expect(dialog).toContainText('No collaborators yet');
      await expect(dialog.locator('.access-grid--head')).toContainText('Status');
      await press(LAYOUTS[0], dialog.locator('[data-kal31-invite-btn]'));
      const share = page.getByRole('dialog', { name: 'Share document' });
      await expect(share).toBeVisible();
      await expect(share.getByTestId('share-message')).toHaveCount(0);
    } finally {
      await doc.remove();
    }
  });
});
