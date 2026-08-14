#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { ArtifactRecorder } from './mobile-annotations/artifacts.mjs';
import { parseCli, printHelp } from './mobile-annotations/cli.mjs';
import {
  DEFAULT_ROUTE,
  FIXTURE_NAME,
  MOBILE_VIEWPORT,
  TOOL_MATRIX,
} from './mobile-annotations/constants.mjs';
import {
  addExactStorageCleanup,
  annotationGeometry,
  exactStorageKeys,
  findPersistedAnnotation,
  findPersistedCallout,
  persistedSnapshot,
  waitForPersistedAnnotation,
  waitForPersistedCallout,
} from './mobile-annotations/storage.mjs';
import { createTouchDriver } from './mobile-annotations/touch.mjs';
import { ensureViteServer } from './mobile-annotations/vite-server.mjs';
import { runEraserLifecycle } from './mobile-annotations/eraser.mjs';
import { runObjectLifecycle } from './mobile-annotations/lifecycle.mjs';
import { surveyRegionScenarioRegistry } from './mobile-annotations/survey-region.mjs';
import {
  createAnnotation,
  mountedAnnotation,
  openRealMobileViewer,
  waitForMountedAnnotation,
  waitForMountedCallout,
} from './mobile-annotations/viewer.mjs';

