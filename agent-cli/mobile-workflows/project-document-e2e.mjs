#!/usr/bin/env node

// DEV-ROUTE / MOCK-ONLY. This harness only navigates `?hubPreview=1`; it never
// loads credentials, installs an auth session, or calls the real backend.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { ArtifactRecorder } from '../mobile-annotations/artifacts.mjs';
import { createTouchDriver } from '../mobile-annotations/touch.mjs';
import { ensureViteServer } from '../mobile-annotations/vite-server.mjs';
import {
  WORKFLOW_STORAGE_KEYS,
  WORKFLOW_VIEWPORTS,
  readWorkflowModel,
  restoreWorkflowModel,
  waitForWorkflowModel,
  workflowRoute,
} from './project-document-model.mjs';
import {
  activate,
  chooseFilesFromButton,
  openDocumentMenu,
  openProject,
} from './project-document-ui.mjs';

function parseOptions(argv) {
  const options = {
    baseUrl: process.env.MOBILE_QA_BASE_URL || null,
    device: 'all',
    headful: process.env.HEADFUL === '1',
    outputDir: path.resolve('.playwright-mcp', 'mobile-project-documents'),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = (name) => {
      const inline = arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : null;
      if (inline !== null) return inline;
      index += 1;
      if (index >= argv.length) throw new Error(`${name} requires a value`);
      return argv[index];
    };
    if (arg === '--device' || arg.startsWith('--device=')) options.device = take('--device');
    else if (arg === '--base-url' || arg.startsWith('--base-url=')) options.baseUrl = take('--base-url');
    else if (arg === '--output-dir' || arg.startsWith('--output-dir=')) options.outputDir = path.resolve(take('--output-dir'));
    else if (arg === '--headful') options.headful = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!['mobile', 'desktop', 'all'].includes(options.device)) {
    throw new Error('--device must be mobile, desktop, or all');
  }
  return options;
}

function printHelp() {
  console.log(`Usage: node agent-cli/mobile-workflows/project-document-e2e.mjs [options]

Options:
  --device mobile|desktop|all  Device contract to run (default: all)
  --base-url <url>             Reuse an existing Survey Vite server
  --output-dir <path>          Screenshots, timings, and summary JSON
  --headful                    Show Chromium
  --help                       Show help`);
}

const options = parseOptions(process.argv.slice(2));
if (options.help) {
  printHelp();
  process.exit(0);
}

const primaryFixture = path.resolve('debug/fixtures/clickable-link-test.pdf');
const secondaryFixture = path.resolve('debug/fixtures/kal412-mixed-import-e2e.pdf');
for (const fixture of [primaryFixture, secondaryFixture]) {
  if (!fs.existsSync(fixture)) throw new Error(`Missing PDF fixture: ${fixture}`);
}

const devices = options.device === 'all' ? ['mobile', 'desktop'] : [options.device];
const artifacts = new ArtifactRecorder(options.outputDir, {
  devices,
  route: workflowRoute('projects'),
  storageKeys: WORKFLOW_STORAGE_KEYS,
  viewports: WORKFLOW_VIEWPORTS,
});

let browser;
let managedServer;

