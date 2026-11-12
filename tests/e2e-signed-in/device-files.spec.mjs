// Open a PDF with no account (Nightly flag device-files, 2026-11-10; matches
// Drawboard's "Temporary" files, /mnt/project-files/drawboard-trial/file-model.md).
// Signed out, a PDF opens, marks drawn on it stay on this device across
// reloads, and "Save to my account" after signing in uploads it with its marks.
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { adminClient, expect, test } from './helpers.mjs';

const PAGE = '.survey-pdfjs-page-div[data-page-number="1"]';
const PAGE_TEXT = 'Type your name in the box:';
const FIXTURE = 'debug/fixtures/clickable-link-test.pdf';

const pageLines = (page) => page.evaluate(() => [...new Set([...document.querySelectorAll('[data-overlay-page="1"] [data-annotation-id] line')]
  .map((l) => ['x1', 'y1', 'x2', 'y2'].map((k) => Number(l.getAttribute(k)).toFixed(1)).join(',')))]);

async function drawLine(page, row) {
  const box = await page.locator(PAGE).boundingBox();
  const from = { x: box.x + box.width * 0.1, y: box.y + box.height * (0.75 + row * 0.07) };
  await page.keyboard.press('l');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + box.width * 0.35, from.y, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('Escape');
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem('survey.flag.device-files', '1'); } catch { /* */ }
  });
});

test('signed out: a PDF opens, keeps its marks on this device, and saves to an account with them', async ({ page }) => {
  test.setTimeout(240_000);
  const name = `E2E device file ${Date.now()}.pdf`;
  const admin = adminClient();
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByText('Continue without an account').click({ timeout: 60_000 });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload PDF' }).click();
    await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: (await import('node:fs')).readFileSync(FIXTURE) });

    // It opens at once, with no sign-in ask.
    await expect(page.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('dialog', { name: 'Welcome back' })).toHaveCount(0);
    await page.waitForTimeout(1_000);
    await drawLine(page, 0);
    await expect.poll(() => pageLines(page)).toHaveLength(1);

    // Back home: the file is listed as on this device, with the notice.
    await page.getByRole('button', { name: `Close ${name}` }).click();
    await expect(page.getByText(name, { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByText('These files are only on this device', { exact: false }).filter({ visible: true }).first()).toBeVisible();

    // A reload keeps the file and its mark.
    await page.reload({ waitUntil: 'domcontentloaded' });
    // The sign-in card comes back on a fresh load; carry on without an account.
    await page.getByText('Continue without an account').click({ timeout: 60_000 });
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => pageLines(page), { timeout: 20_000 }).toHaveLength(1);
    await drawLine(page, 1);
    await expect.poll(() => pageLines(page)).toHaveLength(2);
    await page.waitForTimeout(1_000);
    await page.getByRole('button', { name: `Close ${name}` }).click();

    // Sign in from the notice; the device file is still listed.
    await page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Welcome back' });
    await dialog.getByLabel('Email').fill(E2E_ACCOUNTS.owner.email);
    await dialog.getByLabel('Password').fill(E2E_ACCOUNTS.owner.password);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(page.getByText(name, { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });

    // Save to my account: a real document with both marks in the cloud.
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Save to my account' }).click();
    await expect(page.getByText(`${name} is saved to your account`)).toBeVisible({ timeout: 60_000 });
    const { data: rows } = await admin.from('documents').select('id').eq('name', name);
    expect(rows?.length).toBe(1);
    await expect.poll(async () => {
      const { count } = await admin.from('annotation_updates').select('*', { count: 'exact', head: true }).eq('document_id', rows[0].id);
      const { count: snaps } = await admin.from('annotation_snapshots').select('*', { count: 'exact', head: true }).eq('document_id', rows[0].id);
      return (count || 0) + (snaps || 0);
    }, { timeout: 30_000 }).toBeGreaterThan(0);

    // Opening the account copy shows both marks (from the cloud), and the
    // device copy is gone.
    await expect(page.getByText('On this device', { exact: true })).toHaveCount(0, { timeout: 20_000 });
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => pageLines(page), { timeout: 30_000 }).toHaveLength(2);
  } finally {
    const { data } = await admin.from('documents').select('id,file_path').eq('name', name);
    for (const row of data || []) {
      await admin.from('documents').delete().eq('id', row.id);
      if (row.file_path) await admin.storage.from('documents').remove([row.file_path]);
    }
  }
});

