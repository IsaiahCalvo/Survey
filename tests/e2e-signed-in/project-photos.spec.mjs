// Project Photos copied from Drawboard Projects (Nightly flag project-photos;
// src/projectPhotos/). On desktop, phone web and the phone app: the empty
// Photos tab, Add photo (file stored under the project, row saved), the
// viewer ("Photo 1 of 1", uploader), Edit image with the pen and Save markup
// (a marked copy, the original kept), Back to original, the Linked filter,
// attaching the photo to an issue from "Browse project photos" (logged in
// the issue's Activity), the link chip in the viewer, and Delete with its
// 5 s Undo (row and files gone).
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

/* A plain 480x320 PNG (a sky-blue sheet with a darker band), made here. */
function samplePng() {
  const w = 480; const h = 320;
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
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y += 1) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    const band = y > 120 && y < 200;
    for (let x = 0; x < w; x += 1) {
      const o = row + 1 + x * 3;
      raw[o] = band ? 40 : 120; raw[o + 1] = band ? 90 : 180; raw[o + 2] = band ? 160 : 230;
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

async function userIdOf(admin, account) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === account.email).id;
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
const SHOTS = process.env.E2E_PHOTO_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);

async function openProject(page, layout, projectId, docName) {
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
  const projectRow = visible(page.locator(`[data-project-id="${projectId}"]`));
  await expect(projectRow).toBeVisible({ timeout: 45_000 });
  await press(layout, projectRow);
}

