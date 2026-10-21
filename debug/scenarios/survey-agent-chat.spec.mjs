// Survey agent chat (KAL-527), driven through the UI with the survey-agent
// edge function mocked. Proves the in-app loop: the person types, the model
// asks for tools, the tools write through the Survey panel's own functions,
// the change card shows what changed, and Undo puts the item back.
//
// Needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set to any value (a fake
// one is fine) so the app has a functions client to call; the route below
// answers instead of the server.
import { test, expect } from '@playwright/test';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const PDF_FILE = 'print-fidelity.pdf';

const TEMPLATE = {
  id: 'agent-template',
  name: 'Door Agent Template',
  modules: [{
    id: 'agent-module',
    name: 'Doors survey',
    categories: [{
      id: 'agent-doors',
      name: 'Doors',
      color: '#5ba1f0',
      checklist: [
        { id: 'cl-power', text: 'Power at door' },
        { id: 'cl-reader', text: 'Card reader' },
      ],
    }],
  }],
};

const MARKER_ID = 'surveyMarker-agent-d117';

async function seed() {
  const { size } = await stat(join(root, 'debug', 'fixtures', PDF_FILE));
  return {
    key: `surveyMarkers_${PDF_FILE}-${size}`,
    markers: {
      [MARKER_ID]: {
        id: MARKER_ID,
        pageNumber: 1,
        bounds: { x: 330, y: 600, width: 150, height: 80 },
        moduleId: 'agent-module',
        regionId: null,
        categoryId: 'agent-doors',
        name: 'D-117',
        checklistResponses: {},
        color: null,
      },
    },
  };
}

// The scripted model: find the door, then set an answer and a note, then
// answer in words. Every request the app sends is kept for checks.
function mockModel(page, calls, status = { enabled: true, reason: null, transcription: false, over_cap: false }) {
  return page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    calls.push(body);
    const reply = (json) => route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
    if (body.action === 'status') return reply(status);
    const tools = body.messages.filter((m) => m.role === 'tool');
    if (tools.length === 0) {
      return reply({ message: { content: '', tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'find_items', arguments: JSON.stringify({ query: 'door 117' }) } },
      ] } });
    }
    if (tools.length === 1) {
      const id = JSON.parse(tools[0].content).matches[0].id;
      return reply({ message: { content: '', tool_calls: [
        { id: 'c2', type: 'function', function: { name: 'set_answers', arguments: JSON.stringify({ item_id: id, answers: [{ checklist_item_id: 'cl-power', value: 'N' }] }) } },
        { id: 'c3', type: 'function', function: { name: 'add_note', arguments: JSON.stringify({ item_id: id, text: 'No power at the door.' }) } },
      ] } });
    }
    return reply({ message: { content: 'D-117: power is N and I added a note.', tool_calls: [] } });
  });
}

async function readMarker(page) {
  return page.evaluate((id) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('surveyMarkers_'));
    return key ? JSON.parse(localStorage.getItem(key) || '{}')[id] : null;
  }, MARKER_ID);
}

test('Survey agent fills an item from a typed message and undoes it', async ({ page }) => {
  const calls = [];
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
  }, { template: TEMPLATE, data });
  await mockModel(page, calls);

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });

  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();

  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  await expect(panel).toBeVisible();
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();

  await input.fill('door 117 has no power');
  await input.press('Enter');

  await expect(panel.getByText('D-117: power is N and I added a note.')).toBeVisible();
  const card = panel.getByTestId('survey-agent-changes');
  await expect(card).toContainText('Power at door = N');
  await expect(card).toContainText('No power at the door.');

  // Three model calls: find, write, words. The write call carried the
  // find result, and the system prompt never came from the app.
  const turns = calls.filter((c) => c.action === 'turn');
  expect(turns).toHaveLength(3);
  expect(turns.every((t) => t.messages.every((m) => m.role !== 'system'))).toBe(true);

  await expect.poll(async () => (await readMarker(page))?.checklistResponses?.['cl-power']?.selection).toBe('N');
  await expect.poll(async () => JSON.stringify((await readMarker(page))?.note || '')).toContain('No power at the door.');

  await card.getByRole('button', { name: /Undo/ }).click();
  await expect.poll(async () => (await readMarker(page))?.checklistResponses?.['cl-power']?.selection || null).toBe(null);
  await expect.poll(async () => JSON.stringify((await readMarker(page))?.note || '')).not.toContain('No power at the door.');
});

