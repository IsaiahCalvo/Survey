// Nightly 'mark-subject' (Drawboard Projects parity): the Properties panel
// gives the picked marks their own subject, which the Markups list shows.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { seedSheet } from './seedSheet.mjs';
import { expect, signIn, test } from './helpers.mjs';

async function drawRect(page, box, x, y, w, h) {
  await page.mouse.move(box.x + x, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + x + w / 2, box.y + y + h / 2, { steps: 4 });
  await page.mouse.move(box.x + x + w, box.y + y + h, { steps: 4 });
  await page.mouse.up();
}

async function marquee(page, box, from, to) {
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Rectangle Select', exact: true }).filter({ visible: true }).first().click();
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + (from[0] + to[0]) / 2, box.y + (from[1] + to[1]) / 2, { steps: 6 });
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 6 });
  await page.mouse.up();
}

const panel = (page) => page.locator('[data-properties-panel]');
const subjectBox = (page) => panel(page).locator('input[data-props-subject]');

async function typeSubject(page, text) {
  const input = subjectBox(page);
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

test('typed subject names the picked marks, shows in Markups, mixes, clears and undoes', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.properties-panel', '1');
    localStorage.setItem('survey.flag.mark-subject', '1');
    localStorage.setItem('survey.flag.markup-list', '1');
    localStorage.removeItem('survey.propertiesPanel.open');
  });
  const sheet = await seedSheet('Mark subject');
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(sheet.name, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="1"]').filter({ visible: true }).first();
  await expect(pageDiv.locator('canvas').first()).toBeVisible({ timeout: 60_000 });
  const marks = pageDiv.locator('[data-svg-annotation-layer="1"] [data-annotation-index]');
  try {
    const box = await pageDiv.boundingBox();
    await page.getByRole('button', { name: 'Shapes', exact: true }).click();
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 150, 200, 80, 40);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Rectangle', exact: true }).filter({ visible: true }).first().click();
    await drawRect(page, box, 300, 260, 60, 50);
    await expect(marks).toHaveCount(2);

    // Both marks: blank box, the kind as its hint.
    await marquee(page, box, [120, 170], [400, 340]);
    await page.locator('[data-selection-quick-expand]').click();
    await expect(subjectBox(page)).toHaveValue('');
    await expect(subjectBox(page)).toHaveAttribute('placeholder', /Rectangle/);
    await typeSubject(page, '  Fire   door ');
    await expect(subjectBox(page)).toHaveValue('Fire door');

    // One mark gets its own: the pair now reads as mixed.
    await page.keyboard.press('Escape');
    await marquee(page, box, [120, 170], [260, 260]);
    await expect(panel(page).locator('[data-props-count]')).toHaveText('1 annotation selected');
    await expect(subjectBox(page)).toHaveValue('Fire door');
    await typeSubject(page, 'Exit sign');
    await page.keyboard.press('Escape');
    await marquee(page, box, [120, 170], [400, 340]);
    await expect(subjectBox(page)).toHaveValue('');
    await expect(subjectBox(page)).toHaveAttribute('placeholder', 'Mixed');

    // The Markups list shows each mark by its subject.
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Annotations', exact: true }).filter({ visible: true }).first().click();
    const rows = page.getByTestId('markups-panel').locator('[data-markup-row]');
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: 'Exit sign' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'Fire door' })).toHaveCount(1);

    // Clearing it gives the kind back; Undo brings the subject back. A row
    // picks its mark.
    await rows.filter({ hasText: 'Exit sign' }).click();
    const expand = page.locator('[data-selection-quick-expand]');
    await expect(subjectBox(page).or(expand)).toBeVisible();
    if (await expand.isVisible()) await expand.click();
    await expect(subjectBox(page)).toHaveValue('Exit sign');
    await typeSubject(page, '');
    await expect(rows.filter({ hasText: 'Exit sign' })).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+z');
    await expect(rows.filter({ hasText: 'Exit sign' })).toHaveCount(1);
  } finally {
    await sheet.remove();
  }
});
