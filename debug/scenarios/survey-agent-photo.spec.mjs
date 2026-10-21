// Photos by voice: "take a photo for D-117" makes the agent call take_photo,
// the panel opens a live camera (Chromium's fake camera here), the person
// takes the shot, and the photo goes to that item's upload path. The
// survey-agent edge function is mocked, as in survey-agent-chat.spec.mjs.
import { test, expect } from '@playwright/test';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const PDF_FILE = 'print-fidelity.pdf';
const CHROMIUM = process.env.PW_CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

test.use({
  launchOptions: {
    ...(CHROMIUM ? { executablePath: CHROMIUM } : {}),
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--mute-audio'],
  },
  permissions: ['camera'],
});

const TEMPLATE = {
  id: 'agent-template',
  name: 'Door Agent Template',
  modules: [{
    id: 'agent-module',
    name: 'Doors survey',
    categories: [{ id: 'agent-doors', name: 'Doors', color: '#5ba1f0', checklist: [{ id: 'cl-power', text: 'Power at door' }] }],
  }],
};
const MARKER_ID = 'surveyMarker-agent-d117';

async function seed() {
  const { size } = await stat(join(root, 'debug', 'fixtures', PDF_FILE));
  return {
    key: `surveyMarkers_${PDF_FILE}-${size}`,
    markers: {
      [MARKER_ID]: {
        id: MARKER_ID, pageNumber: 1, bounds: { x: 330, y: 600, width: 150, height: 80 },
        moduleId: 'agent-module', regionId: null, categoryId: 'agent-doors', name: 'D-117', checklistResponses: {}, color: null,
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
    const tools = body.messages.filter((m) => m.role === 'tool');
    const call = (id, name, args) => reply({ message: { content: '', tool_calls: [
      { id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ] } });
    if (tools.length === 0) return call('p1', 'find_items', { query: 'D-117' });
    if (tools.length === 1) return call('p2', 'take_photo', { item_id: JSON.parse(tools[0].content).matches[0].id });
    return reply({ message: { content: 'Done with the photo.', tool_calls: [] } });
  });
}

async function openAgent(page) {
  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  // The fixture's "Redactions are not applied" notice sits where the camera opens.
  const notice = page.getByText('Redactions are not applied');
  if (await notice.isVisible().catch(() => false)) {
    await notice.locator('xpath=../..').getByRole('button', { name: 'Dismiss' }).click();
  }
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Door Agent Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  const input = panel.getByRole('textbox', { name: 'Message the Survey agent' });
  await expect(input).toBeEnabled();
  await input.fill('take a photo for D-117');
  await input.press('Enter');
  return panel;
}

async function setup(page, calls) {
  const data = await seed();
  await page.addInitScript(({ template, data: d }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.agent.speak', '0');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(d.key, JSON.stringify(d.markers));
  }, { template: TEMPLATE, data });
  await mockModel(page, calls);
}

const photoResult = (calls) => {
  const last = calls.filter((c) => c.action === 'turn').at(-1);
  return last.messages.filter((m) => m.role === 'tool').at(-1).content;
};

test('"Take a photo for D-117" opens the camera and sends the shot to D-117', async ({ page }) => {
  const calls = [];
  await setup(page, calls);
  const panel = await openAgent(page);

  const camera = panel.getByRole('group', { name: 'Camera for D-117' });
  await expect(camera).toBeVisible();
  // The fake camera is live: the preview has frames.
  await expect.poll(() => camera.locator('video').evaluate((v) => v.videoWidth)).toBeGreaterThan(0);
  await camera.getByRole('button', { name: 'Take photo' }).click();

  await expect(panel.getByText('Done with the photo.')).toBeVisible();
  await expect(camera).toHaveCount(0);
  // The photo reached D-117's upload path: attached when the document is in
  // an account, or the upload's own "save it first" answer when it is local.
  expect(photoResult(calls)).toMatch(/Attached 1 photo to D-117|Save this document/);
});

test('Cancel closes the camera and tells the agent no photo was taken', async ({ page }) => {
  const calls = [];
  await setup(page, calls);
  const panel = await openAgent(page);

  const camera = panel.getByRole('group', { name: 'Camera for D-117' });
  await expect(camera).toBeVisible();
  await camera.getByRole('button', { name: 'Cancel' }).click();

  await expect(panel.getByText('Done with the photo.')).toBeVisible();
  expect(photoResult(calls)).toMatch(/closed the camera without taking a photo for D-117/);
});
