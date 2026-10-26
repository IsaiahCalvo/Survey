// Nightly 'custom-answers': Score, Count and Date lines. The template marks
// the lines; the Survey rail shows score buttons, a - box + counter and a
// date picker; answers are saved on the item and come back on reload.
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

let original = null;

test.beforeAll(async () => {
  const db = adminClient();
  const { data } = await db.from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
  original = data.config;
  const config = structuredClone(original);
  const lines = config.modules[0].categories[0].checklist;
  lines[0] = { ...lines[0], kind: 'score', issueAt: 2 };
  lines[1] = { ...lines[1], kind: 'count', min: 1 };
  lines[2] = { ...lines[2], kind: 'date', issueIfPast: true };
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
  // version this spec just wrote (kinds, units, meanings).
  await page.getByRole('button', { name: /^Survey template: .*Switch template$/ }).filter({ visible: true }).first().click();
  await page.getByRole('menuitem', { name: E2E_SURVEY.templateName }).or(page.getByRole('menuitemradio', { name: E2E_SURVEY.templateName })).or(page.getByRole('option', { name: E2E_SURVEY.templateName })).first().click();
  await takeLatest(page);
  await expect(category).toBeVisible();
  const expand = page.getByRole('button', { name: 'Expand marker details' }).first();
  if (!(await expand.isVisible().catch(() => false))) await category.click();
  await expand.click();
}

test('score, count and date lines in the Survey rail', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.custom-answers', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurveyItem(page);
  const [cable, frame, door] = E2E_SURVEY.checklist.map((c) => c.text);
  const scoreBtn = (n) => page.getByRole('group', { name: `${cable} score` }).getByRole('button', { name: `${cable} ${n}`, exact: true });
  const countBox = page.getByRole('textbox', { name: `${frame} answer` });
  const dateBox = page.getByLabel(`${door} date`);

  // Start blank (a rerun on the same stack finds the last run's answers).
  for (let n = 1; n <= 5; n++) if (await scoreBtn(n).getAttribute('aria-pressed') === 'true') await scoreBtn(n).click();
  await countBox.fill('');
  await countBox.press('Enter');
  await dateBox.fill('');
  await expect(page.getByText('0/3', { exact: true })).toBeVisible();

  // Score: five buttons, one lit.
  await expect(scoreBtn(5)).toBeVisible();
  await scoreBtn(2).click();
  await expect(scoreBtn(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(scoreBtn(2)).toHaveClass(/is-no/); // at the issue line
  await scoreBtn(4).click();
  await expect(scoreBtn(4)).toHaveClass(/is-yes/);
  await expect(scoreBtn(2)).toHaveAttribute('aria-pressed', 'false');

  // Count: + and - step it; a negative never saves.
  await page.getByRole('button', { name: `${frame} one more` }).click();
  await page.getByRole('button', { name: `${frame} one more` }).click();
  await expect(countBox).toHaveValue('2');
  await page.getByRole('button', { name: `${frame} one less` }).click();
  await expect(countBox).toHaveValue('1');
  await countBox.fill('-3');
  await countBox.press('Enter');
  await expect(countBox).toHaveValue('1');

  // Date: the system picker.
  await dateBox.fill('2027-03-15');
  await expect(dateBox).toHaveValue('2027-03-15');
  await expect(page.getByText('3/3', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/answer-kinds.png' });

  // Saved with the item: still there after a reload.
  await page.waitForTimeout(2000);
  await page.reload();
  await openSurveyItem(page, { reopened: true });
  await expect(scoreBtn(4)).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  await expect(countBox).toHaveValue('1');
  await expect(dateBox).toHaveValue('2027-03-15');

  // Leave the seeded item blank for the walks that use it.
  await scoreBtn(4).click();
  await countBox.fill('');
  await countBox.press('Enter');
  await dateBox.fill('');
  await expect(page.getByText('0/3', { exact: true })).toBeVisible();
  await page.waitForTimeout(2000);
});

test('the template editor shows each kind with its settings', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.custom-answers', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  const [cable, frame, door] = E2E_SURVEY.checklist.map((c) => c.text);
  const visible = (locator) => locator.filter({ visible: true }).first();
  const kindOf = (line) => visible(page.getByRole('combobox', { name: `How "${line}" is answered` }));
  await visible(page.getByText(E2E_SURVEY.templateName, { exact: true })).click();
  const expand = visible(page.getByRole('button', { name: `Expand ${E2E_SURVEY.categoryName}` }));
  const collapse = visible(page.getByRole('button', { name: `Collapse ${E2E_SURVEY.categoryName}` }));
  await expect(expand.or(collapse).first()).toBeVisible({ timeout: 30_000 });
  if (await expand.isVisible()) await expand.click();
  await expect(kindOf(cable)).toHaveValue('score', { timeout: 30_000 });
  await expect(visible(page.getByRole('combobox', { name: `Score scale for "${cable}"` }))).toHaveValue('5');
  await expect(visible(page.getByRole('combobox', { name: `Issue at or below, for "${cable}"` }))).toHaveValue('2');
  await expect(kindOf(frame)).toHaveValue('count');
  await expect(visible(page.getByRole('textbox', { name: `Lowest fine value for "${frame}"` }))).toHaveValue('1');
  await expect(kindOf(door)).toHaveValue('date');
  await expect(visible(page.getByRole('checkbox', { name: 'Issue once past' }))).toBeChecked();
});
