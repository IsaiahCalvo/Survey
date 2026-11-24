// The on-device voice (Nightly flag survey-agent-device-voice), driven
// through the UI with the survey-agent edge function mocked. Proves the
// choice button shows and the first pick downloads and starts the Pocket TTS
// voice in the real app (busy ring, then ready).
//
// Downloads ~146 MB from Hugging Face on a fresh browser profile.
import { test, expect } from '@playwright/test';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const PDF_FILE = 'print-fidelity.pdf';
const TEMPLATE = {
  id: 'voice-template',
  name: 'Voice Template',
  modules: [{ id: 'voice-module', name: 'Doors survey', categories: [{ id: 'voice-doors', name: 'Doors', color: '#5ba1f0', checklist: [{ id: 'cl-power', text: 'Power at door' }] }] }],
};

test('the on-device voice can be chosen in the agent and gets ready', async ({ page }) => {
  test.setTimeout(300_000);
  const calls = [];
  const { size } = await stat(join(root, 'debug', 'fixtures', PDF_FILE));
  await page.addInitScript(({ template, key }) => {
    localStorage.setItem('SURVEY_AGENT_BETA', '1');
    localStorage.setItem('survey.flag.survey-agent-device-voice', '1');
    localStorage.setItem('mobileWorkflowTemplates', JSON.stringify([template]));
    localStorage.setItem(key, '{}');
  }, { template: TEMPLATE, key: `surveyMarkers_${PDF_FILE}-${size}` });
  await page.route('**/functions/v1/survey-agent', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } });
      return;
    }
    const body = route.request().postDataJSON();
    calls.push(body.action);
    const reply = (json) => route.fulfill({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' }, body: JSON.stringify(json) });
    if (body.action === 'status') return reply({ enabled: true, reason: null, transcription: false, speech: true, over_cap: false });
    if (body.action === 'speak') return reply({ error: 'speech_unavailable' });
    return reply({ message: { content: 'Marked reader 1409 on page 8.', tool_calls: [] } });
  });

  await page.goto(`/?testPdf=${encodeURIComponent(PDF_FILE)}&surveyTemplateWorkflowE2E=1`);
  await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
  await page.getByRole('button', { name: 'Survey', exact: true }).click();
  await page.getByRole('button', { name: /Voice Template/ }).click();
  await page.getByRole('button', { name: 'Open Survey agent chat' }).click();
  const panel = page.getByRole('region', { name: 'Survey agent' });
  await page.getByRole('button', { name: 'Dismiss' }).first().click({ timeout: 5_000 }).catch(() => {});
  if (!(await panel.isVisible())) await page.getByRole('button', { name: 'Open Survey agent chat' }).click();

  const choice = panel.getByRole('button', { name: 'Cloud voice' });
  await expect(choice).toBeVisible();
  await choice.click();
  const device = panel.getByRole('button', { name: 'Voice on this device' });
  await expect(device).toHaveAttribute('aria-busy', 'true');
  await panel.screenshot({ path: 'debug/out/device-voice-loading.png' });
  await expect(device).toHaveAttribute('data-voice-state', 'ready', { timeout: 240_000 });
  await expect(device).toHaveAttribute('aria-busy', 'false');
  await panel.screenshot({ path: 'debug/out/device-voice-ready.png' });

  // Signed out, the AI notice can't be accepted, so the walk stops here;
  // tests/agentDeviceVoice.test.mjs proves a ready voice speaks replies
  // without the server.
  expect(calls).not.toContain('speak');
});
