// Projects Issues and Tasks copied from Drawboard Projects (Nightly flag
// project-issues; src/projectItems/). On every layout (desktop, tablet, phone
// web on iPhone and Android sizes, the phone app): a new issue gets ISS-1 and
// opens its details, summary / status / assignee / due date / tags / a linked
// document and a comment are saved, the Activity tab logs the changes,
// search by ID and the filters find it, Archive (with Undo), Show archived,
// Delete (owner, archived only) and the Issues Register CSV.
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
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
const SHOTS = process.env.E2E_ISSUE_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);
const press = (layout, locator) => (layout.use.hasTouch ? locator.tap() : locator.click());

/* The app's drop-down on wide screens, the browser's own list on a phone. */
async function pick(page, layout, testId, option) {
  const scope = visible(page.getByTestId(testId));
  if (layout.phone) {
    await scope.selectOption({ label: option });
    return;
  }
  await press(layout, scope.locator('button').first());
  await press(layout, visible(page.getByRole('option', { name: option, exact: true })));
}

for (const layout of LAYOUTS) {
  test.describe(`Project issues, ${layout.name}`, () => {
    test.use(layout.use);

    test('raise, edit, filter, archive, delete and export an issue', async ({ page }) => {
      test.setTimeout(240_000);
      const admin = adminClient();
      const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
      const editorId = await userIdOf(admin, E2E_ACCOUNTS.editor);
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const projectId = crypto.randomUUID();
      const projectName = `PI ${slug} ${RUN}`.slice(0, 60);
      const docId = crypto.randomUUID();
      const docName = `A-101 ${slug}.pdf`;
      await must('project', admin.from('projects').insert({ id: projectId, user_id: ownerId, name: projectName }));
      const bytes = await onePagePdf(docName);
      await must('upload', admin.storage.from('documents').upload(`${ownerId}/${docId}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
      await must('doc', admin.from('documents').insert({
        id: docId, user_id: ownerId, project_id: projectId, name: docName, file_path: `${ownerId}/${docId}.pdf`, file_size: bytes.length, page_count: 1,
        content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      }));
      await must('collab', admin.from('project_collaborators').insert({ project_id: projectId, user_id: editorId, role: 'editor', status: 'active', email: E2E_ACCOUNTS.editor.email }));
      const editorName = E2E_ACCOUNTS.editor.email.split('@')[0];

      await page.addInitScript(() => { localStorage.setItem('survey.flag.project-issues', '1'); });
      try {
        await signInAt(page, E2E_ACCOUNTS.owner, layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/');
        if (layout.phone && !layout.app) {
          // Phone web: the title is the menu of hub sections.
          await expect(visible(page.getByText(docName, { exact: true }))).toBeVisible({ timeout: 45_000 });
          const sectionMenu = visible(page.locator('.hub-title-switch'));
          await expect(async () => {
            if ((await sectionMenu.getAttribute('aria-expanded')) !== 'true') await press(layout, sectionMenu);
            await expect(sectionMenu).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 });
          }).toPass({ timeout: 20_000 });
          await press(layout, visible(page.locator('.hub-section-menu').getByRole('menuitem', { name: 'Projects' })));
        } else {
          await visible(page.getByRole('button', { name: 'Projects', exact: true }).or(page.getByRole('tab', { name: 'Projects' }))).click();
        }
        const projectRow = visible(page.locator(`[data-project-id="${projectId}"]`));
        await expect(projectRow).toBeVisible({ timeout: 45_000 });
        await press(layout, projectRow);

        // 1. The Issues tab, then New issue: ISS-1 opens its details.
        await press(layout, visible(page.locator('[data-project-items-tabs]').getByRole('tab', { name: 'Issues' })));
        await press(layout, visible(page.getByRole('button', { name: 'New issue' })));
        const detail = visible(page.locator('[data-item-detail]'));
        await expect(detail).toBeVisible();
        await expect(detail.locator('[data-item-code]')).toHaveText('ISS-1');
        const title = detail.getByTestId('item-title');
        await title.fill('Door 3 hinge loose');
        await title.press('Enter');
        await expect.poll(async () => (await admin.from('project_items').select('title, number, status').eq('project_id', projectId)).data)
          .toEqual([{ title: 'Door 3 hinge loose', number: 1, status: 'draft' }]);
        // On Hold is a Task's status: the database refuses it on an Issue.
        const held = await admin.from('project_items').update({ status: 'on_hold' }).eq('project_id', projectId).select('id');
        expect(held.error?.message || '').toContain('project_items_kind_status_check');

        // 2. Status, assignee, due date, tags, a linked document, a comment.
        await pick(page, layout, 'item-status-select', 'Open');
        await pick(page, layout, 'item-assignee-select', editorName);
        await detail.getByTestId('item-due').fill('2026-12-01');
        const tagInput = detail.getByLabel('Add tags');
        await tagInput.fill('Fire, Level 2, Temp, Old');
        await tagInput.press('Enter');
        // Two removes in the same moment (before the screen redraws) both stick.
        await expect(detail.getByRole('button', { name: 'Remove tag Old' })).toBeVisible();
        await detail.evaluate((el) => {
          el.querySelector('[aria-label="Remove tag Temp"]').click();
          el.querySelector('[aria-label="Remove tag Old"]').click();
        });
        await expect(detail.getByRole('button', { name: /Remove tag (Temp|Old)/ })).toHaveCount(0);
        await pick(page, layout, 'item-link-select', docName);
        await expect(detail.locator('[data-item-links]')).toContainText(docName);
        await detail.getByTestId('item-comment-input').fill('Hinge screws stripped.');
        await press(layout, detail.getByTestId('item-comment-send'));
        await expect(detail.locator('[data-item-discussion]')).toContainText('Hinge screws stripped.');
        await expect.poll(async () => (await admin.from('project_items').select('status, assignee_id, due_date, tags, links').eq('project_id', projectId)).data?.[0])
          .toEqual({ status: 'open', assignee_id: editorId, due_date: '2026-12-01', tags: ['Fire', 'Level 2'], links: [{ document_id: docId }] });
        await press(layout, detail.getByRole('tab', { name: 'Activity' }));
        await expect(detail.locator('[data-item-activity]')).toContainText("changed the status from 'Draft' to 'Open'");
        await expect(detail.locator('[data-item-activity]')).toContainText(`assigned it to ${editorName}`);
        await expect(detail.locator('[data-item-activity]')).toContainText('created the issue');
        await shot(page, layout, '1-detail');
        await press(layout, detail.getByRole('button', { name: 'Close details' }));
        await expect(page.locator('[data-item-detail]').filter({ visible: true })).toHaveCount(0);

        // 3. The row, search by ID, quick filters and status groups.
        const row = visible(page.locator('[data-item-row]', { hasText: 'Door 3 hinge loose' }));
        await expect(row).toContainText('ISS-1');
        await expect(row.locator('[data-item-status]')).toHaveText('Open');
        await shot(page, layout, '2-list');
        const search = visible(page.getByTestId('item-search'));
        await search.fill('iss-1');
        await expect(row).toBeVisible();
        await search.fill('nothing like it');
        await expect(page.locator('[data-item-row]').filter({ visible: true })).toHaveCount(0);
        await search.fill('');
        await search.evaluate((el) => el.blur());
        const chip = (label) => visible(page.locator('[data-item-chips] button').filter({ hasText: new RegExp(`^${label}`) }));
        await press(layout, chip('Assigned to me'));
        await expect(page.locator('[data-item-row]').filter({ visible: true })).toHaveCount(0);
        await press(layout, chip('Assigned to me'));
        await press(layout, chip('Done'));
        await expect(page.locator('[data-item-row]').filter({ visible: true })).toHaveCount(0);
        await press(layout, chip('Done'));
        await press(layout, chip('Started'));
        await expect(row).toBeVisible();
        await press(layout, chip('Started'));
        await press(layout, chip('Fire'));
        await expect(row).toBeVisible();
        await press(layout, chip('Fire'));

        // 4. The Issues Register CSV.
        const downloadPromise = page.waitForEvent('download');
        await press(layout, visible(page.getByTestId('item-list-menu')));
        await press(layout, visible(page.getByRole('menuitem', { name: 'Export CSV' })));
        const download = await downloadPromise;
        const fileName = download.suggestedFilename();
        expect(fileName.startsWith(`${projectName} - Issues Register - `)).toBe(true);
        expect(fileName).toMatch(/ - Issues Register - \d{4}-\d{2}-\d{2} \d{2}-\d{2}\.csv$/);
        const csv = readFileSync(await download.path(), 'utf8').replace(/^\uFEFF/, '');
        expect(csv.split('\r\n')[0]).toBe('"ID","AssetLinks","Summary","Description","Due date","Created at (UTC)","Last updated at (UTC)","Status","Drawings","Documents","Assigned to","Created by","Most recent comment","Tags"');
        expect(csv).toContain('"ISS-1","","Door 3 hinge loose","","2026-12-01",');
        expect(csv).toContain(`"Open","${docName}","","${editorName}",`);
        expect(csv).toContain('"Hinge screws stripped.","Fire, Level 2"');

        // 5. Archive (row menu, or the details' More on a phone), Undo, then
        // archive again, Show archived and Delete.
        const archiveViaMenu = async (label) => {
          if (layout.phone) {
            await press(layout, visible(page.locator('[data-item-row]', { hasText: 'Door 3 hinge loose' })));
            await press(layout, visible(page.locator('[data-item-detail]').getByRole('button', { name: 'More for ISS-1' })));
          } else {
            await press(layout, visible(page.locator('[data-item-row]', { hasText: 'Door 3 hinge loose' })).getByRole('button', { name: 'More for ISS-1' }));
          }
          await press(layout, visible(page.getByRole('menuitem', { name: label })));
        };
        await archiveViaMenu('Archive');
        await expect.poll(async () => Boolean((await admin.from('project_items').select('archived_at').eq('project_id', projectId)).data?.[0]?.archived_at)).toBe(true);
        await expect(page.locator('[data-item-row]').filter({ visible: true })).toHaveCount(0);
        await press(layout, visible(page.getByRole('button', { name: 'Undo' })));
        await expect.poll(async () => Boolean((await admin.from('project_items').select('archived_at').eq('project_id', projectId)).data?.[0]?.archived_at)).toBe(false);
        await expect(visible(page.locator('[data-item-row]', { hasText: 'Door 3 hinge loose' }))).toBeVisible();
        await archiveViaMenu('Archive');
        await expect.poll(async () => Boolean((await admin.from('project_items').select('archived_at').eq('project_id', projectId)).data?.[0]?.archived_at)).toBe(true);
        await press(layout, visible(page.getByTestId('item-list-menu')));
        await press(layout, visible(page.getByRole('menuitem', { name: /Show archived issues/ })));
        await expect(visible(page.locator('[data-item-row]', { hasText: 'Door 3 hinge loose' }))).toBeVisible();
        await shot(page, layout, '3-archived');
        await archiveViaMenu('Delete');
        await expect(page.locator('[data-item-row]').filter({ visible: true })).toHaveCount(0);
        await expect.poll(async () => (await admin.from('project_items').select('id').eq('project_id', projectId)).data?.length, { timeout: 20_000 }).toBe(0);

        // A new issue never reuses a number.
        await press(layout, visible(page.getByTestId('item-list-menu')));
        await press(layout, visible(page.getByRole('menuitem', { name: /Show unarchived issues/ })));
        await press(layout, visible(page.getByRole('button', { name: 'New issue' })));
        await expect(visible(page.locator('[data-item-detail] [data-item-code]'))).toHaveText('ISS-2');
        await press(layout, visible(page.locator('[data-item-detail]').getByRole('button', { name: 'Close details' })));

        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow).toBeLessThanOrEqual(1);
      } finally {
        if (!process.env.KEEP) {
          await admin.from('projects').delete().eq('id', projectId);
          await admin.from('documents').delete().eq('id', docId);
        }
      }
    });
  });
}
