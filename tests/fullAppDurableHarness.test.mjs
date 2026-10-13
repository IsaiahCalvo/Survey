import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  createCleanupManifest,
  createDurableNames,
  documentCleanupProblems,
  exactDocumentCleanupProblems,
  finalizeCleanupManifest,
  isExpectedMissingLegacySidecar,
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
    ownerAccount: null,
    inviteeAccount: null,
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
    { resource: 'storage', operation: 'delete', ok: true, paths: ['owner/a.pdf'] },
    { resource: 'storage', operation: 'delete', ok: true, paths: ['owner/b.pdf'] },
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
  assert.deepEqual(documentCleanupProblems(manifest), []);
});

test('project cleanup is gated on exact document and storage deletes', () => {
  const source = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /await tracker\.flush\(\);[\s\S]*?documentCleanupProblems\(manifest\)/);
  assert.match(source, /if \(documentsExplicitlyClean\) \{[\s\S]*?deleteProjectsByName/);
  assert.match(source, /project cleanup skipped: explicit document\/storage deletion was not proved first/);
  assert.doesNotMatch(source, /page\.keyboard\.press\('Escape'\)/);
});

test('each UI document delete waits for the product completion signal and exact DB/storage proof before reload', () => {
  const source = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  const deletion = source.slice(
    source.indexOf('async function deleteDocumentByName'),
    source.indexOf('async function deleteProjectsByName'),
  );
  const completion = deletion.indexOf("page.waitForEvent('console'");
  const proof = deletion.indexOf('exactDocumentCleanupProblems');
  const reload = deletion.indexOf('await page.reload');
  assert.ok(completion >= 0, 'must wait for the app delete completion');
  assert.ok(proof > completion, 'must prove exact completed requests after app completion');
  assert.ok(reload > proof, 'must not reload before DB/storage completion proof');
  assert.match(deletion, /\[DocumentDelete\] verify:removed/);
  assert.match(deletion, /await tracker\.flush\(\)/);
});

test('exact per-document cleanup proof fails closed for either missing response', () => {
  const manifest = createCleanupManifest({
    surface: 'desktop',
    runId: 'run-42',
    names: createDurableNames('desktop', 'run-42'),
  });
  const document = { id: 'document-a', file_path: 'owner/a.pdf' };
  assert.deepEqual(exactDocumentCleanupProblems(manifest, document), [
    'document DELETE not completed for document-a',
    'storage DELETE not completed for owner/a.pdf',
  ]);
  manifest.requests.push({ resource: 'documents', operation: 'delete', ok: true, ids: ['document-a'] });
  assert.deepEqual(exactDocumentCleanupProblems(manifest, document), [
    'storage DELETE not completed for owner/a.pdf',
  ]);
  manifest.requests.push({ resource: 'storage', operation: 'delete', ok: true, paths: ['owner/a.pdf'] });
  assert.deepEqual(exactDocumentCleanupProblems(manifest, document), []);
});

