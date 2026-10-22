// Nightly 'custom-answers': a checklist line can take a typed number or text
// instead of the answer buttons. The template marks the line; the Survey rail
// shows a box; what is typed is saved on the item and comes back on reload.
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

let original = null;

test.beforeAll(async () => {
  const db = adminClient();
  const { data } = await db.from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
  original = data.config;
  const config = structuredClone(original);
  const lines = config.modules[0].categories[0].checklist;
  lines[0] = { ...lines[0], kind: 'number', unit: 'ft' };
  lines[1] = { ...lines[1], kind: 'text' };
  const { error } = await db.from('templates').update({ config }).eq('id', E2E_SURVEY.templateId);
  if (error) throw error;
});

test.afterAll(async () => {
  if (original) await adminClient().from('templates').update({ config: original }).eq('id', E2E_SURVEY.templateId);
});

// "Survey template updated": take the version this spec wrote.
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
  // A document keeps the template version it was surveyed with; take the
  // version this spec just wrote.
  await page.getByRole('button', { name: /^Survey template: .*Switch template$/ }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: E2E_SURVEY.templateName }).or(page.getByRole('menuitemradio', { name: E2E_SURVEY.templateName })).or(page.getByRole('option', { name: E2E_SURVEY.templateName })).first().click();
  await takeLatest(page);
  await expect(category).toBeVisible();
  const expand = page.getByRole('button', { name: 'Expand marker details' }).first();
  if (!(await expand.isVisible().catch(() => false))) await category.click();
  await expand.click();
}

const box = (page, line) => page.getByRole('textbox', { name: `${line} answer` });

test('number and text lines take a typed answer in the Survey rail', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.custom-answers', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurveyItem(page);
  const [cable, frame, door] = E2E_SURVEY.checklist.map((c) => c.text);
  // The pick-one line keeps its buttons; the other two get boxes.
  await expect(page.getByRole('group', { name: door }).getByRole('button', { name: 'Y', exact: true })).toBeVisible();
  await expect(box(page, cable)).toBeVisible();
  await expect(page.getByText('ft', { exact: true })).toBeVisible();

  // Start blank (a rerun on the same stack finds the last run's answers).
  for (const line of [cable, frame]) {
    await box(page, line).fill('');
    await box(page, line).press('Enter');
  }
  await expect(page.getByText('0/3', { exact: true })).toBeVisible();

  // Not a number: the box goes back to empty and nothing is saved.
  await box(page, cable).fill('eight');
  await box(page, cable).press('Enter');
  await expect(box(page, cable)).toHaveValue('');
  await box(page, cable).fill('1,200');
  await box(page, cable).press('Enter');
  await expect(box(page, cable)).toHaveValue('1200');
  await box(page, frame).fill('  Prepped by crew B ');
  await box(page, frame).press('Tab');
  await expect(box(page, frame)).toHaveValue('Prepped by crew B');
  await expect(page.getByText('2/3', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/typed-answers.png' });

  // Saved with the item: still there after a reload.
  await page.waitForTimeout(2000);
  await page.reload();
  // The app reopens the drawing it had open.
  await openSurveyItem(page, { reopened: true });
  await expect(box(page, cable)).toHaveValue('1200', { timeout: 30_000 });
  await expect(box(page, frame)).toHaveValue('Prepped by crew B');
  // Leave the seeded item blank for the walks that use it.
  for (const line of [cable, frame]) {
    await box(page, line).fill('');
    await box(page, line).press('Enter');
  }
  await expect(page.getByText('0/3', { exact: true })).toBeVisible();
  await page.waitForTimeout(2000);
});

test('the template editor shows how each line is answered', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.custom-answers', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  const [cable, frame, door] = E2E_SURVEY.checklist.map((c) => c.text);
  const kindOf = (line) => page.getByRole('combobox', { name: `How "${line}" is answered` }).filter({ visible: true }).first();
  await page.getByRole('button', { name: `Expand ${E2E_SURVEY.categoryName}` }).filter({ visible: true }).first().click();
  await expect(kindOf(cable)).toHaveValue('number', { timeout: 30_000 });
  await expect(page.getByRole('textbox', { name: `Unit for "${cable}"` }).filter({ visible: true }).first()).toHaveValue('ft');
  await expect(kindOf(frame)).toHaveValue('text');
  await expect(kindOf(door)).toHaveValue('choice');
});
