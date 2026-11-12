// Nightly 'comment-pins' (Drawboard Projects' page pins, deep/page-pins.md):
// N arms the Pin tool, M cycles Comment / Issue / Task, a click drops a pin
// with its bottom-left corner on the point and opens the composer (Enter is a
// new line, the send button saves, the tool stays on). Pins stay 26 px at any
// zoom; a done issue hides unless "Show done items" is on; the "Show pins"
// switches are kept per person; a pin drags (Survey goes past Drawboard).
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { adminClient, apiClientFor, expect, signIn, test } from './helpers.mjs';

const flagOn = (page, on) => page.addInitScript((value) => {
  if (value) localStorage.setItem('survey.flag.comment-pins', '1');
  else localStorage.removeItem('survey.flag.comment-pins');
  // Start each test with the default switches, but keep them over a reload.
  if (!sessionStorage.getItem('pins-test-started')) {
    for (const key of Object.keys(localStorage)) if (key.startsWith('survey.pins.filter')) localStorage.removeItem(key);
    sessionStorage.setItem('pins-test-started', '1');
  }
}, on);

async function openSheet(page, sheet, { tap = false } = {}) {
  await signIn(page, E2E_ACCOUNTS.owner);
  const row = page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first();
  if (tap) await row.tap(); else await row.click();
  const openFile = page.getByRole('button', { name: 'Open file' });
  if (tap) { if (await openFile.isVisible().catch(() => false)) await openFile.tap(); } else await openFile.click();
  const surface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(surface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  return { surface, pins: surface.locator('[data-page-pin-id]') };
}

const toolButton = (page) => page.locator('[data-pin-tool-button]').filter({ visible: true });
const composer = (page) => page.locator('[data-pin-composer]');
const card = (page) => page.locator('[data-pin-card]');

async function pinRows(docName) {
  const admin = adminClient();
  const { data: doc } = await admin.from('documents').select('id').eq('name', docName).single();
  const { data } = await admin.from('mark_comments').select('*').eq('document_id', doc.id).not('pin_kind', 'is', null).order('created_at');
  return { docId: doc.id, rows: data || [] };
}

test('N, click, composer, save; M to Issue; status hides a done pin; Show pins; drag; delete', async ({ page }) => {
  test.setTimeout(240_000);
  await flagOn(page, true);
  const sheet = await seedSheet('Pins desktop');
  try {
    const { surface, pins } = await openSheet(page, sheet);
    const box = await surface.boundingBox();

    // Server rules: a viewer or a stranger can't drop a pin; issues number per document.
    const { docId } = await pinRows(sheet.name);
    const stranger = await apiClientFor(E2E_ACCOUNTS.free);
    expect((await stranger.rpc('add_page_pin', { p_document_id: docId, p_page_number: 1, p_x: 10, p_y: 10, p_kind: 'comment', p_body: 'no' })).error?.message).toContain('Document not found');

    await page.keyboard.press('n');
    await expect(toolButton(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(toolButton(page)).toHaveAttribute('data-pin-tool-button', 'comment');

    // Comment pin: its square corner on the click point.
    const at = { x: box.x + 200, y: box.y + 220 };
    await page.mouse.click(at.x, at.y);
    await expect(composer(page)).toHaveAttribute('data-pin-composer', 'comment');
    const input = composer(page).getByLabel('Add a comment');
    await input.type('First line');
    await page.keyboard.press('Enter');
    await input.type('second line');
    await expect(input).toHaveValue('First line\nsecond line');
    await page.screenshot({ path: test.info().outputPath('pins-composer.png') });
    await composer(page).locator('[data-pin-save]').click();
    await expect(composer(page)).toHaveCount(0);
    await expect(pins).toHaveCount(1);
    const pinBox = await pins.first().boundingBox();
    expect(Math.round(pinBox.width)).toBe(26);
    expect(Math.abs(pinBox.x - at.x)).toBeLessThan(2);
    expect(Math.abs(pinBox.y + pinBox.height - at.y)).toBeLessThan(2);
    // The tool stays on.
    await expect(toolButton(page)).toHaveAttribute('aria-pressed', 'true');

    // M: Issue. Saved as Draft, numbered ISS-1.
    await page.keyboard.press('m');
    await expect(toolButton(page)).toHaveAttribute('data-pin-tool-button', 'issue');
    await expect(toolButton(page)).toHaveAttribute('aria-pressed', 'true');
    await page.mouse.click(box.x + 320, box.y + 420);
    await expect(composer(page)).toHaveAttribute('data-pin-composer', 'issue');
    await expect(composer(page).locator('[data-pin-status-pill]')).toHaveText(/Draft/);
    await composer(page).getByLabel('Add a short summary...').type('Leak at the valve');
    await composer(page).locator('[data-pin-save]').click();
    const issue = surface.locator('[data-pin-kind="issue"]');
    await expect(issue).toHaveAttribute('data-pin-status', 'draft');
    expect((await pinRows(sheet.name)).rows.map((r) => [r.pin_kind, r.pin_number, r.pin_status])).toEqual([['comment', null, null], ['issue', 1, 'draft']]);

    // Same size after zooming in.
    await page.keyboard.press('ControlOrMeta+=');
    await page.keyboard.press('ControlOrMeta+=');
    await page.waitForTimeout(1200);
    expect(Math.round((await pins.first().boundingBox()).width)).toBe(26);
    await page.keyboard.press('ControlOrMeta+0');
    await page.waitForTimeout(1000);

    // The card: ISS-1; Closed is done, so the pin hides once the card closes.
    await issue.click();
    await expect(card(page)).toHaveAttribute('data-pin-card', 'issue');
    await expect(card(page).locator('[data-pin-card-title]')).toHaveText('ISS-1');
    await expect(issue).toHaveAttribute('aria-expanded', 'true');
    await card(page).locator('[data-pin-status-pill]').click();
    await card(page).locator('[data-pin-status-option="closed"]').click();
    await expect(card(page).locator('[data-pin-status-pill]')).toHaveText(/Closed/);
    await page.screenshot({ path: test.info().outputPath('pins-card.png') });
    await expect(issue).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(card(page)).toHaveCount(0);
    await expect(issue).toHaveCount(0);
    await expect.poll(async () => (await pinRows(sheet.name)).rows[1]?.pin_status).toBe('closed');
    // A status change leaves the spot alone.
    const closedRow = (await pinRows(sheet.name)).rows[1];
    expect(closedRow.pin_x).toBeGreaterThan(250);
    expect(closedRow.pin_y).toBeGreaterThan(350);

    // Show pins: done items back; Comments off hides the comment pin and the master.
    await page.locator('[data-pin-filter-toggle]').filter({ visible: true }).click();
    const filterCard = page.locator('[data-pin-filter-menu]');
    await filterCard.locator('[data-pin-filter="done"]').click();
    await expect(issue).toHaveCount(1);
    await filterCard.locator('[data-pin-filter="comments"]').click();
    await expect(surface.locator('[data-pin-kind="comment"]')).toHaveCount(0);
    await expect(filterCard.locator('[data-pin-filter="all"]')).toHaveAttribute('aria-checked', 'false');
    const saved = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('survey.pins.filter:')).map(([, v]) => JSON.parse(v)));
    expect(saved).toEqual([{ comments: false, issues: true, tasks: true, done: true }]);
    await filterCard.locator('[data-pin-filter="all"]').click();
    await expect(surface.locator('[data-pin-kind="comment"]')).toHaveCount(1);
    await page.keyboard.press('Escape');

    // Kept after a reload.
    await page.reload();
    const againSurface = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
    await expect(againSurface.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(1500);
    const again = { surface: againSurface };
    await expect(again.surface.locator('[data-pin-kind="issue"]')).toHaveCount(1);

    // Drag the comment pin 120 px right: it moves and saves.
    const comment = again.surface.locator('[data-pin-kind="comment"]');
    const from = await comment.boundingBox();
    await page.mouse.move(from.x + 13, from.y + 13);
    await page.mouse.down();
    await page.mouse.move(from.x + 73, from.y + 13, { steps: 5 });
    await page.mouse.move(from.x + 133, from.y + 13, { steps: 5 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await comment.boundingBox()).x - from.x)).toBeGreaterThan(100);
    await expect(card(page)).toHaveCount(0);
    await expect.poll(async () => (await pinRows(sheet.name)).rows[0].pin_x).toBeGreaterThan(250);

    // Open it: the words keep their new line. Delete asks first.
    await comment.click();
    await expect(card(page).locator('[data-pin-card-body]')).toHaveText('First line\nsecond line');
    await card(page).locator('[data-pin-card-menu]').click();
    await card(page).getByRole('menuitem', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete comment' }).click();
    await expect(comment).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('pins-desktop.png') });
  } finally {
    await sheet.remove();
  }
});

