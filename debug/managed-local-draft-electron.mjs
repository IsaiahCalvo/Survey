// Actual process-crash recovery. This fixture never uses accounts or a user's
// profile, and reuses the entry that denies Chromium and native-fetch network.
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { _electron } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'survey-data-qa-'));
const evidence = await mkdtemp(path.join(tmpdir(), 'survey-draft-crash-evidence-'));
const fixture = path.join(profile, 'managed-crash.pdf');
const expected = 'Native crash draft retained';
const canonicalDB = 'survey-local-documents-v1';
const draftDB = 'survey-local-document-drafts-v1';
const report = { environment: 'Real Electron main, production file assets, isolated profile, network denied', profile, evidence, checks: [], launches: [], hashes: {} };
for (const name of ['src/electron-main.js', 'src/PDFViewer.jsx', 'src/Dashboard.jsx', 'src/hooks/useManagedLocalDraftTracking.js', 'src/services/localDocumentDraftStore.js', 'src/services/localDocumentStore.js', 'dist/index.html']) {
  report.hashes[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
}
await copyFile(path.join(root, 'debug/fixtures/e2e/prog-07-form-fields.pdf'), fixture);
report.fixtureSha256 = createHash('sha256').update(await readFile(fixture)).digest('hex');
let desktop; let page; let launchEvidence;

async function launch() {
  desktop = await _electron.launch({ args: [path.join(root, 'debug/managed-local-electron-entry.cjs')],
    env: { ...process.env, NODE_ENV: 'production', SURVEY_MANAGED_LOCAL_QA_DEV: '0', SURVEY_DATA_QA_PROFILE: profile }, timeout: 30_000 });
  assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
  await desktop.evaluate(({ dialog }, fixturePath) => {
    global.__draftCrashNativeDialogs = [];
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixturePath] });
    dialog.showMessageBox = async (...args) => { global.__draftCrashNativeDialogs.push(args.at(-1)); return { response: 0 }; };
  }, fixture);
  page = await desktop.firstWindow(); page.setDefaultTimeout(20_000);
  launchEvidence = { errors: [], pageErrors: [], saveLogs: [] }; report.launches.push(launchEvidence);
  page.on('console', message => {
    if (message.type() === 'error') launchEvidence.errors.push(message.text().slice(0, 600));
    if (/PDFSaveExport|Error saving|recovery storage/i.test(message.text())) launchEvidence.saveLogs.push(message.text().slice(0, 1200));
  });
  page.on('pageerror', error => launchEvidence.pageErrors.push(error.message));
  await page.waitForFunction(() => document.body?.innerText?.trim().length > 20);
  launchEvidence.url = page.url(); launchEvidence.title = await page.title();
  launchEvidence.native = await desktop.evaluate(({ app }) => ({ userData: app.getPath('userData'), appPath: app.getAppPath(), packaged: app.isPackaged, pid: process.pid }));
  assert.ok(page.url().startsWith('file://'));
  const guest = page.getByRole('button', { name: 'Continue without an account', exact: true });
  if (await guest.isVisible()) await guest.click();
  await page.getByRole('button', { name: 'On this device', exact: true }).click();
  await page.getByRole('button', { name: 'Open local PDF', exact: true }).waitFor();
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
}

