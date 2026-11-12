// Sheet register (Nightly flag sheet-register), copied from Drawboard
// Projects' Drawings list: each Home row shows its sheet number, revision,
// discipline and open items; search finds a sheet by number; chips filter by
// discipline and open items; the list sorts by sheet number; Edit details
// sets number and revision; bulk picks set the discipline and the review
// status of several drawings at once; Export list saves the list as a CSV.
// Every layout: desktop, tablet, phone web on iPhone and Android sizes, the
// phone app on iOS and Android.
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { E2E_ACCOUNTS } from './accounts.mjs';
import { RUN, must } from './accountFixtures.mjs';
import { adminClient, apiClientFor, expect, test } from './helpers.mjs';

const FLAGS = ['sheet-register', 'document-review'];

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
  pdf.addPage([792, 612]).drawText(label, { x: 72, y: 500, size: 28, font });
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
const SHOTS = process.env.E2E_REGISTER_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);

async function seed(admin, ownerId, i) {
  const tag = `qq${RUN}${i}`;
  const projectId = crypto.randomUUID();
  await must('project', admin.from('projects').insert({ id: projectId, user_id: ownerId, name: `SR ${tag}` }));
  const names = {
    arch: `A-${110 + i} Floor plan ${tag}.pdf`,
    struct: `S-${710 + i} Framing ${tag}.pdf`,
    notes: `Notes ${tag}.pdf`,
  };
  const ids = {};
  for (const [key, name] of Object.entries(names)) {
    const id = crypto.randomUUID();
    const bytes = await onePagePdf(name);
    await must('upload', admin.storage.from('documents').upload(`${ownerId}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
    await must('doc', admin.from('documents').insert({
      id, user_id: ownerId, project_id: projectId, name, file_path: `${ownerId}/${id}.pdf`, file_size: bytes.length, page_count: 1,
      content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }));
    ids[key] = id;
  }
  // One open issue on the plan; a closed one on the framing sheet does not count.
  await must('open issue', admin.from('project_items').insert({ project_id: projectId, kind: 'issue', title: `Door swing ${tag}`, status: 'open', links: [{ document_id: ids.arch }] }));
  await must('closed issue', admin.from('project_items').insert({ project_id: projectId, kind: 'issue', title: `Beam ${tag}`, status: 'closed', links: [{ document_id: ids.struct }] }));
  return {
    tag, names, ids, projectId,
    remove: async () => {
      await admin.from('project_items').delete().eq('project_id', projectId);
      await admin.from('documents').delete().eq('project_id', projectId);
      await admin.storage.from('documents').remove(Object.values(ids).map((id) => `${ownerId}/${id}.pdf`));
      await admin.from('projects').delete().eq('id', projectId);
    },
  };
}

for (const [i, layout] of LAYOUTS.entries()) {
  test.describe(`Sheet register, ${layout.name}`, () => {
    test.use(layout.use);

    test('sheet line, search, chips, sort, Edit details, bulk picks and the CSV', async ({ page }) => {
      test.setTimeout(240_000);
      const admin = adminClient();
      const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
      const s = await seed(admin, ownerId, i);
      const arch = `A-${110 + i}`;
      const struct = `S-${710 + i}`;
      const elec = `E-${910 + i}`;
      const rowOf = (key) => visible(page.locator(layout.phone
        ? `.mobile-doc-card[data-document-id="${s.ids[key]}"]`
        : `.documents-ledger-row[data-document-id="${s.ids[key]}"]`));
      const hidden = (key) => expect(page.locator(layout.phone
        ? `.mobile-doc-card[data-document-id="${s.ids[key]}"]`
        : `.documents-ledger-row[data-document-id="${s.ids[key]}"]`).filter({ visible: true })).toHaveCount(0);
      const lineOf = (key) => rowOf(key).locator('[data-sheet-register-line]');
      const rowIds = () => page.locator(layout.phone ? '.mobile-doc-card' : '.documents-ledger-row').filter({ visible: true })
        .evaluateAll((els) => els.map((el) => el.getAttribute('data-document-id')));

      await page.addInitScript((flags) => { for (const f of flags) localStorage.setItem(`survey.flag.${f}`, '1'); }, FLAGS);
      try {
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        const search = visible(page.getByPlaceholder('Search documents...'));
        await expect(search).toBeVisible({ timeout: 45_000 });
        await search.fill(s.tag);
        await search.evaluate((el) => el.blur());

        // 1. The line under each name: number, discipline, open items.
        await expect(lineOf('arch')).toContainText(arch, { timeout: 30_000 });
        await expect(lineOf('arch').locator('[data-sheet-discipline]')).toHaveText('Architectural');
        await expect(lineOf('arch').locator('[data-sheet-open-items]')).toHaveText('1 open item', { timeout: 30_000 });
        await expect(lineOf('struct').locator('[data-sheet-discipline]')).toHaveText('Structural');
        await expect(lineOf('struct').locator('[data-sheet-open-items]')).toHaveCount(0);
        await expect(rowOf('notes').locator('[data-sheet-number]')).toHaveCount(0);
        await shot(page, layout, '1-lines');

        // 2. Search by sheet number, written without the dash.
        await search.fill(struct.replace('-', '').toLowerCase());
        await expect(rowOf('struct')).toBeVisible();
        await hidden('arch');
        await search.fill(s.tag);
        await search.evaluate((el) => el.blur());
        await expect(rowOf('arch')).toBeVisible();

        // 3. Chips: a discipline, then open items.
        const chip = (attr, value) => visible(page.locator(`[data-sheet-register-chips] [${attr}="${value}"]`));
        await press(layout, chip('data-discipline-filter', 'Structural'));
        await expect(rowOf('struct')).toBeVisible();
        await hidden('arch');
        await hidden('notes');
        await press(layout, chip('data-discipline-filter', 'Structural'));
        await press(layout, chip('data-open-items-filter', 'with'));
        await expect(rowOf('arch')).toBeVisible();
        await hidden('struct');
        await press(layout, chip('data-open-items-filter', 'with'));
        await press(layout, chip('data-open-items-filter', 'without'));
        await expect(rowOf('struct')).toBeVisible();
        await hidden('arch');
        await press(layout, chip('data-open-items-filter', 'without'));
        await expect(rowOf('notes')).toBeVisible();

        // 4. Edit details from the row's More menu: number and revision.
        await press(layout, rowOf('notes').getByRole('button', { name: 'More' }));
        await press(layout, visible(page.getByRole('menuitem', { name: 'Edit details…' })));
        const details = page.locator('[data-sheet-details-dialog]');
        await expect(details).toBeVisible();
        await details.getByLabel('Sheet number').fill(elec);
        await details.getByLabel('Revision').fill('C');
        await shot(page, layout, '2-details');
        await press(layout, details.getByRole('button', { name: 'Save' }));
        await expect(details).toBeHidden();
        await expect(lineOf('notes').locator('[data-sheet-number]')).toHaveText(elec);
        await expect(lineOf('notes').locator('[data-sheet-revision]')).toHaveText('Rev C');
        await expect(lineOf('notes').locator('[data-sheet-discipline]')).toHaveText('Electrical');
        await expect.poll(async () => (await admin.from('documents').select('sheet_number, sheet_revision').eq('id', s.ids.notes).single()).data)
          .toEqual({ sheet_number: elec, sheet_revision: 'C' });

        // 5. Sort by sheet number: A, E, S.
        if (layout.phone) {
          await press(layout, visible(page.locator('.documents-mobile-filter').first()));
          await press(layout, visible(page.getByRole('menuitem', { name: /Sheet number/ })));
        } else {
          await press(layout, visible(page.locator('[data-register-sort="sheet"]')));
        }
        await expect.poll(rowIds).toEqual([s.ids.arch, s.ids.notes, s.ids.struct]);

        // 6. Pick two (plan and notes) and set their discipline, then their status.
        if (layout.phone) {
          await press(layout, visible(page.getByRole('button', { name: 'Select', exact: true })));
          await press(layout, rowOf('arch'));
          await press(layout, rowOf('notes'));
        } else {
          // Ctrl/Cmd-click adds a row to the selection (a plain click only previews).
          await rowOf('arch').click({ modifiers: ['ControlOrMeta'] });
          await rowOf('notes').click({ modifiers: ['ControlOrMeta'] });
          await expect(page.locator('.documents-bulk-pane')).toBeVisible();
        }
        const bulk = async (key, choice) => {
          if (layout.phone) {
            await press(layout, visible(page.locator('[data-sheet-bulk-more]')));
            await press(layout, visible(page.getByRole('menuitem', { name: key === 'discipline' ? 'Set discipline…' : 'Set status…' })));
          } else {
            await press(layout, visible(page.locator(`[data-sheet-bulk="${key}"]`)));
          }
          const dialog = page.locator(`[data-sheet-bulk-dialog="${key}"]`);
          await expect(dialog).toContainText('For 2 documents');
          await press(layout, dialog.getByRole('menuitem', { name: choice, exact: true }));
          await expect(dialog).toBeHidden();
        };
        await bulk('discipline', 'Mechanical');
        await expect(lineOf('arch').locator('[data-sheet-discipline]')).toHaveText('Mechanical');
        await expect(lineOf('notes').locator('[data-sheet-discipline]')).toHaveText('Mechanical');
        await expect.poll(async () => (await admin.from('document_reviews').select('document_id, discipline').in('document_id', [s.ids.arch, s.ids.notes])).data
          ?.map((r) => r.discipline)).toEqual(['Mechanical', 'Mechanical']);
        await bulk('status', 'Approved');
        await expect.poll(async () => (await admin.from('document_reviews').select('status').in('document_id', [s.ids.arch, s.ids.notes])).data
          ?.map((r) => r.status)).toEqual(['approved', 'approved']);
        await expect(rowOf('arch').locator('[data-doc-review-line]')).toContainText('Approved');
        await shot(page, layout, '3-bulk');
        if (layout.phone) await press(layout, visible(page.getByRole('button', { name: 'Done', exact: true })));
        else await page.keyboard.press('Escape');

        // 7. Export list: the CSV holds the three drawings in list order.
        if (layout.phone) await press(layout, visible(page.locator('.documents-mobile-filter').first()));
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          press(layout, visible(page.locator(layout.phone ? '[data-sheet-register-export="phone"]' : '[data-sheet-register-export="desktop"]'))),
        ]);
        expect(download.suggestedFilename()).toMatch(/^Drawing list \d{4}-\d{2}-\d{2}\.csv$/);
        const csv = (await readFile(await download.path(), 'utf8')).replace(/^﻿/, '');
        const lines = csv.trim().split('\r\n');
        expect(lines[0]).toBe('Sheet number,Name,Revision,Discipline,Status,Assignee,Markups,Open items,Tags,Project,Uploaded,Uploaded by,Last edited,Version');
        expect(lines).toHaveLength(4);
        expect(lines[1]).toMatch(new RegExp(`^${arch},${s.names.arch},,Mechanical,Approved,,[^,]*,1,,SR ${s.tag},\\d{4}-\\d{2}-\\d{2},[^,]+,\\d{4}-\\d{2}-\\d{2},1$`));
        expect(lines[2]).toMatch(new RegExp(`^${elec},${s.names.notes},C,Mechanical,Approved,`));
        expect(lines[3]).toMatch(new RegExp(`^${struct},${s.names.struct},,Structural,,,[^,]*,0,`));

        // Nothing spills off the side of the screen.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      } finally {
        if (!process.env.KEEP) await s.remove();
      }
    });
  });
}

test.describe('Sheet register, access', () => {
  test('viewers and strangers cannot change the register; a stranger reads nothing', async () => {
    const admin = adminClient();
    const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
    const viewerId = await userIdOf(admin, E2E_ACCOUNTS.viewer);
    const s = await seed(admin, ownerId, 9);
    try {
      await must('share', admin.from('document_collaborators').insert({ document_id: s.ids.arch, user_id: viewerId, role: 'viewer', status: 'active' }));
      const owner = await apiClientFor(E2E_ACCOUNTS.owner);
      const viewer = await apiClientFor(E2E_ACCOUNTS.viewer);
      const stranger = await apiClientFor(E2E_ACCOUNTS.free);
      for (const client of [viewer, stranger]) {
        expect((await client.rpc('set_document_discipline', { p_document_id: s.ids.arch, p_discipline: 'Civil' })).error?.message).toContain('Document not found');
        expect((await client.rpc('set_document_sheet_details', { p_document_id: s.ids.arch, p_sheet_number: 'X-1', p_sheet_revision: null })).error?.message).toContain('Document not found');
      }
      expect((await owner.rpc('set_document_discipline', { p_document_id: s.ids.arch, p_discipline: 'x'.repeat(41) })).error?.message).toContain('too long');
      expect((await owner.rpc('set_document_sheet_details', { p_document_id: s.ids.arch, p_sheet_number: 'A-1', p_sheet_revision: 'x'.repeat(13) })).error?.message).toContain('too long');
      // Nobody writes the column straight into the table.
      expect((await owner.from('document_reviews').insert({ document_id: s.ids.struct, discipline: 'Civil' })).error).toBeTruthy();

      expect(await must('stranger list', stranger.rpc('list_sheet_register', { p_document_ids: [s.ids.arch] }))).toEqual([]);
      // The viewer can read the sheet, but is not on the project: its issues are not counted for them.
      const seen = await must('viewer list', viewer.rpc('list_sheet_register', { p_document_ids: [s.ids.arch, s.ids.struct] }));
      expect(seen).toHaveLength(1);
      expect(seen[0]).toMatchObject({ document_id: s.ids.arch, open_items: 0, version: 1 });
      const mine = await must('owner list', owner.rpc('list_sheet_register', { p_document_ids: [s.ids.arch, s.ids.struct] }));
      expect(mine.find((r) => r.document_id === s.ids.arch)).toMatchObject({ open_items: 1, version: 1, discipline: null });
      expect(mine.find((r) => r.document_id === s.ids.struct)).toMatchObject({ open_items: 0 });
      expect(mine[0].uploader_name).toBeTruthy();
    } finally {
      await admin.from('document_collaborators').delete().eq('document_id', s.ids.arch);
      await s.remove();
    }
  });
});