test('without the flag there is no Pin button and N does nothing', async ({ page }) => {
  test.setTimeout(120_000);
  await flagOn(page, false);
  const sheet = await seedSheet('Pins off');
  try {
    const { surface } = await openSheet(page, sheet);
    await page.keyboard.press('n');
    await expect(page.locator('[data-pin-tool-button]')).toHaveCount(0);
    await expect(page.locator('[data-pin-filter-toggle]')).toHaveCount(0);
    const box = await surface.boundingBox();
    await page.mouse.click(box.x + 200, box.y + 200);
    await expect(composer(page)).toHaveCount(0);
  } finally {
    await sheet.remove();
  }
});

for (const layout of [{ name: 'phone web', native: false }, { name: 'phone app', native: true }]) {
  test.describe(`page pins, ${layout.name}`, () => {
    test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

    test('Pin in the Text group, a tap, Task from the composer, saved', async ({ page }) => {
      test.setTimeout(150_000);
      await flagOn(page, true);
      if (layout.native) {
        await page.addInitScript(() => {
          window.Capacitor = { isNativePlatform: () => true, getPlatform: () => 'ios', Plugins: {} };
        });
      }
      const sheet = await seedSheet(`Pins ${layout.native ? 'app' : 'web'}`);
      try {
        const { surface, pins } = await openSheet(page, sheet, { tap: true });
        await page.getByRole('button', { name: 'Text', exact: true }).filter({ visible: true }).first().tap();
        await page.getByRole('button', { name: 'Pin', exact: true }).filter({ visible: true }).last().tap();
        await page.waitForTimeout(300);
        const box = await surface.boundingBox();
        await page.touchscreen.tap(box.x + box.width * 0.4, box.y + box.height * 0.3);
        await expect(composer(page)).toBeVisible();
        const c = await composer(page).boundingBox();
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.x + c.width).toBeLessThanOrEqual(390);
        await composer(page).locator('[data-pin-kind-option="task"]').tap();
        await expect(composer(page)).toHaveAttribute('data-pin-composer', 'task');
        await composer(page).getByLabel('Add a short summary...').fill('Check the panel');
        await composer(page).locator('[data-pin-save]').tap();
        await expect(pins).toHaveCount(1);
        await expect(pins.first()).toHaveAttribute('data-pin-kind', 'task');
        await page.screenshot({ path: test.info().outputPath(`pins-${layout.native ? 'app' : 'web'}.png`) });
      } finally {
        await sheet.remove();
      }
    });
  });
}
