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
function mockModel(page, calls) {
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

  await page.getByRole('button', { name: 'Survey agent: talk or type to fill items' }).click();
  const panel = page.getByRole('dialog', { name: 'Survey agent' });
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
  await page.getByRole('button', { name: 'Survey agent: talk or type to fill items' }).click();
  const panel = page.getByRole('dialog', { name: 'Survey agent' });
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
