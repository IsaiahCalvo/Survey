#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertBrowserUsesLeasedAccount, installLeasedBrowserAccount } from './lib/leased-browser-session.mjs';
import { ensureViteServer } from './mobile-annotations/vite-server.mjs';
import {
  createCleanupManifest,
  createDurableNames,
  DURABLE_SURFACES,
  finalizeCleanupManifest,
  parseDurableArgs,
} from './full-app-durable-contract.mjs';

async function main() {
  const args = parseDurableArgs(process.argv.slice(2));
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  if (args.dryRun) {
    console.log(JSON.stringify({ runId, surfaces: args.surfaces, liveAuth: false, cleanupRequired: true }, null, 2));
    return;
  }

  const server = await ensureViteServer(args.baseUrl);
  const browser = await chromium.launch({ headless: !args.headful });
  const failures = [];
  try {
    // Verify the exact second identity is part of this coordinator-owned lease
    // even though the current free/free bundle cannot exercise sharing (the
    // product intentionally disables invite creation for free owners).
    const collaboratorLeaseContext = await browser.newContext();
    const collaboratorLeaseAccount = await installLeasedBrowserAccount(collaboratorLeaseContext, { accountIndex: 1 });
    await collaboratorLeaseContext.close();

    for (const surface of args.surfaces) {
      const config = DURABLE_SURFACES[surface];
      const context = await browser.newContext({
        viewport: config.viewport,
        screen: config.viewport,
        isMobile: config.isMobile,
        hasTouch: config.hasTouch,
        deviceScaleFactor: config.deviceScaleFactor,
        locale: 'en-US',
      });

      // Required ordering: exact lease verification and auth installation run
      // before the first page is created or navigated.
      const leasedAccount = await installLeasedBrowserAccount(context);
      const page = await context.newPage();
      const diagnostics = createBrowserDiagnostics(page);
      await page.goto(`${server.baseUrl}${config.route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await assertBrowserUsesLeasedAccount(page, { account: leasedAccount, timeoutMs: 60_000 });
      diagnostics.markIdentityVerified();

      try {
        await runSurface({
          page,
          surface,
          runId,
          artifactRoot: args.artifactRoot,
          ownerLeaseAccount: leasedAccount,
          collaboratorLeaseAccount,
          diagnostics,
        });
      } catch (error) {
        failures.push(`${surface}: ${error?.stack || error}`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close().catch(() => {});
    server.managedProcess?.kill('SIGTERM');
  }

  if (failures.length) throw new Error(`Durable full-app E2E failed:\n${failures.join('\n\n')}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function invariant(value, message) {
  if (!value) throw new Error(message);
  return value;
}

async function firstVisible(locator) {
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible().catch(() => false)) return candidate;
  }
  return null;
}

async function clickVisible(locator, label) {
  const target = invariant(await firstVisible(locator), `Expected visible ${label}`);
  await target.click();
  return target;
}

function createResponseTracker(page, manifest, names) {
  const pending = new Set();
  const recordResponse = async (response) => {
    const request = response.request();
    const url = new URL(response.url());
    const method = request.method().toUpperCase();
    const ok = response.status() >= 200 && response.status() < 300;
    const tableMatch = url.pathname.match(/\/rest\/v1\/(projects|documents)$/);
    if (tableMatch && method === 'POST' && ok) {
      const body = await response.json().catch(() => null);
      for (const row of Array.isArray(body) ? body : [body]) {
        if (!row?.id) continue;
        if (tableMatch[1] === 'projects' && String(row.name || '').startsWith(names.prefix)) {
          manifest.created.projects.push({ id: row.id, name: row.name, user_id: row.user_id });
        }
        if (tableMatch[1] === 'documents') {
          if (row.project_id && [names.sourceDocument, names.targetDocument].includes(row.name)) {
            manifest.created.documents.push({
              id: row.id,
              name: row.name,
              project_id: row.project_id,
              file_path: row.file_path,
            });
            if (row.file_path) manifest.created.storagePaths.push(row.file_path);
          }
        }
      }
    }
    if (tableMatch && method === 'DELETE') {
      const ids = url.searchParams.getAll('id').flatMap((value) => value.replace(/^eq\./, '').split(','));
      manifest.requests.push({
        at: new Date().toISOString(),
        resource: tableMatch[1],
        operation: 'delete',
        ids,
        status: response.status(),
        ok,
      });
    }
    if (url.pathname.includes('/storage/v1/object/documents') && method === 'DELETE') {
      let payload = null;
      try { payload = request.postDataJSON(); } catch { payload = request.postData(); }
      manifest.requests.push({
        at: new Date().toISOString(),
        resource: 'storage',
        operation: 'delete',
        paths: payload?.prefixes || [],
        status: response.status(),
        ok,
      });
    }
  };
  const listener = (response) => {
    const task = recordResponse(response).finally(() => pending.delete(task));
    pending.add(task);
  };
  page.on('response', listener);
  return {
    async flush() { await Promise.all([...pending]); },
    stop() { page.off('response', listener); },
  };
}

function installDialogDiscipline(page) {
  const expected = [];
  const unexpected = [];
  page.on('dialog', async (dialog) => {
    const next = expected.shift();
    if (!next || !next.pattern.test(dialog.message())) {
      unexpected.push(`${dialog.type()}: ${dialog.message()}`);
      await dialog.dismiss().catch(() => {});
      return;
    }
    await dialog.accept(next.promptText).catch(() => {});
  });
  return {
    expect(pattern, promptText = undefined) { expected.push({ pattern, promptText }); },
    assertClean() {
      invariant(expected.length === 0, `${expected.length} expected dialog(s) never appeared`);
      invariant(unexpected.length === 0, `Unexpected dialogs: ${unexpected.join(' | ')}`);
    },
  };
}

function createBrowserDiagnostics(page) {
  let identityVerifiedAt = null;
  const consoleEvents = [];
  const criticalRequestFailures = [];
  const expectedAbortedRequests = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    consoleEvents.push({ at: Date.now(), text: message.text() });
  });
  page.on('requestfailed', (request) => {
    const url = request.url();
    if (!/\/(?:rest|storage)\/v1\//.test(url)) return;
    const failure = {
      at: new Date().toISOString(),
      kind: 'network',
      method: request.method(),
      url: redactRequestUrl(url),
      error: request.failure()?.errorText || 'request failed',
    };
    // Deliberate reloads/back-navigation cancel in-flight idempotent reads.
    // Keep them in evidence, but do not misclassify browser cancellation as a
    // backend failure. Mutating requests and every other network error remain
    // hard failures.
    if (/^net::ERR_ABORTED$/i.test(failure.error) && ['GET', 'HEAD'].includes(failure.method)) {
      expectedAbortedRequests.push({ ...failure, classification: 'deliberate navigation cancelled an idempotent read' });
      return;
    }
    criticalRequestFailures.push(failure);
  });
  page.on('response', (response) => {
    const request = response.request();
    const method = request.method().toUpperCase();
    if (!['POST', 'PATCH', 'DELETE'].includes(method) || response.status() < 400) return;
    const url = response.url();
    if (!/\/(?:rest|storage)\/v1\//.test(url)) return;
    criticalRequestFailures.push({
      at: new Date().toISOString(),
      kind: 'http',
      method,
      url: redactRequestUrl(url),
      status: response.status(),
    });
  });
  return {
    markIdentityVerified() { identityVerifiedAt = Date.now(); },
    snapshot() {
      const expectedConsoleErrors = [];
      const consoleErrors = [];
      for (const event of consoleEvents) {
        const beforeVerified = identityVerifiedAt != null && event.at <= identityVerifiedAt;
        const expectedCaptcha = beforeVerified && /turnstile|captcha|failed to load resource.*(?:400|401)/i.test(event.text);
        (expectedCaptcha ? expectedConsoleErrors : consoleErrors).push({
          at: new Date(event.at).toISOString(),
          text: event.text,
          classification: expectedCaptcha ? 'pre-lease-session captcha fallback' : 'unexpected',
        });
      }
      return { consoleErrors, expectedConsoleErrors, expectedAbortedRequests, criticalRequestFailures };
    },
  };
}

function redactRequestUrl(value) {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (/token|key|email/i.test(key)) url.searchParams.set(key, '[redacted]');
  }
  return url.toString();
}

async function waitForHub(page, title) {
  await page.getByRole('heading', { name: title, exact: true }).waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => ![...document.querySelectorAll('.hub-skeleton-block')]
    .some((node) => node.getClientRects().length > 0), null, { timeout: 60_000 });
}

