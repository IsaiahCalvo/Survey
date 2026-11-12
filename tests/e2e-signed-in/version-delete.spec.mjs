// Delete one version (Nightly flag version-delete), copied from Drawboard
// Projects' "only the latest revision and its markup" delete: from the
// Versions list, delete the open latest copy (the one before is current
// again and opens), Undo puts it back, then delete an older copy. Someone
// else's copy can't be deleted. Every layout: desktop, tablet, phone web on
// iPhone and Android sizes, the phone app on iOS and Android.
import crypto from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, test } from './helpers.mjs';

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } }, phone: false, app: false },
  { name: 'tablet', use: { viewport: { width: 1024, height: 768 }, hasTouch: true }, phone: false, app: false },
  { name: 'phone web, 390px iPhone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone web, 360px Android', use: { viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone app, iOS 390px', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }, phone: true, app: true },
  { name: 'phone app, Android 412px', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }, phone: true, app: true },
];

async function onePagePdf(label) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(label, { x: 72, y: 700, size: 24, font });
  return Buffer.from(await pdf.save());
}

async function addCopy(admin, userId, name, label) {
  const id = crypto.randomUUID();
  const bytes = await onePagePdf(label);
  const path = `${userId}/${id}.pdf`;
  await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('row', admin.from('documents').insert({
    id, user_id: userId, project_id: null, name, file_path: path, file_size: bytes.length, page_count: 1,
    content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }));
  return id;
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
const press = (layout, locator, options = {}) => (layout.use.hasTouch ? locator.tap(options) : locator.click(options));
const SHOTS = process.env.E2E_VERSION_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);