// "D-117 power no" in one model step: set_answers takes the name as heard.
test('Survey agent sets an answer by item name with no separate search', async ({ page }) => {
  const calls = [];
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
  }, { template: TEMPLATE, data });
  await page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    calls.push(body);
    const reply = (json) => route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: false, over_cap: false });
    const tools = body.messages.filter((m) => m.role === 'tool');
    if (!tools.length) {
      return reply({ message: { content: '', tool_calls: [
        { id: 'n1', type: 'function', function: { name: 'set_answers', arguments: JSON.stringify({ item_name: 'D one seventeen', answers: [{ checklist_item_id: 'cl-power', value: 'N' }] }) } },
      ] } });
    }
    return reply({ message: { content: 'D-117 power is N.', tool_calls: [] } });
  });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();
  await input.fill('D one seventeen power no');
  await input.press('Enter');

  await expect(panel.getByText('D-117 power is N.')).toBeVisible();
  await expect(panel.getByTestId('survey-agent-changes')).toContainText('Power at door = N');
  await expect.poll(async () => (await readMarker(page))?.checklistResponses?.['cl-power']?.selection).toBe('N');
  // Two model calls (write, words) instead of three (find, write, words).
  expect(calls.filter((c) => c.action === 'turn')).toHaveLength(2);
});

// Spanish: picked in the chat, sent with each turn so the model answers in
// Spanish, and spoken by the device in a Spanish voice (the server voice
// speaks English only).
test('Survey agent in Spanish: the reply is asked for in Spanish and spoken in a Spanish voice', async ({ page }) => {
  const calls = [];
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '1');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
    window.__spoken = [];
    class Utterance { constructor(text) { this.text = text; } }
    window.SpeechSynthesisUtterance = Utterance;
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: { speak(u) { window.__spoken.push([u.text, u.lang]); setTimeout(() => u.onend?.(), 50); }, cancel() {} },
    });
  }, { template: TEMPLATE, data });
  await page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    calls.push(body);
    const reply = (json) => route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: false, speech: true, over_cap: false });
    if (body.action === 'speak') return reply({ audio: '', mime: 'audio/wav' });
    const tools = body.messages.filter((m) => m.role === 'tool');
    if (!tools.length) {
      return reply({ message: { content: '', tool_calls: [
        { id: 's1', type: 'function', function: { name: 'set_answers', arguments: JSON.stringify({ item_name: 'D-117', answers: [{ checklist_item_id: 'cl-power', value: 'N' }] }) } },
      ] } });
    }
    return reply({ message: { content: 'D-117: sin energía, marqué N.', tool_calls: [] } });
  });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  await panel.getByRole('button', { name: 'Language: English' }).click();
  await expect(panel.getByRole('button', { name: 'Language: Español' })).toHaveText('ES');
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();
  await input.fill('D-117 no tiene energía');
  await input.press('Enter');

  await expect(panel.getByText('D-117: sin energía, marqué N.')).toBeVisible();
  await expect.poll(async () => (await readMarker(page))?.checklistResponses?.['cl-power']?.selection).toBe('N');
  const turns = calls.filter((c) => c.action === 'turn');
  expect(turns.length).toBe(2);
  expect(turns.every((t) => t.lang === 'es')).toBe(true);
  // Spoken by the device in Spanish; the English server voice is not asked.
  await expect.poll(() => page.evaluate(() => window.__spoken)).toEqual([['D 117: sin energía, marqué N.', 'es-US']]);
  expect(calls.filter((c) => c.action === 'speak')).toHaveLength(0);
  // Remembered for next time.
  expect(await page.evaluate(() => localStorage.getItem('survey.agent.lang'))).toBe('es');
});

