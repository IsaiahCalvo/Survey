// Nightly 'custom-answers': a template's own checklist answers, typed in the
// template editor (with an optional "means" line), are saved with the template
// and come back after a reload.
// Without the flag the editor offers only today's presets.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { adminClient, clientFromPageSession, expect, signIn, test } from './helpers.mjs';

async function openTemplateEditor(page) {
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  const answers = page.getByRole('combobox', { name: 'Checklist answers' }).filter({ visible: true }).first();
  await expect(answers).toBeVisible({ timeout: 30_000 });
  return answers;
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
  await expect(answers.locator('option', { hasText: 'Edit answers' })).toHaveCount(0);
  await expect(answers.locator('option', { hasText: 'Small / Medium / Large' })).toHaveCount(0);
});

test('flag on: type 5 / 10 / 20, save, and it is still there after a reload', async ({ page }) => {
  await flag(true)(page);
  await signIn(page, E2E_ACCOUNTS.owner);
  const answers = await openTemplateEditor(page);
  const templateName = await page.getByRole('textbox', { name: 'Template name' }).filter({ visible: true }).first().inputValue();
  const save = page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first();

  await expect(answers).toHaveValue('yes-no-na');
  await answers.selectOption({ label: 'Edit answers…' });
  const dialog = page.getByRole('dialog', { name: templateName });
  const editor = dialog.getByTestId('answer-set-editor');
  await expect(editor).toBeVisible();
  await expect(answers).toHaveValue('yes-no-na', { timeout: 1_000 });
  // Start from Y / N / N/A: rename to 5 / 10 / 20, all Neutral.
  for (const [i, v] of ['5', '10', '20'].entries()) {
    await editor.getByRole('textbox', { name: `Answer ${i + 1}`, exact: true }).fill(v);
    await editor.getByRole('combobox', { name: `Answer ${i + 1} counts as` }).selectOption('neutral');
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
  await expect(answers).toHaveValue('yes-no-na');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(answers).toHaveValue('');

  await save.click();
  const db = await clientFromPageSession(page);
  await expect.poll(async () => {
    const { data } = await db.from('templates').select('config').eq('name', templateName).limit(1).maybeSingle();
    // jsonb does not keep key order, so compare value / tone pairs.
    return JSON.stringify((data?.config?.answerSet || []).map((a) => [a.value, a.tone, a.means ?? null]));
  }, { timeout: 20_000 }).toBe(JSON.stringify([['5', 'neutral', 'a single door'], ['10', 'neutral', null], ['20', 'neutral', null]]));

  await page.reload();
  const again = await openTemplateEditor(page);
  await expect(again).toHaveValue('');
  await again.selectOption({ label: 'Edit answers…' });
  const reopened = page.getByRole('dialog', { name: templateName });
  await expect(reopened.getByRole('textbox', { name: 'Answer 2', exact: true })).toHaveValue('10');
  await expect(reopened.getByRole('textbox', { name: 'What answer 1 means' })).toHaveValue('a single door');
  // Cancel keeps the saved list.
  await reopened.getByRole('textbox', { name: 'Answer 2', exact: true }).fill('11');
  await reopened.getByRole('button', { name: 'Cancel' }).click();
  await expect(reopened).toHaveCount(0);
  await again.selectOption({ label: 'Edit answers…' });
  await expect(reopened.getByRole('textbox', { name: 'Answer 2', exact: true })).toHaveValue('10');
  await page.keyboard.press('Escape');
  await expect(reopened).toHaveCount(0);

  // Put the seed template back to Y / N / N/A for the other specs.
  await again.selectOption('yes-no-na');
  await save.click();
  await expect.poll(async () => {
    const { data } = await db.from('templates').select('config').eq('name', templateName).limit(1).maybeSingle();
    return data?.config?.answerSet ?? null;
  }, { timeout: 20_000 }).toBe(null);
});

test('a preset can be edited after picking it, past six answers', async ({ page }) => {
  await flag(true)(page);
  await signIn(page, E2E_ACCOUNTS.owner);
  const answers = await openTemplateEditor(page);
  const templateName = await page.getByRole('textbox', { name: 'Template name' }).filter({ visible: true }).first().inputValue();
  const save = page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first();

  await answers.selectOption({ label: 'Small / Medium / Large' });
  await answers.selectOption({ label: 'Edit answers…' });
  const dialog = page.getByRole('dialog', { name: templateName });
  await expect(dialog.getByRole('textbox', { name: 'Answer 1', exact: true })).toHaveValue('Small');
  for (const [i, v] of ['XS', 'XL', 'XXL', '2XL', '3XL'].entries()) {
    await dialog.getByRole('button', { name: 'Add answer' }).click();
    await dialog.getByRole('textbox', { name: `Answer ${i + 4}`, exact: true }).fill(v);
  }
  await expect(dialog.getByText('8 of 20')).toBeVisible();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(answers).toHaveValue('');
  await save.click();
  const db = await clientFromPageSession(page);
  await expect.poll(async () => {
    const { data } = await db.from('templates').select('config').eq('name', templateName).limit(1).maybeSingle();
    return (data?.config?.answerSet || []).map((a) => a.value).join(' ');
  }, { timeout: 20_000 }).toBe('Small Medium Large XS XL XXL 2XL 3XL');

  await answers.selectOption('yes-no-na');
  await save.click();
  await expect.poll(async () => {
    const { data } = await db.from('templates').select('config').eq('name', templateName).limit(1).maybeSingle();
    return data?.config?.answerSet ?? null;
  }, { timeout: 20_000 }).toBe(null);
});
