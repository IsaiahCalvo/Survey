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
  await expect(answers.locator('option', { hasText: 'Make your own' })).toHaveCount(0);
  await expect(answers.locator('option', { hasText: 'Small / Medium / Large' })).toHaveCount(0);
});

test('flag on: type 5 / 10 / 20, save, and it is still there after a reload', async ({ page }) => {
  await flag(true)(page);
  await signIn(page, E2E_ACCOUNTS.owner);
  const answers = await openTemplateEditor(page);
  const templateName = await page.getByRole('textbox', { name: 'Template name' }).filter({ visible: true }).first().inputValue();
  const save = page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first();

  await expect(answers).toHaveValue('yes-no-na');
  await answers.selectOption({ label: 'Make your own…' });
  const editor = page.getByTestId('answer-set-editor').filter({ visible: true });
  await expect(editor).toBeVisible();
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
  await expect(editor.getByRole('button', { name: 'Done' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Remove answer 4' }).click();
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(editor).toHaveCount(0);
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
  await again.selectOption({ label: 'Edit my answers…' });
  await expect(page.getByTestId('answer-set-editor').filter({ visible: true }).getByRole('textbox', { name: 'Answer 2', exact: true })).toHaveValue('10');
  await expect(page.getByTestId('answer-set-editor').filter({ visible: true }).getByRole('textbox', { name: 'What answer 1 means' })).toHaveValue('a single door');

  // Put the seed template back to Y / N / N/A for the other specs.
  await page.getByTestId('answer-set-editor').filter({ visible: true }).getByRole('button', { name: 'Done' }).click();
  await again.selectOption('yes-no-na');
  await save.click();
  await expect.poll(async () => {
    const { data } = await db.from('templates').select('config').eq('name', templateName).limit(1).maybeSingle();
    return data?.config?.answerSet ?? null;
  }, { timeout: 20_000 }).toBe(null);
});
