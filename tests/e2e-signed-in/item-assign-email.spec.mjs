// "Assigned to you" email for issues and tasks (Nightly flag
// 'item-assign-email'; Drawboard Projects NT-01 / IS-10). On desktop and the
// phone app: picking an assignee asks the server to email them, the server
// checks the item's own activity log and sends once, and the email's link
// opens that item in its project for the person it went to.
//
// The function is answered here by its real rules (prepareItemAssignEmail)
// against the local database; only the send to Brevo is left out.
import crypto from 'node:crypto';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, expect, test } from './helpers.mjs';
import { itemLink, prepareItemAssignEmail } from '../../supabase/functions/_shared/itemAssignEmail.js';

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } }, phone: false },
  { name: 'phone app, Android 412px', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }, phone: true },
];
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };

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

async function pick(page, layout, testId, option) {
  const scope = visible(page.getByTestId(testId));
  if (layout.phone) {
    await scope.selectOption({ label: option });
    return;
  }
  await press(layout, scope.locator('button').first());
  await press(layout, visible(page.getByRole('option', { name: option, exact: true })));
}

async function serveNotify(context, asks) {
  const admin = adminClient();
  await context.route('**/functions/v1/notify-comment-mentions', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = request.postDataJSON() || {};
    const token = (request.headers().authorization || '').replace(/^Bearer /, '');
    const { data: who } = await admin.auth.getUser(token);
    const out = await prepareItemAssignEmail({ admin, callerId: who?.user?.id, itemId: body.itemId });
    asks.push({ body, out });
    const reply = out.refusal ? { sent: 0, reason: out.refusal } : { sent: 1 };
    return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(reply) });
  });
}

for (const layout of LAYOUTS) {
  test.describe(`Assigned-to-you email, ${layout.name}`, () => {
    test.use(layout.use);

    test('assigning emails the person once; their link opens the item', async ({ page, context, browser }) => {
      test.setTimeout(180_000);
      const admin = adminClient();
      const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const idOf = (account) => users.users.find((u) => u.email === account.email).id;
      const ownerId = idOf(E2E_ACCOUNTS.owner);
      const editorId = idOf(E2E_ACCOUNTS.editor);
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const projectId = crypto.randomUUID();
      const projectName = `IAE ${slug} ${RUN}`.slice(0, 60);
      await must('project', admin.from('projects').insert({ id: projectId, user_id: ownerId, name: projectName }));
      await must('member', admin.from('project_collaborators').insert({ project_id: projectId, user_id: editorId, role: 'editor', status: 'active', email: E2E_ACCOUNTS.editor.email }));
      const [item] = await must('item', admin.from('project_items').insert({ project_id: projectId, kind: 'issue', title: 'Door 3 hinge loose', created_by: ownerId }).select('id, project_id, kind, number'));
      const editorName = E2E_ACCOUNTS.editor.email.split('@')[0];
      const flags = () => { try { localStorage.setItem('survey.flag.project-issues', '1'); localStorage.setItem('survey.flag.item-assign-email', '1'); } catch { /* */ } };
      await context.addInitScript(flags);
      const asks = [];
      await serveNotify(context, asks);
      const app = layout.phone ? '/?mobileNav=tabs&nativeShell=capacitor' : '/';
      let editorContext = null;
      try {
        await signInAt(page, E2E_ACCOUNTS.owner, app);
        const tab = visible(page.getByRole('button', { name: 'Projects', exact: true }).or(page.getByRole('tab', { name: 'Projects' })));
        const row = visible(page.locator(`[data-project-id="${projectId}"]`));
        await expect(async () => {
          await tab.click();
          await expect(row).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 45_000 });
        await press(layout, row);
        await press(layout, visible(page.locator('[data-project-items-tabs]').getByRole('tab', { name: 'Issues' })));
        await press(layout, visible(page.getByText('Door 3 hinge loose', { exact: true })));
        const detail = visible(page.locator('[data-item-detail]'));
        await expect(detail.locator('[data-item-code]')).toHaveText('ISS-1');

        // Assign: one ask, the server finds the change in the log and sends.
        await pick(page, layout, 'item-assignee-select', editorName);
        await expect(visible(page.getByText(`${editorName} will get an email about ISS-1.`))).toBeVisible({ timeout: 30_000 });
        expect(asks).toHaveLength(1);
        expect(Object.keys(asks[0].body).sort()).toEqual(['itemId', 'origin']);
        expect(asks[0].out).toMatchObject({ email: E2E_ACCOUNTS.editor.email, projectName });
        const { data: claimed } = await admin.from('project_item_assign_emails').select('assignee_id').eq('item_id', item.id);
        expect(claimed).toEqual([{ assignee_id: editorId }]);

        // The same assignment is never sent twice; the assignee can't ask for one.
        const again = await prepareItemAssignEmail({ admin, callerId: ownerId, itemId: item.id });
        expect(again.refusal).toBe('already-sent');
        const fromAssignee = await prepareItemAssignEmail({ admin, callerId: editorId, itemId: item.id });
        expect(fromAssignee.refusal).toBe('self');

        // The editor opens the email's link: Projects, that project, the item.
        editorContext = await browser.newContext(layout.use);
        await editorContext.addInitScript(flags);
        const editorPage = await editorContext.newPage();
        const link = new URL(itemLink(null, { ...item, project_id: projectId }));
        await signInAt(editorPage, E2E_ACCOUNTS.editor, `${layout.phone ? '/?mobileNav=tabs&nativeShell=capacitor&' : '/?'}${link.searchParams.toString()}`);
        const opened = visible(editorPage.locator('[data-item-detail]'));
        await expect(opened.locator('[data-item-code]')).toHaveText('ISS-1', { timeout: 45_000 });
        await expect(opened.getByTestId('item-title')).toHaveValue('Door 3 hinge loose');
        await expect.poll(() => editorPage.evaluate(() => new URL(window.location.href).searchParams.has('item'))).toBe(false);
      } finally {
        await editorContext?.close();
        await admin.from('project_items').delete().eq('project_id', projectId);
        await admin.from('project_collaborators').delete().eq('project_id', projectId);
        await admin.from('projects').delete().eq('id', projectId);
      }
    });
  });
}