for (const layout of LAYOUTS) {
  test.describe(`Project photos, ${layout.name}`, () => {
    test.use(layout.use);

    test('add, mark up, link to an issue and delete a project photo', async ({ page }) => {
      test.setTimeout(240_000);
      const admin = adminClient();
      const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const projectId = crypto.randomUUID();
      const projectName = `PP ${slug} ${RUN}`.slice(0, 60);
      const docName = `PP-${slug}.pdf`;
      await must('project', admin.from('projects').insert({ id: projectId, user_id: ownerId, name: projectName }));
      // One file so the project shows in the phone list, one issue to link to.
      const docId = crypto.randomUUID();
      await must('doc', admin.from('documents').insert({
        id: docId, user_id: ownerId, project_id: projectId, name: docName, file_path: `${ownerId}/${docId}.pdf`, file_size: 10, page_count: 1,
      }));
      const issue = await must('issue', admin.from('project_items').insert({ project_id: projectId, kind: 'issue', title: 'Leak at riser' }).select('id, number').single());

      await page.addInitScript(() => {
        localStorage.setItem('survey.flag.project-issues', '1');
        localStorage.setItem('survey.flag.project-photos', '1');
      });
      try {
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        await openProject(page, layout, projectId, docName);

        // 1. The Photos tab starts empty.
        await press(layout, visible(page.locator('[data-project-items-tabs]').getByRole('tab', { name: 'Photos' })));
        const panel = visible(page.locator(`[data-project-photos="${projectId}"]`));
        await expect(panel.getByText('No photos yet')).toBeVisible();
        await shot(page, layout, '1-empty');

        // 2. Add photo: the file lands under the project, the row is saved.
        await panel.locator('[data-photo-input]').setInputFiles({ name: 'riser.png', mimeType: 'image/png', buffer: samplePng() });
        const tile = visible(panel.locator('[data-photo-tile]'));
        await expect(tile).toBeVisible({ timeout: 30_000 });
        await expect.poll(async () => (await admin.from('project_photos').select('id').eq('project_id', projectId)).data?.length).toBe(1);
        const { data: [photo] } = await admin.from('project_photos').select('id, path, marked_path, uploaded_by, width, height').eq('project_id', projectId);
        expect(photo.path).toMatch(new RegExp(`^${projectId}/${photo.id}\\.(png|jpg)$`));
        expect(photo.uploaded_by).toBe(ownerId);
        expect(photo.marked_path).toBeNull();
        expect(photo.width).toBe(480);
        await shot(page, layout, '2-added');

        // 3. The viewer, then Edit image: a pen stroke, Save markup.
        await press(layout, tile.locator('.photo-tile-open'));
        const viewer = visible(page.locator(`[data-photo-viewer="${photo.id}"]`));
        await expect(viewer).toBeVisible();
        await expect(visible(page.getByText('Photo 1 of 1'))).toBeVisible();
        await expect(viewer.getByText('Uploaded by')).toBeVisible();
        await press(layout, viewer.locator('[data-photo-edit]'));
        const canvas = viewer.locator('[data-photo-canvas]');
        await expect(canvas).toBeVisible();
        await expect(viewer.locator('[data-photo-tool="pen"]')).toHaveAttribute('aria-pressed', 'true');
        await press(layout, viewer.locator('[data-photo-colour="blue"]'));
        const box = await canvas.boundingBox();
        await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
        await page.mouse.down();
        for (let i = 1; i <= 10; i += 1) await page.mouse.move(box.x + box.width * (0.2 + i * 0.05), box.y + box.height * (0.3 + i * 0.03));
        await page.mouse.up();
        await shot(page, layout, '3-markup');
        await press(layout, viewer.locator('[data-photo-save]'));
        await expect.poll(async () => (await admin.from('project_photos').select('marked_path').eq('id', photo.id).single()).data?.marked_path)
          .toBe(`${projectId}/${photo.id}-m1.png`);
        const files = async () => ((await admin.storage.from('project-photos').list(projectId)).data || []).map((f) => f.name).sort();
        await expect.poll(files).toEqual([photo.path.split('/')[1], `${photo.id}-m1.png`].sort());
        await expect(viewer.locator('[data-photo-original]')).toBeVisible();

        // 4. Back to original: the marked copy goes, the original stays.
        await press(layout, viewer.locator('[data-photo-original]'));
        await expect.poll(async () => (await admin.from('project_photos').select('marked_path').eq('id', photo.id).single()).data?.marked_path).toBeNull();
        await expect.poll(files).toEqual([photo.path.split('/')[1]]);
        await page.keyboard.press('Escape');
        await expect(viewer).toBeHidden();

        // 5. Linked filter: nothing linked yet.
        await press(layout, panel.locator('[data-photo-filter-open]'));
        await press(layout, visible(page.locator('[data-photo-filter="linked"]')));
        await expect(panel.getByText('No photos match these filters.')).toBeVisible();
        await page.keyboard.press('Escape');

        // 6. The issue attaches it from "Browse project photos".
        await press(layout, visible(page.locator('[data-project-items-tabs]').getByRole('tab', { name: 'Issues' })));
        await press(layout, visible(page.locator(`[data-item-row="${issue.id}"]`)));
        const detail = visible(page.locator(`[data-item-detail="${issue.id}"]`));
        await expect(detail).toBeVisible();
        const strip = detail.locator(`[data-item-photos="${issue.id}"]`);
        await expect(strip).toBeVisible({ timeout: 20_000 });
        await press(layout, strip.locator('[data-item-photo-add]'));
        await press(layout, visible(page.getByRole('menuitem', { name: 'Browse project photos' })));
        await press(layout, visible(page.locator(`[data-photo-gallery-tile="${photo.id}"]`)));
        await press(layout, visible(page.locator('[data-photo-gallery-add]')));
        await expect(strip.locator(`[data-item-photo="${photo.id}"]`)).toBeVisible();
        await expect.poll(async () => (await admin.from('project_photo_links').select('item_id').eq('photo_id', photo.id)).data)
          .toEqual([{ item_id: issue.id }]);
        await expect.poll(async () => (await admin.from('project_item_events').select('action').eq('item_id', issue.id).eq('action', 'photo_added')).data?.length).toBe(1);
        await shot(page, layout, '4-issue');
        if (layout.phone) await press(layout, detail.getByRole('button', { name: 'Close details' }));

        // 7. Back on Photos the Linked filter shows it, and the viewer names ISS-n.
        await press(layout, visible(page.locator('[data-project-items-tabs]').getByRole('tab', { name: 'Photos' })));
        await press(layout, panel.locator('[data-photo-filter-open]'));
        await press(layout, visible(page.locator('[data-photo-filter="linked"]')));
        await page.keyboard.press('Escape');
        await expect(visible(panel.locator(`[data-photo-tile="${photo.id}"]`))).toBeVisible();
        await press(layout, visible(panel.locator(`[data-photo-tile="${photo.id}"] .photo-tile-open`)));
        await expect(visible(page.locator('[data-photo-links]')).getByText(`ISS-${issue.number}`)).toBeVisible();

        // 8. Delete with Undo: hidden at once, gone (row, link, file) after 5 s.
        await press(layout, visible(page.locator('[data-photo-delete]')));
        await expect(panel.locator(`[data-photo-tile="${photo.id}"]`)).toHaveCount(0);
        await expect.poll(async () => (await admin.from('project_photos').select('id').eq('id', photo.id)).data?.length, { timeout: 20_000 }).toBe(0);
        await expect.poll(files, { timeout: 20_000 }).toEqual([]);
        expect((await admin.from('project_photo_links').select('photo_id').eq('photo_id', photo.id)).data).toEqual([]);
      } finally {
        await admin.from('project_photos').delete().eq('project_id', projectId);
        const left = ((await admin.storage.from('project-photos').list(projectId)).data || []).map((f) => `${projectId}/${f.name}`);
        if (left.length) await admin.storage.from('project-photos').remove(left);
        await admin.from('project_items').delete().eq('project_id', projectId);
        await admin.from('documents').delete().eq('id', docId);
        await admin.from('projects').delete().eq('id', projectId);
      }
    });
  });
}

