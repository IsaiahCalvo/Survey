#!/usr/bin/env node

import fs from 'node:fs';
import { chromium } from 'playwright';
import { ArtifactRecorder } from './artifacts.mjs';
import { FIXTURE_NAME, MOBILE_VIEWPORT } from './constants.mjs';
import { addExactStorageCleanup, exactStorageKeys } from './storage.mjs';
import { createTouchDriver } from './touch.mjs';
import { ensureViteServer } from './vite-server.mjs';
import { openRealMobileViewer } from './viewer.mjs';
import {
  runRegionLifecycle,
  runSpaceLifecycle,
  runSurveyMarkerLifecycle,
} from './survey-region.mjs';

const requested = new Set(process.argv.slice(2).filter((arg) => !arg.startsWith('--')));
const allowKeyboardDelete = process.argv.includes('--allow-keyboard-delete');
const tools = requested.size ? requested : new Set(['survey-marker', 'space', 'region']);
const fixturePath = new URL(`../../debug/fixtures/${FIXTURE_NAME}`, import.meta.url);
const pdfId = `${FIXTURE_NAME}-${fs.statSync(fixturePath).size}`;
const storageKeys = exactStorageKeys(pdfId);
const server = await ensureViteServer(process.env.MOBILE_QA_BASE_URL || null);
const artifacts = new ArtifactRecorder('.playwright-mcp/mobile-annotations', {
  tools: [...tools],
  viewport: MOBILE_VIEWPORT,
  input: 'trusted-cdp-touch',
  focused: 'survey-region',
});

let browser;
try {
  browser = await chromium.launch({ headless: process.env.HEADFUL !== '1' });
  const context = await browser.newContext({
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    locale: 'en-US',
    screen: MOBILE_VIEWPORT,
    viewport: MOBILE_VIEWPORT,
  });
  await addExactStorageCleanup(context, storageKeys, artifacts.runId);
  const page = await context.newPage();
  artifacts.captureBrowserProblems(page);
  await openRealMobileViewer(page, server.baseUrl);
  const touch = await createTouchDriver({ browserName: 'chromium', context, page });

  if (tools.has('survey-marker')) {
    await runSurveyMarkerLifecycle({
      page,
      touch,
      storageKeys,
      artifacts,
      allowKeyboardDelete,
    });
  }
  let space = null;
  if (tools.has('space') || tools.has('region')) {
    space = await runSpaceLifecycle({ page, touch, storageKeys, artifacts });
    console.log(`SPACE PASS ${space.id}`);
  }
  if (tools.has('region')) {
    await runRegionLifecycle({ page, touch, storageKeys, spaceId: space.id, artifacts });
  }
  artifacts.assertNoBrowserErrors();
  console.log(`RESULT PASS ${artifacts.finish('passed')}`);
} catch (error) {
  console.error(error?.stack || error);
  console.error(`RESULT FAIL ${artifacts.finish('failed', error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  server.managedProcess?.kill('SIGTERM');
}