async function runDevice(device, baseUrl) {
  const viewport = WORKFLOW_VIEWPORTS[device];
  const context = await browser.newContext({
    deviceScaleFactor: device === 'mobile' ? 3 : 1,
    hasTouch: device === 'mobile',
    isMobile: device === 'mobile',
    locale: 'en-US',
    screen: viewport,
    viewport,
  });
  const cleanupGate = `mobile-project-document-clean-${artifacts.runId}-${device}`;
  await context.addInitScript(({ gate, keys }) => {
    try {
      if (sessionStorage.getItem(gate)) return;
      Object.values(keys).forEach((key) => localStorage.removeItem(key));
      localStorage.removeItem('survey-hub-tab');
      sessionStorage.setItem(gate, '1');
    } catch { /* about:blank and opaque frames have no storage */ }
  }, { gate: cleanupGate, keys: WORKFLOW_STORAGE_KEYS });
  await context.route('**/api/analytics/track', (route) => route.fulfill({
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: '',
  }));

  const page = await context.newPage();
  artifacts.captureBrowserProblems(page);
  const touch = device === 'mobile'
    ? await createTouchDriver({ browserName: 'chromium', context, page })
    : null;
  const projectName = `E2E ${device} project ${process.pid}`;
  const emptyProjectName = `E2E ${device} empty ${process.pid}`;
  const renamedProject = `${projectName} renamed`;
  const renamedDocument = `e2e-${device}-renamed.pdf`;
  let initialModel;

  const selectVisibleButton = (name) => page.getByRole('button', { name, exact: true }).filter({ visible: true }).first();
  const waitForPreferences = async (predicate, argument) => {
    await page.waitForFunction(({ key, source, value }) => {
      const preferences = JSON.parse(localStorage.getItem(key) || '{}');
      return Function('preferences', 'value', `return (${source})(preferences, value);`)(preferences, value);
    }, {
      key: WORKFLOW_STORAGE_KEYS.projectPreferences,
      source: String(predicate),
      value: argument,
    }, { timeout: 10_000 });
    return (await readWorkflowModel(page)).projectPreferences;
  };
  const dragRowTo = async (fromRow, toRow, label) => {
    const handle = fromRow.locator('[data-drag-rearrange-handle]');
    const fromBox = await handle.boundingBox();
    const toBox = await toRow.boundingBox();
    assert.ok(fromBox && toBox, `${device}: ${label} drag bounds`);
    const start = { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 };
    const end = { x: start.x, y: toBox.y + toBox.height / 2 };
    if (device === 'mobile') await touch.drag(start, end, { steps: 16 });
    else {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 16 });
      await page.mouse.up();
    }
  };

  try {
    await artifacts.time(`${device}:open-hub`, async () => {
      await page.goto(`${baseUrl}${workflowRoute('projects')}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
      await waitForWorkflowModel(page, '(model) => model.projects.length === 3 && model.documents.length === 6', null, 30_000);
    });
    initialModel = await readWorkflowModel(page);

    await artifacts.time(`${device}:project-duplicate-reload`, async () => {
      await activate(page.locator('[data-testid="project-select-toggle"]:visible'), touch, device);
      await activate(page.locator('[data-project-id="p1"]:visible').first(), touch, device);
      await activate(selectVisibleButton('Duplicate'), touch, device);
      let duplicated = await waitForWorkflowModel(
        page,
        '(state) => state.projects.some((project) => project.name === "Tower 5 — Security (copy)")',
        null,
      );
      const projectCopy = duplicated.projects.find((project) => project.name === 'Tower 5 — Security (copy)');
      assert.ok(projectCopy?.id?.startsWith('workflow-project-copy-'), `${device}: duplicated project stable id`);
      assert.equal(
        duplicated.documents.filter((document) => document.project_id === projectCopy.id).length,
        initialModel.documents.filter((document) => document.project_id === 'p1').length,
        `${device}: duplicated project clones its documents`,
      );
      await page.reload({ waitUntil: 'domcontentloaded' });
      duplicated = await readWorkflowModel(page);
      assert.ok(duplicated.projects.some((project) => project.id === projectCopy.id), `${device}: duplicated project survives reload`);
      assert.ok(duplicated.documents.some((document) => document.project_id === projectCopy.id), `${device}: duplicated project documents survive reload`);
      await restoreWorkflowModel(page, initialModel);
      await page.reload({ waitUntil: 'domcontentloaded' });
    });

    await artifacts.time(`${device}:project-pin-reorder-reload`, async () => {
      const projectTwo = page.locator('[data-project-id="p2"]:visible').first();
      await activate(projectTwo.getByTitle('More'), touch, device);
      await activate(page.getByRole('menuitem', { name: 'Pin project', exact: true }), touch, device);
      await waitForPreferences((preferences) => preferences.pinnedIds?.includes('p2'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(
        await page.locator('[data-project-id]:visible').first().getAttribute('data-project-id'),
        'p2',
        `${device}: pinned project remains first after reload`,
      );
      const pinned = page.locator('[data-project-id="p2"]:visible').first();
      assert.equal(await pinned.getByTitle('Pinned').count(), 1, `${device}: pinned marker survives reload`);
      await activate(pinned.getByTitle('More'), touch, device);
      await activate(page.getByRole('menuitem', { name: 'Unpin project', exact: true }), touch, device);
      await waitForPreferences((preferences) => !preferences.pinnedIds?.includes('p2'));

      const from = page.locator('[data-project-id="p3"]:visible').first();
      const to = page.locator('[data-project-id="p1"]:visible').first();
      await dragRowTo(from, to, 'project reorder');
      await waitForPreferences((preferences) => preferences.projectOrder?.[0] === 'p3');
      await page.reload({ waitUntil: 'domcontentloaded' });
      assert.equal(
        await page.locator('[data-project-id]:visible').first().getAttribute('data-project-id'),
        'p3',
        `${device}: project touch reorder survives reload`,
      );
      await restoreWorkflowModel(page, initialModel);
      await page.reload({ waitUntil: 'domcontentloaded' });
    });

    await artifacts.time(`${device}:document-duplicate-copy-paste-move-reorder-reload`, async () => {
      await openProject(page, touch, device, 'p1');
      const fileSelectScope = device === 'mobile'
        ? page.locator('.projects-mobile-select-row:visible')
        : page.locator('.projects-desktop-layout > .card').nth(1);

      await activate(fileSelectScope.getByRole('button', { name: 'Select', exact: true }), touch, device);
      await activate(page.locator('[data-document-id="d1"]:visible').first(), touch, device);
      await activate(fileSelectScope.getByRole('button', { name: 'Duplicate', exact: true }), touch, device);
      let persisted = await waitForWorkflowModel(
        page,
        '(state) => state.documents.filter((document) => document.project_id === "p1" && document.name === "SE-011 Security Shop Drawings-copy.pdf").length === 1',
        null,
      );
      const bulkCopy = persisted.documents.find((document) => document.project_id === 'p1'
        && document.name === 'SE-011 Security Shop Drawings-copy.pdf');
      assert.ok(bulkCopy?.id?.startsWith('d-copy-'), `${device}: duplicated document stable id`);
      await activate(fileSelectScope.getByRole('button', { name: 'Done', exact: true }), touch, device);

      const originalRow = page.locator('[data-document-id="d1"]:visible').first();
      await activate(originalRow.getByTitle('More'), touch, device);
      await activate(page.getByRole('menuitem', { name: 'Copy', exact: true }), touch, device);
      await activate(originalRow.getByTitle('More'), touch, device);
      const paste = page.getByRole('menuitem', { name: 'Paste', exact: true });
      assert.equal(await paste.isEnabled(), true, `${device}: Paste enables after Copy`);
      await activate(paste, touch, device);
      persisted = await waitForWorkflowModel(
        page,
        '(state) => state.documents.filter((document) => document.project_id === "p1" && document.name === "SE-011 Security Shop Drawings-copy.pdf").length === 2',
        null,
      );
      const pasteCopy = persisted.documents.find((document) => document.project_id === 'p1'
        && document.name === 'SE-011 Security Shop Drawings-copy.pdf'
        && document.id !== bulkCopy.id);
      assert.ok(pasteCopy?.id, `${device}: pasted document stable id`);

      await activate(fileSelectScope.getByRole('button', { name: 'Select', exact: true }), touch, device);
      await activate(page.locator('[data-document-id="d3"]:visible').first(), touch, device);
      await activate(fileSelectScope.getByRole('button', { name: 'Move/Copy', exact: true }), touch, device);
      let dialog = page.getByRole('dialog', { name: 'Move or copy documents', exact: true });
      await activate(dialog.getByRole('button', { name: 'Copy', exact: true }), touch, device);
      await activate(dialog.getByRole('button', { name: 'Lab Reno — MEP', exact: true }), touch, device);
      await activate(dialog.getByRole('button', { name: 'Copy here', exact: true }), touch, device);
      await waitForWorkflowModel(
        page,
        '(state) => state.documents.some((document) => document.project_id === "p2" && document.name === "RFI-014 Lobby Camera Coverage.pdf") && state.documents.some((document) => document.id === "d3" && document.project_id === "p1")',
        null,
      );

      await activate(page.locator('[data-document-id="d3"]:visible').first(), touch, device);
      await activate(fileSelectScope.getByRole('button', { name: 'Move/Copy', exact: true }), touch, device);
      dialog = page.getByRole('dialog', { name: 'Move or copy documents', exact: true });
      await activate(dialog.getByRole('button', { name: 'Move', exact: true }), touch, device);
      await activate(dialog.getByRole('button', { name: 'MEP Phase 2', exact: true }), touch, device);
      await activate(dialog.getByRole('button', { name: 'Move here', exact: true }), touch, device);
      await waitForWorkflowModel(
        page,
        '(state) => state.documents.some((document) => document.id === "d3" && document.project_id === "p3")',
        null,
      );
      await activate(fileSelectScope.getByRole('button', { name: 'Done', exact: true }), touch, device);

      const fromDocument = page.locator('[data-document-id="d1"]:visible').first();
      const toDocument = page.locator(`[data-document-id="${pasteCopy.id}"]:visible`).first();
      await dragRowTo(fromDocument, toDocument, 'document reorder');
      await waitForPreferences(
        (preferences, documentId) => preferences.documentOrderByProject?.p1?.[0] === documentId,
        'd1',
      );

      await page.reload({ waitUntil: 'domcontentloaded' });
      persisted = await readWorkflowModel(page);
      assert.equal(persisted.documents.some((document) => document.id === 'd3' && document.project_id === 'p3'), true, `${device}: moved document survives reload`);
      assert.equal(persisted.documents.some((document) => document.project_id === 'p2' && document.name === 'RFI-014 Lobby Camera Coverage.pdf'), true, `${device}: copied document survives reload`);
      assert.equal(persisted.documents.filter((document) => document.project_id === 'p1' && document.name === 'SE-011 Security Shop Drawings-copy.pdf').length, 2, `${device}: duplicate and paste survive reload`);
      assert.equal(persisted.projectPreferences.documentOrderByProject.p1[0], 'd1', `${device}: document reorder survives reload`);
      await restoreWorkflowModel(page, initialModel);
      await page.reload({ waitUntil: 'domcontentloaded' });
    });

    await artifacts.time(`${device}:create-empty-project`, async () => {
      await activate(page.getByRole('button', { name: 'New project', exact: true }), touch, device);
      const dialog = page.getByRole('dialog', { name: 'Create project', exact: true });
      await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(emptyProjectName);
      await activate(dialog.getByRole('button', { name: 'Create project', exact: true }), touch, device);
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
      await waitForWorkflowModel(page, '(state, name) => state.projects.some((project) => project.name === name)', emptyProjectName);
      const emptyModel = await readWorkflowModel(page);
      const emptyProject = emptyModel.projects.find((project) => project.name === emptyProjectName);
      assert.equal(emptyModel.documents.some((document) => document.project_id === emptyProject.id), false, `${device}: PDF selection is optional`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const reloaded = await readWorkflowModel(page);
      assert.ok(reloaded.projects.some((project) => project.id === emptyProject.id), `${device}: empty project survives reload`);
    });

    await artifacts.time(`${device}:create-project-with-pdf`, async () => {
      await activate(page.getByRole('button', { name: 'New project', exact: true }), touch, device);
      const dialog = page.getByRole('dialog', { name: 'Create project', exact: true });
      await dialog.waitFor({ state: 'visible', timeout: 10_000 });
      await dialog.getByRole('textbox', { name: 'Project name', exact: true }).fill(projectName);
      await dialog.getByTestId('create-project-files').setInputFiles(primaryFixture);
      await dialog.getByText(path.basename(primaryFixture), { exact: true }).waitFor({ state: 'visible' });
      await activate(dialog.getByRole('button', { name: 'Create project', exact: true }), touch, device);
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    });

    let model = await waitForWorkflowModel(
      page,
      '(state, name) => state.projects.some((project) => project.name === name) && state.documents.some((document) => document.name === "clickable-link-test.pdf")',
      projectName,
    );
    const project = model.projects.find((item) => item.name === projectName);
    assert.ok(project?.id?.startsWith('workflow-project-'), `${device}: created project needs stable id`);
    const primary = model.documents.find((item) => item.name === path.basename(primaryFixture) && item.project_id === project.id);
    assert.ok(primary?.id?.startsWith('workflow-document-'), `${device}: uploaded document needs stable id`);
    assert.equal(primary.file_size, fs.statSync(primaryFixture).size, `${device}: uploaded byte size`);
    assert.equal(primary.mime_type, 'application/pdf', `${device}: uploaded MIME`);

    await openProject(page, touch, device, project.id);
    const title = page.getByTitle(device === 'mobile' ? 'Tap to rename' : 'Click to rename');
    await title.fill(renamedProject);
    await title.press('Enter');
    model = await waitForWorkflowModel(page, '(state, id) => state.projects.some((project) => project.id === id && project.name.endsWith(" renamed"))', project.id);
    assert.equal(model.projects.find((item) => item.id === project.id)?.name, renamedProject);

    await artifacts.time(`${device}:add-files`, async () => {
      await chooseFilesFromButton({
        button: page.getByRole('button', { name: 'Add files', exact: true }).first(),
        device,
        files: [secondaryFixture],
        page,
        touch,
      });
      await waitForWorkflowModel(page, '(state, id) => state.documents.some((document) => document.project_id === id && document.name === "kal412-mixed-import-e2e.pdf")', project.id);
    });
    model = await readWorkflowModel(page);
    const secondary = model.documents.find((item) => item.project_id === project.id && item.name === path.basename(secondaryFixture));
    assert.equal(secondary.file_size, fs.statSync(secondaryFixture).size, `${device}: add-files byte size`);
    await artifacts.screenshot(page, `${device}-project-created-uploaded`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    model = await readWorkflowModel(page);
    assert.equal(model.projects.find((item) => item.id === project.id)?.name, renamedProject, `${device}: project rename survives reload`);
    assert.equal(model.documents.filter((item) => item.project_id === project.id).length, 2, `${device}: project files survive reload`);
    await openProject(page, touch, device, project.id);

    await artifacts.time(`${device}:open-viewer-return`, async () => {
      await activate(page.locator(`[data-document-id="${primary.id}"]:visible`).first(), touch, device);
      await page.waitForURL((url) => url.searchParams.get('testPdf') != null, { timeout: 60_000 });
      await page.locator('.survey-pdfjs-page-div[data-page-number="1"]').waitFor({ state: 'visible', timeout: 60_000 });
      assert.equal(new URL(page.url()).searchParams.get('previewName'), path.basename(primaryFixture));
      assert.equal(new URL(page.url()).searchParams.get('workflowE2E'), '1');
      await artifacts.screenshot(page, `${device}-real-viewer`);
      const returnControl = device === 'mobile'
        ? page.getByRole('button', { name: 'Back to documents', exact: true })
        : page.getByText('Home', { exact: true }).first();
      await activate(returnControl, touch, device);
      await page.waitForURL((url) => url.searchParams.get('hubPreview') === '1' && url.searchParams.get('workflowE2E') === '1', { timeout: 30_000 });
      await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    });

    await activate(page.getByRole('button', { name: 'Documents', exact: true }), touch, device);
    await page.getByRole('heading', { name: 'Documents', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    const search = page.locator('input[placeholder="Search documents..."]:visible');
    await search.fill(path.basename(primaryFixture));
    await page.keyboard.press('Escape');
    await openDocumentMenu(page, touch, device, primary.id);
    await activate(page.getByRole('menuitem', { name: 'Rename', exact: true }), touch, device);
    const renameDialog = page.getByRole('dialog', { name: 'Rename document', exact: true });
    await renameDialog.getByRole('textbox', { name: 'Name', exact: true }).fill(renamedDocument);
    await activate(renameDialog.getByRole('button', { name: 'Save', exact: true }), touch, device);
    await waitForWorkflowModel(page, '(state, id) => state.documents.some((document) => document.id === id && document.name.startsWith("e2e-") && document.name.endsWith("-renamed.pdf"))', primary.id);

    await page.goto(`${baseUrl}${workflowRoute('documents')}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Documents', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    model = await readWorkflowModel(page);
    assert.equal(model.documents.find((item) => item.id === primary.id)?.name, renamedDocument, `${device}: document rename survives reload`);
    await page.locator('input[placeholder="Search documents..."]:visible').fill(renamedDocument);
    await page.locator(`[data-document-id="${primary.id}"]:visible`).waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');

    await openDocumentMenu(page, touch, device, primary.id);
    await activate(page.getByRole('menuitem', { name: 'Delete', exact: true }), touch, device);
    await waitForWorkflowModel(page, '(state, id) => !state.documents.some((document) => document.id === id)', primary.id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    model = await readWorkflowModel(page);
    assert.equal(model.documents.some((item) => item.id === primary.id), false, `${device}: document delete survives reload`);

    await page.goto(`${baseUrl}${workflowRoute('projects')}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Projects', exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await activate(page.locator('[data-testid="project-select-toggle"]:visible'), touch, device);
    await activate(page.locator(`[data-project-id="${project.id}"]:visible`).first(), touch, device);
    await activate(page.locator('[data-testid="delete-selected-projects"]:visible'), touch, device);
    await waitForWorkflowModel(page, '(state, id) => !state.projects.some((project) => project.id === id) && !state.documents.some((document) => document.project_id === id)', project.id);
    await page.reload({ waitUntil: 'domcontentloaded' });
    model = await readWorkflowModel(page);
    assert.equal(model.projects.some((item) => item.id === project.id), false, `${device}: project delete survives reload`);
    assert.equal(model.documents.some((item) => item.project_id === project.id), false, `${device}: project delete cascades documents`);

    await restoreWorkflowModel(page, initialModel);
    await page.reload({ waitUntil: 'domcontentloaded' });
    model = await readWorkflowModel(page);
    assert.deepEqual(model.projects, initialModel.projects, `${device}: exact project fixture restored`);
    assert.deepEqual(model.documents, initialModel.documents, `${device}: exact document fixture restored`);

    artifacts.recordScenario({
      device,
      input: device === 'mobile' ? touch.inputKind : 'desktop-mouse-keyboard',
      lifecycle: 'create-empty-project-reload-create-project-with-pdf-rename-add-file-reload-open-viewer-return-rename-document-reload-delete-document-reload-delete-project-cascade-reload-restore-fixture',
      modelAssertions: 'exact localStorage ids, names, project membership, MIME, byte size, reload persistence, delete cascade',
      status: 'passed',
    });
  } finally {
    await context.close();
  }
}

async function run() {
  const server = await ensureViteServer(options.baseUrl);
  managedServer = server.managedProcess;
  browser = await chromium.launch({ headless: !options.headful });
  const results = await Promise.allSettled(devices.map((device) => runDevice(device, server.baseUrl)));
  const failures = results
    .map((result, index) => ({ result, device: devices[index] }))
    .filter(({ result }) => result.status === 'rejected');
  artifacts.setFinal({
    baseUrl: server.baseUrl,
    devices,
    passedDevices: results.filter((result) => result.status === 'fulfilled').length,
  });
  if (failures.length) {
    throw new Error(failures.map(({ device, result }) => `${device}: ${result.reason?.stack || result.reason}`).join('\n\n'));
  }
  artifacts.assertNoBrowserErrors();
}

try {
  await run();
  const summary = artifacts.finish('passed');
  console.log('RESULT: PASS');
  console.log(`devices: ${devices.join(', ')}`);
  console.log(`duration: ${artifacts.durationMs()}ms`);
  console.log(`artifacts: ${summary}`);
} catch (error) {
  const summary = artifacts.finish('failed', error);
  console.error('RESULT: FAIL');
  console.error(error?.stack || error);
  console.error(`artifacts: ${summary}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  managedServer?.kill('SIGTERM');
}