// Phase 2 (KAL-528): the model finds a tag on the plan and adds it as an item.
// Page 2 of this PDF is rotated 90 degrees, so the box has to follow the
// rotation to land on the printed word.
function mockPlanModel(page, calls) {
  return page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    calls.push(body);
    const reply = (json) => route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: false, over_cap: false });
    const tools = body.messages.filter((m) => m.role === 'tool');
    const call = (id, name, args) => reply({ message: { content: '', tool_calls: [
      { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ] } });
    if (tools.length === 0) return call('p1', 'find_on_plan', { text: 'ROTATION' });
    if (tools.length === 1) {
      const { matches } = JSON.parse(tools[0].content);
      const onPage2 = matches.find((m) => m.page === 2);
      return call('p2', 'create_item', { name: 'ROTATION', category_id: 'agent-doors', plan_match_id: onPage2.id, entity_id: null });
    }
    return reply({ message: { content: 'Added ROTATION on page 2.', tool_calls: [] } });
  });
}

test('Survey agent adds an item from a tag on a rotated plan page, and Undo removes it', async ({ page }) => {
  const calls = [];
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
  }, { template: TEMPLATE, data });
  await mockPlanModel(page, calls);

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();
  await input.fill('add ROTATION from page 2 as a door');
  await input.press('Enter');

  await expect(panel.getByText('Added ROTATION on page 2.')).toBeVisible();
  const card = panel.getByTestId('survey-agent-changes');
  await expect(card).toContainText('Added ROTATION (Doors) on page 2');

  // The search found the word on every page (it is printed on all ten).
  const turns = calls.filter((c) => c.action === 'turn');
  const found = JSON.parse(turns[1].messages.at(-1).content);
  expect(found.matches.length).toBeGreaterThanOrEqual(10);
  const createdId = /id (\S+)\.$/.exec(turns[2].messages.at(-1).content)?.[1];
  expect(createdId).toBeTruthy();

  const stored = async () => page.evaluate((id) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('surveyMarkers_'));
    return key ? JSON.parse(localStorage.getItem(key) || '{}')[id] || null : null;
  }, createdId);
  await expect.poll(async () => (await stored())?.name).toBe('ROTATION');
  expect((await stored()).pageNumber).toBe(2);
  expect((await stored()).categoryId).toBe('agent-doors');

  // On screen, the new marker sits on the printed word.
  const pageDiv = page.locator('.survey-pdfjs-page-div[data-page-number="2"]');
  await pageDiv.scrollIntoViewIfNeeded();
  const marker = page.locator(`[data-survey-marker-id="${createdId}"]`).first();
  await expect(marker).toBeVisible();
  // "ROTATION" is printed at x 28-211, y 760 on the 612 x 792 sheet, which
  // /Rotate 90 shows down the right edge: centre about (765, 173) of 792 x 612.
  // An unrotated box would sit near the top left instead.
  const word = { x: 765, y: 173 };
  const { bounds } = await stored();
  expect(bounds.x).toBeLessThanOrEqual(word.x);
  expect(bounds.x + bounds.width).toBeGreaterThanOrEqual(word.x);
  expect(bounds.y).toBeLessThanOrEqual(word.y);
  expect(bounds.y + bounds.height).toBeGreaterThanOrEqual(word.y);
  const onScreen = await page.evaluate((id) => {
    const p = document.querySelector('.survey-pdfjs-page-div[data-page-number="2"]').getBoundingClientRect();
    const m = document.querySelector(`[data-survey-marker-id="${id}"]`).getBoundingClientRect();
    return { left: (m.left - p.left) / p.width, right: (m.right - p.left) / p.width, top: (m.top - p.top) / p.height, bottom: (m.bottom - p.top) / p.height };
  }, createdId);
  expect(onScreen.left).toBeLessThan(word.x / 792);
  expect(onScreen.right).toBeGreaterThan(word.x / 792);
  expect(onScreen.top).toBeLessThan(word.y / 612);
  expect(onScreen.bottom).toBeGreaterThan(word.y / 612);

  await card.getByRole('button', { name: /Undo/ }).click();
  await expect.poll(stored).toBe(null);
});