async function navigateHub(page, title) {
  const activeHeading = page.getByRole('heading', { name: title, exact: true });
  if (await activeHeading.isVisible().catch(() => false)) {
    await waitForHub(page, title);
    return;
  }
  await clickVisible(page.getByRole('button', { name: title, exact: true }), `${title} navigation`);
  await waitForHub(page, title);
}

async function visibleExactText(page, text) {
  return firstVisible(page.getByText(text, { exact: true }));
}

async function visibleInputWithValue(page, value) {
  const inputs = page.locator('input');
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    if (!await input.isVisible().catch(() => false)) continue;
    if (await input.inputValue().catch(() => null) === value) return input;
  }
  return null;
}

async function waitForExactText(page, text, { timeout = 30_000 } = {}) {
  await page.waitForFunction((value) => [...document.querySelectorAll('body *')]
    .some((node) => node.children.length === 0 && node.textContent?.trim() === value
      && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0), text, { timeout });
  return invariant(await visibleExactText(page, text), `Expected visible text: ${text}`);
}

async function waitForExactTextAbsent(page, text, { timeout = 30_000 } = {}) {
  await page.waitForFunction((value) => ![...document.querySelectorAll('body *')]
    .some((node) => node.children.length === 0 && node.textContent?.trim() === value
      && node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0), text, { timeout });
}

