// A OneDrive / SharePoint PDF added straight into a project (Nightly flag
// 'drive-sync-back'; Drawboard Projects' "New drawing > OneDrive"). On
// desktop from the project header's "From OneDrive", on the phone app from
// the project's ⋮ menu: the picker names the project, the PDF lands in the
// project's files without opening, and it is linked so marks save back.
//
// Same harness as drive-sync-back.spec: the sheet-sync function is answered
// here by the real server code (driveAction) against the local database,
// with a fake Microsoft Graph behind it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, expect, test } from './helpers.mjs';
import { createDriveClient, driveAction, DriveError } from '../../supabase/functions/_shared/driveFiles/service.js';

const FIXTURE = fs.readFileSync('debug/fixtures/clickable-link-test.pdf');
const GRAPH = 'https://graph.fake-onedrive.test/v1.0';
const FILES = 'https://files.fake-onedrive.test';
const DRIVE = 'b!e2edrive';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,PUT,POST,OPTIONS', 'Access-Control-Expose-Headers': '*' };

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } }, phone: false },
  { name: 'phone app, Android 412px', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }, phone: true },
];

/* A one-folder OneDrive: Plans/<name>. */
function fakeOneDrive(fileName) {
  const items = new Map([['PLAN1', { name: fileName, bytes: Buffer.concat([FIXTURE, Buffer.from(`\n% ${fileName}\n`)]), version: 1 }]]);
  const item = (id, it) => ({
    id, name: it.name, eTag: `"{${id}},${it.version}"`, size: it.bytes.length, webUrl: `https://contoso.example/Plans/${encodeURIComponent(it.name)}`,
    file: { mimeType: 'application/pdf' }, parentReference: { driveId: DRIVE }, lastModifiedDateTime: new Date().toISOString(),
    '@microsoft.graph.downloadUrl': `${FILES}/dl/${id}?v=${it.version}`,
  });
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const graphFetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    const path = decodeURIComponent(url.slice(GRAPH.length + 1)).replace(/\?.*$/, '');
    if (method === 'GET' && path === 'me/drive/root/children') return json(200, { value: [{ name: 'Plans', folder: { childCount: 1 } }] });
    if (method === 'GET' && path === 'me/drive/root:/Plans:/children') return json(200, { value: [...items].map(([id, it]) => item(id, it)) });
    const m = /^drives\/([^/]+)\/items\/([^/]+)$/.exec(path);
    if (m && items.has(m[2])) return json(200, item(m[2], items.get(m[2])));
    return json(404, { error: { code: 'itemNotFound' } });
  };
  return { items, graphFetch };
}

async function serveDriveActions(context, drive) {
  const admin = adminClient();
  await context.route('**/functions/v1/sheet-sync', async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const body = request.postDataJSON() || {};
    const token = (request.headers().authorization || '').replace(/^Bearer /, '');
    const reply = (status, data) => route.fulfill({ status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!String(body.action || '').startsWith('drive')) {
      if (body.action === 'status') return reply(200, { microsoft: { connected: true, email: null } });
      return reply(400, { error: 'not in this test' });
    }
    const { data: who } = await admin.auth.getUser(token);
    if (!who?.user) return reply(401, { error: 'Sign in first.' });
    const userDb = createClient(process.env.E2E_SUPABASE_URL, process.env.E2E_SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { action, ...rest } = body;
    try {
      const out = await driveAction({
        user: who.user, userDb, service: admin, env: {}, body: { action, ...rest },
        driveClientFor: async () => createDriveClient({ getAccessToken: async () => 'tok-e2e', fetch: drive.graphFetch, baseUrl: GRAPH }),
      });
      return reply(200, out);
    } catch (err) {
      if (err instanceof DriveError) return reply(err.status, { error: err.message, code: err.code });
      return reply(500, { error: String(err?.message || err) });
    }
  });
  await context.route(`${FILES}/**`, async (route) => {
    const request = route.request();
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    const dl = /\/dl\/([^/?]+)/.exec(request.url());
    const it = dl && drive.items.get(dl[1]);
    if (!it) return route.fulfill({ status: 404, headers: CORS, body: '' });
    return route.fulfill({ status: 200, headers: { ...CORS, 'Content-Type': 'application/pdf' }, body: it.bytes });
  });
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

async function flagOn(on) {
  await adminClient().from('feature_flags').update({ mode: on ? 'on' : 'off' }).eq('key', 'drive-sync-back');
}

for (const layout of LAYOUTS) {
  test.describe(`Project from OneDrive, ${layout.name}`, () => {
    test.use(layout.use);

    test('a OneDrive PDF lands in the project, unopened, linked to save back', async ({ page, context }) => {
      test.setTimeout(180_000);
      const admin = adminClient();
      const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
      const ownerId = users.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const projectId = crypto.randomUUID();
      const projectName = `POD ${slug} ${RUN}`.slice(0, 60);
      const fileName = `E2E OneDrive into project ${slug} ${Date.now()}.pdf`;
      const drive = fakeOneDrive(fileName);
      await must('project', admin.from('projects').insert({ id: projectId, user_id: ownerId, name: projectName }));
      await context.addInitScript(() => { try { localStorage.setItem('survey.flag.drive-sync-back', '1'); } catch { /* */ } });
      await flagOn(true);
      try {
        await serveDriveActions(context, drive);
        await signInAt(page, E2E_ACCOUNTS.owner, layout.phone ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        const tab = visible(page.getByRole('button', { name: 'Projects', exact: true }).or(page.getByRole('tab', { name: 'Projects' })));
        const row = visible(page.locator(`[data-project-id="${projectId}"]`));
        await expect(async () => {
          await tab.click();
          await expect(row).toBeVisible({ timeout: 3_000 });
        }).toPass({ timeout: 45_000 });

        if (layout.phone) {
          await press(layout, row.getByRole('button', { name: 'More' }));
          await press(layout, visible(page.getByRole('menuitem', { name: 'Add from OneDrive' })));
        } else {
          await press(layout, row);
          await press(layout, visible(page.locator('[data-project-add-onedrive]')));
        }
        const picker = page.locator('[data-drive-picker="true"]');
        await expect(visible(page.getByText(`Add to ${projectName} from OneDrive`))).toBeVisible();
        await press(layout, picker.getByRole('listitem').filter({ hasText: 'Plans' }));
        await press(layout, picker.locator(`[data-drive-file="${fileName}"]`));
        await expect(visible(page.getByText(`${fileName} added to ${projectName} from OneDrive`, { exact: false }))).toBeVisible({ timeout: 60_000 });

        const { data: docs } = await admin.from('documents').select('id, project_id').eq('name', fileName);
        expect(docs).toEqual([{ id: docs[0].id, project_id: projectId }]);
        const { data: link } = await admin.from('document_drive_links').select('drive_id, item_id').eq('document_id', docs[0].id).maybeSingle();
        expect(link).toEqual({ drive_id: DRIVE, item_id: 'PLAN1' });
        // Not opened: still on the Projects page, and the file shows in the project.
        await expect(page.locator('.survey-pdfjs-page-div')).toHaveCount(0);
        if (!layout.phone) await expect(visible(page.getByText(fileName, { exact: true }))).toBeVisible({ timeout: 30_000 });
      } finally {
        await flagOn(false);
        const { data } = await admin.from('documents').select('id, file_path').eq('name', fileName);
        for (const doc of data || []) {
          await admin.from('documents').delete().eq('id', doc.id);
          if (doc.file_path) await admin.storage.from('documents').remove([doc.file_path]);
        }
        await admin.from('projects').delete().eq('id', projectId);
      }
    });
  });
}
