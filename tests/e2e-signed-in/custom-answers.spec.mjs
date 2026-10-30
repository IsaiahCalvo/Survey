// Nightly 'custom-answers': a template's own checklist answers, typed in the
// template editor (with an optional "means" line), are saved with the template
// and come back after a reload.
// Without the flag the editor offers only today's presets.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, clientFromPageSession, expect, signIn, test } from './helpers.mjs';

async function openTemplatesTab(page) {
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
}

// Flag off: the old drop-down.
async function openTemplateEditor(page) {
  await openTemplatesTab(page);
  const answers = page.getByRole('button', { name: 'Checklist answers', exact: true }).filter({ visible: true }).first();
  await expect(answers).toBeVisible({ timeout: 30_000 });
  return answers;
}

// Flag on: the Answers button under the template name, showing the list.
async function openAnswersButton(page) {
  await openTemplatesTab(page);
  const button = page.getByRole('button', { name: /^Checklist answers: / }).filter({ visible: true }).first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  return button;
}

/** Open the picker of ready-made lists from the Answers button. */
async function openPicker(page, button) {
  await button.click();
  const picker = page.getByTestId('answer-set-picker');
  await expect(picker).toBeVisible();
  return picker;
}

/** The answer list editor, from the picker's footer button. */
async function openOwnList(page, button, templateName) {
  const picker = await openPicker(page, button);
  await picker.getByRole('button', { name: /^(Make your own|Edit your list)…$/ }).click();
  await expect(picker).toHaveCount(0);
  return page.getByRole('dialog', { name: templateName });
}

// Every template starts on Y / N / N/A, even when an earlier run on the same
// stack stopped halfway.
test.beforeAll(async () => {
  const db = adminClient();
  const { data } = await db.from('templates').select('id, config');
  for (const row of data || []) {
    if (!row.config?.answerSet) continue;
    const { answerSet: _a, ...config } = row.config;
    await db.from('templates').update({ config }).eq('id', row.id);
  }
});

const flag = (on) => (page) => page.addInitScript((v) => localStorage.setItem('survey.flag.custom-answers', v), on ? '1' : '0');

