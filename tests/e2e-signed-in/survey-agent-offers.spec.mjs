// KAL-529 (Nightly flag agent-template-offers): the Survey agent offers to
// add a checklist line it keeps hearing ("no power" on a door). The model is
// scripted (the survey-agent function is answered by a route); the card, the
// template save and the answer on the item are the app's own.
import { E2E_ACCOUNTS, E2E_SURVEY } from './accounts.mjs';
import { adminClient, expect, signIn, test } from './helpers.mjs';

const call = (id, name, args) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const LINE = 'Power at door';

const SCRIPT = {
  'D-1-17 has no power': [
    [call('a1', 'offer_checklist_line', { category_id: E2E_SURVEY.categoryId, text: LINE, item_id: E2E_SURVEY.markerId, answer: 'N' })],
    'Want a Power at door line on every door? Tap Yes.',
  ],
  'check the item': [
    [call('b1', 'get_item', { item_id: E2E_SURVEY.markerId })],
    'Checked.',
  ],
};

let savedConfig = null;
test.beforeAll(async () => {
  const { data, error } = await adminClient().from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
  if (error) throw error;
  savedConfig = data.config;
});
// The seed's template, as it was: other specs count its lines.
test.afterAll(async () => {
  if (savedConfig) await adminClient().from('templates').update({ config: savedConfig }).eq('id', E2E_SURVEY.templateId);
});

async function scriptModel(page, seen) {
  await page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    const reply = (json) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: false, over_cap: false });
    seen.push(body);
    const messages = body.messages || [];
    const lastUser = messages.map((m, i) => [m, i]).filter(([m]) => m.role === 'user').pop();
    const said = String(lastUser?.[0]?.content || '').split('\n')[0].trim();
    const steps = SCRIPT[said];
    const answered = new Set(messages.slice(lastUser[1] + 1).filter((m) => m.role === 'tool').map((m) => m.tool_call_id));
    const stepIndex = (steps || []).filter((st) => Array.isArray(st) && st.every((c) => answered.has(c.id))).length;
    const step = steps?.[stepIndex];
    if (!step) return reply({ message: { content: 'I did not follow.', tool_calls: [] } });
    if (typeof step === 'string') return reply({ message: { content: step, tool_calls: [] } });
    return reply({ message: { content: '', tool_calls: step } });
  });
}

const lastItem = (seen) => {
  const results = seen.flatMap((b) => b.messages || []).filter((m) => m.role === 'tool' && String(m.content).includes('"checklist"') && !String(m.tool_call_id).startsWith('ctx-'));
  return JSON.parse(results.at(-1).content);
};

test('"no power" on a door: a Yes / No card adds the line and answers it on that door', async ({ page }) => {
  const seen = [];
  await page.addInitScript(() => {
    localStorage.setItem('survey.flag.survey-agent', '1');
    localStorage.setItem('survey.flag.agent-template-offers', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('survey.agent.noteStyle', 'bullets');
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
  // The note style setting sits beside the read-aloud button.
  await expect(panel.getByRole('button', { name: 'Notes as bullets' })).toBeVisible();
  const say = async (text, answer) => {
    await input.fill(text);
    await input.press('Enter');
    await expect(panel.getByText(answer).last()).toBeVisible({ timeout: 30_000 });
  };

  await say('D-1-17 has no power', 'Tap Yes.');
  const sent = seen.find((b) => b.action === 'turn');
  expect(sent.offers).toBe(true);
  expect(sent.note_style).toBe('bullets');
  const ctx = JSON.parse(sent.messages.find((m) => m.role === 'tool' && String(m.tool_call_id).startsWith('ctx-')).content);
  expect(ctx.template_editable).toBe(true);

  const card = panel.getByTestId('survey-agent-offer');
  await expect(card).toContainText(`Add “${LINE}” to the ${E2E_SURVEY.categoryName} checklist, set to N on ${E2E_SURVEY.itemName}?`);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/agent-offer-card.png' });
  await card.getByRole('button', { name: 'Yes' }).click();
  await expect(card).toContainText('Added to the template', { timeout: 15_000 });

  // Saved to the template row, after the lines it had.
  await expect.poll(async () => {
    const { data } = await adminClient().from('templates').select('config').eq('id', E2E_SURVEY.templateId).single();
    const door = data.config.modules[0].categories.find((c) => c.id === E2E_SURVEY.categoryId);
    return door.checklist.map((l) => l.text);
  }, { timeout: 15_000 }).toEqual([...E2E_SURVEY.checklist.map((l) => l.text), LINE]);

  // Answered on D-1-17, and the agent is told with the next message.
  const changes = panel.getByTestId('survey-agent-changes').last();
  await expect(changes).toContainText(`${E2E_SURVEY.itemName}: ${LINE} N`);
  await say('check the item', 'Checked.');
  const lastTurn = seen.filter((b) => b.action === 'turn').at(-1);
  expect(lastTurn.messages.filter((m) => m.role === 'user').at(-1).content).toContain(`"${LINE}"`);
  const item = lastItem(seen);
  expect(item.checklist.find((l) => l.text === LINE)?.answer).toBe('N');
  await page.screenshot({ path: 'test-results/agent-offer-added.png' });

  // Undo takes the answer back; the line stays in the template.
  await changes.getByRole('button', { name: /Undo/ }).click();
  await expect(changes).toContainText('Undone');
  const asked = seen.length;
  await input.fill('check the item');
  await input.press('Enter');
  await expect.poll(() => seen.length > asked && lastItem(seen).checklist.find((l) => l.text === LINE)?.answer, { timeout: 30_000 }).toBeNull();
});