test('With no signal a message waits, then sends when the signal is back; the allowance warns near the end', async ({ page, context }) => {
  const calls = [];
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
  }, { template: TEMPLATE, data });
  await mockModel(page, calls, { enabled: true, reason: null, transcription: false, over_cap: false, usage_left: { requests: 40, cost_share: 0.9 } });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  await expect(panel.getByRole('status')).toContainText('about 40 requests left');

  await context.setOffline(true);
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await input.fill('door 117 has no power');
  await input.press('Enter');
  await expect(panel.getByText('Waiting for signal')).toBeVisible();
  await expect(panel.getByRole('status')).toContainText('1 message is waiting');
  expect(calls.filter((c) => c.action === 'turn')).toHaveLength(0);

  await context.setOffline(false);
  await expect(panel.getByText('D-117: power is N and I added a note.')).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByText('Waiting for signal')).toHaveCount(0);
  await expect.poll(async () => (await readMarker(page))?.checklistResponses?.['cl-power']?.selection).toBe('N');
});

test('With no signal a message is kept on the device: closing the chat keeps it, and it sends once back online', async ({ page, context }) => {
  const calls = [];
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '1');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
    // The device voice, silent: keep what would be said.
    window.__said = [];
    if (window.speechSynthesis) {
      window.speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend?.(), 0); };
      window.speechSynthesis.cancel = () => {};
    }
  }, { template: TEMPLATE, data });
  await mockModel(page, calls);

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  const open = page.getByRole('button', { name: 'Open Survey agent chat' });
  await open.click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();

  await context.setOffline(true);
  await input.fill('door 117 has no power');
  await input.press('Enter');
  await expect(panel.getByText('Waiting for signal')).toBeVisible();
  // Said out loud, in the device's own voice (no signal for the server's).
  await expect.poll(() => page.evaluate(() => window.__said)).toContain('No signal. I saved that and will send it when you are back online.');

  // Going back to the Survey panel keeps the message waiting.
  await panel.getByRole('button', { name: 'Back to Survey' }).click();
  await expect(panel).toBeHidden();
  await open.click();
  await expect(panel.getByText('door 117 has no power')).toBeVisible();
  await expect(panel.getByText('Waiting for signal')).toBeVisible();
  expect(calls.filter((c) => c.action === 'turn')).toHaveLength(0);

  await context.setOffline(false);
  await expect(panel.getByText('D-117: power is N and I added a note.')).toBeVisible({ timeout: 40_000 });
  await expect(panel.getByText('Waiting for signal')).toHaveCount(0);
  await expect.poll(async () => (await readMarker(page))?.checklistResponses?.['cl-power']?.selection).toBe('N');
  // Each said once: the retries while offline stay quiet.
  await expect.poll(() => page.evaluate(() => window.__said)).toEqual([
    'No signal. I saved that and will send it when you are back online.',
    'D 117: power is N and I added a note.',
  ]);

  // Sent once: opening the chat again does not send it again.
  await panel.getByRole('button', { name: 'Back to Survey' }).click();
  await open.click();
  await expect(panel.getByRole('textbox', { name: 'Message the Survey agent' })).toBeEnabled();
  await page.waitForTimeout(1500);
  await expect(panel.getByText('Waiting for signal')).toHaveCount(0);
  expect(calls.filter((c) => c.action === 'turn')).toHaveLength(3);
});

test('A message that hits the per-minute limit waits and sends a moment later, instead of being lost', async ({ page }) => {
  const calls = [];
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '1');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
    window.__said = [];
    if (window.speechSynthesis) {
      window.speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend?.(), 0); };
      window.speechSynthesis.cancel = () => {};
    }
  }, { template: TEMPLATE, data });
  await mockModel(page, calls);
  // The first three model calls hit the per-minute limit (the first try and
  // both retries); after that the limit has cleared.
  let refusals = 3;
  // Registered last, so it answers first.
  await page.route('**/functions/v1/survey-agent', async (route, request) => {
    const body = request.method() === 'POST' ? request.postDataJSON() : null;
    if (body?.action === 'turn' && refusals > 0) {
      refusals -= 1;
      await route.fulfill({ status: 429, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'busy_try_again', retry_after: 1 }) });
      return;
    }
    await route.fallback();
  });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();
  await input.fill('door 117 has no power');
  await input.press('Enter');

  await expect(panel.getByText('Waiting for signal')).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole('status')).toContainText('Busy for a moment. 1 message is waiting and will send shortly.');
  await expect.poll(() => page.evaluate(() => window.__said)).toContain('That was a lot at once. I saved it and will send it in a moment.');
  await expect(panel.getByText('D-117: power is N and I added a note.')).toBeVisible({ timeout: 40_000 });
  await expect.poll(async () => (await readMarker(page))?.checklistResponses?.['cl-power']?.selection).toBe('N');
  expect(refusals).toBe(0);
});

