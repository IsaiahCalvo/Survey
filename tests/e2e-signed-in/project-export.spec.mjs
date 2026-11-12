// Export project (Nightly flag project-export), copied from Drawboard
// Projects' "Export Project": the project's More menu makes one zip with
// every file (marks drawn in, every revision when asked), each file's
// comments as CSV and the Issues register. Survey downloads it at once.
// Every layout: desktop, tablet, phone web on iPhone and Android sizes, the
// phone app on iOS and Android.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import * as Y from 'yjs';
import { bytesToPgHex } from '../../supabase/functions/_shared/pgBytea.js';
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
  pdf.addPage([612, 792]).drawText(label, { x: 72, y: 700, size: 20, font });
  return Buffer.from(await pdf.save());
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
const SHOTS = process.env.E2E_EXPORT_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);
const annotCount = async (bytes) => {
  const pdf = await PDFDocument.load(bytes);
  const annots = pdf.getPage(0).node.lookup(PDFName.of('Annots'));
  return annots ? annots.size() : 0;
};

for (const [i, layout] of LAYOUTS.entries()) {
  test.describe(`Project export, ${layout.name}`, () => {
    test.use(layout.use);

    test('one zip: drawings with marks, every revision, comments and issues', async ({ page }) => {
      test.setTimeout(240_000);
      const admin = adminClient();
      const owner = E2E_ACCOUNTS.owner;
      const api = await apiClientFor(owner);
      const ownerId = await userIdOf(admin, owner);
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const projectId = crypto.randomUUID();
      const projectName = `PX ${slug} ${RUN}`.slice(0, 60);
      const n = 300 + i;
      const docs = {
        planA: { id: crypto.randomUUID(), name: 'Plan.pdf', sheet_number: `A${n}`, sheet_revision: 'A', label: `Plan rev A ${RUN}` },
        planB: { id: crypto.randomUUID(), name: 'Plan.pdf', sheet_number: `A${n}`, sheet_revision: 'B', label: `Plan rev B ${RUN}` },
        spec: { id: crypto.randomUUID(), name: 'Spec.pdf', sheet_number: null, sheet_revision: null, label: `Spec ${RUN}` },
      };
      await must('project', admin.from('projects').insert({ id: projectId, user_id: ownerId, name: projectName }));
      const bytesOf = {};
      for (const doc of Object.values(docs)) {
        const bytes = await onePagePdf(doc.label);
        bytesOf[doc.id] = bytes;
        const path = `${ownerId}/${doc.id}.pdf`;
        await must(`upload ${doc.label}`, admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
        await must(`row ${doc.label}`, admin.from('documents').insert({
          id: doc.id, user_id: ownerId, project_id: projectId, name: doc.name, file_path: path, file_size: bytes.length, page_count: 1,
          sheet_number: doc.sheet_number, sheet_revision: doc.sheet_revision,
          content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        }));
      }
      // Revision B replaced revision A.
      await must('supersede', api.rpc('supersede_document', { p_old_document_id: docs.planA.id, p_new_document_id: docs.planB.id }));
      // One rectangle on revision B, as the store keeps it (annotationMarkStore.js).
      const markId = `px-rect-${RUN}-${i}`;
      const source = new Y.Doc();
      source.transact(() => {
        const entry = new Y.Map();
        source.getMap('marks').set(markId, entry);
        entry.set('p', 1);
        const fields = new Y.Map();
        entry.set('o', fields);
        const rect = { type: 'rect', id: markId, left: 150, top: 220, width: 120, height: 60, stroke: '#e53935', strokeWidth: 3, fill: 'transparent' };
        for (const [k, v] of Object.entries(rect)) fields.set(k, v);
      });
      await must('seed mark', api.rpc('append_annotation_update', {
        p_document_id: docs.planB.id, p_client_id: `px-seed-${RUN}-${i}`, p_client_seq: 1, p_data: bytesToPgHex(Y.encodeStateAsUpdate(source)),
      }));
      // A comment on the spec, an issue in the project.
      const comment = `Check the door schedule ${RUN}`;
      await must('comment', api.rpc('add_mark_comment', { p_document_id: docs.spec.id, p_page_number: 1, p_body: comment, p_mark_id: null, p_thread_id: null, p_mentions: [] }));
      const issue = `Leak at grid C ${RUN}`;
      await must('issue', api.from('project_items').insert({ project_id: projectId, kind: 'issue', title: issue, status: 'open' }));

      await page.addInitScript(() => { localStorage.setItem('survey.flag.project-export', '1'); });
      try {
        await signInAt(page, owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        if (layout.phone && !layout.app) {
          const sectionMenu = visible(page.locator('.hub-title-switch'));
          await expect(sectionMenu).toBeVisible({ timeout: 45_000 });
          // The hub redraws while it loads; open the menu and pick Projects until the list shows.
          await expect(async () => {
            if ((await sectionMenu.getAttribute('aria-expanded')) !== 'true') await press(layout, sectionMenu);
            await expect(sectionMenu).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 });
            await visible(page.locator('.hub-section-menu').getByRole('menuitem', { name: 'Projects' })).tap({ timeout: 2_000 });
            await expect(visible(page.locator(`[data-project-id="${projectId}"]`))).toBeVisible({ timeout: 5_000 });
          }).toPass({ timeout: 45_000 });
        } else {
          await visible(page.getByRole('button', { name: 'Projects', exact: true }).or(page.getByRole('tab', { name: 'Projects' }))).click();
        }
        const projectRow = visible(page.locator(`[data-project-id="${projectId}"]`));
        await expect(projectRow).toBeVisible({ timeout: 45_000 });

        // 1. The project's More menu: Export project…
        await press(layout, visible(projectRow.getByRole('button', { name: 'More', exact: true })));
        await press(layout, visible(page.getByRole('menuitem', { name: 'Export project…' })));
        const dialog = page.locator('[data-project-export]');
        await expect(dialog).toBeVisible();
        await expect(dialog).toContainText('2 files in one zip');
        await press(layout, dialog.getByRole('radio', { name: /Every revision/ }));
        await expect(dialog.getByRole('radio', { name: /Every revision/ })).toHaveAttribute('aria-checked', 'true');
        await shot(page, layout, '1-dialog');
        const box = await dialog.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(layout.use.viewport.width + 1);

        // 2. Export: the zip downloads and the dialog closes.
        const downloading = page.waitForEvent('download', { timeout: 90_000 });
        await press(layout, dialog.getByRole('button', { name: 'Export', exact: true }));
        const download = await downloading;
        await expect(dialog).toBeHidden({ timeout: 30_000 });
        const safe = projectName.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
        expect(download.suggestedFilename()).toBe(`${safe} (5 items).zip`);

        // 3. Inside: both revisions of the drawing, the spec, comments, issues.
        const zip = await JSZip.loadAsync(readFileSync(await download.path()));
        const names = Object.keys(zip.files).filter((k) => !zip.files[k].dir).sort();
        expect(names.filter((k) => !k.startsWith('Issues/'))).toEqual([
          'Comments/Spec comments.csv',
          'Documents/Spec.pdf',
          `Drawings/A-${n} - Plan - A.pdf`,
          `Drawings/A-${n} - Plan - B.pdf`,
        ]);
        expect(names.filter((k) => k.startsWith('Issues/'))).toHaveLength(1);
        expect(names.find((k) => k.startsWith('Issues/'))).toContain(`${safe} - Issues Register - `);
        // Revision B carries its rectangle; revision A and the spec have no marks and come out as stored.
        const planB = await zip.file(`Drawings/A-${n} - Plan - B.pdf`).async('uint8array');
        expect(await annotCount(planB)).toBeGreaterThan(0);
        const planA = await zip.file(`Drawings/A-${n} - Plan - A.pdf`).async('uint8array');
        expect(Buffer.from(planA).equals(bytesOf[docs.planA.id])).toBe(true);
        const spec = await zip.file('Documents/Spec.pdf').async('uint8array');
        expect(Buffer.from(spec).equals(bytesOf[docs.spec.id])).toBe(true);
        expect(await zip.file('Comments/Spec comments.csv').async('string')).toContain(comment);
        expect(await zip.file(names.find((k) => k.startsWith('Issues/'))).async('string')).toContain(issue);
      } finally {
        if (!process.env.KEEP) {
          await admin.from('documents').delete().in('id', Object.values(docs).map((d) => d.id));
          await admin.from('projects').delete().eq('id', projectId);
        }
      }
    });
  });
}
