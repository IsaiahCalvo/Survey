#!/usr/bin/env node

import path from 'node:path';
import { chromium } from 'playwright';
import { ArtifactRecorder } from '../mobile-annotations/artifacts.mjs';
import { createTouchDriver } from '../mobile-annotations/touch.mjs';
import { ensureViteServer } from '../mobile-annotations/vite-server.mjs';
import { MOBILE_VIEWPORT } from '../mobile-annotations/constants.mjs';
import {
  runSurveyTemplateWorkflow,
  TEMPLATE_WORKFLOW_ROUTE,
  TEMPLATE_WORKFLOW_STORAGE_KEY,
} from './survey-template.mjs';
import { runDesktopSurveyTemplateWorkflow } from './survey-template-desktop.mjs';

const baseUrlArg = process.argv.find((arg) => arg.startsWith('--base-url='))?.split('=')[1] || null;
const headful = process.argv.includes('--headful');
const deviceArg = process.argv.find((arg) => arg.startsWith('--device='))?.split('=')[1] || 'all';
if (!['mobile', 'desktop', 'all'].includes(deviceArg)) throw new Error('--device must be mobile, desktop, or all');
const artifacts = new ArtifactRecorder(path.resolve('.playwright-mcp', 'mobile-workflows'), {
  workflow: 'survey-template',
  route: TEMPLATE_WORKFLOW_ROUTE,
  viewport: MOBILE_VIEWPORT,
});

let browser;
let managedProcess;
let page;

async function runDevice(server, device) {
  const profile = device === 'mobile'
    ? { viewport: MOBILE_VIEWPORT, screen: MOBILE_VIEWPORT, deviceScaleFactor: 3, hasTouch: true, isMobile: true }
    : { viewport: { width: 1400, height: 900 }, screen: { width: 1400, height: 900 }, deviceScaleFactor: 1, hasTouch: false, isMobile: false };
  const context = await browser.newContext({ ...profile, locale: 'en-US' });
  await context.addInitScript((key) => {
    const sentinel = '__mobileWorkflowTemplatesInitialized';
    if (!sessionStorage.getItem(sentinel)) {
      localStorage.setItem(key, '[]');
      localStorage.removeItem('surveyHub.templateOrder:isaiahcalvo123@gmail.com');
      sessionStorage.setItem(sentinel, '1');
    }
  }, TEMPLATE_WORKFLOW_STORAGE_KEY);
  await context.route('**/api/analytics/track', async (route) => {
    await route.fulfill({
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: '',
    });
  });
  const devicePage = await context.newPage();
  page = devicePage;
  artifacts.captureBrowserProblems(devicePage);
  try {
    if (device === 'desktop') {
      return await artifacts.time('survey-template:desktop', () => runDesktopSurveyTemplateWorkflow({
        page: devicePage, baseUrl: server.baseUrl, artifacts,
      }));
    }
    const touch = await createTouchDriver({ browserName: 'chromium', context, page: devicePage });
    return await artifacts.time('survey-template:mobile', () => runSurveyTemplateWorkflow({
      page: devicePage, touch, baseUrl: server.baseUrl, artifacts,
    }));
  } catch (error) {
    await artifacts.screenshot(devicePage, `${device}-failure`).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

try {
  const server = await ensureViteServer(baseUrlArg);
  managedProcess = server.managedProcess;
  browser = await chromium.launch({ headless: !headful });
  const devices = deviceArg === 'all' ? ['mobile', 'desktop'] : [deviceArg];
  const results = [];
  for (const device of devices) results.push(await runDevice(server, device));
  artifacts.setFinal({ devices, results });
  artifacts.assertNoBrowserErrors();
  const summary = artifacts.finish('passed');
  console.log('RESULT: PASS');
  console.log(`duration: ${artifacts.durationMs()}ms`);
  console.log(`artifacts: ${summary}`);
} catch (error) {
  if (page) await artifacts.screenshot(page, 'failure').catch(() => {});
  const summary = artifacts.finish('failed', error);
  console.error('RESULT: FAIL');
  console.error(error?.stack || error);
  console.error(`artifacts: ${summary}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  managedProcess?.kill('SIGTERM');
}
