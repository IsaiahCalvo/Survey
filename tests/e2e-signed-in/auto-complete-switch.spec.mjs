// Owner 2026-10-27: "auto-mark as complete is a toggle". A template's
// Entities carry an "Auto-mark as Complete" switch. On (the default), an item
// turns Complete by itself once every line is done; off, it keeps the entity
// it had. The switch is saved with the template.
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const COMPLETE = { id: 'e2e-ent-complete', name: 'Complete', color: '#548c71' };
let original = null;

// Text lines, so the spec can blank its answers again (a pick-one answer
// cannot be cleared, and the specs after this one need D-1-17 blank).
async function writeTemplate(patch) {
  const config = { ...structuredClone(original), entities: [COMPLETE], ...patch };
  const lines = config.modules[0].categories[0].checklist;
  config.modules[0].categories[0].checklist = lines.map((line) => ({ ...line, kind: 'text' }));
  if (patch.autoComplete === undefined) delete config.autoComplete;
  const { error } = await adminClient().from('templates').update({ config }).eq('id', E2E_SURVEY.templateId);
  if (error) throw error;
}

test.beforeAll(async () => {
  const { data } = await adminClient().from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
  original = data.config;
});

test.afterAll(async () => {
  if (original) await adminClient().from('templates').update({ config: original }).eq('id', E2E_SURVEY.templateId);
});

async function takeLatest(page) {
  const latest = page.getByRole('button', { name: 'Use latest version' });
  if (await latest.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await latest.click();
}

async function openSurveyItem(page, { reopened = false } = {}) {
  if (!reopened) {
    await page.getByText(E2E_SURVEY.documentName, { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open file' }).click();
  }
  await expect(page.getByRole('button', { name: `Close ${E2E_SURVEY.documentName}` })).toBeVisible({ timeout: 60_000 });
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]:visible').first().waitFor({ timeout: 60_000 });
  const category = page.getByRole('button', { name: `Show Survey Markers in ${E2E_SURVEY.categoryName}` });
  const chooser = page.getByText('Choose a survey template', { exact: true });
  if (!(await category.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    await expect(chooser.or(category).first()).toBeVisible({ timeout: 30_000 });
    if (await chooser.isVisible()) {
      await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
      await takeLatest(page);
    }
  }
  // Take the template version this spec just wrote (entities, switch).
  await page.getByRole('button', { name: /^Survey template: .*Switch template$/ }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: E2E_SURVEY.templateName }).or(page.getByRole('menuitemradio', { name: E2E_SURVEY.templateName })).or(page.getByRole('option', { name: E2E_SURVEY.templateName })).first().click();
  await takeLatest(page);
  await expect(category).toBeVisible();
  const expand = page.getByRole('button', { name: 'Expand marker details' }).first();
  if (!(await expand.isVisible().catch(() => false))) await category.click();
  await expand.click();
}

const box = (page, line) => page.getByRole('textbox', { name: `${line} answer` });
const entityButton = (page) => page.getByRole('button', { name: /^Entity: .*\. Change entity$/ }).filter({ visible: true }).first();

async function answerLine(page, line, value) {
  await box(page, line).fill(value);
  await box(page, line).press('Enter');
  await expect(box(page, line)).toHaveValue(value);
}
async function answerAll(page, value) {
  for (const { text } of E2E_SURVEY.checklist) await answerLine(page, text, value);
}

async function clearEntity(page) {
  await entityButton(page).click();
  await page.getByRole('listbox', { name: 'Entity' }).getByRole('option').first().click();
  await expect(entityButton(page)).toHaveAccessibleName('Entity: none. Change entity');
}

test('switch off: every line done leaves the entity alone; on: it turns Complete', async ({ page }) => {
  await writeTemplate({ autoComplete: false });
  await page.addInitScript(() => localStorage.setItem('survey.flag.custom-answers', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurveyItem(page);
  await answerAll(page, '');
  await clearEntity(page);

  await answerAll(page, 'ok');
  await expect(page.getByText('3/3', { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  await expect(entityButton(page)).toHaveAccessibleName('Entity: none. Change entity');
  await page.screenshot({ path: 'test-results/auto-complete-off.png' });

  // Same walk with the switch on (unset).
  await writeTemplate({ autoComplete: undefined });
  await page.reload();
  // The app reopens the drawing it had open.
  await openSurveyItem(page, { reopened: true });
  await answerAll(page, '');
  await clearEntity(page);
  await answerAll(page, 'ok');
  await expect(entityButton(page)).toHaveAccessibleName('Entity: Complete. Change entity', { timeout: 10_000 });
  // A later blank line never takes Complete away.
  await answerLine(page, E2E_SURVEY.checklist[0].text, '');
  await page.waitForTimeout(500);
  await expect(entityButton(page)).toHaveAccessibleName('Entity: Complete. Change entity');
  await page.screenshot({ path: 'test-results/auto-complete-on.png' });

  // Leave the seeded item blank for the walks that use it.
  await answerAll(page, '');
  await expect(page.getByText('0/3', { exact: true })).toBeVisible();
  await clearEntity(page);
  await page.waitForTimeout(2000);
});

test('the template editor switch saves on and off', async ({ page }) => {
  await writeTemplate({ autoComplete: undefined });
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  await page.getByText(E2E_SURVEY.templateName, { exact: true }).filter({ visible: true }).first().click();
  const toggle = page.getByRole('switch', { name: 'Auto-mark as Complete' }).filter({ visible: true }).first();
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  await expect(page.getByText('Items turn Complete once every line is done.').filter({ visible: true })).toBeVisible();

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByText('Set Complete by hand.').filter({ visible: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/auto-complete-editor-off.png' });
  await page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first().click();
  const stored = async () => {
    const { data } = await adminClient().from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
    return data.config.autoComplete ?? 'unset';
  };
  await expect.poll(stored, { timeout: 20_000 }).toBe(false);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first().click();
  await expect.poll(stored, { timeout: 20_000 }).toBe('unset');
});

test('on a phone the switch sits under the Entities list', async ({ page }) => {
  await writeTemplate({ autoComplete: undefined });
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  // The phone's Templates page, reached from the desktop one.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByText(E2E_SURVEY.templateName, { exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('button', { name: 'Entities', exact: true }).filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Entities' });
  const toggle = dialog.getByRole('switch', { name: 'Auto-mark as Complete' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await page.screenshot({ path: 'test-results/auto-complete-phone.png' });
});
