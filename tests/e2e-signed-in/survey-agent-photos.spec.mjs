// KAL-532 (Nightly flag agent-photo-questions): the Survey agent answers a
// question about a photo added in the chat, and staff see each account's
// agent cost and the take-back rate per prompt version on /flags. The model
// and the photo model are scripted (the survey-agent function is answered by
// a route); the panel, the photo shrink and the staff page are the app's own.
import { readFileSync } from 'node:fs';
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, profileChip, signIn, test } from './helpers.mjs';

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const PHOTO = readFileSync(new URL('../../public/favicon-64x64.png', import.meta.url));

async function scriptModel(page, seen) {
  await page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    seen.push(body);
    const reply = (json) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: false, photos: true, over_cap: false, usage_left: { requests: 2990, cost_share: 0.98 } });
    if (body.action === 'look') return reply({ text: 'A small orange square with a white mark.' });
    const messages = body.messages || [];
    const lastUser = messages.map((m, i) => [m, i]).filter(([m]) => m.role === 'user').pop();
    const attached = String(lastUser[0].content).match(/\[Attached in this chat: (\S+) \(photo/)?.[1];
    const answered = messages.slice(lastUser[1] + 1).some((m) => m.role === 'tool' && m.tool_call_id === 'q1');
    if (!answered) {
      return reply({ message: { content: '', tool_calls: [call('q1', 'ask_about_photo', { item_id: null, photo: null, attachment_id: attached, question: 'What is in the photo?' })] }, prompt_version: 'p-test0001' });
    }
    return reply({ message: { content: 'It shows a small orange square.', tool_calls: [] }, prompt_version: 'p-test0001' });
  });
}

test('a photo added in the chat: the agent asks the photo model and says what it shows', async ({ page }) => {
  const seen = [];
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.survey-agent', '1');
    localStorage.setItem('survey.flag.agent-photo-questions', '1');
    localStorage.setItem('survey.agent.speak', '0');
  });
  await scriptModel(page, seen);
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.getByText(E2E_SURVEY.documentName, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]:visible').first().waitFor({ timeout: 60_000 });
  const category = page.getByRole('button', { name: `Show Survey Markers in ${E2E_SURVEY.categoryName}` });
  if (!(await category.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: 'Survey', exact: true }).click();
    const chooser = page.getByText('Choose a survey template', { exact: true });
    await expect(chooser.or(category).first()).toBeVisible({ timeout: 30_000 });
    // With no memory on this device, Survey opens the drawing's own template;
    // a newer version of it is asked about first, over the picker.
    await page.getByRole('button', { name: 'Use latest version' }).click({ timeout: 2_000 }).catch(() => {});
    if (await chooser.isVisible()) {
      await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
      const latest = page.getByRole('button', { name: 'Use latest version' });
      if (await latest.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await latest.click();
    }
  }
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  const allow = panel.getByRole('button', { name: 'Allow and continue' });
  await expect(allow.or(input)).toBeVisible({ timeout: 30_000 });
  if (await allow.isVisible()) await allow.click();
  await expect(input).toBeEnabled({ timeout: 30_000 });

  await panel.locator('input[type="file"]').setInputFiles({ name: 'site.png', mimeType: 'image/png', buffer: PHOTO });
  await input.fill('what is in this photo?');
  await input.press('Enter');
  await expect(panel.getByText('It shows a small orange square.')).toBeVisible({ timeout: 30_000 });

  const turn = seen.find((b) => b.action === 'turn');
  expect(turn.photos).toBe(true);
  const look = seen.find((b) => b.action === 'look');
  expect(look.mime).toBe('image/jpeg');
  expect(look.question).toBe('What is in the photo?');
  expect(look.image.length).toBeGreaterThan(100);
  const result = seen.filter((b) => b.action === 'turn').at(-1).messages.find((m) => m.tool_call_id === 'q1');
  expect(JSON.parse(result.content)).toEqual({ photo: 'site.png', answer: 'A small orange square with a white mark.' });
  await page.screenshot({ path: 'test-results/agent-photo-answer.png' });
});

test('staff see each account\'s agent cost this month and the take-back rate', async ({ page }) => {
  const db = adminClient();
  const { data: owner } = await db.from('profiles').select('id').eq('email', E2E_ACCOUNTS.owner.email).maybeSingle();
  const ownerId = owner?.id || (await db.auth.admin.listUsers()).data.users.find((u) => u.email === E2E_ACCOUNTS.owner.email).id;
  const month = `${new Date().toISOString().slice(0, 7)}-01`;
  await db.from('survey_agent_usage').upsert({ user_id: ownerId, month, requests: 42, cost_micros: 1_250_000 });
  for (const event of ['changed', 'changed', 'changed', 'changed', 'undo']) {
    await db.rpc('record_survey_agent_feedback', { p_prompt_version: 'p-e2etest1', p_event: event });
  }
  await signIn(page, E2E_ACCOUNTS.owner);
  await page.goto('/flags');
  const section = page.locator('[data-agent-usage]');
  await expect(section).toBeVisible({ timeout: 30_000 });
  await expect(section.getByRole('row', { name: new RegExp(E2E_ACCOUNTS.owner.email.replace(/[.+]/g, '\\$&')) })).toContainText('42');
  await expect(section).toContainText('$1.25');
  await expect(section.getByRole('row', { name: /p-e2etest1/ })).toContainText('25%');
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: 'test-results/agent-staff-usage.png' });

  // Nobody else reads it.
  const { apiClientFor } = await import('./helpers.mjs');
  const free = await apiClientFor(E2E_ACCOUNTS.free);
  const { data: none } = await free.rpc('staff_survey_agent_usage');
  expect(none).toEqual([]);
  await free.auth.signOut();
});

test('Settings, Privacy shows what is left of the monthly agent allowance', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('survey.flag.survey-agent', '1'));
  await scriptModel(page, []);
  await signIn(page, E2E_ACCOUNTS.owner);
  await profileChip(page, E2E_ACCOUNTS.owner).click();
  await page.getByRole('menuitem', { name: 'Settings' }).click();
  await page.getByRole('tab', { name: 'Privacy' }).click();
  const row = page.locator('[data-agent-allowance]');
  await expect(row).toContainText('2990 requests and 98% of your monthly allowance');
  await page.screenshot({ path: 'test-results/agent-settings-allowance.png' });
});