test('project cleanup waits for exact project DELETE responses before reload', () => {
  const source = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  const deletion = source.slice(
    source.indexOf('async function deleteProjectsByName'),
    source.indexOf('async function runSurface'),
  );
  assert.match(deletion, /responseDeletesId\(response, 'projects', project\.id\)/);
  assert.match(deletion, /const completionError = await response\.finished\(\)/);
  assert.match(deletion, /invariant\(!completionError/);
  assert.ok(deletion.indexOf('await response.finished()') < deletion.indexOf('await page.reload'));
});

test('owner cleanup closes Manage Team through its scoped Done control', () => {
  const source = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  const cleanupState = source.slice(
    source.indexOf('async function closeManageTeamForCleanup'),
    source.indexOf('async function deleteDocumentByName'),
  );
  assert.match(cleanupState, /\[data-kal31-manage-team="true"\]/);
  assert.match(cleanupState, /manageTeam\.getByRole\('button', \{ name: 'Done', exact: true \}\)/);
  assert.match(cleanupState, /await manageTeam\.waitFor\(\{ state: 'hidden'/);
});

test('real-auth durable harness installs and checks leased identity without environment credentials', () => {
  const source = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  const install = source.indexOf('await installLeasedBrowserAccount(');
  const firstNavigation = source.indexOf('await page.goto(');
  assert.ok(install >= 0);
  assert.ok(firstNavigation > install, 'leased account must be installed before first navigation');
  assert.match(source, /await assertBrowserUsesLeasedAccount\(/);
  assert.match(source, /loadVerifiedTestAccounts/);
  assert.match(source, /resolveLeasedCollaborationAccounts/);
  assert.match(source, /assertRuntimeOwnerEntitlement/);
  assert.doesNotMatch(source, /VITE_DEV_AUTO_LOGIN_(?:EMAIL|PASSWORD)/);
});

test('durable UI waits for loaded hub controls and uses supported locator APIs', () => {
  const source = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /querySelectorAll\('\.hub-loading-region, \[data-quiet-loading\]'\)/);
  assert.match(source, /visibleInputWithValue\(page, oldName\)/);
  assert.doesNotMatch(source, /page\.getByDisplayValue/);
});

test('move/copy destination is a real accessible control and harness clicks it without force', () => {
  const harness = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../src/home/BulkModals.jsx', import.meta.url), 'utf8');
  assert.match(modal, /role="dialog" aria-modal="true" aria-label="Move or copy documents"/);
  assert.match(modal, /<button[\s\S]*?aria-pressed=\{destId === p\.id\}/);
  assert.match(harness, /getByRole\('dialog', \{ name: 'Move or copy documents'/);
  assert.match(harness, /moveDialog\.getByRole\('button', \{ name: targetProject, exact: true \}\)/);
  assert.match(harness, /getAttribute\('aria-pressed'\) === 'true'/);
  assert.doesNotMatch(harness, /destination\.click\(\{\s*force:\s*true/);
});

test('move waits for its exact successful PATCH and product completion before reload', () => {
  const harness = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../src/home/BulkModals.jsx', import.meta.url), 'utf8');
  const ledger = readFileSync(new URL('../src/home/DocumentsLedger.jsx', import.meta.url), 'utf8');
  const move = harness.slice(harness.indexOf('async function moveDocument'), harness.indexOf('async function openViewerAndReturn'));
  const responseWait = move.indexOf('page.waitForResponse');
  const responseFinished = move.indexOf('await moveResponse.finished()');
  const modalHidden = move.indexOf("moveDialog.waitFor({ state: 'hidden'");
  const reload = move.indexOf('await page.reload');
  assert.ok(responseWait >= 0 && responseFinished > responseWait);
  assert.ok(modalHidden > responseFinished && reload > modalHidden);
  assert.match(move, /responseMovesDocument\(response, createdDocument\.id, createdTargetProject\.id\)/);
  assert.match(move, /invariant\(moveResponse\.ok\(\)/);
  assert.match(modal, /await onConfirm\?\.\(destId, mode\);[\s\S]*?onClose\?\.\(\)/);
  assert.match(ledger, /onConfirm=\{async \(destId, mode\) => \{[\s\S]*?await onMoveCopy\?\.\(/);
});

test('durable diagnostics retain navigation-aborted reads without treating them as backend failures', () => {
  const source = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /expectedAbortedRequests/);
  assert.match(source, /ERR_ABORTED/);
  assert.match(source, /\['GET', 'HEAD'\]\.includes/);
});

test('console 400s are expected only when paired to a verified captcha backend response', () => {
  const source = readFileSync(new URL('../agent-cli/full-app-durable-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /\/auth\/v1\/token/);
  assert.match(source, /verified dev-auto-login captcha fallback/);
  assert.match(source, /\/captcha\/i\.test/);
  assert.match(source, /Math\.abs\(entry\.atMs - event\.at\) <= 2_000/);
  assert.match(source, /httpErrorResponses/);
  assert.match(source, /manifest\.browserDiagnostics = await diagnostics\.snapshot\(\)/);
  assert.doesNotMatch(source, /beforeVerified && \/turnstile\|captcha/);
});

test('missing legacy sidecar is expected only for an exact created project/document pair', () => {
  const names = createDurableNames('desktop', 'run-42');
  const manifest = createCleanupManifest({ surface: 'desktop', runId: 'run-42', names });
  manifest.created.projects.push({ id: 'project-a', name: names.sourceProject });
  manifest.created.documents.push({
    id: 'document-a',
    project_id: 'project-a',
    name: names.sourceDocument,
    file_path: 'owner/a.pdf',
  });
  const exact = {
    url: 'https://example.supabase.co/storage/v1/object/documents/project-a/document-a_data.json',
    status: 400,
    errorCode: 'NoSuchKey',
    manifest,
  };
  assert.equal(isExpectedMissingLegacySidecar(exact), true);
  manifest.created.projects.push({ id: 'project-b', name: names.targetProject });
  assert.equal(isExpectedMissingLegacySidecar({
    ...exact,
    url: 'https://example.supabase.co/storage/v1/object/documents/project-b/document-a_data.json',
  }), true, 'a moved document uses its created target project in the sidecar path');
  assert.equal(isExpectedMissingLegacySidecar({ ...exact, status: 404 }), false);
  assert.equal(isExpectedMissingLegacySidecar({ ...exact, errorCode: 'AccessDenied' }), false);
  assert.equal(isExpectedMissingLegacySidecar({
    ...exact,
    url: 'https://example.supabase.co/storage/v1/object/documents/project-a/foreign-document_data.json',
  }), false);
  assert.equal(isExpectedMissingLegacySidecar({
    ...exact,
    url: 'https://example.supabase.co/storage/v1/object/documents/foreign-project/document-a_data.json',
  }), false);
});