const options = parseCli(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (options.listTools) {
  for (const row of TOOL_MATRIX) {
    console.log(`${row.id}\t${row.implemented ? 'ready' : 'planned'}\t${row.label}`);
  }
  process.exit(0);
}

const fixturePath = path.resolve('debug', 'fixtures', FIXTURE_NAME);
if (!fs.existsSync(fixturePath)) {
  throw new Error(`Missing stable fixture: ${fixturePath}`);
}

const pdfId = `${FIXTURE_NAME}-${fs.statSync(fixturePath).size}`;
const storageKeys = exactStorageKeys(pdfId);
const artifacts = new ArtifactRecorder(options.outputDir, {
  browser: options.browser,
  fixture: FIXTURE_NAME,
  pdfId,
  route: DEFAULT_ROUTE,
  tools: options.tools,
  viewport: MOBILE_VIEWPORT,
});

let browser;
let managedServer;
let page;

const surveyRegionScenarios = surveyRegionScenarioRegistry();

async function runTool(toolId, touch, context, sharedState) {
  if (toolId === 'eraser') {
    await runEraserLifecycle({ artifacts, context, page, storageKeys, touch });
    return;
  }

  if (surveyRegionScenarios.has(toolId)) {
    if (toolId === 'region' && !sharedState.spaceId) {
      const prerequisite = await surveyRegionScenarios.get('space')({
        artifacts,
        page,
        storageKeys,
        touch,
      });
      sharedState.spaceId = prerequisite.id;
    }
    const result = await surveyRegionScenarios.get(toolId)({
      artifacts,
      page,
      spaceId: sharedState.spaceId,
      storageKeys,
      touch,
    });
    if (toolId === 'space') sharedState.spaceId = result.id;
    return;
  }

  const beforeIds = new Set(await page.locator('g[data-anno-id]').evaluateAll((groups) => (
    groups.map((group) => group.getAttribute('data-anno-id')).filter(Boolean)
  )));

  const created = await artifacts.time(`${toolId}:create`, async () => (
    createAnnotation(page, touch, toolId, beforeIds)
  ));
  if (!created?.id) throw new Error(`${toolId}: create did not return a stable annotation id`);

  if (created.kind === 'callout') {
    await waitForMountedCallout(page, created.id);
    const persisted = await waitForPersistedCallout(page, storageKeys.callouts, created.id);
    if (!persisted.text?.includes('Mobile callout lifecycle')) {
      throw new Error(`${toolId}: callout text did not persist`);
    }
    const result = await runObjectLifecycle({ artifacts, created, page, storageKeys, toolId, touch });
    artifacts.recordScenario({
      id: created.id,
      input: touch.inputKind,
      geometry: result.geometry,
      lifecycle: 'create-edit-move-undo-redo-delete-undo-delete-reload',
      persistedType: 'callout',
      status: 'passed',
      storeKind: 'callout',
      tool: toolId,
    });
    return;
  }

  const mountedBeforeReload = await waitForMountedAnnotation(page, created.id);
  const mountedGeometry = annotationGeometry(mountedBeforeReload);
  if (Object.keys(mountedGeometry).length === 0) {
    throw new Error(`${toolId}: mounted annotation ${created.id} has no serializable geometry`);
  }

  const persistedBeforeReload = await waitForPersistedAnnotation(page, storageKeys.annotations, created.id);
  const persistedGeometry = annotationGeometry(persistedBeforeReload);
  if (JSON.stringify(persistedGeometry) !== JSON.stringify(mountedGeometry)) {
    throw new Error(`${toolId}: persisted geometry differs from mounted state before reload`);
  }

  await artifacts.screenshot(page, `${toolId}-created`);
  const result = await runObjectLifecycle({ artifacts, created, page, storageKeys, toolId, touch });
  if (!await mountedAnnotation(page, created.id)) throw new Error(`${toolId}: final id is not mounted`);
  artifacts.recordScenario({
    id: created.id,
    input: touch.inputKind,
    geometry: result.geometry,
    lifecycle: 'create-edit-move-undo-redo-delete-undo-delete-reload',
    persistedType: result.object.type,
    status: 'passed',
    storeKind: 'annotation',
    tool: toolId,
  });
}

async function run() {
  const server = await ensureViteServer(options.baseUrl);
  managedServer = server.managedProcess;
  const baseUrl = server.baseUrl;
  const browserType = options.browser === 'webkit' ? webkit : chromium;

  browser = await browserType.launch({ headless: !options.headful });
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

  const viewerOpenStartedAt = Date.now();
  await artifacts.time('viewer:open', async () => {
    await openRealMobileViewer(page, baseUrl);
  });
  const viewerReadyMs = Date.now() - viewerOpenStartedAt;
  if (viewerReadyMs > options.viewerReadyBudgetMs) {
    throw new Error(
      `viewer:first-page-ready exceeded ${options.viewerReadyBudgetMs}ms budget (${viewerReadyMs}ms)`,
    );
  }
  artifacts.recordScenario({
    budgetMs: options.viewerReadyBudgetMs,
    durationMs: viewerReadyMs,
    lifecycle: 'navigate-domcontentloaded-first-page-painted-annotation-layer-ready',
    status: 'passed',
    storeKind: 'diagnostic',
    tool: 'viewer-first-page-ready',
  });

  const touch = await createTouchDriver({
    browserName: options.browser,
    context,
    page,
  });

  const sharedState = { spaceId: null };
  const orderedTools = [...options.tools].sort((left, right) => {
    if (left === 'space' && right === 'region') return -1;
    if (left === 'region' && right === 'space') return 1;
    return 0;
  });
  for (const toolId of orderedTools) {
    await runTool(toolId, touch, context, sharedState);
  }

  const finalStorage = await persistedSnapshot(page, storageKeys);
  for (const scenario of artifacts.scenarios) {
    if (scenario.storeKind === 'diagnostic') continue;
    if (['survey-marker', 'space', 'region'].includes(scenario.tool)) continue;
    const exists = scenario.storeKind === 'callout'
      ? findPersistedCallout(finalStorage.callouts, scenario.id)
      : findPersistedAnnotation(finalStorage.annotations, scenario.id);
    if (scenario.expectedPresent === false ? exists : !exists) {
      throw new Error(`${scenario.tool}: ${scenario.id} missing from final exact-key snapshot`);
    }
  }

  artifacts.setFinal({
    baseUrl,
    input: touch.inputKind,
    storageKeys,
    storedAnnotationCount: finalStorage.annotationObjects.length,
    viewerReadyBudgetMs: options.viewerReadyBudgetMs,
    viewerReadyMs,
  });
  artifacts.assertNoBrowserErrors();
}

try {
  await run();
  const summaryPath = artifacts.finish('passed');
  console.log('RESULT: PASS');
  console.log(`tools: ${options.tools.join(', ')}`);
  console.log(`duration: ${artifacts.durationMs()}ms`);
  console.log(`artifacts: ${summaryPath}`);
} catch (error) {
  if (page) await artifacts.screenshot(page, 'failure').catch(() => {});
  const summaryPath = artifacts.finish('failed', error);
  console.error('RESULT: FAIL');
  console.error(error?.stack || error);
  console.error(`artifacts: ${summaryPath}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  managedServer?.kill('SIGTERM');
}
