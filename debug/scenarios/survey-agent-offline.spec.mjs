// Survey agent with no signal (Nightly flag survey-agent-offline): a message
// the plain rules can read is done on the device at once, with its change
// card and Undo; one they can't read waits for the signal as before.
//
// Needs VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY set to any value (a fake
// one is fine) so the app has a functions client.
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

async function readMarker(page) {
  return page.evaluate((id) => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('surveyMarkers_'));
    return key ? JSON.parse(localStorage.getItem(key) || '{}')[id] : null;
  }, MARKER_ID);
}

test('with no signal, the agent answers on the device and a free sentence waits', async ({ page, context }) => {
  const turns = [];
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.flag.survey-agent-offline', '1');
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
    if (body.action === 'turn') turns.push(body);
    await route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify(body.action === 'status'
        ? { enabled: true, reason: null, transcription: false, over_cap: false }
        : { message: { content: 'OK.', tool_calls: [] } }),
    });
  });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();

  await context.setOffline(true);
  await input.fill('D one seventeen power at door no, card reader yes');
  await input.press('Enter');

  await expect(panel.getByTestId('survey-agent-offline-done')).toBeVisible();
  const card = panel.getByTestId('survey-agent-changes');
  await expect(card).toContainText('Power at door = N');
  await expect(card).toContainText('Card reader = Y');
  await expect.poll(async () => (await readMarker(page))?.checklistResponses?.['cl-power']?.selection).toBe('N');
  await expect.poll(async () => (await readMarker(page))?.checklistResponses?.['cl-reader']?.selection).toBe('Y');
  expect(turns).toHaveLength(0);

  await card.getByRole('button', { name: /Undo/ }).click();
  await expect.poll(async () => (await readMarker(page))?.checklistResponses?.['cl-power']?.selection || null).toBe(null);

  // Described, not named: "door 117" is D-117 in the Doors category.
  await input.fill('door 117, card reader no');
  await input.press('Enter');
  await expect.poll(async () => (await readMarker(page))?.checklistResponses?.['cl-reader']?.selection).toBe('N');
  expect(turns).toHaveLength(0);

  // A sentence the rules can't read waits for the signal.
  await input.fill('the reader by the stairs looks loose');
  await input.press('Enter');
  await expect(panel.getByText('Waiting for signal')).toBeVisible();
  expect(turns).toHaveLength(0);

  await context.setOffline(false);
  await expect.poll(() => turns.length, { timeout: 30_000 }).toBeGreaterThan(0);
});