test('flag off: only the usual presets, no make-your-own', async ({ page }) => {
  await flag(false)(page);
  await signIn(page, E2E_ACCOUNTS.owner);
  const answers = await openTemplateEditor(page);
  await answers.click();
  const list = page.getByRole('listbox', { name: 'Checklist answers' });
  await expect(list.getByRole('option').first()).toBeVisible();
  await expect(list.getByRole('option', { name: /Edit answers/ })).toHaveCount(0);
  await expect(list.getByRole('option', { name: /Small \/ Medium \/ Large/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(list).toHaveCount(0);
});

test('flag on: type 5 / 10 / 20, save, and it is still there after a reload', async ({ page }) => {
  await flag(true)(page);
  await signIn(page, E2E_ACCOUNTS.owner);
  const answers = await openAnswersButton(page);
  const templateName = await page.getByRole('textbox', { name: 'Template name' }).filter({ visible: true }).first().inputValue();
  const save = page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first();

  await expect(answers).toHaveAccessibleName('Checklist answers: Y, N, N/A. Change');
  const dialog = await openOwnList(page, answers, templateName);
  const editor = dialog.getByTestId('answer-set-editor');
  await expect(editor).toBeVisible();
  // Start from Y / N / N/A: rename to 5 / 10 / 20, all Neutral.
  for (const [i, v] of ['5', '10', '20'].entries()) {
    await editor.getByRole('textbox', { name: `Answer ${i + 1}`, exact: true }).fill(v);
    await editor.getByRole('button', { name: `Answer ${i + 1} counts as`, exact: true }).click();
    await page.getByRole('listbox', { name: `Answer ${i + 1} counts as` }).getByRole('option', { name: 'Neutral', exact: true }).click();
    await expect(editor.getByRole('button', { name: `Answer ${i + 1} counts as`, exact: true })).toHaveAttribute('data-value', 'neutral');
  }
  await editor.getByRole('textbox', { name: 'What answer 1 means' }).fill('a single door');
  // A comma is refused with a plain reason and is never saved.
  await editor.getByRole('button', { name: 'Add answer' }).click();
  await editor.getByRole('textbox', { name: 'Answer 4', exact: true }).fill('40,50');
  await expect(editor.getByRole('alert')).toContainText('commas');
  await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Remove answer 4' }).click();
  await expect(editor.getByRole('alert')).toHaveCount(0);
  // Nothing reaches the template until Save.
  await expect(answers).toHaveAccessibleName('Checklist answers: Y, N, N/A. Change');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(answers).toHaveAccessibleName('Checklist answers: 5, 10, 20. Change');

  await save.click();
  const db = await clientFromPageSession(page);
  await expect.poll(async () => {
    const { data } = await db.from('templates').select('config').eq('name', templateName).limit(1).maybeSingle();
    // jsonb does not keep key order, so compare value / tone pairs.
    return JSON.stringify((data?.config?.answerSet || []).map((a) => [a.value, a.tone, a.means ?? null]));
  }, { timeout: 20_000 }).toBe(JSON.stringify([['5', 'neutral', 'a single door'], ['10', 'neutral', null], ['20', 'neutral', null]]));

  await page.reload();
  const again = await openAnswersButton(page);
  await expect(again).toHaveAccessibleName('Checklist answers: 5, 10, 20. Change');
  // The picker shows the template's own list first, checked.
  const picker = await openPicker(page, again);
  await expect(picker.getByRole('radio', { name: 'Your list: 5, 10, 20' })).toHaveAttribute('aria-checked', 'true');
  await picker.getByRole('button', { name: 'Cancel' }).click();
  const reopened = await openOwnList(page, again, templateName);
  await expect(reopened.getByRole('textbox', { name: 'Answer 2', exact: true })).toHaveValue('10');
  await expect(reopened.getByRole('textbox', { name: 'What answer 1 means' })).toHaveValue('a single door');
  // Cancel keeps the saved list.
  await reopened.getByRole('textbox', { name: 'Answer 2', exact: true }).fill('11');
  await reopened.getByRole('button', { name: 'Cancel' }).click();
  await expect(reopened).toHaveCount(0);
  await openOwnList(page, again, templateName);
  await expect(reopened.getByRole('textbox', { name: 'Answer 2', exact: true })).toHaveValue('10');
  await page.keyboard.press('Escape');
  await expect(reopened).toHaveCount(0);

  // Put the seed template back to Y / N / N/A for the other specs.
  await (await openPicker(page, again)).getByRole('radio', { name: 'Y / N / N/A', exact: true }).click();
  await expect(again).toHaveAccessibleName('Checklist answers: Y, N, N/A. Change');
  await save.click();
  await expect.poll(async () => {
    const { data } = await db.from('templates').select('config').eq('name', templateName).limit(1).maybeSingle();
    return data?.config?.answerSet ?? null;
  }, { timeout: 20_000 }).toBe(null);
});

test('a preset can be edited after picking it, past six answers', async ({ page }) => {
  await flag(true)(page);
  await signIn(page, E2E_ACCOUNTS.owner);
  const answers = await openAnswersButton(page);
  const templateName = await page.getByRole('textbox', { name: 'Template name' }).filter({ visible: true }).first().inputValue();
  const save = page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first();

  await (await openPicker(page, answers)).getByRole('radio', { name: 'Small / Medium / Large' }).click();
  await expect(answers).toHaveAccessibleName('Checklist answers: Small, Medium, Large. Change');
  const dialog = await openOwnList(page, answers, templateName);
  await expect(dialog.getByRole('textbox', { name: 'Answer 1', exact: true })).toHaveValue('Small');
  for (const [i, v] of ['XS', 'XL', 'XXL', '2XL', '3XL'].entries()) {
    await dialog.getByRole('button', { name: 'Add answer' }).click();
    await dialog.getByRole('textbox', { name: `Answer ${i + 4}`, exact: true }).fill(v);
  }
  await expect(dialog.getByText('8 of 20')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(answers).toHaveAccessibleName('Checklist answers: Small, Medium, Large, XS, XL, XXL, 2XL, 3XL. Change');
  await save.click();
  const db = await clientFromPageSession(page);
  await expect.poll(async () => {
    const { data } = await db.from('templates').select('config').eq('name', templateName).limit(1).maybeSingle();
    return (data?.config?.answerSet || []).map((a) => a.value).join(' ');
  }, { timeout: 20_000 }).toBe('Small Medium Large XS XL XXL 2XL 3XL');

  await (await openPicker(page, answers)).getByRole('radio', { name: 'Y / N / N/A', exact: true }).click();
  await save.click();
  await expect.poll(async () => {
    const { data } = await db.from('templates').select('config').eq('name', templateName).limit(1).maybeSingle();
    return data?.config?.answerSet ?? null;
  }, { timeout: 20_000 }).toBe(null);
});

test('the picker offers 1 to 5 and 1 to 10 ratings, grouped, and a pick shows on the button', async ({ page }) => {
  await flag(true)(page);
  await signIn(page, E2E_ACCOUNTS.owner);
  const answers = await openAnswersButton(page);
  const picker = await openPicker(page, answers);
  for (const group of ['Yes or no', 'Pass or fail', 'Condition', 'Status', 'Ratings and sizes']) {
    await expect(picker.getByText(group, { exact: true })).toBeVisible();
  }
  await expect(picker.getByRole('radio', { name: 'Y / N / N/A', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(picker.getByRole('radio', { name: 'Rating 1 to 10' })).toBeVisible();
  await picker.getByRole('radio', { name: 'Rating 1 to 5', exact: true }).click();
  await expect(picker).toHaveCount(0);
  await expect(answers).toHaveAccessibleName('Checklist answers: 1, 2, 3, 4, 5. Change');
  // Not saved: Cancel in the editor's bar puts Y / N / N/A back.
  await page.getByRole('button', { name: 'Cancel', exact: true }).filter({ visible: true }).first().click();
  await expect(answers).toHaveAccessibleName('Checklist answers: Y, N, N/A. Change');
});