// Shared markup tools (annotation-agent flag): "put a note by D-117" lands a
// real text note next to the item, through the same tools WebMCP uses.
function mockMarkupModel(page, calls) {
  return page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    calls.push(body);
    const reply = (json) => route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: false, over_cap: false });
    const tools = body.messages.filter((m) => m.role === 'tool');
    const call = (id, name, args) => reply({ message: { content: '', tool_calls: [
      { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ] } });
    if (tools.length === 0) return call('m1', 'find_items', { query: 'D-117', category_id: null });
    if (tools.length === 1) {
      const id = JSON.parse(tools[0].content).matches[0].id;
      return call('m2', 'add_text_note', { near_item_id: id, text: 'Ceiling tile missing' });
    }
    if (tools.length === 2) return call('m3', 'list_annotations', {});
    return reply({ message: { content: 'Added a note next to D-117.', tool_calls: [] } });
  });
}

test('With markup tools on, the agent puts a text note next to an item', async ({ page }) => {
  const calls = [];
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.flag.annotation-agent', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
  }, { template: TEMPLATE, data });
  await mockMarkupModel(page, calls);

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();
  await input.fill('put a note by D-117: ceiling tile missing');
  await input.press('Enter');
  await expect(panel.getByText('Added a note next to D-117.')).toBeVisible();

  const turns = calls.filter((c) => c.action === 'turn');
  expect(turns.every((t) => t.annotations === true)).toBe(true);
  const results = turns.at(-1).messages.filter((m) => m.role === 'tool');
  expect(results[1].content).toMatch(/^Added a text note on page 1 \(id [^)]+\)\.$/);
  // The note is on page 1 beside D-117's box (x 330..480 on a 612 pt wide
  // page): no room on the right for a 160 pt note, so on the left, top-aligned.
  const listed = JSON.parse(results[2].content);
  const note = listed.find((a) => /Ceiling tile missing/.test(a.text || ''));
  expect(note).toMatchObject({ page: 1, type: 'Textbox', bounds: { x: 330 - 8 - 160, y: 600 } });

  // The change card lists the note, and its Undo takes the note away.
  const card = panel.getByTestId('survey-agent-changes');
  await expect(card).toContainText('Added a text note on page 1.');
  await card.getByRole('button', { name: /Undo/ }).click();
  await expect.poll(() => page.evaluate(async () => {
    const { activeAgentDocument } = await import('/src/agent/webmcp.js');
    return activeAgentDocument().listAnnotations().some((a) => /Ceiling tile missing/.test(a.text || ''));
  })).toBe(false);
});

