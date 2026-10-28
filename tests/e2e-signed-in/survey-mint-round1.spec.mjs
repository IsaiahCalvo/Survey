// Survey mode polish, round 1 (owner 2026-10-28, "make Survey mint"):
// - a template is typed from the keyboard alone: a new template, module and
//   category each take the caret with their name selected, and Enter on a
//   checklist line opens the next one;
// - new markers list in name order (Camera 1, 2, 3), not by their random ids;
// - picking a marker on the page opens its row in the Survey panel;
// - Ctrl+Z after an answer takes back the answer, not the marker.
import { randomUUID } from 'node:crypto';
import { E2E_ACCOUNTS, E2E_PROJECT } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

async function ownerId(admin, email) {
  const { data } = await admin.auth.admin.listUsers({ perPage: 200 });
  return data.users.find((u) => u.email === email).id;
}

test('a template is typed from the keyboard: names take the caret, Enter opens the next line', async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const uid = await ownerId(admin, E2E_ACCOUNTS.pro.email);
  await admin.from('templates').delete().eq('user_id', uid);
  try {
    await signIn(page, E2E_ACCOUNTS.pro);
    await page.getByRole('button', { name: /^Templates$/ }).filter({ visible: true }).first().click();
    await page.getByRole('button', { name: /New template/ }).filter({ visible: true }).first().click();
    const title = page.locator('input[data-template-title]').filter({ visible: true });
    await expect(title).toBeFocused();
    await page.keyboard.type('Fire alarm walk');
    await page.keyboard.press('Enter');
    await expect(title).toHaveValue('Fire alarm walk');

    await page.getByRole('button', { name: 'Add module' }).filter({ visible: true }).first().click();
    await page.keyboard.type('Fire alarm');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: /Fire alarm/ }).or(page.getByText('Fire alarm', { exact: true })).filter({ visible: true }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Add category' }).filter({ visible: true }).first().click();
    await expect(page.locator('input[data-category-name-id]').filter({ visible: true }).first()).toBeFocused();
    await page.keyboard.type('Smoke detector');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Collapse Smoke detector' }).filter({ visible: true })).toBeVisible();

    await page.getByText('Add checklist item', { exact: true }).filter({ visible: true }).first().click();
    for (const line of ['Installed', 'Tested', 'Tagged']) {
      await page.keyboard.type(line);
      await page.keyboard.press('Enter');
    }
    // Enter on the empty new line ends the list; no blank line is left.
    await page.keyboard.press('Enter');
    const lines = page.locator('input[data-checklist-item-id]').filter({ visible: true });
    await expect(lines).toHaveCount(3);
    await expect(lines.nth(0)).toHaveValue('Installed');
    await expect(lines.nth(1)).toHaveValue('Tested');
    await expect(lines.nth(2)).toHaveValue('Tagged');
    await page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first().click();
    await expect.poll(async () => {
      const { data } = await admin.from('templates').select('name, config').eq('user_id', uid);
      const t = data?.[0];
      return t ? [t.name, ...t.config.modules[0].categories.map((c) => [c.name, ...c.checklist.map((l) => l.text)].join('/'))].join('|') : '';
    }).toBe('Fire alarm walk|Smoke detector/Installed/Tested/Tagged');
  } finally {
    await admin.from('templates').delete().eq('user_id', uid);
  }
});

