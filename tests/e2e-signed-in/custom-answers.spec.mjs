// Nightly 'custom-answers': a template's own checklist answers, typed in the
// template editor, are saved with the template and come back after a reload.
// Without the flag the editor offers only today's presets.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { clientFromPageSession, expect, signIn, test } from './helpers.mjs';

async function openTemplateEditor(page) {
  await page.getByRole('tab', { name: /Templates/ }).or(page.getByRole('button', { name: /^Templates$/ })).filter({ visible: true }).first().click();
  const answers = page.getByRole('combobox', { name: 'Checklist answers' }).filter({ visible: true }).first();
  await expect(answers).toBeVisible({ timeout: 30_000 });
  return answers;
}

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
  const original = await (await clientFromPageSession(page)).from('templates').select('id, name, config').eq('name', templateName).maybeSingle();

  await answers.selectOption({ label: 'Make your own…' });
  const editor = page.getByTestId('answer-set-editor').filter({ visible: true });
  await expect(editor).toBeVisible();
  // Start from Y / N / N/A: rename to 5 / 10 / 20, all Neutral.
  for (const [i, v] of ['5', '10', '20'].entries()) {
    await editor.getByRole('textbox', { name: `Answer ${i + 1}` }).fill(v);
    await editor.getByRole('combobox', { name: `Answer ${i + 1} counts as` }).selectOption('neutral');
  }
  // A comma is refused with a plain reason and is never saved.
  await editor.getByRole('button', { name: 'Add answer' }).click();
  await editor.getByRole('textbox', { name: 'Answer 4' }).fill('40,50');
  await expect(editor.getByRole('alert')).toContainText('commas');
  await expect(editor.getByRole('button', { name: 'Done' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Remove answer 4' }).click();
  await expect(editor.getByRole('alert')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(editor).toHaveCount(0);
  await expect(answers).toHaveValue('');

  await page.getByRole('button', { name: 'Save', exact: true }).filter({ visible: true }).first().click();
  const db = await clientFromPageSession(page);
  await expect.poll(async () => {
    const { data } = await db.from('templates').select('config').eq('name', templateName).maybeSingle();
    // jsonb does not keep key order, so compare value / tone pairs.
    return JSON.stringify((data?.config?.answerSet || []).map((a) => [a.value, a.tone]));
  }, { timeout: 20_000 }).toBe(JSON.stringify([['5', 'neutral'], ['10', 'neutral'], ['20', 'neutral']]));

  await page.reload();
  const again = await openTemplateEditor(page);
  await expect(again).toHaveValue('');
  await again.selectOption({ label: 'Edit my answers…' });
  await expect(page.getByTestId('answer-set-editor').filter({ visible: true }).getByRole('textbox', { name: 'Answer 2' })).toHaveValue('10');

  // Put the seed template back for the other specs.
  if (original.data) await db.from('templates').update({ config: original.data.config }).eq('id', original.data.id);
});