test('Save to my account keeps the device copy when the marks don\'t reach the server, and a second try moves it', async ({ page, context }) => {
  test.setTimeout(240_000);
  const name = `E2E device marks refused ${Date.now()}.pdf`;
  const admin = adminClient();
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByText('Continue without an account').click({ timeout: 60_000 });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload PDF' }).click();
    await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: (await import('node:fs')).readFileSync(FIXTURE) });
    await expect(page.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_000);
    await drawLine(page, 0);
    await expect.poll(() => pageLines(page)).toHaveLength(1);
    await page.waitForTimeout(1_000);
    await page.getByRole('button', { name: `Close ${name}` }).click();

    await page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Welcome back' });
    await dialog.getByLabel('Email').fill(E2E_ACCOUNTS.owner.email);
    await dialog.getByLabel('Password').fill(E2E_ACCOUNTS.owner.password);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // Every mark write fails on the server (an internal error, not a refusal).
    const failWrite = (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'internal error' }) });
    const writes = /\/rest\/v1\/rpc\/(append_annotation_update|store_annotation_snapshot)/;
    await context.route(writes, failWrite);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Save to my account' }).click();
    await expect(page.getByText('Its marks didn’t reach your account', { exact: false })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText(`${name} is saved to your account`)).toHaveCount(0);
    // The device copy (with its mark) is still here, and the PDF that went up
    // without its marks was taken back out: the file is listed once.
    await expect(page.getByText('On this device', { exact: true }).filter({ visible: true }).first()).toBeVisible();
    await expect.poll(async () => (await admin.from('documents').select('id').eq('name', name)).data?.length, { timeout: 20_000 }).toBe(0);
    await expect(page.getByRole('button', { name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }).filter({ visible: true })).toHaveCount(1, { timeout: 20_000 });

    // The server is fine again: Save once more moves it, marks and all.
    await context.unroute(writes, failWrite);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click({ button: 'right' });
    await expect(page.getByRole('menuitem', { name: 'Save to my account' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Save to my account' }).click();
    await expect(page.getByText(`${name} is saved to your account`, { exact: false })).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('On this device', { exact: true })).toHaveCount(0, { timeout: 20_000 });
    const { data: rows } = await admin.from('documents').select('id').eq('name', name);
    expect(rows?.length).toBeGreaterThan(0);
    await page.getByText(name, { exact: true }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    await expect(page.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => pageLines(page), { timeout: 30_000 }).toHaveLength(1);
  } finally {
    const { data } = await admin.from('documents').select('id,file_path').eq('name', name);
    for (const row of data || []) {
      await admin.from('documents').delete().eq('id', row.id);
      if (row.file_path) await admin.storage.from('documents').remove([row.file_path]);
    }
  }
});

test('a failed Save never deletes a document the account already had with the same bytes', async ({ page, context }) => {
  test.setTimeout(240_000);
  const fs = await import('node:fs');
  const { createHash, randomUUID } = await import('node:crypto');
  const bytes = fs.readFileSync(FIXTURE);
  const name = `E2E device reuse ${Date.now()}.pdf`;
  const admin = adminClient();
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const ownerId = users.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const existingId = randomUUID();
  const filePath = `${ownerId}/${existingId}.pdf`;
  try {
    // The account already has this very file (same name, same bytes).
    const up = await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
    if (up.error) throw up.error;
    const ins = await admin.from('documents').insert({
      id: existingId, user_id: ownerId, project_id: null, name, file_path: filePath, file_size: bytes.length, page_count: 1,
      content_sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    if (ins.error) throw ins.error;

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByText('Continue without an account').click({ timeout: 60_000 });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload PDF' }).click();
    await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: bytes });
    await expect(page.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_000);
    await drawLine(page, 0);
    await expect.poll(() => pageLines(page)).toHaveLength(1);
    await page.waitForTimeout(1_000);
    await page.getByRole('button', { name: `Close ${name}` }).click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Welcome back' });
    await dialog.getByLabel('Email').fill(E2E_ACCOUNTS.owner.email);
    await dialog.getByLabel('Password').fill(E2E_ACCOUNTS.owner.password);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    const failWrite = (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'internal error' }) });
    const writes = /\/rest\/v1\/rpc\/(append_annotation_update|store_annotation_snapshot)/;
    await context.route(writes, failWrite);
    const deviceRow = page.getByRole('button', { name: /On this device/ }).filter({ hasText: name }).filter({ visible: true }).first();
    await deviceRow.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Save to my account' }).click();
    await expect(page.getByText('Its marks didn’t reach your account', { exact: false })).toBeVisible({ timeout: 90_000 });
    await context.unroute(writes, failWrite);
    // The account's own document is still there, and so is the device copy.
    await page.waitForTimeout(3_000);
    const { data: still } = await admin.from('documents').select('id').eq('id', existingId).maybeSingle();
    expect(still?.id).toBe(existingId);
    await expect(page.getByText('On this device', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  } finally {
    const { data } = await admin.from('documents').select('id,file_path').eq('name', name);
    for (const row of data || []) {
      await admin.from('documents').delete().eq('id', row.id);
      if (row.file_path) await admin.storage.from('documents').remove([row.file_path]);
    }
  }
});