test('new markers list in name order, and picking one on the page opens its row', async ({ page }) => {
  test.setTimeout(180_000);
  const admin = adminClient();
  const uid = await ownerId(admin, E2E_ACCOUNTS.owner.email);
  const fs = await import('node:fs');
  const bytes = fs.readFileSync('debug/fixtures/package2-rev4.pdf');
  const docId = randomUUID();
  const templateId = randomUUID();
  const filePath = `${uid}/${docId}.pdf`;
  const docName = `E2E Mint ${Date.now()}.pdf`;
  const templateName = `E2E Mint ${Date.now()}`;
  await admin.storage.from('documents').upload(filePath, new Blob([bytes], { type: 'application/pdf' }), { contentType: 'application/pdf', upsert: true });
  await admin.from('templates').insert({
    id: templateId, user_id: uid, name: templateName,
    config: {
      modules: [{ id: 'm-sec', name: 'Security', categories: [{ id: 'c-cam', name: 'Camera', checklist: [{ id: 'l1', text: 'Mounted' }, { id: 'l2', text: 'Aimed and focused at the door' }] }] }],
      entities: [{ id: 'e-gc', name: 'GC', color: '#E53935' }, { id: 'e-done', name: 'Complete', color: '#548c71' }],
    },
  });
  await admin.from('documents').insert({ id: docId, user_id: uid, project_id: E2E_PROJECT.id, name: docName, file_path: filePath, file_size: bytes.length, page_count: 36 });
  try {
    await signIn(page, E2E_ACCOUNTS.owner);
    await page.getByText(docName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
    const page1 = page.locator('.survey-pdfjs-page-div[data-page-number="1"]');
    await expect(page1.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await page.locator('.survey-rail__template-row').filter({ hasText: templateName }).first().click();
    await expect(page.locator('.survey-subrow__centre').getByRole('button', { name: 'Camera', exact: true })).toHaveAttribute('aria-pressed', 'true');

    const box = await page1.boundingBox();
    const at = (fx) => ({ x: box.x + box.width * fx, y: box.y + box.height * 0.3 });
    const card = page.getByRole('dialog', { name: 'New Survey Marker' });
    for (const fx of [0.2, 0.4, 0.6]) {
      const p = at(fx);
      await page.mouse.move(p.x, p.y);
      await page.mouse.down();
      await page.mouse.move(p.x + 50, p.y + 40, { steps: 5 });
      await page.mouse.up();
      await expect(card).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(card).toBeHidden();
    }
    const names = () => page.evaluate(() => Array.from(document.querySelectorAll('input[data-survey-marker-name-input]'), (el) => el.value));
    await expect.poll(names).toEqual(['Camera 1', 'Camera 2', 'Camera 3']);

    // Round 3: an answer is its own Undo step. Ctrl+Z after a wrong answer
    // took the whole marker away; now it takes back just the answer.
    const mounted = page.getByRole('group', { name: 'Mounted' }).getByRole('button', { name: 'Y', exact: true });
    await mounted.click();
    await expect(mounted).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Control+z');
    await expect(mounted).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(names).toEqual(['Camera 1', 'Camera 2', 'Camera 3']);
    await page.keyboard.press('Control+Shift+z');
    await expect(mounted).toHaveAttribute('aria-pressed', 'true');

    // The last answer turns the marker Complete by itself. Undo takes back
    // that answer only: Complete is never undone (owner ruling 2026-10-01),
    // so the marker, its row and its box all stay Complete.
    const openRow = page.locator('[id^="highlight-item-"]').filter({ has: page.getByRole('group', { name: 'Mounted' }) });
    const entity = openRow.getByRole('button', { name: /^Entity: .*\. Change entity$/ });
    const aimed = page.getByRole('group', { name: 'Aimed and focused at the door' }).getByRole('button', { name: 'Y', exact: true });
    const markerId = (await openRow.getAttribute('id')).replace(/^highlight-item-/, '');
    const boxFill = page.locator(`[data-survey-marker-id="${markerId}"] rect`).first();
    await aimed.click();
    await expect(entity).toHaveAccessibleName('Entity: Complete. Change entity', { timeout: 10_000 });
    await expect(boxFill).toHaveAttribute('fill', 'rgba(84, 140, 113, 0.4)');
    await page.keyboard.press('Control+z');
    await expect(aimed).toHaveAttribute('aria-pressed', 'false');
    await expect(mounted).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(500);
    await expect(entity).toHaveAccessibleName('Entity: Complete. Change entity');
    await expect(boxFill).toHaveAttribute('fill', 'rgba(84, 140, 113, 0.4)');

    // Camera 3 (the newest) is open; picking Camera 1 on the page opens its row.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Expand marker details' })).toHaveCount(2);
    const first = at(0.2);
    await page.mouse.click(first.x + 25, first.y + 20);
    const row1 = page.locator('[id^="highlight-item-"]').filter({ has: page.locator('input[data-survey-marker-name-input]') }).first();
    await expect(row1.locator('input[data-survey-marker-name-input]')).toHaveValue('Camera 1');
    await expect(page.getByRole('group', { name: 'Mounted' })).toHaveCount(1);
    const openName = await page.evaluate(() => {
      const group = document.querySelector('[role="group"][aria-label="Mounted"]');
      let el = group;
      while (el && !el.querySelector?.('input[data-survey-marker-name-input]')) el = el.parentElement;
      return el?.querySelector('input[data-survey-marker-name-input]')?.value || null;
    });
    expect(openName).toBe('Camera 1');

    // Export data: long headers are not cut off, the header row stays put,
    // and each sheet prints one page wide.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export data/ }).filter({ visible: true }).first().click();
    const file = await (await download).path();
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(file);
    const sheet = wb.worksheets.find((w) => w.name.startsWith('Camera'));
    const header = sheet.getRow(1).values.slice(1);
    const longCol = header.indexOf('Aimed and focused at the door') + 1;
    expect(longCol).toBeGreaterThan(0);
    expect(sheet.getColumn(longCol).width).toBeGreaterThanOrEqual('Aimed and focused at the door'.length);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.pageSetup).toMatchObject({ orientation: 'landscape', fitToWidth: 1 });
    expect(sheet.getRow(2).values.slice(1)).toContain('Camera 1');
  } finally {
    await admin.from('documents').delete().eq('id', docId);
    await admin.storage.from('documents').remove([filePath]);
    await admin.from('templates').delete().eq('id', templateId);
  }
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });

  // Round 2: on the phone "New template" added the template out of sight at
  // the bottom of the list and stayed there; it now opens the new template's
  // page with its name selected.
  test('New template opens the new template with its name ready to type', async ({ page }) => {
    test.setTimeout(120_000);
    const admin = adminClient();
    const uid = await ownerId(admin, E2E_ACCOUNTS.pro.email);
    await admin.from('templates').delete().eq('user_id', uid);
    try {
      await signIn(page, E2E_ACCOUNTS.pro);
      await page.getByRole('button', { name: 'Documents', exact: true }).filter({ visible: true }).first().tap();
      await page.getByText('Templates', { exact: true }).filter({ visible: true }).first().tap();
      await page.getByRole('button', { name: /New template/ }).filter({ visible: true }).first().tap();
      const title = page.locator('input[data-template-title]').filter({ visible: true });
      await expect(title).toBeFocused();
      await expect(page.getByRole('button', { name: 'Add module' }).filter({ visible: true })).toBeVisible();
      await page.keyboard.type('Phone walk');
      await page.keyboard.press('Enter');
      await expect(title).toHaveValue('Phone walk');
    } finally {
      await admin.from('templates').delete().eq('user_id', uid);
    }
  });
});
