// Project settings and access copied from Drawboard Projects (Nightly flag
// project-access; src/projectAccess/). On desktop, phone web and the phone
// app: Project settings from the row menu (cover picture, description,
// "Everyone in <company>" as Editors), the company member let in, the role
// guide, Close project (moves under "Show closed projects") and Reopen.
// Then, on desktop, a viewer leaves a project (5 s Undo, then gone), and the
// server rules for access, close, leave and company members joining or going.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, test } from './helpers.mjs';

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } }, phone: false, app: false },
  { name: 'phone web, 390px iPhone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone app, Android 412px', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }, phone: true, app: true },
];

/* A plain 320x180 PNG, made here. */
function samplePng() {
  const w = 320; const h = 180;
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x += 1) { const o = row + 1 + x * 3; raw[o] = 150; raw[o + 1] = 110; raw[o + 2] = y > 90 ? 60 : 200; }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function idsOf(admin) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const by = (a) => data.users.find((u) => u.email === a.email).id;
  return { owner: by(E2E_ACCOUNTS.owner), pro: by(E2E_ACCOUNTS.pro), editor: by(E2E_ACCOUNTS.editor), viewer: by(E2E_ACCOUNTS.viewer) };
}

/* Same clean-up as company-workspace.spec: no test account in any company. */
async function clearCompanies(admin) {
  const emails = Object.values(E2E_ACCOUNTS).map((a) => a.email);
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const ids = (users?.users || []).filter((u) => emails.includes(u.email)).map((u) => u.id);
  const { data: rows } = await admin.from('organization_members').select('organization_id').in('user_id', ids);
  const orgs = [...new Set((rows || []).map((r) => r.organization_id))];
  if (orgs.length) await admin.from('organizations').delete().in('id', orgs);
}

async function makeCompany(admin, name, members) {
  const org = await must('org', admin.from('organizations').insert({ name }).select('id').single());
  await must('org members', admin.from('organization_members').insert(members.map(([userId, role]) => ({ organization_id: org.id, user_id: userId, role }))));
  return org.id;
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
const SHOTS = process.env.E2E_ACCESS_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);

