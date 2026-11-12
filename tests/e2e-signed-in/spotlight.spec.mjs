// Spotlight (Nightly flag spotlight), copied from Drawboard Projects: the
// owner presses "Spotlight me" in the people list; the editor, on the same
// sheet, sees "Olive is presenting" and follows; the owner's zoom carries to
// the editor; a pan of the editor's own pauses following until "Follow
// again"; the owner's next sheet takes the editor along; Stop ends it. Two
// people, every layout: desktop, tablet, phone web on iPhone and Android
// sizes, the phone app on iOS and Android.
import crypto from 'node:crypto';
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

const SHOTS = process.env.E2E_SPOTLIGHT_SHOTS || '';
const shot = (page, layout, who, step) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${layout.name.replace(/[^a-z0-9]+/gi, '-')}-${who}-${step}.png` }) : null);
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

// A project of the owner's with two sheets, shared with the editor.
async function seedSharedProject(admin, ownerId, editorId, slug) {
  const projectId = crypto.randomUUID();
  await must('project', admin.from('projects').insert({ id: projectId, user_id: ownerId, name: `SP ${slug} ${RUN}`.slice(0, 60) }));
  await must('member', admin.from('project_collaborators').insert({
    project_id: projectId, user_id: editorId, invited_by: ownerId, role: 'editor', email: E2E_ACCOUNTS.editor.email, status: 'active',
  }));
  const ids = [];
  const names = [`S-1 ${slug}.pdf`, `S-2 ${slug}.pdf`];
  for (const name of names) {
    const id = crypto.randomUUID();
    const bytes = await onePagePdf(name);
    await must('upload', admin.storage.from('documents').upload(`${ownerId}/${id}.pdf`, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf' }));
    await must('doc', admin.from('documents').insert({
      id, user_id: ownerId, project_id: projectId, name, file_path: `${ownerId}/${id}.pdf`, file_size: bytes.length, page_count: 1,
      content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }));
    await must('doc member', admin.from('document_collaborators').insert({
      document_id: id, user_id: editorId, invited_by: ownerId, role: 'editor', email: E2E_ACCOUNTS.editor.email, status: 'active',
    }));
    ids.push(id);
  }
  return {
    projectId,
    ids,
    names,
    remove: async () => {
      await admin.from('document_collaborators').delete().in('document_id', ids);
      await admin.from('documents').delete().eq('project_id', projectId);
      await admin.storage.from('documents').remove(ids.map((id) => `${ownerId}/${id}.pdf`));
      await admin.from('project_collaborators').delete().eq('project_id', projectId);
      await admin.from('projects').delete().eq('id', projectId);
    },
  };
}

async function openAs(browser, layout, account) {
  const context = await browser.newContext(layout.use);
  await context.route(
    (url) => !['data:', 'blob:'].includes(url.protocol) && !['127.0.0.1', 'localhost'].includes(url.hostname),
    (route) => route.abort('blockedbyclient'),
  );
  await context.addInitScript(() => {
    localStorage.setItem('survey.flag.spotlight', '1');
    localStorage.setItem('survey.flag.sheet-set-view', '1');
  });
  const page = await context.newPage();
  await page.goto(layout.app ? '/?mobileNav=tabs&nativeShell=capacitor' : '/', { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill(account.email);
  await dialog.getByLabel('Password').fill(account.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toBeHidden();
  return { context, page };
}

// Projects -> the project -> Open all -> the first sheet in the single view.
async function openFirstSheet(page, layout, seed) {
  if (layout.phone && !layout.app) {
    const sectionMenu = visible(page.locator('.hub-title-switch'));
    await expect(sectionMenu).toBeVisible({ timeout: 45_000 });
    await expect(async () => {
      if ((await sectionMenu.getAttribute('aria-expanded')) !== 'true') await press(layout, sectionMenu);
      await expect(sectionMenu).toHaveAttribute('aria-expanded', 'true', { timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await press(layout, visible(page.locator('.hub-section-menu').getByRole('menuitem', { name: 'Projects' })));
  } else {
    await visible(page.getByRole('button', { name: 'Projects', exact: true }).or(page.getByRole('tab', { name: 'Projects' }))).click({ timeout: 45_000 });
  }
  const projectRow = visible(page.locator(`[data-project-id="${seed.projectId}"]`));
  await expect(projectRow).toBeVisible({ timeout: 45_000 });
  await press(layout, projectRow);
  await press(layout, visible(page.locator('[data-open-all-sheets]')));
  const bar = visible(page.locator('[data-sheet-set-bar]'));
  await expect(bar.locator('[data-sheet-count]')).toHaveText('1 / 2', { timeout: 60_000 });
  // A phone folds the views into one View mode menu, as Drawboard's.
  if (layout.phone) {
    await press(layout, bar.locator('[data-sheet-view-menu]'));
    await press(layout, bar.locator('[data-sheet-view-menu-list] [data-sheet-view="single"]'));
  } else {
    await press(layout, bar.locator('[data-sheet-view="single"]'));
  }
  await expect(visible(page.locator('.survey-pdfjs-page-div[data-page-number="1"]'))).toBeVisible({ timeout: 60_000 });
  return bar;
}

// Next sheet: the bar's arrow, or on a phone (no arrows there, as
// Drawboard's) the second row of the sheet picker.
async function nextSheet(layout, bar) {
  if (!layout.phone) {
    await press(layout, bar.locator('[data-sheet-step="next"]'));
    return;
  }
  await press(layout, bar.locator('[data-sheet-picker-button]'));
  await press(layout, bar.locator('[data-sheet-picker]').getByRole('option').nth(1));
}

// The people list: the desktop footer's faces, or the phone's Active users.
async function spotlightMe(page, layout) {
  const me = visible(page.locator('[data-spotlight-me]'));
  await expect(async () => {
    if (!(await me.isVisible())) {
      const opener = layout.phone
        ? visible(page.locator('button[aria-haspopup="dialog"][aria-label*="active user"]'))
        : visible(page.locator('[data-presence-group]'));
      await press(layout, opener);
    }
    await expect(me).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(me).toHaveText('Spotlight me');
  await press(layout, me);
}

const pageWidth = async (page) => (await visible(page.locator('.survey-pdfjs-page-div[data-page-number="1"]')).boundingBox())?.width || 0;

for (const layout of LAYOUTS) {
  test.describe(`Spotlight, ${layout.name}`, () => {
    test('present, follow, zoom along, pause and follow again, next sheet, stop', async ({ browser }) => {
      test.setTimeout(300_000);
      const admin = adminClient();
      const ownerId = await userIdOf(admin, E2E_ACCOUNTS.owner);
      const editorId = await userIdOf(admin, E2E_ACCOUNTS.editor);
      const slug = layout.name.replace(/[^a-z0-9]+/gi, '-');
      const seed = await seedSharedProject(admin, ownerId, editorId, slug);
      const a = await openAs(browser, layout, E2E_ACCOUNTS.owner);
      const b = await openAs(browser, layout, E2E_ACCOUNTS.editor);
      try {
        const barA = await openFirstSheet(a.page, layout, seed);
        const barB = await openFirstSheet(b.page, layout, seed);

        // 1. The owner presents: green frame, "0 following". The editor sees
        // who is presenting.
        await spotlightMe(a.page, layout);
        const frameA = a.page.locator('[data-spotlight-frame="presenting"]');
        await expect(frameA).toBeVisible();
        await expect(frameA.locator('[data-spotlight-count]')).toHaveText('0 following');
        const chipB = b.page.locator('[data-spotlight-chip="presenting"]');
        await expect(chipB).toContainText('Olive is presenting', { timeout: 20_000 });
        await shot(a.page, layout, 'owner', '1-presenting');
        await shot(b.page, layout, 'editor', '1-chip');

        // 2. The editor follows; the owner counts one.
        await press(layout, chipB.locator('[data-spotlight-follow]'));
        await expect(b.page.locator('[data-spotlight-frame="following"]')).toContainText('Following Olive');
        await expect(frameA.locator('[data-spotlight-count]')).toHaveText('1 following', { timeout: 20_000 });

        // 3. The owner zooms in; the editor's page grows to match.
        const before = await pageWidth(b.page);
        await a.page.locator('.survey-pdfjs-page-div[data-page-number="1"]').first().hover().catch(() => {});
        for (let i = 0; i < 3; i += 1) await a.page.keyboard.press('ControlOrMeta+Equal');
        await expect.poll(() => pageWidth(a.page), { timeout: 15_000 }).toBeGreaterThan(before * 1.5);
        const target = await pageWidth(a.page);
        await expect.poll(async () => Math.abs((await pageWidth(b.page)) / target - 1), { timeout: 20_000 }).toBeLessThan(0.2);
        await shot(a.page, layout, 'owner', '2-zoomed');
        await shot(b.page, layout, 'editor', '2-following');

        // 4. A pan of the editor's own pauses following; Follow again rejoins.
        if (layout.use.hasTouch) {
          // The middle of the viewer (the zoomed page runs off its edges).
          const box = await visible(b.page.locator('.survey-pdfjs-viewer')).boundingBox();
          await b.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        } else {
          await b.page.mouse.move(700, 450);
          await b.page.mouse.wheel(0, 200);
        }
        const pausedB = b.page.locator('[data-spotlight-chip="paused"]');
        await expect(pausedB).toBeVisible();
        await expect(frameA.locator('[data-spotlight-count]')).toHaveText('0 following', { timeout: 20_000 });
        await shot(b.page, layout, 'editor', '3-paused');
        await press(layout, pausedB.locator('[data-spotlight-follow-again]'));
        await expect(b.page.locator('[data-spotlight-frame="following"]')).toBeVisible();
        await expect(frameA.locator('[data-spotlight-count]')).toHaveText('1 following', { timeout: 20_000 });

        // 5. The owner opens the next sheet; the editor goes with them.
        await nextSheet(layout, barA);
        await expect(barA.locator('[data-sheet-count]')).toHaveText('2 / 2');
        await expect(barB.locator('[data-sheet-count]')).toHaveText('2 / 2', { timeout: 30_000 });
        await expect(b.page.locator('[data-spotlight-frame="following"]')).toBeVisible({ timeout: 30_000 });
        await expect(a.page.locator('[data-spotlight-frame="presenting"]')).toBeVisible();

        // 6. Stop: the frame goes on both screens.
        await press(layout, a.page.locator('[data-spotlight-stop]'));
        await expect(a.page.locator('[data-spotlight-frame]')).toHaveCount(0);
        await expect(b.page.locator('[data-spotlight-frame]')).toHaveCount(0, { timeout: 20_000 });
        await expect(b.page.locator('[data-spotlight-chip]')).toHaveCount(0);
      } finally {
        await a.context.close();
        await b.context.close();
        await seed.remove();
      }
    });
  });
}

test.describe('Spotlight, flag off', () => {
  test.use(LAYOUTS[0].use);
  test('no Spotlight me in the people list', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const dialog = page.getByRole('dialog', { name: 'Welcome back' });
    await expect(dialog).toBeVisible({ timeout: 60_000 });
    await dialog.getByLabel('Email').fill(E2E_ACCOUNTS.owner.email);
    await dialog.getByLabel('Password').fill(E2E_ACCOUNTS.owner.password);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.getByText('E2E Sample Drawing.pdf', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText('Type your name in the box:')).toBeVisible({ timeout: 60_000 });
    await visible(page.locator('[data-presence-group]')).click();
    await expect(page.locator('[data-presence-list]')).toBeVisible();
    await expect(page.locator('[data-spotlight-me]')).toHaveCount(0);
  });
});
