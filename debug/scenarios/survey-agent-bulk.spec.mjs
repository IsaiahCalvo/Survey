// "Add all doors on this sheet": the agent reads the category's example item
// (D-101), calls add_all_from_plan for the page on screen, and every other
// door tag on that page becomes an item on its spot. Undo takes them all
// back. The survey-agent edge function is mocked, as in
// survey-agent-chat.spec.mjs; debug/fixtures/make-door-tags.mjs builds the plan.
import { test, expect } from '@playwright/test';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// A tool result the model asked for; the app puts the survey context in
// (tool call id ctx-...) before the first step on its own.
const isToolResult = (m) => m.role === 'tool' && !String(m.tool_call_id).startsWith('ctx-');

const root = resolve(import.meta.dirname, '..', '..');
const PDF_FILE = 'door-tags.pdf';

const TEMPLATE = {
  id: 'agent-template',
  name: 'Door Agent Template',
  modules: [{
    id: 'agent-module',
    name: 'Doors survey',
    categories: [{ id: 'agent-doors', name: 'Doors', color: '#5ba1f0', checklist: [{ id: 'cl-power', text: 'Power at door' }] }],
  }],
};

async function seed() {
  const { size } = await stat(join(root, 'debug', 'fixtures', PDF_FILE));
  return {
    key: `surveyMarkers_${PDF_FILE}-${size}`,
    markers: {
      'surveyMarker-d101': {
        id: 'surveyMarker-d101', pageNumber: 1, bounds: { x: 92, y: 112, width: 44, height: 30 },
        moduleId: 'agent-module', regionId: null, categoryId: 'agent-doors', name: 'D-101', checklistResponses: {}, color: null,
      },
    },
  };
}

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
    const tools = body.messages.filter(isToolResult);
    const call = (id, name, args) => reply({ message: { content: '', tool_calls: [
      { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ] } });
    if (tools.length === 0) return call('b1', 'get_survey_context', {});
    if (tools.length === 1) {
      const doors = JSON.parse(tools[0].content).categories.find((c) => c.name === 'Doors');
      return call('b2', 'add_all_from_plan', { category_id: doors.id, like: doors.example_item, page: null, entity_id: null });
    }
    return reply({ message: { content: 'Added five doors on this sheet.', tool_calls: [] } });
  });
}

const markerNames = (page) => page.evaluate(() => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('surveyMarkers_'));
  return Object.values(key ? JSON.parse(localStorage.getItem(key) || '{}') : {}).map((m) => `${m.name}@${m.pageNumber}`).sort();
});

test('"Add all doors on this sheet" adds every new door tag on the page, and Undo takes them back', async ({ page }) => {
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
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();
  await input.fill('add all doors on this sheet');
  await input.press('Enter');
  await expect(panel.getByText('Added five doors on this sheet.')).toBeVisible();

  const turns = calls.filter((c) => c.action === 'turn');
  const results = turns.at(-1).messages.filter(isToolResult);
  expect(JSON.parse(results[0].content)).toMatchObject({ page_on_screen: 1 });
  expect(results[1].content).toBe('Found 6 tags like D-101 on page 1. Added 5 as Doors: D-102, D-103, D-104, D-105, D-106. 1 was already an item.');
  await expect.poll(() => markerNames(page)).toEqual(['D-101@1', 'D-102@1', 'D-103@1', 'D-104@1', 'D-105@1', 'D-106@1']);

  const card = panel.getByTestId('survey-agent-changes');
  await expect(card).toContainText('Added D-106 (Doors) on page 1');
  await card.getByRole('button', { name: /Undo/ }).click();
  await expect.poll(() => markerNames(page)).toEqual(['D-101@1']);
});

test('"What\'s left on this sheet?" reads the page\'s progress back', async ({ page }) => {
  const calls = [];
  const data = await seed();
  data.markers['surveyMarker-d102'] = {
    ...data.markers['surveyMarker-d101'], id: 'surveyMarker-d102', name: 'D-102', bounds: { x: 252, y: 112, width: 44, height: 30 },
    checklistResponses: { 'cl-power': { selection: 'Y' } },
  };
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
    const reply = (json) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: false, over_cap: false });
    const tools = body.messages.filter(isToolResult);
    if (!tools.length) {
      return reply({ message: { content: '', tool_calls: [
        { id: 's1', type: 'function', function: { name: 'survey_status', arguments: JSON.stringify({ page: null, all_pages: false }) } },
      ] } });
    }
    return reply({ message: { content: 'One of two doors is done. D-101 has not been started.', tool_calls: [] } });
  });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();
  await input.fill("what's left on this sheet");
  await input.press('Enter');
  await expect(panel.getByText('One of two doors is done.')).toBeVisible();

  const result = JSON.parse(calls.filter((c) => c.action === 'turn').at(-1).messages.find(isToolResult).content);
  expect(result).toEqual({
    scope: 'page 1',
    items: 2,
    done: 1,
    not_started: { count: 1, names: ['D-101'] },
    partly_done: { count: 0, items: [] },
  });
  // Read-only: no change card.
  await expect(panel.getByTestId('survey-agent-changes')).toHaveCount(0);
});

test('"Sum up the walk" gives a summary with the items that have issues, and Save summary downloads it', async ({ page }) => {
  const data = await seed();
  data.markers['surveyMarker-d101'].checklistResponses = { 'cl-power': { selection: 'N' } };
  data.markers['surveyMarker-d102'] = {
    ...data.markers['surveyMarker-d101'], id: 'surveyMarker-d102', name: 'D-102', bounds: { x: 252, y: 112, width: 44, height: 30 },
    checklistResponses: { 'cl-power': { selection: 'Y' } },
  };
  data.markers['surveyMarker-d103'] = { ...data.markers['surveyMarker-d101'], id: 'surveyMarker-d103', name: 'D-103', checklistResponses: {} };
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
  }, { template: TEMPLATE, data });
  const calls = [];
  await page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    calls.push(body);
    const reply = (json) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: false, over_cap: false });
    if (!body.messages.some(isToolResult)) {
      return reply({ message: { content: '', tool_calls: [
        { id: 'w1', type: 'function', function: { name: 'walk_summary', arguments: JSON.stringify({ scope: 'walk', page: null }) } },
      ] } });
    }
    return reply({ message: { content: 'Two of three doors done, one with issues: D-101 has no power.', tool_calls: [] } });
  });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();
  await input.fill("that's it for today, sum up the walk");
  await input.press('Enter');
  await expect(panel.getByText('Two of three doors done, one with issues')).toBeVisible();

  // Nothing was worked on in this chat, so it covers the whole survey.
  const result = JSON.parse(calls.filter((c) => c.action === 'turn').at(-1).messages.find(isToolResult).content);
  expect(result).toMatchObject({
    scope: 'the whole survey',
    totals: { items: 3, done: 2, partly: 0, notStarted: 1, withIssues: 1 },
    categories: [{ name: 'Doors', with_issues: [{ name: 'D-101', issues: ['Power at door = N'] }] }],
  });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'Save summary' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Door Agent Template- summary of the whole survey.txt');
  const text = await (await import('node:fs/promises')).readFile(await download.path(), 'utf8');
  expect(text).toContain('3 items: 2 done, 0 partly done, 1 not started, 1 with issues.');
  expect(text).toContain('  D-101: Power at door = N');
});
