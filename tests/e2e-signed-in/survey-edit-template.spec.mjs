// Nightly 'custom-answers': the Survey bar's template menu has "Edit
// template…", which leaves the drawing for the home Templates editor with
// that template open, its Answers button in view.
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

// A second template, so the editor has to pick the one Survey mode uses.
const OTHER = { id: 'e2e00000-0000-4000-8000-000000000391', name: 'E2E Another template' };

test.beforeAll(async () => {
  const db = adminClient();
  const { data: doors } = await db.from('templates').select('user_id').eq('id', E2E_SURVEY.templateId).single();
  const config = {
    modules: [{ id: 'e2e-mod-other', name: 'Other', categories: [{ id: 'e2e-cat-other', name: 'Other', checklist: [{ id: 'e2e-cl-other', text: 'Other line' }] }] }],
    entities: [],
  };
  const { error } = await db.from('templates').upsert({ id: OTHER.id, user_id: doors.user_id, name: OTHER.name, config });
  if (error) throw error;
});

test.afterAll(async () => {
  await adminClient().from('templates').delete().eq('id', OTHER.id);
});

// The survey bar's template menu (a plain button under its list).
const editTemplate = (page) => page.getByRole('button', { name: 'Edit template…' });

async function openSurvey(page) {
  await page.getByText(E2E_SURVEY.documentName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByRole('button', { name: `Close ${E2E_SURVEY.documentName}` })).toBeVisible({ timeout: 60_000 });
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]:visible').first().waitFor({ timeout: 60_000 });
  const templateButton = page.getByRole('button', { name: /^Survey template: .*Switch template$/ }).filter({ visible: true }).first();
  if (!(await templateButton.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    const chooser = page.getByText('Choose a survey template', { exact: true });
    await expect(chooser.or(templateButton).first()).toBeVisible({ timeout: 30_000 });
    if (await chooser.isVisible()) {
      await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
      // An earlier spec may have changed the template since this document used it.
      const latest = page.getByRole('button', { name: 'Use latest version' });
      if (await latest.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await latest.click();
    }
  }
  await expect(templateButton).toBeVisible({ timeout: 30_000 });
  return templateButton;
}

test('flag on: Edit template opens the Templates editor on that template', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.custom-answers', '1'));
  await signIn(page, E2E_ACCOUNTS.owner);
  // Leave the Templates editor on the other template first.
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  await page.getByText(OTHER.name, { exact: true }).filter({ visible: true }).first().click();
  const name = page.getByRole('textbox', { name: 'Template name' }).filter({ visible: true }).first();
  await expect(name).toHaveValue(OTHER.name);
  await page.getByRole('tab', { name: /Documents/ }).or(page.getByRole('button', { name: /^Documents$/ })).filter({ visible: true }).first().click();

  const templateButton = await openSurvey(page);
  await templateButton.click();
  await editTemplate(page).click();
  await expect(name).toHaveValue(E2E_SURVEY.templateName, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: /^Checklist answers: / }).filter({ visible: true }).first()).toBeVisible();
});

test('flag off: the template menu has no Edit template', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.custom-answers', '0'));
  await signIn(page, E2E_ACCOUNTS.owner);
  const templateButton = await openSurvey(page);
  await templateButton.click();
  await expect(page.getByRole('option', { name: E2E_SURVEY.templateName })).toBeVisible();
  await expect(editTemplate(page)).toHaveCount(0);
});