test('a device file left open across sign-in keeps its marks, and Save to my account moves the open tab to the cloud copy', async ({ page }) => {
  test.setTimeout(240_000);
  const name = `E2E device open ${Date.now()}.pdf`;
  const admin = adminClient();
  const home = () => page.getByRole('button', { name: 'Home', exact: true }).filter({ visible: true }).first().click();
  try {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.getByText('Continue without an account').click({ timeout: 60_000 });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload PDF' }).click();
    await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: (await import('node:fs')).readFileSync(FIXTURE) });
    await expect(page.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1_000);
    await drawLine(page, 0);
    await expect.poll(() => pageLines(page)).toHaveLength(1);
    await page.waitForTimeout(1_000);

    // Home with the tab still open, then sign in.
    await home();
    await page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).first().click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Welcome back' });
    await dialog.getByLabel('Email').fill(E2E_ACCOUNTS.owner.email);
    await dialog.getByLabel('Password').fill(E2E_ACCOUNTS.owner.password);
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });

    // Back to the open tab: the mark drawn signed out is still there, and a
    // second one drawn signed in stays on the same device copy.
    await page.getByRole('tab', { name }).or(page.getByText(name, { exact: true })).filter({ visible: true }).first().click();
    await expect(page.locator(PAGE).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => pageLines(page), { timeout: 20_000 }).toHaveLength(1);
    await drawLine(page, 1);
    await expect.poll(() => pageLines(page)).toHaveLength(2);
    await page.waitForTimeout(1_000);

    // Save to my account with the tab open: the tab closes for the move and
    // the cloud copy opens in its place with both marks.
    await home();
    // The list row, not the tab of the same name above it.
    await page.getByText(name, { exact: true }).filter({ visible: true }).last().click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Save to my account' }).click();
    await expect(page.getByText(`${name} is saved to your account`)).toBeVisible({ timeout: 60_000 });
    const { data: rows } = await admin.from('documents').select('id').eq('name', name);
    expect(rows?.length).toBe(1);
    await expect(page.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => pageLines(page), { timeout: 30_000 }).toHaveLength(2);
    // The open viewer is now the cloud document: a third mark reaches it.
    const before = async () => {
      const { count } = await admin.from('annotation_updates').select('*', { count: 'exact', head: true }).eq('document_id', rows[0].id);
      return count || 0;
    };
    const was = await before();
    await drawLine(page, 2);
    await expect.poll(before, { timeout: 30_000 }).toBeGreaterThan(was);
  } finally {
    const { data } = await admin.from('documents').select('id,file_path').eq('name', name);
    for (const row of data || []) {
      await admin.from('documents').delete().eq('id', row.id);
      if (row.file_path) await admin.storage.from('documents').remove([row.file_path]);
    }
  }
});

test('a selection with a device file and a cloud document: Duplicate leaves the device file out', async ({ page }) => {
  test.setTimeout(180_000);
  const name = `E2E device mixed ${Date.now()}.pdf`;
  const errors = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && /DocumentDuplicate/.test(msg.text())) errors.push(msg.text()); });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue without an account').click({ timeout: 60_000 });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload PDF' }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: (await import('node:fs')).readFileSync(FIXTURE) });
  await expect(page.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: `Close ${name}` }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Welcome back' });
  await dialog.getByLabel('Email').fill(E2E_ACCOUNTS.owner.email);
  await dialog.getByLabel('Password').fill(E2E_ACCOUNTS.owner.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 30_000 });

  // Pick both rows, then Duplicate.
  const rowNamed = (fileName) => page.getByRole('button', { name: new RegExp(`^${fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} `) }).filter({ visible: true }).first();
  const deviceRow = rowNamed(name);
  const cloudRow = rowNamed(E2E_DOCUMENT.name);
  await expect(cloudRow).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_500);
  await deviceRow.click({ modifiers: ['ControlOrMeta'] });
  await cloudRow.click({ modifiers: ['ControlOrMeta'] });
  // The selection panel's Duplicate (the same action as the right-click menu).
  await expect(page.getByText('2 documents selected')).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).filter({ visible: true }).first().click();
  // The cloud document is copied; the device file never reaches the server,
  // so nothing fails and nothing is rolled back.
  const copyName = E2E_DOCUMENT.name.replace(/\.pdf$/, ' (Copy).pdf');
  const admin = adminClient();
  try {
    await expect(page.getByText(copyName, { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Failed to duplicate/)).toHaveCount(0);
    expect(errors).toEqual([]);
    const { data } = await admin.from('documents').select('id').eq('name', name);
    expect(data).toEqual([]);
  } finally {
    const { data: copies } = await admin.from('documents').select('id,file_path').eq('name', copyName);
    for (const row of copies || []) {
      await admin.from('documents').delete().eq('id', row.id);
      if (row.file_path) await admin.storage.from('documents').remove([row.file_path]);
    }
  }
});

