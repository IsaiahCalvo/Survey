// Nightly 'custom-answers': a Pick many line. Its own options show as chips
// on the Survey rail; any number can be on; a Problem option lights red.
// The template's own list here has eight answers, so its pick-one lines show
// a drop-down instead of a row of buttons.
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

let original = null;
const OPTIONS = [{ value: 'None', tone: 'good' }, { value: 'Rust', tone: 'bad' }, { value: 'Label faded', tone: 'neutral' }];
const LONG_LIST = ['OK', 'Loose', 'Cracked', 'Bent', 'Missing', 'Rusted', 'Dirty', 'Painted']
  .map((value, i) => ({ value, tone: i === 0 ? 'good' : i === 6 ? 'neutral' : 'bad' }));

test.beforeAll(async () => {
  const db = adminClient();
  const { data } = await db.from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
  original = data.config;
  const config = structuredClone(original);
  const lines = config.modules[0].categories[0].checklist;
  lines[0] = { ...lines[0], kind: 'many', options: OPTIONS };
  config.answerSet = LONG_LIST;
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

test('a Pick many line takes any of its options', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.custom-answers', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSurveyItem(page);
  const [cable, frame] = E2E_SURVEY.checklist.map((c) => c.text);
  const chip = (value) => page.getByRole('group', { name: `${cable} options` }).getByRole('button', { name: `${cable} ${value}`, exact: true });
  const clear = async () => {
    for (const o of OPTIONS) if (await chip(o.value).getAttribute('aria-pressed') === 'true') await chip(o.value).click();
  };
  await clear();
  await expect(page.getByText('0/3', { exact: true })).toBeVisible();

  await chip('Label faded').click();
  await chip('Rust').click();
  await expect(chip('Rust')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('Rust')).toHaveClass(/is-no/);
  await expect(chip('Label faded')).toHaveClass(/is-na/);
  await expect(chip('None')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByText('1/3', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/pick-many.png' });

  await page.waitForTimeout(2000);
  await page.reload();
  await openSurveyItem(page, { reopened: true });
  await expect(chip('Rust')).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  await expect(chip('Label faded')).toHaveAttribute('aria-pressed', 'true');

  // Eight answers: a drop-down, not eight buttons.
  const frameList = page.getByRole('combobox', { name: `${frame} answer` });
  await expect(frameList.locator('option')).toHaveCount(LONG_LIST.length + 1);
  await frameList.selectOption('Loose');
  await expect(page.getByText('2/3', { exact: true })).toBeVisible();
  await frameList.selectOption('');
  await expect(page.getByText('1/3', { exact: true })).toBeVisible();

  // Leave the seeded item blank for the walks that use it.
  await clear();
  await expect(page.getByText('0/3', { exact: true })).toBeVisible();
  await page.waitForTimeout(2000);
});

test('the template editor edits a Pick many line\'s options', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.custom-answers', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  const [cable] = E2E_SURVEY.checklist.map((c) => c.text);
  const visible = (locator) => locator.filter({ visible: true }).first();
  await visible(page.getByText(E2E_SURVEY.templateName, { exact: true })).click();
  const expand = visible(page.getByRole('button', { name: `Expand ${E2E_SURVEY.categoryName}` }));
  const collapse = visible(page.getByRole('button', { name: `Collapse ${E2E_SURVEY.categoryName}` }));
  await expect(expand.or(collapse).first()).toBeVisible({ timeout: 30_000 });
  if (await expand.isVisible()) await expand.click();
  await expect(visible(page.getByRole('combobox', { name: `How "${cable}" is answered` }))).toHaveValue('many', { timeout: 30_000 });
  const options = visible(page.getByRole('button', { name: `Options for "${cable}"` }));
  await expect(options).toHaveText('Options (3)');
  await options.click();
  const editor = page.getByRole('dialog', { name: cable });
  await expect(editor.getByRole('textbox', { name: 'Answer 2', exact: true })).toHaveValue('Rust');
  await expect(editor.getByText(/any number of them/)).toBeVisible();
  await editor.getByRole('button', { name: 'Cancel' }).click();
  await expect(editor).toHaveCount(0);

  // A ready type fills in the line's settings in one pick.
  const how = visible(page.getByRole('combobox', { name: `How "${cable}" is answered` }));
  await how.selectOption({ label: 'Expiry date' });
  await expect(how).toHaveValue('date');
  await expect(visible(page.getByRole('checkbox', { name: 'Issue once past' }))).toBeChecked();
});