// Read exact committed IDB records, not localStorage or an uncommitted editor
// state. Absence does not open/create an empty database ahead of the product.
async function records(name, names) {
  return page.evaluate(async ({ name, names }) => {
    if (!(await indexedDB.databases()).some(db => db.name === name)) return null;
    const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
    return new Promise((resolve, reject) => {
      let db; let settled = false;
      const finish = (error, result) => {
        if (settled) return; settled = true; clearTimeout(timer); db?.close();
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('QA IDB snapshot timed out')), 5000);
      const open = indexedDB.open(name);
      open.onerror = () => finish(open.error);
      open.onsuccess = () => {
        db = open.result;
        if (settled) { db.close(); return; }
        if (names.some(name => !db.objectStoreNames.contains(name))) { finish(null, null); return; }
        // Include v2 payloads in the SAME snapshot as their session references.
        // Legacy v1 databases retain inline blobs and have no shared store.
        const snapshotNames = [...names];
        if (names.includes('sessions') && db.objectStoreNames.contains('sharedPdfBytes')) snapshotNames.push('sharedPdfBytes');
        const tx = db.transaction(snapshotNames, 'readonly');
        const requests = snapshotNames.map(name => tx.objectStore(name).getAll());
        tx.onabort = () => finish(tx.error || new Error('QA IDB snapshot aborted'));
        tx.oncomplete = async () => {
          try {
            const result = {};
            const raw = Object.fromEntries(snapshotNames.map((name, index) => [name, requests[index].result]));
            const shared = new Map((raw.sharedPdfBytes || []).map(row => [row.payloadId, row]));
            for (const storeName of snapshotNames) result[storeName] = await Promise.all(raw[storeName].map(async row => {
              const copy = { ...row };
              let blob = copy.blob;
              if (storeName === 'pdfBytes' && names.includes('sessions') && Object.hasOwn(copy, 'payloadId')) {
                const payload = shared.get(copy.payloadId);
                if (Object.hasOwn(copy, 'blob') || !payload || payload.incarnation !== copy.payloadIncarnation
                  || payload.fingerprint !== copy.payloadId || copy.fingerprint !== copy.payloadId
                  || payload.size !== copy.size || !(payload.blob instanceof Blob) || payload.blob.size !== copy.size) {
                  throw new Error('QA draft byte reference does not resolve to its exact shared payload');
                }
                blob = payload.blob;
              }
              if (blob) { copy.byteSize = blob.size; copy.byteSha256 = await hash(await blob.arrayBuffer()); delete copy.blob; }
              if (copy.state) {
                copy.stateSha256 = await hash(new TextEncoder().encode(JSON.stringify(copy.state)));
                copy.statePdfId = copy.state.pdfId;
                copy.fields = Object.entries(copy.state.entries).filter(([key]) => key.startsWith('annotationsByPage_')).flatMap(([_key, value]) =>
                  Object.values(JSON.parse(value)).flatMap(page => page?.objects || []).filter(item => item.type === 'form-field').map(item => ({ name: item.data.fieldName, value: item.data.value })));
                delete copy.state;
              }
              return copy;
            }));
            finish(null, result);
          } catch (error) { finish(error); }
        };
      };
    });
  }, { name, names });
}
const library = () => records(canonicalDB, ['manifests', 'pdfBytes', 'documentState']);
const drafts = () => records(draftDB, ['sessions', 'pdfBytes', 'snapshots']);

