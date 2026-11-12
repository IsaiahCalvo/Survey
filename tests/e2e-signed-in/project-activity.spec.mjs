// Project Activity (Nightly flag project-activity), copied from Drawboard
// Projects' Activity page. The owner adds, renames and revises a file, raises
// an issue and moves its status, and adds a teammate (as themselves, through
// the API, so the server writes "You"); the project's Activity tab lists each
// line in a 15-minute group headed "Today", and a file line opens the file.
// Every layout: desktop, tablet, phone web on iPhone and Android sizes, the
// phone app on iOS and Android. Load more on desktop.
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

const SHOTS = process.env.E2E_ACTIVITY_SHOTS || '';
const shot = (page, layout, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${step}.png` }) : null);
const visible = (locator) => locator.filter({ visible: true }).first();
const press = (layout, locator) => (layout.use.hasTouch ? locator.tap() : locator.click());

async function onePagePdf(label) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage([792, 612]).drawText(label, { x: 72, y: 500, size: 40, font });
  return Buffer.from(await pdf.save());
}

async function userIdOf(admin, account) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  return data.users.find((u) => u.email === account.email).id;
}

// Everything the owner does goes through their own session, so the server
// stamps them as the actor.
async function ownerDoesThings(admin, ownerId, editorId, slug, { renames = 0 } = {}) {
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const projectId = crypto.randomUUID();
  await must('project', owner.from('projects').insert({ id: projectId, user_id: ownerId, name: `PA ${slug} ${RUN}`.slice(0, 60) }));
  const docId = crypto.randomUUID();
  const name = `P-1 ${slug}.pdf`;
  const bytes = await onePagePdf(name);
  await must('upload', admin.storage.from('documents').upload(`${ownerId}/${docId}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
  await must('doc', owner.from('documents').insert({
    id: docId, user_id: ownerId, project_id: projectId, name, file_path: `${ownerId}/${docId}.pdf`, file_size: bytes.length, page_count: 1,
  }));
  const renamed = `P-1 Plan ${slug}.pdf`;
  await must('rename', owner.from('documents').update({ name: renamed }).eq('id', docId));
  await must('revision', owner.from('documents').update({ sheet_revision: 'B' }).eq('id', docId));
  const item = await must('issue', owner.from('project_items').insert({ project_id: projectId, kind: 'issue', title: 'Leak' }).select('id').single());
  await must('status', owner.from('project_items').update({ status: 'open' }).eq('id', item.id));
  await must('member', owner.from('project_collaborators').insert({
    project_id: projectId, user_id: editorId, invited_by: ownerId, role: 'editor', email: E2E_ACCOUNTS.editor.email, status: 'active',
  }));
  for (let i = 0; i < renames; i += 1) {
    await must('busy rename', owner.from('projects').update({ name: `PA ${slug} ${RUN} ${i}`.slice(0, 60) }).eq('id', projectId));
  }
  return {
    projectId,
    docId,
    renamed,
    remove: async () => {
      await admin.from('documents').delete().eq('project_id', projectId);
      await admin.storage.from('documents').remove([`${ownerId}/${docId}.pdf`]);
      await admin.from('projects').delete().eq('id', projectId);
    },
  };
}