/* The desktop's "v3" button, or the phone's More menu row. */
async function openVersions(page, layout) {
  const list = page.locator('[data-document-versions]');
  await expect(async () => {
    if (await list.isVisible()) return;
    const button = page.locator('[data-document-versions-button]').filter({ visible: true });
    if (await button.count()) await press(layout, button.first(), { timeout: 3_000 });
    else {
      await press(layout, visible(page.getByRole('button', { name: 'More document options', exact: true })), { timeout: 3_000 });
      await press(layout, visible(page.locator('[data-mobile-document-versions]')), { timeout: 3_000 });
    }
    await expect(list).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
  return list;
}

/* The open copy, as the Versions list marks it ("Open now"). Phones draw no text layer to read. */
async function expectOpen(page, layout, number, rows) {
  const list = await openVersions(page, layout);
  await expect(list.locator('[data-version-row]')).toHaveCount(rows);
  await expect(list.locator(`[data-version-row="${number}"]`)).toContainText('Open now', { timeout: 20_000 });
  return list;
}

for (const [i, layout] of LAYOUTS.entries()) {
  test.describe(`Version delete, ${layout.name}`, () => {
    test.use(layout.use);

    test('delete the latest (the one before is current again), Undo, delete an older one', async ({ page }) => {
      test.setTimeout(240_000);
      const admin = adminClient();
      const api = await apiClientFor(E2E_ACCOUNTS.owner);
      const stranger = await apiClientFor(E2E_ACCOUNTS.free);
      const { data: { user } } = await api.auth.getUser();
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const name = `VD ${slug} ${RUN} ${i}.pdf`;
      const v1 = await addCopy(admin, user.id, name, `VD rev A ${i}`);
      const v2 = await addCopy(admin, user.id, name, `VD rev B ${i}`);
      const v3 = await addCopy(admin, user.id, name, `VD rev C ${i}`);
      await must('v1 -> v2', api.rpc('supersede_document', { p_old_document_id: v1, p_new_document_id: v2 }));
      await must('v2 -> v3', api.rpc('supersede_document', { p_old_document_id: v2, p_new_document_id: v3 }));
      const chain = async () => (await must('versions', api.rpc('document_versions', { p_document_id: v2 }))).map((v) => [v.id, v.version_number, v.is_current]);
      const extra = [];
      const row = async (id) => must('row', admin.from('documents').select('superseded_by, user_archived_at').eq('id', id).single());

      // Shared with the editor after the last upload: the share sits on v3 only.
      const editorApi = i === 0 ? await apiClientFor(E2E_ACCOUNTS.editor) : null;
      const editorId = editorApi ? (await editorApi.auth.getUser()).data.user.id : null;
      if (editorId) {
        await must('share v3', admin.from('document_collaborators').insert({
          document_id: v3, user_id: editorId, invited_by: user.id, role: 'editor', email: E2E_ACCOUNTS.editor.email, status: 'active',
        }));
      }
      const sharedWith = async (id) => (await must('shares', admin.from('document_collaborators').select('user_id').eq('document_id', id))).map((r) => r.user_id);

      try {
        // Someone with no access gets the same answer as for no such copy.
        expect((await stranger.rpc('remove_document_version', { p_document_id: v3 })).error?.message).toContain('Document not found');

        await page.addInitScript(() => {
          localStorage.setItem('survey.flag.document-versions', '1');
          localStorage.setItem('survey.flag.version-delete', '1');
        });
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        const docRow = visible(page.getByText(name, { exact: true }));
        await expect(docRow).toBeVisible({ timeout: 45_000 });
        await press(layout, docRow);
        const openFile = page.getByRole('button', { name: 'Open file' }).filter({ visible: true });
        const viewer = page.locator('[data-document-versions-button]').or(page.getByRole('button', { name: 'More document options', exact: true })).filter({ visible: true });
        await expect(async () => {
          if (!(await viewer.count()) && (await openFile.count())) await press(layout, openFile.first(), { timeout: 3_000 }).catch(() => {});
          await expect(viewer.first()).toBeVisible({ timeout: 5_000 });
        }).toPass({ timeout: 60_000 });

        // 1. Delete v3, the open latest copy: v2 is current again and opens.
        let list = await expectOpen(page, layout, 3, 3);
        await shot(page, layout, '1-list');
        const box = await list.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(layout.use.viewport.width + 1);
        await press(layout, list.locator('[data-version-delete-button="3"]'));
        await expect(page.getByText('Deleted v3. v2 is current again.')).toBeVisible({ timeout: 20_000 });
        expect(await chain()).toEqual([[v1, 1, false], [v2, 2, true]]);
        expect((await row(v3)).user_archived_at).not.toBeNull();
        await expect(page.locator('[data-document-versions]')).toBeHidden();
        // v2 takes marks again: no older-version bar.
        await expect(page.locator('[data-older-version-bar]').filter({ visible: true })).toHaveCount(0, { timeout: 20_000 });
        await shot(page, layout, '2-deleted');
        if (i === 0) {
          // Straight calls, as the functions ship with the flag off: an
          // upload in flight can't make the deleted copy a version again, and
          // nobody else can Undo the delete.
          const late = await addCopy(admin, user.id, name, `VD late ${i}`);
          extra.push(late);
          expect((await api.rpc('supersede_document', { p_old_document_id: v3, p_new_document_id: late })).error?.message).toContain('Only current documents');
          // Undo takes no chain ids, and only the person who deleted it (or its uploader) may.
          expect((await stranger.rpc('restore_document_version', { p_document_id: v3 })).error?.message).toContain('Document not found');
          expect((await row(v3)).user_archived_at).not.toBeNull();
          // The share moved to v2, the copy that is current again.
          expect(await sharedWith(v2)).toContain(editorId);
          // The deleted copy is never "current", even to its uploader.
          expect((await must('deleted copy', api.rpc('document_versions', { p_document_id: v3 }))).map((v) => v.is_current)).toEqual([false]);
        }

        // 2. Undo: v3 is back as the latest.
        // The toast's Undo (the viewer's own Undo button is another one).
        await press(layout, visible(page.locator('.app-toast-host').getByRole('button', { name: 'Undo' })));
        await expect.poll(chain, { timeout: 20_000 }).toEqual([[v1, 1, false], [v2, 2, false], [v3, 3, true]]);
        expect((await row(v3)).user_archived_at).toBeNull();
        if (editorId) expect(await sharedWith(v3)).toContain(editorId);
        await expect(page.locator('.app-toast-host [data-toast-id]')).toHaveCount(0, { timeout: 20_000 });

        // 3. Delete v1, an older copy: the chain closes over the gap.
        list = await expectOpen(page, layout, 3, 3);
        await press(layout, list.locator('[data-version-delete-button="1"]'));
        await expect(page.getByText('Deleted v1.', { exact: true })).toBeVisible({ timeout: 20_000 });
        await expect(list.locator('[data-version-row]')).toHaveCount(2);
        expect(await chain()).toEqual([[v2, 1, false], [v3, 2, true]]);
        const gone = await row(v1);
        expect(gone.superseded_by).toBeNull();
        expect(gone.user_archived_at).not.toBeNull();
      } finally {
        if (!process.env.KEEP) {
          const unlink = await admin.from('documents').update({ superseded_by: null }).in('id', [v1, v2, v3, ...extra]);
          const del = await admin.from('documents').delete().in('id', [v1, v2, v3, ...extra]);
          if (unlink.error || del.error) console.warn('[version-delete] cleanup', unlink.error?.message, del.error?.message);
        }
      }
    });
  });
}
