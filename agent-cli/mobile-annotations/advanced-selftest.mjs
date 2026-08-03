#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ArtifactRecorder } from './artifacts.mjs';
import { runAdvancedAnnotationSuite, assertAdvancedFinalPersistence } from './advanced.mjs';
import { runRegionAdvancedTransform, runSurveyMarkerAdvancedTransform } from './advanced-entities.mjs';
import { DEFAULT_ROUTE, FIXTURE_NAME, MOBILE_VIEWPORT } from './constants.mjs';
import { addExactStorageCleanup, exactStorageKeys } from './storage.mjs';
import { createTouchDriver } from './touch.mjs';
import { ensureViteServer } from './vite-server.mjs';
import { openRealMobileViewer } from './viewer.mjs';

const requested = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const fixturePath = path.resolve('debug', 'fixtures', FIXTURE_NAME);
const pdfId = `${FIXTURE_NAME}-${fs.statSync(fixturePath).size}`;
const storageKeys = exactStorageKeys(pdfId);
const tools = requested.length ? requested : undefined;
const artifacts = new ArtifactRecorder('.playwright-mcp/mobile-annotations-advanced', {
  browser: 'chromium',
  fixture: FIXTURE_NAME,
  pdfId,
  route: DEFAULT_ROUTE,
  tools: tools || ['all-standard', 'callout'],
  viewport: MOBILE_VIEWPORT,
});

let browser;
let managedProcess;
let page;

try {
  const server = await ensureViteServer(null);
  managedProcess = server.managedProcess;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
    locale: 'en-US',
    screen: MOBILE_VIEWPORT,
    viewport: MOBILE_VIEWPORT,
  });
  await addExactStorageCleanup(context, storageKeys, artifacts.runId);
  page = await context.newPage();
  artifacts.captureBrowserProblems(page);
  await openRealMobileViewer(page, server.baseUrl);
  const touch = await createTouchDriver({ browserName: 'chromium', context, page });
  const entityTools = new Set((tools || []).filter((tool) => tool === 'survey-marker' || tool === 'region'));
  const standardTools = tools?.filter((tool) => !entityTools.has(tool));
  const results = standardTools?.length || !tools
    ? await runAdvancedAnnotationSuite({ page, touch, storageKeys, artifacts, tools: standardTools || undefined })
    : [];
  if (entityTools.has('survey-marker')) {
    results.push(await runSurveyMarkerAdvancedTransform({ page, touch, storageKeys, artifacts }));
  }
  if (entityTools.has('region')) {
    results.push(await runRegionAdvancedTransform({ page, touch, storageKeys, artifacts }));
  }
  await assertAdvancedFinalPersistence(page, storageKeys, results);
  artifacts.setFinal({ input: touch.inputKind, storageKeys, resultCount: results.length });
  artifacts.assertNoBrowserErrors();
  const summary = artifacts.finish('passed');
  console.log(`RESULT: PASS\nartifacts: ${summary}`);
} catch (error) {
  if (page) await artifacts.screenshot(page, 'failure').catch(() => {});
  const summary = artifacts.finish('failed', error);
  console.error(`RESULT: FAIL\n${error?.stack || error}\nartifacts: ${summary}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  managedProcess?.kill('SIGTERM');
}
