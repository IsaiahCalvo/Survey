// Nightly beta (plan 2026-10-27): the Survey agent learns a project's names
// and note wording. The model is scripted (the survey-agent function is
// answered by a route), everything else is real: the app's tools, the
// survey_agent_memory table and its row rules on the local stack, and the
// "What Survey learned" dialog.
import { E2E_ACCOUNTS, E2E_PROJECT, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const isToolResult = (m) => m.role === 'tool' && !String(m.tool_call_id).startsWith('ctx-');
const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });

// One scripted step per user line: the tools to call first, then the words.
const SCRIPT = {
  'whenever I say dee one seventeen I mean D-1-17': [
    [call('a1', 'remember', { kind: 'name', heard: 'dee one seventeen', means: 'D-1-17' })],
    'Got it.',
  ],
  'dee one seventeen frame is in, door missing': [
    // Only a note: a pick-one answer could not be cleared for the specs after this.
    [call('b1', 'set_answers', { item_name: 'dee one seventeen', note: 'Door missing.' })],
    'Done.',
  ],
  'always write not installed, not missing': [
    [call('c1', 'remember', { kind: 'wording', heard: 'missing', means: 'not installed' }), call('c2', 'tidy_notes', { from: 'missing', to: 'not installed' })],
    [call('c3', 'get_item', { item_id: E2E_SURVEY.markerId })],
    'Saved, and I changed one note.',
  ],
  'check the item': [
    [call('d1', 'get_item', { item_id: E2E_SURVEY.markerId })],
    'Checked.',
  ],
};

async function scriptModel(page, seen) {
  await page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    const reply = (json) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: false, over_cap: false });
    const messages = body.messages || [];
    const lastUser = messages.map((m, i) => [m, i]).filter(([m]) => m.role === 'user').pop();
    const said = String(lastUser?.[0]?.content || '').split('\n')[0].trim();
    const steps = SCRIPT[said];
    const results = messages.slice(lastUser[1] + 1).filter(isToolResult);
    seen.push(...results.map((r) => r.content));
    const answered = new Set(results.map((r) => r.tool_call_id));
    const stepIndex = (steps || []).filter((st) => Array.isArray(st) && st.every((c) => answered.has(c.id))).length;
    const step = steps?.[stepIndex];
    if (!step) return reply({ message: { content: 'I did not follow.', tool_calls: [] } });
    if (typeof step === 'string') return reply({ message: { content: step, tool_calls: [] } });
    return reply({ message: { content: '', tool_calls: step } });
  });
}

async function clearMemory() {
  await adminClient().from('survey_agent_memory').delete().eq('project_id', E2E_PROJECT.id);
}

test.beforeEach(clearMemory);
test.afterAll(clearMemory);

async function takeLatest(page) {
  const latest = page.getByRole('button', { name: 'Use latest version' });
  if (await latest.waitFor({ timeout: 3_000 }).then(() => true, () => false)) await latest.click();
}

test('the agent learns a name and a wording for the project, and people can see and remove them', async ({ page }) => {
  const seen = [];
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.survey-agent', '1');
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
    if (await chooser.isVisible()) {
      await page.getByText(E2E_SURVEY.templateName, { exact: true }).last().click();
      await takeLatest(page);
    }
  }

  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled({ timeout: 30_000 });
  const say = async (text, answer) => {
    await input.fill(text);
    await input.press('Enter');
    await expect(panel.getByText(answer).last()).toBeVisible({ timeout: 30_000 });
  };

  // A name, saved for the project (real row, real row rules).
  await say('whenever I say dee one seventeen I mean D-1-17', 'Got it.');
  await expect.poll(async () => {
    const { data } = await adminClient().from('survey_agent_memory').select('kind, heard, means, project_id').eq('project_id', E2E_PROJECT.id);
    return data;
  }).toEqual([{ kind: 'name', heard: 'dee one seventeen', means: 'D-1-17', project_id: E2E_PROJECT.id }]);

  // Said that way, it finds D-1-17: the frame line and a note.
  await say('dee one seventeen frame is in, door missing', 'Done.');
  await expect(panel.getByTestId('survey-agent-changes').last()).toContainText('D-1-17');

  // A wording: saved, the old note tidied, and the item reads it back.
  await say('always write not installed, not missing', 'Saved, and I changed one note.');
  const item = JSON.parse(seen.findLast((c) => c.includes('"checklist"')));
  expect(item.name).toBe('D-1-17');
  expect(item.note).toBe('Door not installed.');

  // What Survey learned: both rows; remove one, then Undo.
  await panel.getByRole('button', { name: 'Learned' }).click();
  const dialog = page.getByRole('dialog', { name: 'What Survey learned' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('means')).toBeVisible();
  await expect(dialog.getByRole('listitem')).toHaveCount(2);
  await page.screenshot({ path: 'test-results/agent-learned.png' });
  await dialog.getByRole('button', { name: 'Remove "missing"' }).click();
  await expect(dialog.getByRole('listitem')).toHaveCount(1);
  await expect.poll(async () => (await adminClient().from('survey_agent_memory').select('id').eq('project_id', E2E_PROJECT.id)).data.length).toBe(1);
  await dialog.getByRole('button', { name: 'Undo' }).click();
  await expect(dialog.getByRole('listitem')).toHaveCount(2);
  await expect.poll(async () => (await adminClient().from('survey_agent_memory').select('id').eq('project_id', E2E_PROJECT.id)).data.length).toBe(2);
  await dialog.getByRole('button', { name: 'Done' }).click();

  // Undo the turns, newest first: the note goes, the learned rows go.
  const undos = panel.getByTestId('survey-agent-changes').getByRole('button', { name: /Undo/ });
  while (await undos.count()) await undos.last().click();
  await expect.poll(async () => (await adminClient().from('survey_agent_memory').select('id').eq('project_id', E2E_PROJECT.id)).data.length).toBe(0);
  await say('check the item', 'Checked.');
  expect(JSON.parse(seen.findLast((c) => c.includes('"checklist"'))).note).toBe('');
  await page.waitForTimeout(2000);
});

test('a viewer reads what was learned but cannot add to it', async () => {
  const db = adminClient();
  await db.from('survey_agent_memory').insert({ project_id: E2E_PROJECT.id, kind: 'name', heard: 'dee one seventeen', means: 'D-1-17' });
  const { apiClientFor } = await import('./helpers.mjs');
  const viewer = await apiClientFor(E2E_ACCOUNTS.viewer);
  const read = await viewer.from('survey_agent_memory').select('heard').eq('project_id', E2E_PROJECT.id);
  const add = await viewer.from('survey_agent_memory').insert({ project_id: E2E_PROJECT.id, kind: 'wording', heard: 'missing', means: 'gone' });
  const free = await apiClientFor(E2E_ACCOUNTS.free);
  const outsider = await free.from('survey_agent_memory').select('heard').eq('project_id', E2E_PROJECT.id);
  // The viewer is on the project as a viewer only (seed); the free account is not on it.
  expect(add.error).toBeTruthy();
  expect(outsider.data).toEqual([]);
  expect(read.error).toBeNull();
  await viewer.auth.signOut();
  await free.auth.signOut();
});