async function createProjectWithPdf({ page, projectName, pdfPaths }) {
  await navigateHub(page, 'Projects');
  await clickVisible(page.getByRole('button', { name: 'New project', exact: true }), 'New project');

  const dialog = await firstVisible(page.getByRole('dialog'));
  invariant(dialog, 'New project did not open an accessible dialog');
  const nameInput = await firstVisible(dialog.getByRole('textbox'));
  invariant(nameInput, 'Create project dialog has no project-name input');
  await nameInput.fill(projectName);

  const pickerButton = await firstVisible(dialog.getByRole('button', { name: /add.*pdf|choose.*pdf|browse|select.*pdf/i }));
  if (pickerButton) {
    const chooser = page.waitForEvent('filechooser', { timeout: 5_000 });
    await pickerButton.click();
    await (await chooser).setFiles(pdfPaths);
  } else {
    const projectInput = (await dialog.locator('input[type="file"][multiple]').count())
      ? dialog.locator('input[type="file"][multiple]').first()
      : page.locator('input[type="file"][multiple]').first();
    invariant(await projectInput.count(), 'Create project flow has no multiple PDF input');
    await projectInput.setInputFiles(pdfPaths);
  }

  for (const pdfPath of pdfPaths) {
    await dialog.getByText(path.basename(pdfPath), { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  }
  const create = invariant(
    await firstVisible(dialog.getByRole('button', { name: /create project|create/i })),
    'Create project dialog has no Create action',
  );
  await create.click();
  await dialog.waitFor({ state: 'hidden', timeout: 90_000 });
  await waitForExactText(page, projectName, { timeout: 90_000 });
}

async function reloadAndAssertProject(page, projectName) {
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForHub(page, 'Projects');
  await waitForExactText(page, projectName, { timeout: 60_000 });
}

async function renameProject(page, oldName, newName) {
  await navigateHub(page, 'Projects');
  const oldText = await waitForExactText(page, oldName);
  await oldText.click();
  const input = invariant(await visibleInputWithValue(page, oldName), 'Selected project has no rename input');
  await input.fill(newName);
  await input.press('Enter');
  await input.blur().catch(() => {});
  await page.waitForTimeout(600);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForHub(page, 'Projects');
  await waitForExactText(page, newName, { timeout: 60_000 });
  await waitForExactTextAbsent(page, oldName);
}

async function findNamedContainer(page, name, descendantSelector) {
  let node = invariant(await visibleExactText(page, name), `Could not find ${name}`);
  for (let depth = 0; depth < 8; depth += 1) {
    if (await firstVisible(node.locator(descendantSelector))) return node;
    node = node.locator('xpath=..');
  }
  throw new Error(`Could not resolve action container for ${name}`);
}

async function renameDocument(page, oldName, newName) {
  await navigateHub(page, 'Documents');
  const row = await findNamedContainer(page, oldName, 'button[title="More"]');
  await clickVisible(row.locator('button[title="More"]'), `${oldName} More`);
  await clickVisible(page.getByRole('menuitem', { name: 'Rename', exact: true }), 'Rename document menu item');
  const dialog = page.getByRole('dialog', { name: 'Rename document', exact: true });
  await dialog.waitFor({ state: 'visible', timeout: 10_000 });
  const input = dialog.getByRole('textbox', { name: 'Name', exact: true });
  await input.fill(newName);
  await clickVisible(dialog.getByRole('button', { name: 'Save', exact: true }), 'Save document name');
  await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
  await waitForExactText(page, newName, { timeout: 30_000 });
}

async function moveDocument(page, documentName, targetProject) {
  await navigateHub(page, 'Documents');
  await clickVisible(page.getByRole('button', { name: 'Select', exact: true }), 'Documents Select');
  await (await waitForExactText(page, documentName)).click();
  await clickVisible(page.getByRole('button', { name: 'Move/Copy', exact: true }), 'Move/Copy');
  await clickVisible(page.getByText(targetProject, { exact: true }), `destination ${targetProject}`);
  await clickVisible(page.getByRole('button', { name: 'Move here', exact: true }), 'Move here');
  const done = await firstVisible(page.getByRole('button', { name: 'Done', exact: true }));
  if (done) await done.click();

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForHub(page, 'Documents');
  const row = await findNamedContainer(page, documentName, 'button[title="More"]');
  invariant((await row.innerText()).includes(targetProject), `Moved document did not persist target project ${targetProject}`);
}

async function openViewerAndReturn(page, surface, documentName) {
  await navigateHub(page, 'Documents');
  const title = await waitForExactText(page, documentName);
  if (surface === 'mobile') await title.click();
  else await title.dblclick();
  await page.locator('.survey-pdfjs-viewer').first().waitFor({ state: 'visible', timeout: 90_000 });
  if (surface === 'mobile') {
    await clickVisible(page.getByRole('button', { name: 'Back to documents', exact: true }), 'Back to documents');
  } else {
    await clickVisible(page.getByText('Home', { exact: true }), 'Home tab');
  }
  await waitForHub(page, 'Documents');
  await waitForExactText(page, documentName, { timeout: 60_000 });
}

async function deleteDocumentByName({ page, name, dialogs, manifest }) {
  await navigateHub(page, 'Documents');
  const existing = await visibleExactText(page, name);
  if (!existing) return;
  const row = await findNamedContainer(page, name, 'button[title="More"]');
  await clickVisible(row.locator('button[title="More"]'), `${name} cleanup More`);
  dialogs.expect(/Delete this document\?/i);
  await clickVisible(page.getByRole('menuitem', { name: 'Delete', exact: true }), `Delete ${name}`);
  await waitForExactTextAbsent(page, name, { timeout: 60_000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForHub(page, 'Documents');
  await waitForExactTextAbsent(page, name, { timeout: 60_000 });
  manifest.uiAbsenceAfterReload.documents.push(name);
}

async function deleteProjectsByName({ page, names, dialogs, manifest }) {
  await navigateHub(page, 'Projects');
  const existing = [];
  for (const name of names) {
    if (await visibleExactText(page, name)) existing.push(name);
  }
  if (existing.length) {
    await clickVisible(page.getByRole('button', { name: 'Select', exact: true }), 'Projects Select');
    for (const name of existing) await (await waitForExactText(page, name)).click();
    dialogs.expect(/Delete (?:this project|these 2 projects) and (?:its|their) documents\?/i);
    await clickVisible(page.getByTitle('Delete'), 'Delete selected projects');
    for (const name of existing) await waitForExactTextAbsent(page, name, { timeout: 60_000 });
  }
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForHub(page, 'Projects');
  for (const name of names) {
    await waitForExactTextAbsent(page, name, { timeout: 60_000 });
    manifest.uiAbsenceAfterReload.projects.push(name);
  }
}

async function runSurface({
  page,
  surface,
  runId,
  artifactRoot,
  ownerLeaseAccount,
  collaboratorLeaseAccount,
  diagnostics,
}) {
  const names = createDurableNames(surface, runId);
  const ownerTier = String(ownerLeaseAccount?.tier || ownerLeaseAccount?.baseline?.tier || 'unknown').toLowerCase();
  const collaboratorTier = String(collaboratorLeaseAccount?.tier || collaboratorLeaseAccount?.baseline?.tier || 'unknown').toLowerCase();
  const manifest = createCleanupManifest({
    surface,
    runId,
    names,
    collaboration: {
      status: 'blocked',
      blockerCode: 'free_owner_invites_locked',
      blocker: 'The exact leased owner is free-tier. Locked product rules disable project/document invite links and email before any backend mutation; invite/accept/role/revoke cannot be truthfully exercised with this lease.',
      ownerTier,
      inviteeTier: collaboratorTier,
      secondLeasedIdentityVerified: true,
      covered: [],
      notCovered: ['invite', 'accept', 'change-role', 'revoke'],
      requiredOwnerTier: ['pro', 'enterprise', 'developer'],
    },
  });
  const outputDirectory = path.resolve(artifactRoot, `${runId}-${surface}`);
  await mkdir(outputDirectory, { recursive: true });
  const tracker = createResponseTracker(page, manifest, names);
  const dialogs = installDialogDiscipline(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let workflowError = null;

  try {
    await waitForHub(page, 'Documents');
    await createProjectWithPdf({
      page,
      projectName: names.sourceProject,
      pdfPaths: [
        path.resolve('debug/fixtures/se011.pdf'),
        ...(ownerTier === 'free' ? [path.resolve('debug/fixtures/clickable-link-test.pdf')] : []),
      ],
    });
    manifest.workflowCoverage.createProject = 'covered';
    manifest.workflowCoverage.uploadDocuments = ownerTier === 'free' ? 'covered:2' : 'covered:1';
    await reloadAndAssertProject(page, names.sourceProject);
    manifest.workflowCoverage.reloadList = 'covered';
    if (ownerTier !== 'free') {
      await createProjectWithPdf({
        page,
        projectName: names.targetProject,
        pdfPaths: [path.resolve('debug/fixtures/clickable-link-test.pdf')],
      });
      manifest.workflowCoverage.uploadDocuments = 'covered:2';
      await reloadAndAssertProject(page, names.targetProject);
    }
    await tracker.flush();
    invariant(manifest.created.projects.length >= (ownerTier === 'free' ? 1 : 2), 'Supabase project-create responses did not expose the exact created rows');
    invariant(manifest.created.documents.length >= 2, 'Supabase document-create responses did not expose two exact created rows');

    await renameProject(page, names.sourceProject, names.renamedProject);
    manifest.workflowCoverage.renameProject = 'covered';
    await renameDocument(page, names.sourceDocument, names.renamedDocument);
    manifest.workflowCoverage.renameDocument = 'covered';
    if (ownerTier === 'free') {
      manifest.workflowCoverage.moveDocument = 'blocked: free tier permits one project, so no valid destination project can coexist';
    } else {
      await moveDocument(page, names.renamedDocument, names.targetProject);
      manifest.workflowCoverage.moveDocument = 'covered';
    }
    await openViewerAndReturn(page, surface, names.renamedDocument);
    manifest.workflowCoverage.openViewerAndBack = 'covered';
    await page.screenshot({ path: path.join(outputDirectory, 'workflow-complete.png') });
  } catch (error) {
    workflowError = error;
    await page.screenshot({ path: path.join(outputDirectory, 'workflow-failure.png') }).catch(() => {});
  }

  // Cleanup always runs, including after a partial workflow. UI deletion is
  // deliberate: it exercises the app's DB cascade, storage remove, and local
  // durable purge instead of bypassing product behavior with an admin client.
  try {
    await deleteDocumentByName({ page, name: names.renamedDocument, dialogs, manifest });
    await deleteDocumentByName({ page, name: names.sourceDocument, dialogs, manifest });
    await deleteDocumentByName({ page, name: names.targetDocument, dialogs, manifest });
  } catch (error) {
    manifest.errors.push(`document cleanup: ${error.message}`);
  }
  try {
    await deleteProjectsByName({
      page,
      names: [names.renamedProject, names.sourceProject, ...(ownerTier === 'free' ? [] : [names.targetProject])],
      dialogs,
      manifest,
    });
  } catch (error) {
    manifest.errors.push(`project cleanup: ${error.message}`);
  }
  await sleep(750);
  await tracker.flush();
  tracker.stop();
  try { dialogs.assertClean(); } catch (error) { manifest.errors.push(error.message); }
  if (pageErrors.length) manifest.errors.push(...pageErrors.map((message) => `pageerror: ${message}`));
  manifest.browserDiagnostics = diagnostics.snapshot();
  if (manifest.browserDiagnostics.consoleErrors.length) {
    manifest.errors.push(`${manifest.browserDiagnostics.consoleErrors.length} unexpected console error(s)`);
  }
  if (manifest.browserDiagnostics.criticalRequestFailures.length) {
    manifest.errors.push(`${manifest.browserDiagnostics.criticalRequestFailures.length} failed critical request(s)`);
  }
  finalizeCleanupManifest(manifest);
  await writeFile(path.join(outputDirectory, 'cleanup-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await page.screenshot({ path: path.join(outputDirectory, 'cleanup-complete.png') }).catch(() => {});

  if (workflowError) throw workflowError;
  invariant(manifest.complete, `Cleanup proof incomplete: ${manifest.problems.join('; ')}`);
  console.log(`[full-app-durable] PASS ${surface}; cleanup: ${path.join(outputDirectory, 'cleanup-manifest.json')}`);
}

await main().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
