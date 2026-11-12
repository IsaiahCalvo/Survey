// Restrict editing (Nightly flag 'restrict-editing'), copied from Drawboard
// Projects' export option of that name: the PDF opens and prints for anyone,
// but changing it or adding marks needs a password the toast shows.
// Export project on every layout (desktop, tablet, phone web on iPhone and
// Android sizes, the phone app on iOS and Android), and the viewer's
// Export PDF dialog on desktop. Real app, real export, real file.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import * as Y from 'yjs';
import { bytesToPgHex } from '../../supabase/functions/_shared/pgBytea.js';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const LAYOUTS = [
  { name: 'desktop', use: { viewport: { width: 1400, height: 900 } }, phone: false, app: false },
  { name: 'tablet', use: { viewport: { width: 1024, height: 768 }, hasTouch: true }, phone: false, app: false },
  { name: 'phone web, 390px iPhone', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone web, 360px Android', use: { viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, phone: true, app: false },
  { name: 'phone app, iOS 390px', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' }, phone: true, app: true },
  { name: 'phone app, Android 412px', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' }, phone: true, app: true },
];

const PASSWORD = /Password to unlock: ([A-Za-z2-9]{4}-[A-Za-z2-9]{4}-[A-Za-z2-9]{4})/;

async function onePagePdf(label) {
  const pdf = await PDFDocument.create();
  pdf.setTitle(label);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([612, 792]).drawText(label, { x: 72, y: 700, size: 20, font });
  return Buffer.from(await pdf.save());
}

function rectUpdate(markId) {
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
  return bytesToPgHex(Y.encodeStateAsUpdate(source));
}

/** What a reader sees: pages, text, title, marks; with or without a password. */
async function readerView(bytes, password) {
  const task = pdfjsLib.getDocument({ data: new Uint8Array(bytes), disableWorker: true, isEvalSupported: false, password });
  const pdf = await task.promise;
  try {
    const page = await pdf.getPage(1);
    const text = (await page.getTextContent()).items.map((item) => item.str).join('');
    const marks = (await page.getAnnotations()).length;
    return { pages: pdf.numPages, text, marks, title: (await pdf.getMetadata()).info?.Title };
  } finally {
    await task.destroy();
  }
}

/** The lock: AES-256, print and copy allowed, changes and notes not. */
async function expectLocked(bytes) {
  const raw = Buffer.from(bytes).toString('latin1');
  expect(raw).toMatch(/\/Encrypt\s+\d+\s+0\s+R/);
  expect(raw).toMatch(/\/V\s+5\b/);
  expect(raw).toMatch(/\/R\s+6\b/);
  const p = Number(raw.match(/\/P\s+(-?\d+)/)?.[1]);
  const bit = (n) => Boolean(p & (1 << (n - 1)));
  expect([bit(3), bit(5), bit(12)]).toEqual([true, true, true]);
  expect([bit(4), bit(6), bit(9), bit(11)]).toEqual([false, false, false, false]);
  await expect(PDFDocument.load(bytes)).rejects.toThrow(/encrypted/i);
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
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/restrict-${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);

for (const [i, layout] of LAYOUTS.entries()) {
  test.describe(`Restrict editing, ${layout.name}`, () => {
    test.use(layout.use);

    test('export project: every PDF opens freely, marks drawn in, one password to change', async ({ page }) => {
      test.setTimeout(240_000);
      const admin = adminClient();
      const owner = E2E_ACCOUNTS.owner;
      const api = await apiClientFor(owner);
      const ownerId = await userIdOf(admin, owner);
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const projectId = crypto.randomUUID();
      const projectName = `RX ${slug} ${RUN}`.slice(0, 60);
      const docs = [
        { id: crypto.randomUUID(), name: 'Plan.pdf', sheet_number: `A${400 + i}`, sheet_revision: 'A', label: `Plan ${RUN} ${i}` },
        { id: crypto.randomUUID(), name: 'Spec.pdf', sheet_number: null, sheet_revision: null, label: `Spec ${RUN} ${i}` },
      ];
      await must('project', admin.from('projects').insert({ id: projectId, user_id: ownerId, name: projectName }));
      const paths = [];
      for (const doc of docs) {
        const bytes = await onePagePdf(doc.label);
        const path = `${ownerId}/${doc.id}.pdf`;
        paths.push(path);
        await must(`upload ${doc.label}`, admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
        await must(`row ${doc.label}`, admin.from('documents').insert({
          id: doc.id, user_id: ownerId, project_id: projectId, name: doc.name, file_path: path, file_size: bytes.length, page_count: 1,
          sheet_number: doc.sheet_number, sheet_revision: doc.sheet_revision,
          content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        }));
      }
      await must('seed mark', api.rpc('append_annotation_update', {
        p_document_id: docs[0].id, p_client_id: `rx-seed-${RUN}-${i}`, p_client_seq: 1, p_data: rectUpdate(`rx-rect-${RUN}-${i}`),
      }));

      await page.addInitScript(() => {
        localStorage.setItem('survey.flag.project-export', '1');
        localStorage.setItem('survey.flag.restrict-editing', '1');
      });
      try {
        await signInAt(page, owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        if (layout.phone && !layout.app) {
          const sectionMenu = visible(page.locator('.hub-title-switch'));
          await expect(sectionMenu).toBeVisible({ timeout: 45_000 });
          await expect(async () => {
            if ((await sectionMenu.getAttribute('aria-expanded')) !== 'true') await press(layout, sectionMenu);
            await expect(sectionMenu).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 });
            await visible(page.locator('.hub-section-menu').getByRole('menuitem', { name: 'Projects' })).tap({ timeout: 2_000 });
            await expect(visible(page.locator(`[data-project-id="${projectId}"]`))).toBeVisible({ timeout: 5_000 });
          }).toPass({ timeout: 45_000 });
        } else {
          // Home redraws while it loads and can swallow the first tap.
          const projectsTab = visible(page.getByRole('button', { name: 'Projects', exact: true }).or(page.getByRole('tab', { name: 'Projects' })));
          await expect(async () => {
            await projectsTab.click({ timeout: 2_000 });
            await expect(visible(page.locator(`[data-project-id="${projectId}"]`))).toBeVisible({ timeout: 5_000 });
          }).toPass({ timeout: 45_000 });
        }
        const projectRow = visible(page.locator(`[data-project-id="${projectId}"]`));
        await expect(projectRow).toBeVisible({ timeout: 45_000 });

        // 1. Export project…, tick Restrict editing: the help line explains it.
        await press(layout, visible(projectRow.getByRole('button', { name: 'More', exact: true })));
        await press(layout, visible(page.getByRole('menuitem', { name: 'Export project…' })));
        const dialog = page.locator('[data-project-export]');
        await expect(dialog).toBeVisible();
        const lock = dialog.getByRole('checkbox', { name: 'Restrict editing' });
        await expect(lock).toHaveAttribute('aria-checked', 'false');
        await press(layout, lock);
        await expect(lock).toHaveAttribute('aria-checked', 'true');
        await expect(dialog.locator('[data-export-restrict-help]')).toContainText('need the one password');
        await shot(page, layout, '1-dialog');
        const box = await dialog.boundingBox();
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(layout.use.viewport.width + 1);

        // 2. Export: the zip downloads, the toast shows the password and a Copy button.
        const downloading = page.waitForEvent('download', { timeout: 90_000 });
        await press(layout, dialog.getByRole('button', { name: 'Export', exact: true }));
        const download = await downloading;
        await expect(dialog).toBeHidden({ timeout: 30_000 });
        const toast = visible(page.locator('.app-toast-host [data-toast-id]').filter({ hasText: 'Editing is locked' }));
        await expect(toast).toBeVisible();
        await expect(toast.getByRole('button', { name: 'Copy password' })).toBeVisible();
        const password = (await toast.textContent()).match(PASSWORD)?.[1];
        expect(password).toBeTruthy();
        // The password never splits at its hyphens (it did at 360px).
        const keep = toast.locator('.app-toast__keep');
        await expect(keep).toHaveText(password);
        expect((await keep.boundingBox()).height).toBeLessThan(32);
        await shot(page, layout, '2-toast');
        const tbox = await toast.boundingBox();
        expect(tbox.x).toBeGreaterThanOrEqual(0);
        expect(tbox.x + tbox.width).toBeLessThanOrEqual(layout.use.viewport.width + 1);

        // 3. Inside: both PDFs locked with that one password, same text, the mark drawn in.
        const zip = await JSZip.loadAsync(readFileSync(await download.path()));
        const pdfs = Object.keys(zip.files).filter((k) => k.endsWith('.pdf')).sort();
        expect(pdfs).toEqual(['Documents/Spec.pdf', `Drawings/A-${400 + i} - Plan - A.pdf`]);
        for (const [k, doc] of [[pdfs[1], docs[0]], [pdfs[0], docs[1]]]) {
          const bytes = await zip.file(k).async('uint8array');
          await expectLocked(bytes);
          const open = await readerView(bytes);
          expect(open.pages).toBe(1);
          expect(open.text).toContain(doc.label);
          expect(open.title).toBe(doc.label);
          expect(open.marks).toBe(doc === docs[0] ? 1 : 0);
          // The toast's password is the owner password of every file.
          expect((await readerView(bytes, password)).text).toContain(doc.label);
        }
      } finally {
        if (!process.env.KEEP) {
          await admin.from('document_annotations').delete().in('document_id', docs.map((d) => d.id));
          await admin.from('documents').delete().in('id', docs.map((d) => d.id));
          await admin.from('projects').delete().eq('id', projectId);
          await admin.storage.from('documents').remove(paths);
        }
      }
    });
  });
}

test.describe('Restrict editing, Export PDF in the viewer', () => {
  test.use({ viewport: { width: 1400, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });

  test('the file opens freely with its mark, the toast copies the password', async ({ page }) => {
    test.setTimeout(180_000);
    const admin = adminClient();
    const owner = await apiClientFor(E2E_ACCOUNTS.owner);
    const ownerId = (await owner.auth.getUser()).data.user.id;
    const label = `Locked sheet ${RUN}`;
    const name = `${label}.pdf`;
    const docId = crypto.randomUUID();
    const bytes = await onePagePdf(label);
    const path = `${ownerId}/${docId}.pdf`;
    await must('upload', admin.storage.from('documents').upload(path, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
    await must('row', admin.from('documents').insert({
      id: docId, user_id: ownerId, project_id: E2E_PROJECT.id, name, file_path: path, file_size: bytes.length, page_count: 1,
      content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }));
    await must('seed mark', owner.rpc('append_annotation_update', {
      p_document_id: docId, p_client_id: `rx-view-${RUN}`, p_client_seq: 1, p_data: rectUpdate(`rx-view-rect-${RUN}`),
    }));
    try {
      await page.addInitScript(() => {
        localStorage.setItem('survey.flag.export-modes', '1');
        localStorage.setItem('survey.flag.restrict-editing', '1');
      });
      await signIn(page, E2E_ACCOUNTS.owner);
      await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('button', { name: 'Open file' }).click();
      await expect(page.getByText(label, { exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(page.locator('[data-overlay-page="1"] [data-annotation-id]')).not.toHaveCount(0, { timeout: 30_000 });

      await page.getByRole('button', { name: 'More export options' }).click();
      await page.getByRole('menuitem', { name: /Export PDF…/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Export PDF' });
      await expect(dialog).toBeVisible();
      const lock = dialog.locator('[data-export-restrict]');
      await lock.click();
      await expect(lock).toHaveAttribute('aria-checked', 'true');
      await expect(dialog.locator('[data-export-restrict-help]')).toBeVisible();
      await expect(dialog).toContainText('editing locked');

      const downloading = page.waitForEvent('download', { timeout: 30_000 });
      await dialog.locator('.xpdf-go').click();
      const download = await downloading;
      const toast = visible(page.locator('.app-toast-host [data-toast-id]').filter({ hasText: 'Editing is locked' }));
      await expect(toast).toBeVisible();
      const password = (await toast.textContent()).match(PASSWORD)?.[1];
      expect(password).toBeTruthy();
      await toast.getByRole('button', { name: 'Copy password' }).click();
      await expect(visible(page.locator('.app-toast-host [data-toast-id]').filter({ hasText: 'Password copied.' }))).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(password);

      const out = readFileSync(await download.path());
      await expectLocked(out);
      const open = await readerView(out);
      expect(open.pages).toBe(1);
      expect(open.text).toContain(label);
      expect(open.marks).toBeGreaterThan(0);
      expect((await readerView(out, password)).text).toContain(label);
    } finally {
      await admin.from('document_annotations').delete().eq('document_id', docId);
      await admin.from('documents').delete().eq('id', docId);
      await admin.storage.from('documents').remove([path]);
    }
  });
});
