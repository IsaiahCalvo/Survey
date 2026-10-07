#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { assertBrowserUsesLeasedAccount, installLeasedBrowserAccount } from './lib/leased-browser-session.mjs';
import { loadVerifiedTestAccounts } from '../scripts/test-account-lease.mjs';
import { ensureViteServer } from './mobile-annotations/vite-server.mjs';
import {
  createCleanupManifest,
  createDurableNames,
  documentCleanupProblems,
  DURABLE_SURFACES,
  exactDocumentCleanupProblems,
  finalizeCleanupManifest,
  isExpectedMissingLegacySidecar,
  parseDurableArgs,
} from './full-app-durable-contract.mjs';
import {
  assertRuntimeOwnerEntitlement,
  resolveLeasedCollaborationAccounts,
} from './full-app-collaboration-contract.mjs';
import {
  createRuntimeEntitlementProbe,
  proveProjectCollaborationCleanup,
  runProjectCollaboration,
} from './full-app-collaboration-e2e.mjs';

async function main() {
  const args = parseDurableArgs(process.argv.slice(2));
  const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  if (args.dryRun) {
    console.log(JSON.stringify({
      runId,
      surfaces: args.surfaces,
      liveAuth: false,
      cleanupRequired: true,
      collaborationIdentitiesConfigured: !!args.ownerAccount && !!args.inviteeAccount,
    }, null, 2));
    return;
  }

  invariant(args.ownerAccount && args.inviteeAccount,
    'Durable collaboration requires --owner-account=email|user-id and --invitee-account=email|user-id');
  const leasedAccounts = loadVerifiedTestAccounts({ minimumAccounts: 2 });
  const collaborationAccounts = resolveLeasedCollaborationAccounts(leasedAccounts, {
    ownerIdentity: args.ownerAccount,
    inviteeIdentity: args.inviteeAccount,
  });

  const server = await ensureViteServer(args.baseUrl);
  const browser = await chromium.launch({ headless: !args.headful });
  const failures = [];
  try {
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
      const leasedAccount = await installLeasedBrowserAccount(context, { accountIndex: collaborationAccounts.ownerIndex });
      const page = await context.newPage();
      const entitlementProbe = createRuntimeEntitlementProbe(page, { userId: leasedAccount.userId });
      const diagnostics = createBrowserDiagnostics(page);
      await page.goto(`${server.baseUrl}${config.route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await assertBrowserUsesLeasedAccount(page, { account: leasedAccount, timeoutMs: 60_000 });
      diagnostics.markIdentityVerified();
      const runtimeOwnerEntitlement = assertRuntimeOwnerEntitlement(
        await entitlementProbe.wait(60_000),
        leasedAccount.userId,
      );
      entitlementProbe.stop();

      try {
        await runSurface({
          page,
          surface,
          runId,
          artifactRoot: args.artifactRoot,
          ownerLeaseAccount: leasedAccount,
          collaboratorLeaseAccount: collaborationAccounts.invitee,
          collaboratorLeaseAccountIndex: collaborationAccounts.inviteeIndex,
          runtimeOwnerEntitlement,
          browser,
          serverBaseUrl: server.baseUrl,
          surfaceConfig: config,
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
    let ok = response.status() >= 200 && response.status() < 300;
    const tableMatch = url.pathname.match(/\/rest\/v1\/(projects|documents)$/);
    let completionError = null;
    if ((tableMatch || url.pathname.includes('/storage/v1/object/documents')) && method === 'DELETE') {
      completionError = await response.finished();
      ok = ok && !completionError;
    }
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
        ...(completionError ? { error: completionError.message } : {}),
      });
    }
    if (url.pathname.includes('/storage/v1/object/documents') && method === 'DELETE') {
      let payload = null;
      try { payload = request.postDataJSON(); } catch { payload = request.postData(); }
      const objectPrefix = '/storage/v1/object/documents/';
      const urlPath = url.pathname.startsWith(objectPrefix)
        ? decodeURIComponent(url.pathname.slice(objectPrefix.length))
        : null;
      manifest.requests.push({
        at: new Date().toISOString(),
        resource: 'storage',
        operation: 'delete',
        paths: payload?.prefixes || (urlPath ? [urlPath] : []),
        status: response.status(),
        ok,
        ...(completionError ? { error: completionError.message } : {}),
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
  let runManifest = null;
  const consoleEvents = [];
  const criticalRequestFailures = [];
  const expectedAbortedRequests = [];
  const httpErrorResponses = [];
  const pendingResponseReads = new Set();
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
  const recordHttpError = async (response) => {
    if (response.status() < 400) return;
    const responseUrl = response.url();
    if (!/\/(?:auth|rest|storage|functions)\/v1\//.test(responseUrl)) return;
    const request = response.request();
    const method = request.method().toUpperCase();
    const atMs = Date.now();
    let errorCode = null;
    let errorMessage = null;
    const body = await response.json().catch(() => null);
    if (body && typeof body === 'object') {
      errorCode = body.error_code || body.code || body.error || null;
      errorMessage = body.msg || body.message || body.error_description || null;
    }
    const verifiedCaptchaFallback = new URL(responseUrl).pathname.includes('/auth/v1/token')
      && method === 'POST'
      && response.status() === 400
      && /captcha/i.test(`${errorCode || ''} ${errorMessage || ''}`);
    const expectedMissingLegacySidecar = method === 'GET' && isExpectedMissingLegacySidecar({
      url: responseUrl,
      status: response.status(),
      errorCode,
      manifest: runManifest,
    });
    const entry = {
      at: new Date(atMs).toISOString(),
      atMs,
      kind: 'http',
      method,
      url: redactRequestUrl(responseUrl),
      status: response.status(),
      errorCode,
      classification: verifiedCaptchaFallback
        ? 'verified dev-auto-login captcha fallback'
        : expectedMissingLegacySidecar
          ? 'expected optional legacy survey sidecar absent'
          : 'unexpected',
    };
    httpErrorResponses.push(entry);
    if (!verifiedCaptchaFallback
      && ['POST', 'PATCH', 'DELETE'].includes(method)
      && /\/(?:rest|storage)\/v1\//.test(responseUrl)) {
      criticalRequestFailures.push(entry);
    }
  };
  page.on('response', (response) => {
    const task = recordHttpError(response).finally(() => pendingResponseReads.delete(task));
    pendingResponseReads.add(task);
  });
  return {
    markIdentityVerified() {},
    setManifest(manifest) { runManifest = manifest; },
    async snapshot() {
      await Promise.all([...pendingResponseReads]);
      const expectedConsoleErrors = [];
      const consoleErrors = [];
      const availableExpectedResponses = httpErrorResponses
        .filter((entry) => entry.classification !== 'unexpected')
        .map((entry) => ({ ...entry, matched: false }));
      for (const event of consoleEvents) {
        const matchingResponse = availableExpectedResponses.find((entry) => (
          !entry.matched
          && /failed to load resource.*400/i.test(event.text)
          && Math.abs(entry.atMs - event.at) <= 2_000
        ));
        if (matchingResponse) matchingResponse.matched = true;
        (matchingResponse ? expectedConsoleErrors : consoleErrors).push({
          at: new Date(event.at).toISOString(),
          text: event.text,
          classification: matchingResponse
            ? matchingResponse.classification
            : 'unexpected',
        });
      }
      return {
        consoleErrors,
        expectedConsoleErrors,
        expectedAbortedRequests,
        httpErrorResponses: httpErrorResponses.map(({ atMs: _atMs, ...entry }) => entry),
        criticalRequestFailures,
      };
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
  await page.waitForFunction(() => ![...document.querySelectorAll('.hub-loading-region, [data-quiet-loading]')]
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

async function moveDocument(page, documentName, targetProject, manifest) {
  const createdDocument = invariant(
    createdDocumentForCleanup(manifest, documentName),
    `Could not resolve exact created document row for move name ${documentName}`,
  );
  const createdTargetProject = invariant(
    manifest.created.projects.find((project) => project.name === targetProject),
    `Could not resolve exact target project row for move name ${targetProject}`,
  );
  await navigateHub(page, 'Documents');
  await clickVisible(page.getByRole('button', { name: 'Select', exact: true }), 'Documents Select');
  await (await waitForExactText(page, documentName)).click();
  await clickVisible(page.getByRole('button', { name: 'Move/Copy', exact: true }), 'Move/Copy');
  const moveDialog = page.getByRole('dialog', { name: 'Move or copy documents', exact: true });
  await moveDialog.waitFor({ state: 'visible', timeout: 10_000 });
  const destination = invariant(
    await firstVisible(moveDialog.getByRole('button', { name: targetProject, exact: true })),
    `Move picker has no interactive destination for ${targetProject}`,
  );
  await destination.click();
  invariant(await destination.getAttribute('aria-pressed') === 'true', `Move destination ${targetProject} was not selected`);
  const moveResponsePromise = page.waitForResponse(
    (response) => responseMovesDocument(response, createdDocument.id, createdTargetProject.id),
    { timeout: 60_000 },
  );
  await clickVisible(moveDialog.getByRole('button', { name: 'Move here', exact: true }), 'Move here');
  const moveResponse = await moveResponsePromise;
  const completionError = await moveResponse.finished();
  invariant(!completionError, `Document move PATCH was interrupted: ${completionError?.message}`);
  invariant(moveResponse.ok(), `Document move PATCH failed with HTTP ${moveResponse.status()}`);
  await moveDialog.waitFor({ state: 'hidden', timeout: 60_000 });

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

function createdDocumentForCleanup(manifest, currentName) {
  const createdName = currentName === manifest.names.renamedDocument
    ? manifest.names.sourceDocument
    : currentName;
  return manifest.created.documents.find((document) => document.name === createdName) || null;
}

function responseDeletesId(response, table, id) {
  const url = new URL(response.url());
  if (response.request().method().toUpperCase() !== 'DELETE'
    || !url.pathname.endsWith(`/rest/v1/${table}`)) return false;
  return url.searchParams.getAll('id')
    .flatMap((value) => value.replace(/^eq\./, '').split(','))
    .includes(id);
}

function responseMovesDocument(response, documentId, targetProjectId) {
  const url = new URL(response.url());
  if (response.request().method().toUpperCase() !== 'PATCH'
    || !url.pathname.endsWith('/rest/v1/documents')) return false;
  const targetsDocument = url.searchParams.getAll('id')
    .flatMap((value) => value.replace(/^eq\./, '').split(','))
    .includes(documentId);
  if (!targetsDocument) return false;
  try {
    return response.request().postDataJSON()?.project_id === targetProjectId;
  } catch {
    return false;
  }
}

async function closeManageTeamForCleanup(page) {
  const manageTeam = page.locator('[data-kal31-manage-team="true"]');
  if (await firstVisible(manageTeam)) {
    await clickVisible(manageTeam.getByRole('button', { name: 'Done', exact: true }), 'Manage Team Done before cleanup');
    await manageTeam.waitFor({ state: 'hidden', timeout: 10_000 });
  }
  invariant(!(await firstVisible(manageTeam)), 'Manage Team remained open before owner cleanup');
}

async function deleteDocumentByName({ page, name, dialogs, manifest, tracker }) {
  await navigateHub(page, 'Documents');
  const existing = await visibleExactText(page, name);
  if (!existing) return;
  const createdDocument = invariant(
    createdDocumentForCleanup(manifest, name),
    `Could not resolve exact created document row for cleanup name ${name}`,
  );
  const row = await findNamedContainer(page, name, 'button[title="More"]');
  await clickVisible(row.locator('button[title="More"]'), `${name} cleanup More`);
  // The hub removes the card optimistically. Wait for the product's terminal
  // verification log before any reload/navigation, otherwise navigation can
  // abort the storage removal or even the next document's initial row lookup.
  const productDeleteComplete = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('[DocumentDelete] verify:removed')
      && message.text().includes(`"docId":"${createdDocument.id}"`),
    timeout: 60_000,
  });
  dialogs.expect(/Delete this document\?/i);
  await clickVisible(page.getByRole('menuitem', { name: 'Delete', exact: true }), `Delete ${name}`);
  await productDeleteComplete;
  await tracker.flush();
  const cleanupProblems = exactDocumentCleanupProblems(manifest, createdDocument);
  invariant(cleanupProblems.length === 0, cleanupProblems.join('; '));
  await waitForExactTextAbsent(page, name, { timeout: 60_000 });
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await waitForHub(page, 'Documents');
  await waitForExactTextAbsent(page, name, { timeout: 60_000 });
  manifest.uiAbsenceAfterReload.documents.push(name);
}

async function deleteProjectsByName({ page, names, dialogs, manifest, tracker }) {
  await navigateHub(page, 'Projects');
  const existing = [];
  for (const name of names) {
    if (await visibleExactText(page, name)) existing.push(name);
  }
  if (existing.length) {
    const createdProjects = existing.map((name) => {
      const createdName = name === manifest.names.renamedProject ? manifest.names.sourceProject : name;
      return invariant(
        manifest.created.projects.find((project) => project.name === createdName),
        `Could not resolve exact created project row for cleanup name ${name}`,
      );
    });
    const completedDeletes = createdProjects.map((project) => page.waitForResponse(
      (response) => responseDeletesId(response, 'projects', project.id),
      { timeout: 60_000 },
    ));
    await clickVisible(page.getByRole('button', { name: 'Select', exact: true }), 'Projects Select');
    for (const name of existing) await (await waitForExactText(page, name)).click();
    dialogs.expect(/Delete (?:this project|these 2 projects) and (?:its|their) documents\?/i);
    await clickVisible(page.getByTitle('Delete'), 'Delete selected projects');
    for (const [index, responsePromise] of completedDeletes.entries()) {
      const response = await responsePromise;
      const completionError = await response.finished();
      invariant(!completionError, `Project DELETE was interrupted for ${createdProjects[index].id}: ${completionError?.message}`);
      invariant(response.ok(), `Project DELETE failed for ${createdProjects[index].id} with HTTP ${response.status()}`);
    }
    await tracker.flush();
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
  collaboratorLeaseAccountIndex,
  runtimeOwnerEntitlement,
  browser,
  serverBaseUrl,
  surfaceConfig,
  diagnostics,
}) {
  const names = createDurableNames(surface, runId);
  const ownerTier = runtimeOwnerEntitlement.tier;
  const manifest = createCleanupManifest({
    surface,
    runId,
    names,
    collaboration: { status: 'pending' },
  });
  diagnostics.setManifest(manifest);
  const outputDirectory = path.resolve(artifactRoot, `${runId}-${surface}`);
  await mkdir(outputDirectory, { recursive: true });
  const tracker = createResponseTracker(page, manifest, names);
  const dialogs = installDialogDiscipline(page);
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  let workflowError = null;
  let collaborationRun = null;
  let collaborationProjectId = null;

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
    collaborationProjectId = invariant(
      manifest.created.projects.find((project) => project.name === names.sourceProject)?.id,
      'Could not resolve exact collaboration project id from create response',
    );

    await renameProject(page, names.sourceProject, names.renamedProject);
    manifest.workflowCoverage.renameProject = 'covered';
    await renameDocument(page, names.sourceDocument, names.renamedDocument);
    manifest.workflowCoverage.renameDocument = 'covered';
    if (ownerTier === 'free') {
      manifest.workflowCoverage.moveDocument = 'blocked: free tier permits one project, so no valid destination project can coexist';
    } else {
      await moveDocument(page, names.renamedDocument, names.targetProject, manifest);
      manifest.workflowCoverage.moveDocument = 'covered';
    }
    await openViewerAndReturn(page, surface, names.renamedDocument);
    manifest.workflowCoverage.openViewerAndBack = 'covered';
    collaborationRun = await runProjectCollaboration({
      browser,
      ownerPage: page,
      serverBaseUrl,
      surfaceConfig,
      projectName: names.renamedProject,
      ownerAccount: ownerLeaseAccount,
      inviteeAccount: collaboratorLeaseAccount,
      inviteeAccountIndex: collaboratorLeaseAccountIndex,
      runtimeOwnerEntitlement,
      artifactDirectory: outputDirectory,
    });
    manifest.collaboration = collaborationRun.evidence;
    await page.screenshot({ path: path.join(outputDirectory, 'workflow-complete.png') });
  } catch (error) {
    workflowError = error;
    await page.screenshot({ path: path.join(outputDirectory, 'workflow-failure.png') }).catch(() => {});
  }

  // Cleanup always runs, including after a partial workflow. UI deletion is
  // deliberate: it exercises the app's DB cascade, storage remove, and local
  // durable purge instead of bypassing product behavior with an admin client.
  let documentsExplicitlyClean = false;
  try {
    await closeManageTeamForCleanup(page);
    await deleteDocumentByName({ page, name: names.renamedDocument, dialogs, manifest, tracker });
    await deleteDocumentByName({ page, name: names.sourceDocument, dialogs, manifest, tracker });
    await deleteDocumentByName({ page, name: names.targetDocument, dialogs, manifest, tracker });
    await tracker.flush();
    const cleanupProblems = documentCleanupProblems(manifest);
    invariant(cleanupProblems.length === 0, cleanupProblems.join('; '));
    documentsExplicitlyClean = true;
  } catch (error) {
    manifest.errors.push(`document cleanup: ${error.message}`);
  }
  if (documentsExplicitlyClean) {
    try {
      await deleteProjectsByName({
        page,
        names: [names.renamedProject, names.sourceProject, ...(ownerTier === 'free' ? [] : [names.targetProject])],
        dialogs,
        manifest,
        tracker,
      });
    } catch (error) {
      manifest.errors.push(`project cleanup: ${error.message}`);
    }
  } else {
    manifest.errors.push('project cleanup skipped: explicit document/storage deletion was not proved first');
  }
  if (collaborationRun && collaborationProjectId) {
    try {
      manifest.collaboration = await proveProjectCollaborationCleanup({
        page,
        projectId: collaborationProjectId,
        evidence: collaborationRun.evidence,
        signedApi: collaborationRun.signedApi,
      });
    } catch (error) {
      manifest.errors.push(`collaboration cleanup: ${error.message}`);
    }
  }
  await sleep(750);
  await tracker.flush();
  tracker.stop();
  try { dialogs.assertClean(); } catch (error) { manifest.errors.push(error.message); }
  if (pageErrors.length) manifest.errors.push(...pageErrors.map((message) => `pageerror: ${message}`));
  manifest.browserDiagnostics = await diagnostics.snapshot();
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
