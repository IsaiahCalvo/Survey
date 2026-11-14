// Team page extras (Nightly flag 'team-plus'; Drawboard Projects' invite
// message, bulk invite from a CSV and team list export). On desktop from the
// project header's Manage team, on the phone app from the drilled-in
// project's team button: the team list downloads as a CSV, and Invite takes a
// note and a CSV file of people (Email, Role), sending one invite each with
// that person's role and the note in the email.
import crypto from 'node:crypto';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, expect, test } from './helpers.mjs';

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } }, phone: false },
  { name: 'phone app, Android 412px', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }, phone: true },
];

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

for (const layout of LAYOUTS) {
  test.describe(`Team page extras, ${layout.name}`, () => {
    test.use(layout.use);

    test('download the team list; invite from a CSV with a note', async ({ page, context }) => {
      test.setTimeout(150_000);
      const admin = adminClient();
      const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const idOf = (account) => users.users.find((u) => u.email === account.email).id;
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const projectId = crypto.randomUUID();
      const projectName = `TPL ${slug} ${RUN}`.slice(0, 60);
      const stamp = Date.now();
      const alex = `tpl-alex-${stamp}@example.com`;
      const sam = `tpl-sam-${stamp}@example.com`;
      const note = 'Field walk Tuesday, please look over level 2 first.';
      await must('project', admin.from('projects').insert({ id: projectId, user_id: idOf(E2E_ACCOUNTS.owner), name: projectName }));
      await must('member', admin.from('project_collaborators').insert({
        project_id: projectId, user_id: idOf(E2E_ACCOUNTS.editor), role: 'editor', status: 'active', email: E2E_ACCOUNTS.editor.email, invited_by: idOf(E2E_ACCOUNTS.owner),
      }));
      await context.addInitScript(() => { try { localStorage.setItem('survey.flag.team-plus', '1'); } catch { /* */ } });
      // The invite email goes through send-invite-email; answer it here and
      // keep the body the server would get.
      const sent = [];
      await context.route('**/functions/v1/send-invite-email', async (route) => {
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
        sent.push(route.request().postDataJSON());
        return route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*' }, contentType: 'application/json', body: JSON.stringify({ sent: true }) });
      });
      try {
        await signInAt(page, E2E_ACCOUNTS.owner, layout.phone ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        const tab = visible(page.getByRole('button', { name: 'Projects', exact: true }).or(page.getByRole('tab', { name: 'Projects' })));
        const row = visible(page.locator(`[data-project-id="${projectId}"]`));
        await expect(async () => {
          await tab.click();
          await expect(row).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 45_000 });
        await press(layout, row);
        await press(layout, visible(page.getByRole('button', { name: 'Manage team' })));
        const team = page.getByRole('dialog', { name: 'Manage team' });
        await expect(team.getByText(E2E_ACCOUNTS.editor.email)).toBeVisible({ timeout: 30_000 });

        // Team list as a CSV.
        const downloading = page.waitForEvent('download');
        await press(layout, team.locator('[data-team-csv]'));
        const download = await downloading;
        expect(download.suggestedFilename()).toMatch(new RegExp(`^TPL .* team \\d{4}-\\d{2}-\\d{2}\\.csv$`));
        const text = await new Promise((resolve, reject) => {
          download.createReadStream().then((stream) => {
            const chunks = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
            stream.on('error', reject);
          }, reject);
        });
        const lines = text.trim().split(/\r\n/);
        expect(lines[0]).toBe('Name,Email,Role,Status,Access,Added');
        expect(lines.some((l) => l.includes(E2E_ACCOUNTS.editor.email) && l.includes(',Editor,Active,Invited,'))).toBe(true);
        expect(lines.some((l) => l.includes(',Owner,Active,Owner,'))).toBe(true);

        // Invite from a CSV with a note.
        await press(layout, team.getByRole('button', { name: 'Invite', exact: true }));
        const invite = page.getByRole('dialog', { name: 'Invite User' });
        await invite.locator('[data-invite-note]').fill(note);
        await invite.locator('[data-invite-csv]').setInputFiles({
          name: 'crew.csv', mimeType: 'text/csv',
          buffer: Buffer.from(`Role,Email\nEditor,${alex}\nviewer,${sam}\nEditor,not an email\n`),
        });
        const summary = invite.locator('[data-invite-csv-summary]');
        await expect(summary).toContainText('2 people from crew.csv: 1 Editor and 1 Viewer.');
        await expect(summary).toContainText('Line 4: "not an email" is not an email address.');
        if (process.env.E2E_TEAM_SHOTS) await page.waitForTimeout(700);
        if (process.env.E2E_TEAM_SHOTS) await page.screenshot({ path: `${process.env.E2E_TEAM_SHOTS}/team-plus-invite-${slug}.png` });
        const send = invite.locator('[data-invite-send]');
        await expect(send).toHaveText('Send 2 invites');
        await press(layout, send);
        await expect.poll(() => sent.length, { timeout: 30_000 }).toBe(2);
        expect(sent.every((b) => b.message === note)).toBe(true);
        await expect(summary).toHaveCount(0);

        const { data: invites } = await admin.from('project_invites').select('target_email, intended_role').eq('project_id', projectId).order('target_email');
        expect(invites).toEqual([{ target_email: alex, intended_role: 'editor' }, { target_email: sam, intended_role: 'viewer' }]);
      } finally {
        await admin.from('project_invites').delete().eq('project_id', projectId);
        await admin.from('project_collaborators').delete().eq('project_id', projectId);
        await admin.from('projects').delete().eq('id', projectId);
      }
    });
  });
}