test('two tabs on one device file never wipe each other (Drawboard loses one tab here)', async ({ context }) => {
  test.setTimeout(180_000);
  const name = `E2E device two tabs ${Date.now()}.pdf`;
  const a = await context.newPage();
  await a.goto('/', { waitUntil: 'domcontentloaded' });
  await a.getByText('Continue without an account').click({ timeout: 60_000 });
  const chooser = a.waitForEvent('filechooser');
  await a.getByRole('button', { name: 'Upload PDF' }).click();
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: (await import('node:fs')).readFileSync(FIXTURE) });
  await expect(a.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });

  const b = await context.newPage();
  await b.goto('/', { waitUntil: 'domcontentloaded' });
  await b.getByText('Continue without an account').click({ timeout: 60_000 });
  await b.getByText(name, { exact: true }).filter({ visible: true }).first().click();
  await b.getByRole('button', { name: 'Open file' }).click();
  await expect(b.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });

  // Each tab draws its own line while the other is open.
  await a.bringToFront();
  await a.waitForTimeout(800);
  await drawLine(a, 0);
  await expect.poll(() => pageLines(a)).toHaveLength(1);
  await b.bringToFront();
  await b.waitForTimeout(800);
  await drawLine(b, 1);
  await expect.poll(() => pageLines(b)).toHaveLength(1);
  await a.waitForTimeout(1_000);
  await a.close();
  await b.close();

  // A fresh tab has both.
  const c = await context.newPage();
  await c.goto('/', { waitUntil: 'domcontentloaded' });
  await c.getByText('Continue without an account').click({ timeout: 60_000 });
  await c.getByText(name, { exact: true }).filter({ visible: true }).first().click();
  await c.getByRole('button', { name: 'Open file' }).click();
  await expect(c.getByText(PAGE_TEXT).filter({ visible: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => pageLines(c), { timeout: 20_000 }).toHaveLength(2);
});

test('flag off: signed out still asks to sign in', async ({ page, context }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem('survey.flag.device-files', '0'); } catch { /* */ }
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByText('Continue without an account').click({ timeout: 60_000 });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Upload PDF' }).click();
  await (await chooser).setFiles(FIXTURE);
  await expect(page.getByText('Please sign in to upload documents.')).toBeVisible({ timeout: 20_000 });
});

for (const layout of [
  { name: 'phone web', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  { name: 'iOS app', native: 'ios', use: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
  { name: 'Android app', native: 'android', use: { viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true } },
]) {
  test.describe(layout.name, () => {
    test.use(layout.use);
    if (layout.native) {
      test.beforeEach(async ({ context }) => {
        await context.addInitScript((platform) => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => platform, isPluginAvailable: () => false, Plugins: {} };
        }, layout.native);
      });
    }
    test(`signed out on a phone: a PDF opens and keeps its marks (${layout.name})`, async ({ page }) => {
      test.setTimeout(180_000);
      const name = `E2E device phone ${Date.now()}.pdf`;
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.getByText('Continue without an account').tap({ timeout: 60_000 });
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Upload PDF' }).filter({ visible: true }).first().tap();
      await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: (await import('node:fs')).readFileSync(FIXTURE) });
      await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
      await page.waitForTimeout(1_500);
      // Draw with the pen tool from the phone toolbar is covered elsewhere;
      // here the mark is a desktop-style drag on the page.
      const box = await page.locator(PAGE).boundingBox();
      await page.keyboard.press('l');
      await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.8);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.8, { steps: 10 });
      await page.mouse.up();
      await expect.poll(() => pageLines(page), { timeout: 5_000 }).toHaveLength(1);
      const marks = await pageLines(page);
      await page.waitForTimeout(1_000);
      await page.getByRole('button', { name: 'Back to documents' }).first().tap();
      await expect(page.getByText(name, { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('These files are only on this device', { exact: false }).filter({ visible: true }).first()).toBeVisible();
      await page.screenshot({ path: `test-results/e2e-signed-in/device-files-${layout.name.replace(' ', '-')}.png` });
      // Reopen: the same marks come back from this device.
      await page.getByText(name, { exact: true }).filter({ visible: true }).first().tap();
      const openFile = page.getByRole('button', { name: 'Open file' });
      if (await openFile.isVisible().catch(() => false)) await openFile.tap();
      await expect(page.locator(`${PAGE} canvas`).first()).toBeVisible({ timeout: 60_000 });
      await expect.poll(() => pageLines(page), { timeout: 20_000 }).toHaveLength(marks.length);
    });
  });
}