// Voice markup: "circle D-117", then "cloud this area" (what is on screen).
test('With markup tools on, the agent circles an item and clouds the area on screen, and Undo takes them back', async ({ page }) => {
  const calls = [];
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.flag.annotation-agent', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
  }, { template: TEMPLATE, data });
  await page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    calls.push(body);
    const reply = (json) => route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(json),
    });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: false, over_cap: false });
    const said = [...body.messages].reverse().find((m) => m.role === 'user')?.content || '';
    const tools = body.messages.slice(body.messages.findLastIndex((m) => m.role === 'user')).filter((m) => m.role === 'tool');
    const call = (id, name, args) => reply({ message: { content: '', tool_calls: [
      { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ] } });
    if (/circle/.test(said)) {
      if (tools.length === 0) return call('c1', 'find_items', { query: 'D-117', category_id: null });
      if (tools.length === 1) {
        const id = JSON.parse(tools[0].content).matches[0].id;
        return call('c2', 'mark_on_plan', { shape: 'circle', item_id: id, plan_match_id: null, on_screen: false, color: null });
      }
      return reply({ message: { content: 'Circled D-117.', tool_calls: [] } });
    }
    if (tools.length === 0) return call('k1', 'mark_on_plan', { shape: 'cloud', item_id: null, plan_match_id: null, on_screen: true, color: 'blue' });
    return reply({ message: { content: 'Clouded that area.', tool_calls: [] } });
  });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();
  const shapes = () => page.evaluate(async () => {
    const { activeAgentDocument } = await import('/src/agent/webmcp.js');
    return activeAgentDocument().listAnnotations();
  });

  await input.fill('circle D-117');
  await input.press('Enter');
  await expect(panel.getByText('Circled D-117.')).toBeVisible();
  let results = calls.filter((c) => c.action === 'turn').at(-1).messages.filter((m) => m.role === 'tool');
  expect(results.at(-1).content).toMatch(/^Drew a circle around D-117 on page 1 \(id [^)]+\)\.$/);
  const circleId = results.at(-1).content.match(/\(id ([^)]+)\)/)[1];
  // Around D-117's box (x 330..480, y 600..680 on page 1), holding it.
  const circle = (await shapes()).find((a) => a.id === circleId);
  expect(circle).toBeTruthy();
  expect(circle.page).toBe(1);
  expect(circle.bounds.x).toBeLessThan(330);
  expect(circle.bounds.y).toBeLessThan(600);
  expect(circle.bounds.x + circle.bounds.width).toBeGreaterThan(480);
  expect(circle.bounds.y + circle.bounds.height).toBeGreaterThan(680);

  await input.fill('cloud this area');
  await input.press('Enter');
  await expect(panel.getByText('Clouded that area.')).toBeVisible();
  results = calls.filter((c) => c.action === 'turn').at(-1).messages.filter((m) => m.role === 'tool');
  expect(results.at(-1).content).toMatch(/^Drew a cloud around the area on screen on page 1 \(id [^)]+\)\.$/);
  const cloudId = results.at(-1).content.match(/\(id ([^)]+)\)/)[1];
  const cloud = (await shapes()).find((a) => a.id === cloudId);
  expect(cloud).toBeTruthy();
  console.log('MARKS', JSON.stringify({ circle, cloud }));
  await page.screenshot({ path: 'test-results/voice-markup.png' });

  // Each change card's Undo takes its own mark away.
  const cards = panel.getByTestId('survey-agent-changes');
  await cards.last().getByRole('button', { name: /Undo/ }).click();
  await expect.poll(async () => (await shapes()).some((a) => a.id === cloudId)).toBe(false);
  await cards.first().getByRole('button', { name: /Undo/ }).click();
  await expect.poll(async () => (await shapes()).some((a) => a.id === circleId)).toBe(false);
});

test('Send voice log stores the turn timeline, with no audio or keys', async ({ page }) => {
  const calls = [];
  const logs = [];
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
  }, { template: TEMPLATE, data });
  await mockModel(page, calls);
  await page.route('**/rest/v1/survey_agent_voice_logs*', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    logs.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: '' });
  });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();
  await input.fill('door 117 has no power');
  await input.press('Enter');
  await expect(panel.getByText('D-117: power is N and I added a note.')).toBeVisible();

  // The fixture's "Redactions are not applied" notice sits over the panel's
  // foot. Dismissing it is a tap outside the chat, so open the chat again.
  await page.getByRole('button', { name: 'Dismiss' }).first().click({ timeout: 5_000 }).catch(() => {});
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  await panel.getByRole('button', { name: 'Send voice log' }).click();
  await expect(panel.getByRole('button', { name: 'Voice log sent' })).toBeVisible();
  expect(logs).toHaveLength(1);
  const row = Array.isArray(logs[0]) ? logs[0][0] : logs[0];
  expect(row.reason).toBe('manual');
  const events = row.log.turns.flatMap((t) => t.events);
  const tools = events.filter((e) => e.type === 'model_done').flatMap((e) => e.data.tools.map((t) => t.name));
  expect(tools).toEqual(['find_items', 'set_answers', 'add_note']);
  expect(events.some((e) => e.type === 'turn_done')).toBe(true);
  expect(JSON.stringify(row)).not.toMatch(/apikey|Bearer|audio/i);
});