try {
  await launch();
  await page.getByRole('button', { name: 'Open local PDF', exact: true }).click();
  const field = page.locator('input[name="siteRef"]'); await field.waitFor();
  assert.equal(await field.inputValue(), '');
  const original = await library(); assert.equal(original.manifests.length, 1);
  report.originalId = original.manifests[0].localId;
  assert.equal(original.manifests[0].revision, 1); assert.deepEqual(original.documentState, []);
  assert.equal(original.pdfBytes[0].byteSha256, report.fixtureSha256);
  const editedAt = Date.now();
  await field.fill(expected);
  let committed;
  while (Date.now() - editedAt < 10_000) {
    const candidate = await drafts();
    if (candidate?.snapshots.some(row => row.fields?.some(field => field.name === 'siteRef' && field.value === expected))) { committed = candidate; break; }
    await page.waitForTimeout(30);
  }
  assert.ok(committed, 'exact edited field must reach a committed recovery transaction');
  report.draftCommitElapsedMs = Date.now() - editedAt;
  assert.ok(report.draftCommitElapsedMs < 10_000, 'receipt arrives before the30-second canonical autosave');
  assert.equal(committed.sessions.length, 1); assert.equal(committed.sessions[0].discarded, false);
  assert.equal(committed.sessions[0].sourceLocalId, report.originalId);
  assert.equal(committed.pdfBytes[0].byteSha256, report.fixtureSha256);
  report.draftBeforeCrash = committed;
  report.originalBeforeCrash = await library();
  assert.deepEqual(report.originalBeforeCrash, original, 'draft capture does not save or alter the original');
  assert.equal(launchEvidence.saveLogs.length, 0, 'neither manual Save nor autosave ran before crash');
  report.checks.push('signed-out native import; exact form draft committed before canonical autosave');

  // Kill exactly the main PID launched by this fixture, after checking its
  // profile and Playwright child identity. Do not invoke app.quit()/Save.
  const ownedPid = desktop.process().pid;
  assert.equal(ownedPid, launchEvidence.native.pid); assert.ok(Number.isSafeInteger(ownedPid) && ownedPid > 1);
  assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
  launchEvidence.blockedRequests = await desktop.evaluate(() => global.__managedLocalBlockedRequests);
  report.crash = { signal: 'SIGKILL', pid: ownedPid, elapsedSinceEditMs: Date.now() - editedAt };
  assert.ok(report.crash.elapsedSinceEditMs < 30_000);
  const crashed = desktop.waitForEvent('close', { timeout: 15_000 });
  process.kill(ownedPid, 'SIGKILL'); await crashed; desktop = null;
  report.checks.push('abrupt SIGKILL of only the verified test-owned Electron PID');

  await launch();
  assert.deepEqual(await library(), original, 'original bytes/state/revision unchanged across abrupt crash');
  const afterCrash = await drafts();
  assert.deepEqual(afterCrash, committed, 'the exact recovery receipt survives process termination');
  await page.getByRole('region', { name: 'Recovery copies', exact: true }).getByRole('button', { name: 'Recover managed-crash.pdf as copy', exact: true }).click();
  const recoveredField = page.locator('input[name="siteRef"]'); await recoveredField.waitFor();
  await page.waitForFunction(value => document.querySelector('input[name="siteRef"]')?.value === value, expected);
  const recovered = await library();
  assert.equal(recovered.manifests.length, 2);
  const copy = recovered.manifests.find(row => row.localId !== report.originalId);
  assert.ok(copy); assert.equal(copy.name, 'managed-crash (recovered).pdf');
  report.recoveredId = copy.localId;
  assert.notEqual(report.recoveredId, report.originalId);
  assert.deepEqual(recovered.manifests.find(row => row.localId === report.originalId), original.manifests[0]);
  assert.deepEqual(recovered.pdfBytes.find(row => row.localId === report.originalId), original.pdfBytes[0]);
  assert.equal(recovered.documentState.some(row => row.localId === report.originalId), false);
  const recoveredState = recovered.documentState.find(row => row.localId === report.recoveredId);
  assert.ok(recoveredState.fields.some(field => field.name === 'siteRef' && field.value === expected));
  assert.equal(recoveredState.statePdfId, report.recoveredId, 'state identity is rebased onto the separate recovered copy');
  assert.equal(recovered.pdfBytes.find(row => row.localId === report.recoveredId).byteSha256, report.fixtureSha256);
  assert.deepEqual(await drafts(), committed, 'Recover as copy retains the source recovery draft');
  await page.waitForFunction(() => !document.querySelector('[title="Unsaved changes (Cmd/Ctrl+S to save)"]'));
  await page.screenshot({ path: path.join(evidence, 'recovered-copy.png') });
  report.checks.push('same-profile UI Recover as copy restores exact edit under a different local ID; original and draft preserved');

  await page.getByText('Home', { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open managed-crash.pdf', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('input[name="siteRef"]')].some(field => field.getBoundingClientRect().width > 0 && field.value === ''));
  assert.equal(await page.locator('input[name="siteRef"]:visible').inputValue(), '', 'visible original form remains unedited');
  await page.getByText('Home', { exact: true }).first().click();
  await page.getByRole('region', { name: 'Recovery copies', exact: true }).getByRole('button', { name: 'Recover managed-crash.pdf as copy', exact: true }).waitFor();
  await page.screenshot({ path: path.join(evidence, 'original-copy-and-retained-draft.png') });
  report.checks.push('visible original reopens empty; recovery UI still offers the retained draft');
  report.libraryAfterRecovery = recovered;
  launchEvidence.blockedRequests = await desktop.evaluate(() => global.__managedLocalBlockedRequests);
  assert.ok(report.launches.every(launch => launch.pageErrors.length === 0));
  const closed = desktop.waitForEvent('close', { timeout: 20_000 });
  await desktop.evaluate(({ app }) => app.quit()); await closed; desktop = null;
  report.result = 'passed';
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.result = 'failed'; report.error = error.stack || String(error);
  if (page && !page.isClosed()) {
    report.failureText = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000);
    report.libraryAtFailure = await library().catch(error => ({ error: error.message }));
    report.draftsAtFailure = await drafts().catch(error => ({ error: error.message }));
    await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  }
  console.error(JSON.stringify(report, null, 2)); process.exitCode = 1;
} finally {
  if (desktop) {
    const closed = desktop.waitForEvent('close', { timeout: 10_000 }).catch(() => {});
    await desktop.evaluate(({ app }) => app.exit()).catch(() => {}); await closed;
  }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