/* Who may read, add and delete project photo files and rows. */
test('project photos: viewers read, editors add, only the uploader or the owner deletes, strangers see nothing', async () => {
  const admin = adminClient();
  const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
  const editorId = await userIdOf(admin, E2E_ACCOUNTS.editor);
  const viewerId = await userIdOf(admin, E2E_ACCOUNTS.viewer);
  const projectId = crypto.randomUUID();
  await must('project', admin.from('projects').insert({ id: projectId, user_id: ownerId, name: `PP rules ${RUN}`.slice(0, 60) }));
  await must('collabs', admin.from('project_collaborators').insert([
    { project_id: projectId, user_id: editorId, role: 'editor', status: 'active', email: E2E_ACCOUNTS.editor.email },
    { project_id: projectId, user_id: viewerId, role: 'viewer', status: 'active', email: E2E_ACCOUNTS.viewer.email },
  ]));
  const [owner, editor, viewer, stranger] = await Promise.all([
    apiClientFor(E2E_ACCOUNTS.owner), apiClientFor(E2E_ACCOUNTS.editor), apiClientFor(E2E_ACCOUNTS.viewer), apiClientFor(E2E_ACCOUNTS.pro),
  ]);
  const png = new Blob([samplePng()], { type: 'image/png' });
  const add = async (client) => {
    const id = crypto.randomUUID();
    const path = `${projectId}/${id}.png`;
    const up = await client.storage.from('project-photos').upload(path, png, { contentType: 'image/png' });
    const row = up.error ? { error: up.error } : await client.from('project_photos').insert({ id, project_id: projectId, path }).select('id').single();
    return { id, path, error: up.error || row.error };
  };
  try {
    const mine = await add(editor);
    expect(mine.error, 'editor adds').toBeFalsy();
    expect((await add(viewer)).error, 'viewer cannot add').toBeTruthy();
    expect((await add(stranger)).error, 'stranger cannot add').toBeTruthy();
    // A row cannot point at another project's file or another photo's name.
    const wrong = await editor.from('project_photos').insert({ project_id: projectId, path: `${projectId}/${crypto.randomUUID()}.png` });
    expect(wrong.error?.message || '').toContain('bad photo path');

    expect((await viewer.storage.from('project-photos').download(mine.path)).data, 'viewer reads').not.toBeNull();
    expect((await viewer.from('project_photos').select('id').eq('id', mine.id)).data).toHaveLength(1);
    expect((await stranger.storage.from('project-photos').download(mine.path)).data, 'stranger cannot read').toBeNull();
    expect((await stranger.from('project_photos').select('id').eq('id', mine.id)).data).toEqual([]);

    // Markup must be this photo's own -m<n> copy.
    const badMark = await editor.from('project_photos').update({ marked_path: `${projectId}/${crypto.randomUUID()}-m1.png` }).eq('id', mine.id);
    expect(badMark.error?.message || '').toContain('bad marked path');

    // The viewer cannot delete; the owner can (not only the uploader).
    await viewer.from('project_photos').delete().eq('id', mine.id);
    await viewer.storage.from('project-photos').remove([mine.path]);
    expect((await admin.from('project_photos').select('id').eq('id', mine.id)).data).toHaveLength(1);
    expect(((await admin.storage.from('project-photos').list(projectId)).data || []).length).toBe(1);
    await owner.from('project_photos').delete().eq('id', mine.id);
    await owner.storage.from('project-photos').remove([mine.path]);
    expect((await admin.from('project_photos').select('id').eq('id', mine.id)).data).toEqual([]);
    expect(((await admin.storage.from('project-photos').list(projectId)).data || []).length).toBe(0);
  } finally {
    const left = ((await admin.storage.from('project-photos').list(projectId)).data || []).map((f) => `${projectId}/${f.name}`);
    if (left.length) await admin.storage.from('project-photos').remove(left);
    await admin.from('projects').delete().eq('id', projectId);
  }
});
