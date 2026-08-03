import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createCleanupManifest,
  createDurableNames,
  finalizeCleanupManifest,
  parseDurableArgs,
  parseSurface,
} from '../agent-cli/full-app-durable-contract.mjs';

test('durable harness surface parser defaults to both and rejects unknown surfaces', () => {
  assert.deepEqual(parseSurface(), ['desktop', 'mobile']);
  assert.deepEqual(parseSurface('desktop'), ['desktop']);
  assert.deepEqual(parseDurableArgs(['--surface=mobile', '--headful']), {
    surfaces: ['mobile'],
    baseUrl: null,
    headful: true,
    dryRun: false,
    artifactRoot: '.playwright-mcp/full-app-durable',
  });
  assert.throws(() => parseSurface('tablet'), /expected desktop, mobile, or both/);
});

test('durable names are unique per surface and retain stable PDF fixture names', () => {
  const desktop = createDurableNames('desktop', 'run-42');
  const mobile = createDurableNames('mobile', 'run-42');
  assert.notEqual(desktop.sourceProject, mobile.sourceProject);
  assert.equal(desktop.sourceDocument, 'se011.pdf');
  assert.equal(desktop.targetDocument, 'clickable-link-test.pdf');
  assert.match(desktop.renamedDocument, /^FULLAPP E2E desktop run-42/);
});

test('cleanup manifest fails closed until exact rows, storage, and reload absences are proved', () => {
  const names = createDurableNames('desktop', 'run-42');
  const manifest = createCleanupManifest({ surface: 'desktop', runId: 'run-42', names });
  assert.equal(manifest.collaboration.status, 'not-covered');
  manifest.created.projects.push(
    { id: 'project-a', name: names.sourceProject },
  );
  manifest.created.documents.push(
    { id: 'document-a', name: names.sourceDocument, file_path: 'owner/a.pdf' },
    { id: 'document-b', name: names.targetDocument, file_path: 'owner/b.pdf' },
  );
  assert.equal(finalizeCleanupManifest(structuredClone(manifest)).complete, false);

  manifest.requests.push(
    { resource: 'documents', operation: 'delete', ok: true, ids: ['document-a'] },
    { resource: 'documents', operation: 'delete', ok: true, ids: ['document-b'] },
    { resource: 'projects', operation: 'delete', ok: true, ids: ['project-a'] },
    { resource: 'storage', operation: 'delete', ok: true },
    { resource: 'storage', operation: 'delete', ok: true },
  );
  manifest.uiAbsenceAfterReload.documents.push(names.renamedDocument, names.targetDocument);
  Object.assign(manifest.workflowCoverage, {
    createProject: 'covered',
    uploadDocuments: 'covered:2',
    reloadList: 'covered',
    renameProject: 'covered',
    renameDocument: 'covered',
    openViewerAndBack: 'covered',
  });
  manifest.workflowCoverage.moveDocument = 'blocked: free tier project limit';
  manifest.uiAbsenceAfterReload.projects.push(names.renamedProject);
  const complete = finalizeCleanupManifest(manifest);
  assert.equal(complete.complete, true, complete.problems.join('\n'));
});

test('real-auth durable harness installs and checks leased identity without environment credentials', () => {
  const source = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  const install = source.indexOf('await installLeasedBrowserAccount(');
  const firstNavigation = source.indexOf('await page.goto(');
  assert.ok(install >= 0);
  assert.ok(firstNavigation > install, 'leased account must be installed before first navigation');
  assert.match(source, /await assertBrowserUsesLeasedAccount\(/);
  assert.doesNotMatch(source, /VITE_DEV_AUTO_LOGIN_(?:EMAIL|PASSWORD)/);
});

test('durable UI waits for loaded hub controls and uses supported locator APIs', () => {
  const source = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /querySelectorAll\('\.hub-skeleton-block'\)/);
  assert.match(source, /visibleInputWithValue\(page, oldName\)/);
  assert.doesNotMatch(source, /page\.getByDisplayValue/);
});

test('durable diagnostics retain navigation-aborted reads without treating them as backend failures', () => {
  const source = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /expectedAbortedRequests/);
  assert.match(source, /ERR_ABORTED/);
  assert.match(source, /\['GET', 'HEAD'\]\.includes/);
});