async function showProjects(page, layout, projectId, docName) {
  if (layout.phone && !layout.app) {
    await expect(visible(page.getByText(docName, { exact: true }))).toBeVisible({ timeout: 45_000 });
    const sectionMenu = visible(page.locator('.hub-title-switch'));
    await expect(async () => {
      if ((await sectionMenu.getAttribute('aria-expanded')) !== 'true') await press(layout, sectionMenu);
      await expect(sectionMenu).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await press(layout, visible(page.locator('.hub-section-menu').getByRole('menuitem', { name: 'Projects' })));
  } else {
    const tab = visible(page.getByRole('button', { name: 'Projects', exact: true }).or(page.getByRole('tab', { name: 'Projects' })));
    await expect(async () => {
      await tab.click();
      await expect(visible(page.locator(`[data-project-id="${projectId}"]`))).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 45_000 });
  }
  await expect(visible(page.locator(`[data-project-id="${projectId}"]`))).toBeVisible({ timeout: 45_000 });
}

async function projectMenu(page, layout, projectId, item) {
  const row = visible(page.locator(`[data-project-id="${projectId}"]`));
  await press(layout, row.getByRole('button', { name: 'More' }));
  await press(layout, visible(page.getByRole('menuitem', { name: item })));
}

for (const layout of LAYOUTS) {
  test.describe(`Project settings, ${layout.name}`, () => {
    test.use(layout.use);
    test.beforeEach(async () => { await clearCompanies(adminClient()); });
    test.afterEach(async () => { await clearCompanies(adminClient()); });

    test('cover, description, company access, role guide, close and reopen', async ({ page }) => {
      test.setTimeout(240_000);
      const admin = adminClient();
      const ids = await idsOf(admin);
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const projectId = crypto.randomUUID();
      const docName = `PA-${slug}.pdf`;
      const companyName = `Acme ${slug}`.slice(0, 40);
      await must('project', admin.from('projects').insert({ id: projectId, user_id: ids.owner, name: `PA ${slug} ${RUN}`.slice(0, 60) }));
      const docId = crypto.randomUUID();
      await must('doc', admin.from('documents').insert({
        id: docId, user_id: ids.owner, project_id: projectId, name: docName, file_path: `${ids.owner}/${docId}.pdf`, file_size: 10, page_count: 1,
      }));
      await makeCompany(admin, companyName, [[ids.owner, 'owner'], [ids.pro, 'member']]);

      await page.addInitScript(() => {
        localStorage.setItem('survey.flag.project-access', '1');
        localStorage.setItem('survey.flag.project-activity', '1');
      });
      try {
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        await showProjects(page, layout, projectId, docName);

        // 1. Project settings from the row menu.
        await projectMenu(page, layout, projectId, 'Project settings');
        const card = visible(page.locator(`[data-project-settings="${projectId}"]`));
        await expect(card).toBeVisible();
        await expect(card.locator('[data-project-access="private"]')).toHaveAttribute('aria-checked', 'true');
        await card.locator('[data-project-settings-description]').fill('Level 3 fit-out, east wing');
        await card.locator('[data-project-cover-input]').setInputFiles({ name: 'cover.png', mimeType: 'image/png', buffer: samplePng() });
        await expect(card.locator('.project-settings-cover img')).toBeVisible();
        const company = card.locator('[data-project-access="company"]');
        await expect(company).toContainText(`Everyone in ${companyName}`);
        await press(layout, company);
        await press(layout, card.locator('[data-company-role="editor"]'));

        await shot(page, layout, '1-settings');
        // The role guide opens over the card and closes back to it.
        await press(layout, card.locator('[data-role-guide-open]'));
        const guide = visible(page.locator('[data-role-guide]'));
        await expect(guide).toContainText('Change who can open the project');
        if (SHOTS) await page.waitForTimeout(600);
        await shot(page, layout, '2-role-guide');
        await press(layout, visible(page.getByRole('button', { name: 'Done' })));
        await expect(guide).toBeHidden();

        await press(layout, card.locator('[data-project-settings-save]'));
        await expect(card).toBeHidden({ timeout: 20_000 });
        await expect.poll(async () => (await admin.from('projects').select('description, company_access, cover_path').eq('id', projectId).single()).data, { timeout: 20_000 })
          .toMatchObject({ description: 'Level 3 fit-out, east wing', company_access: 'editor', cover_path: `${projectId}/cover-1.png` });
        const files = ((await admin.storage.from('project-photos').list(projectId)).data || []).map((f) => f.name);
        expect(files).toEqual(['cover-1.png']);
        // The company member is let in as an Editor, from the company.
        const { data: proRow } = await admin.from('project_collaborators').select('role, status, access_source').eq('project_id', projectId).eq('user_id', ids.pro).single();
        expect(proRow).toEqual({ role: 'editor', status: 'active', access_source: 'company' });
        // One activity line, not one per company member.
        const { data: events } = await admin.from('project_events').select('action, from_value, to_value').eq('project_id', projectId).in('action', ['project_access', 'member_added']);
        expect(events).toEqual([{ action: 'project_access', from_value: 'private', to_value: 'editor' }]);

        if (!layout.phone) {
          // The header shows the cover and the description.
          await press(layout, visible(page.locator(`[data-project-id="${projectId}"]`)));
          await expect(visible(page.locator('[data-project-description]'))).toHaveText('Level 3 fit-out, east wing');
          await expect(visible(page.locator('[data-project-cover] img'))).toBeVisible({ timeout: 20_000 });
          await shot(page, layout, '3-header');
        }

        // 2. Close project: out of the list, under "Show closed projects".
        await projectMenu(page, layout, projectId, 'Close project');
        await expect(page.locator(`[data-project-id="${projectId}"]`).filter({ visible: true })).toHaveCount(0);
        await expect.poll(async () => Boolean((await admin.from('projects').select('closed_at').eq('id', projectId).single()).data?.closed_at), { timeout: 20_000 }).toBe(true);
        const toggle = visible(page.locator('[data-projects-closed-toggle]'));
        await expect(toggle).toHaveText(/Show closed projects \(\d+\)/);
        await shot(page, layout, '4-closed');
        await press(layout, toggle);
        await expect(visible(page.locator(`[data-project-id="${projectId}"]`))).toBeVisible();

        // 3. Reopen: back in the open list.
        await projectMenu(page, layout, projectId, 'Reopen project');
        await expect.poll(async () => (await admin.from('projects').select('closed_at').eq('id', projectId).single()).data?.closed_at, { timeout: 20_000 }).toBeNull();
        const back = page.locator('[data-projects-closed-toggle]').filter({ visible: true });
        if (await back.count()) await press(layout, back.first());
        await expect(visible(page.locator(`[data-project-id="${projectId}"]`))).toBeVisible();
      } finally {
        const left = ((await admin.storage.from('project-photos').list(projectId)).data || []).map((f) => `${projectId}/${f.name}`);
        if (left.length) await admin.storage.from('project-photos').remove(left);
        await admin.from('documents').delete().eq('id', docId);
        await admin.from('projects').delete().eq('id', projectId);
      }
    });
  });
}

test('a viewer leaves a project: hidden at once, gone after the Undo window', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const ids = await idsOf(admin);
  const projectId = crypto.randomUUID();
  const docName = `PA-leave-${RUN}.pdf`.slice(0, 60);
  await must('project', admin.from('projects').insert({ id: projectId, user_id: ids.owner, name: `PA leave ${RUN}`.slice(0, 60) }));
  const docId = crypto.randomUUID();
  await must('doc', admin.from('documents').insert({
    id: docId, user_id: ids.owner, project_id: projectId, name: docName, file_path: `${ids.owner}/${docId}.pdf`, file_size: 10, page_count: 1,
  }));
  await must('collab', admin.from('project_collaborators').insert({ project_id: projectId, user_id: ids.viewer, role: 'viewer', status: 'active', email: E2E_ACCOUNTS.viewer.email }));
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.addInitScript(() => localStorage.setItem('survey.flag.project-access', '1'));
  const layout = LAYOUTS[0];
  try {
    await signInAt(page, E2E_ACCOUNTS.viewer, '/');
    await showProjects(page, layout, projectId, docName);
    await projectMenu(page, layout, projectId, 'Leave project');
    await expect(page.locator(`[data-project-id="${projectId}"]`).filter({ visible: true })).toHaveCount(0);
    await expect(visible(page.getByText(/You left /))).toBeVisible();
    // Still a member during the Undo window, gone after it.
    expect((await admin.from('project_collaborators').select('id').eq('project_id', projectId).eq('user_id', ids.viewer)).data).toHaveLength(1);
    await expect.poll(async () => (await admin.from('project_collaborators').select('id').eq('project_id', projectId).eq('user_id', ids.viewer)).data?.length, { timeout: 20_000 }).toBe(0);
    await expect(page.locator(`[data-project-id="${projectId}"]`).filter({ visible: true })).toHaveCount(0);
  } finally {
    await admin.from('documents').delete().eq('id', docId);
    await admin.from('projects').delete().eq('id', projectId);
  }
});

test.describe('project access rules', () => {
  test.beforeEach(async () => { await clearCompanies(adminClient()); });
  test.afterEach(async () => { await clearCompanies(adminClient()); });

  test('only the owner changes access or closes; company members follow; leave removes only your own row', async () => {
    const admin = adminClient();
    const ids = await idsOf(admin);
    const projectId = crypto.randomUUID();
    await must('project', admin.from('projects').insert({ id: projectId, user_id: ids.owner, name: `PA rules ${RUN}`.slice(0, 60) }));
    await must('collabs', admin.from('project_collaborators').insert([
      { project_id: projectId, user_id: ids.editor, role: 'editor', status: 'active', email: E2E_ACCOUNTS.editor.email },
      { project_id: projectId, user_id: ids.viewer, role: 'viewer', status: 'active', email: E2E_ACCOUNTS.viewer.email },
    ]));
    const [owner, editor, viewer, pro] = await Promise.all([
      apiClientFor(E2E_ACCOUNTS.owner), apiClientFor(E2E_ACCOUNTS.editor), apiClientFor(E2E_ACCOUNTS.viewer), apiClientFor(E2E_ACCOUNTS.pro),
    ]);
    const rowOf = async (userId) => (await admin.from('project_collaborators').select('role, status, access_source').eq('project_id', projectId).eq('user_id', userId).maybeSingle()).data;
    try {
      // No company yet: company access is refused.
      expect((await owner.rpc('set_project_access', { p_project: projectId, p_role: 'viewer' })).error?.message || '').toContain('company');
      const org = await makeCompany(admin, `PA rules co ${RUN}`.slice(0, 40), [[ids.owner, 'owner'], [ids.pro, 'member']]);

      // Not the owner: refused, by the function and by a direct write.
      expect((await editor.rpc('set_project_access', { p_project: projectId, p_role: 'editor' })).error, 'editor cannot change access').toBeTruthy();
      expect((await editor.from('projects').update({ company_access: 'editor', company_id: org }).eq('id', projectId)).error?.message || '').toContain('use project settings');
      expect((await owner.from('projects').update({ closed_at: new Date().toISOString() }).eq('id', projectId)).error?.message || '').toContain('use project settings');
      expect((await editor.rpc('set_project_closed', { p_project: projectId, p_closed: true })).error, 'editor cannot close').toBeTruthy();
      expect((await pro.from('projects').select('id').eq('id', projectId)).data, 'outsider sees nothing yet').toEqual([]);

      // Company as Viewers: the company member gets in.
      expect((await owner.rpc('set_project_access', { p_project: projectId, p_role: 'viewer' })).error).toBeFalsy();
      expect(await rowOf(ids.pro)).toEqual({ role: 'viewer', status: 'active', access_source: 'company' });
      expect((await pro.from('projects').select('id').eq('id', projectId)).data).toHaveLength(1);
      // A person already invited keeps their own role.
      expect(await rowOf(ids.editor)).toEqual({ role: 'editor', status: 'active', access_source: 'invite' });

      // Someone joining the company gets in; leaving the company takes them out.
      const extra = await must('new member', admin.from('organization_members').insert({ organization_id: org, user_id: ids.viewer, role: 'member' }).select('user_id').single());
      expect(extra.user_id).toBe(ids.viewer);
      expect(await rowOf(ids.viewer), 'invited viewer row kept as is').toEqual({ role: 'viewer', status: 'active', access_source: 'invite' });
      await admin.from('organization_members').delete().eq('organization_id', org).eq('user_id', ids.pro);
      expect(await rowOf(ids.pro)).toBeNull();
      await admin.from('organization_members').insert({ organization_id: org, user_id: ids.pro, role: 'member' });
      expect(await rowOf(ids.pro)).toEqual({ role: 'viewer', status: 'active', access_source: 'company' });

      // The owner raising a company member by hand sticks through a re-sync.
      await owner.from('project_collaborators').update({ role: 'editor' }).eq('project_id', projectId).eq('user_id', ids.pro);
      expect(await rowOf(ids.pro)).toEqual({ role: 'editor', status: 'active', access_source: 'invite' });
      await owner.rpc('set_project_access', { p_project: projectId, p_role: 'editor' });
      await owner.rpc('set_project_access', { p_project: projectId, p_role: 'viewer' });
      expect((await rowOf(ids.pro)).role).toBe('editor');

      // Private again: company rows go, invited rows stay.
      await admin.from('project_collaborators').update({ access_source: 'company' }).eq('project_id', projectId).eq('user_id', ids.pro);
      expect((await owner.rpc('set_project_access', { p_project: projectId, p_role: null })).error).toBeFalsy();
      expect(await rowOf(ids.pro)).toBeNull();
      expect(await rowOf(ids.editor)).not.toBeNull();
      expect((await admin.from('projects').select('company_access, company_id').eq('id', projectId).single()).data).toEqual({ company_access: null, company_id: null });

      // Close and reopen: owner only, through the function.
      expect((await owner.rpc('set_project_closed', { p_project: projectId, p_closed: true })).error).toBeFalsy();
      expect((await admin.from('projects').select('closed_by').eq('id', projectId).single()).data.closed_by).toBe(ids.owner);
      expect((await owner.rpc('set_project_closed', { p_project: projectId, p_closed: false })).error).toBeFalsy();

      // A bad cover path is refused.
      expect((await editor.from('projects').update({ cover_path: `${crypto.randomUUID()}/cover-1.png` }).eq('id', projectId)).error, 'cover of another project').toBeTruthy();
      expect((await editor.from('projects').update({ cover_path: `${projectId}/cover-2.png` }).eq('id', projectId)).error, 'editor sets a cover').toBeFalsy();

      // Leave: the editor cannot remove the viewer; the viewer leaves; the
      // owner's own row can't go this way.
      await editor.from('project_collaborators').delete().eq('project_id', projectId).eq('user_id', ids.viewer);
      expect(await rowOf(ids.viewer)).not.toBeNull();
      const left = await viewer.from('project_collaborators').delete().eq('project_id', projectId).eq('user_id', ids.viewer).select('id');
      expect(left.data).toHaveLength(1);
      expect(await rowOf(ids.viewer)).toBeNull();
      const { data: leftEvent } = await admin.from('project_events').select('actor_id, subject_id').eq('project_id', projectId).eq('action', 'member_removed');
      expect(leftEvent).toEqual([{ actor_id: ids.viewer, subject_id: ids.viewer }]);
    } finally {
      await admin.from('projects').delete().eq('id', projectId);
    }
  });
});