async function signInAt(page, layout) {
  await page.goto(layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/', { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill(E2E_ACCOUNTS.owner.email);
  await dialog.getByLabel('Password').fill(E2E_ACCOUNTS.owner.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toBeHidden();
}

async function openProject(page, layout, projectId, docName) {
  if (layout.phone && !layout.app) {
    // Phone web: the title is the menu of hub sections. Open it once the
    // Documents list has loaded (its first load redraws the header), and
    // retry the whole pick with bounded taps.
    await expect(visible(page.getByText(docName, { exact: true }))).toBeVisible({ timeout: 45_000 });
    const sectionMenu = visible(page.locator('.hub-title-switch'));
    await expect(async () => {
      if ((await sectionMenu.getAttribute('aria-expanded')) !== 'true') await sectionMenu.tap({ timeout: 3_000 });
      await visible(page.locator('.hub-section-menu').getByRole('menuitem', { name: 'Projects' })).tap({ timeout: 3_000 });
      await expect(visible(page.locator(`[data-project-id="${projectId}"]`))).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 45_000 });
  } else {
    await visible(page.getByRole('button', { name: 'Projects', exact: true }).or(page.getByRole('tab', { name: 'Projects' }))).click({ timeout: 45_000 });
  }
  const row = visible(page.locator(`[data-project-id="${projectId}"]`));
  await expect(row).toBeVisible({ timeout: 45_000 });
  await press(layout, row);
}

for (const layout of LAYOUTS) {
  test.describe(`Project activity, ${layout.name}`, () => {
    test.use(layout.use);

    test('the Activity tab lists what happened, grouped, and a file line opens the file', async ({ page }) => {
      test.setTimeout(180_000);
      const admin = adminClient();
      const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
      const editorId = await userIdOf(admin, E2E_ACCOUNTS.editor);
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const seed = await ownerDoesThings(admin, ownerId, editorId, slug);
      await page.addInitScript(() => localStorage.setItem('survey.flag.project-activity', '1'));
      try {
        await signInAt(page, layout);
        await openProject(page, layout, seed.projectId, seed.renamed);
        await press(layout, visible(page.locator('[data-project-items-tabs] [role="tab"]', { hasText: 'Activity' })));
        const feed = visible(page.locator('[data-project-activity]'));
        await expect(feed).toBeVisible();
        const lines = feed.locator('[data-activity-event]');
        // Newest first.
        await expect(lines).toHaveText([
          /You\s+added e2e-editor@example\.com as editor/,
          /You\s+changed the status of ISS-1 Leak from 'Draft' to 'Open'/,
          /You\s+created the issue ISS-1 Leak/,
          new RegExp(`You\\s+changed the revision of P-1 Plan ${slug}\\.pdf|You\\s+set the revision of P-1 Plan ${slug}\\.pdf to 'B'`),
          new RegExp(`You\\s+renamed 'P-1 ${slug}\\.pdf' to 'P-1 Plan ${slug}\\.pdf'`),
          new RegExp(`You\\s+added P-1 ${slug}\\.pdf`),
          /You\s+created the project/,
        ], { timeout: 20_000 });
        await expect(feed.locator('[data-activity-group]').first().locator('h3')).toHaveText(/^Today, /);
        await shot(page, layout, 'activity');

        // A file line opens the file.
        await press(layout, lines.filter({ hasText: 'added P-1' }).first());
        await expect(visible(page.locator('.survey-pdfjs-page-div[data-page-number="1"]'))).toBeVisible({ timeout: 60_000 });
      } finally {
        await seed.remove();
      }
    });
  });
}

test.describe('Project activity, more than one page', () => {
  test.use(LAYOUTS[0].use);
  test('Load more shows the older lines', async ({ page }) => {
    test.setTimeout(180_000);
    const admin = adminClient();
    const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
    const editorId = await userIdOf(admin, E2E_ACCOUNTS.editor);
    const seed = await ownerDoesThings(admin, ownerId, editorId, 'more', { renames: 50 });
    await page.addInitScript(() => localStorage.setItem('survey.flag.project-activity', '1'));
    try {
      await signInAt(page, LAYOUTS[0]);
      await openProject(page, LAYOUTS[0], seed.projectId, seed.renamed);
      await visible(page.locator('[data-project-items-tabs] [role="tab"]', { hasText: 'Activity' })).click();
      const feed = visible(page.locator('[data-project-activity]'));
      const lines = feed.locator('[data-activity-event]');
      await expect(lines).toHaveCount(50, { timeout: 20_000 });
      await expect(feed.getByText('created the project')).toHaveCount(0);
      await feed.locator('[data-activity-more]').click();
      await expect(lines).toHaveCount(57);
      await expect(lines.last()).toContainText('created the project');
      await expect(feed.locator('[data-activity-more]')).toHaveCount(0);
    } finally {
      await seed.remove();
    }
  });
});

test.describe('Project activity, flag off', () => {
  test.use(LAYOUTS[0].use);
  test('no Activity tab', async ({ page }) => {
    const admin = adminClient();
    const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
    const editorId = await userIdOf(admin, E2E_ACCOUNTS.editor);
    const seed = await ownerDoesThings(admin, ownerId, editorId, 'off');
    try {
      await signInAt(page, LAYOUTS[0]);
      await openProject(page, LAYOUTS[0], seed.projectId, seed.renamed);
      await expect(page.getByText(seed.renamed).first()).toBeVisible({ timeout: 30_000 });
      await expect(page.locator('[data-project-items-tabs] [role="tab"]', { hasText: 'Activity' })).toHaveCount(0);
    } finally {
      await seed.remove();
    }
  });
});
