// Real Electron lifecycle with a test-owned profile and no network/accounts.
// Default: production dist assets. Diagnostic override: SURVEY_MANAGED_LOCAL_QA_DEV=1.
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { _electron } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'survey-data-qa-'));
const evidence = await mkdtemp(path.join(tmpdir(), 'survey-managed-local-evidence-'));
const fixture = path.join(profile, 'managed-lifecycle.pdf');
const development = process.env.SURVEY_MANAGED_LOCAL_QA_DEV === '1';
const report = { environment: development ? 'Electron development localhost:5218' : 'Electron production file assets, all network denied', profile, evidence, checks: [], launches: [], sourceHashes: {} };
for (const name of ['src/electron-main.js', 'src/PDFViewer.jsx', 'src/AppShell.jsx', 'src/services/localDocumentStore.js', 'dist/index.html']) {
  report.sourceHashes[name] = createHash('sha256').update(await readFile(path.join(root, name))).digest('hex');
}
await copyFile(path.join(root, 'debug/fixtures/e2e/prog-07-form-fields.pdf'), fixture);
let desktop;
let page;
let launchEvidence;
const dirtyTitle = 'Unsaved changes (Cmd/Ctrl+S to save)';

async function launch() {
  desktop = await _electron.launch({
    args: [path.join(root, 'debug/managed-local-electron-entry.cjs')],
    env: { ...process.env, NODE_ENV: development ? 'development' : 'production', DEV_PORT: '5218', SURVEY_DATA_QA_PROFILE: profile },
    timeout: 30_000,
  });
  assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
  await desktop.evaluate(({ dialog }, fixturePath) => {
    global.__managedLocalDialogs = [];
    global.__managedLocalPickerCount = 0;
    dialog.showOpenDialog = async () => { global.__managedLocalPickerCount++; return { canceled: false, filePaths: [fixturePath] }; };
    // A failure must veto quit, never choose discard. Capture the actual dialog.
    dialog.showMessageBox = async (...args) => {
      global.__managedLocalDialogs.push(args.at(-1)); return { response: 0 };
    };
  }, fixture);
  page = await desktop.firstWindow();
  page.setDefaultTimeout(20_000);
  launchEvidence = { consoleErrors: [], pageErrors: [], saveLogs: [] };
  launchEvidence.native = await desktop.evaluate(({ app }) => ({ packaged: app.isPackaged, appPath: app.getAppPath(), userData: app.getPath('userData') }));
  report.launches.push(launchEvidence);
  page.on('console', message => {
    const text = message.text();
    if (message.type() === 'error') launchEvidence.consoleErrors.push(text.slice(0, 600));
    if (/save|local|persist|form/i.test(text)) launchEvidence.saveLogs.push(text.slice(0, 1200));
  });
  page.on('pageerror', error => launchEvidence.pageErrors.push(error.message));
  await page.waitForFunction(() => document.body?.innerText?.trim().length > 20);
  launchEvidence.url = page.url(); launchEvidence.title = await page.title();
  assert.ok(development ? page.url().startsWith('http://localhost:5218') : page.url().startsWith('file://'));
  const continueButton = page.getByRole('button', { name: 'Continue without an account', exact: true });
  if (await continueButton.isVisible()) await continueButton.click();
  await page.getByRole('button', { name: 'On this device', exact: true }).click();
  await page.getByRole('button', { name: 'Open local PDF', exact: true }).waitFor();
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
}

async function quit(label) {
  assert.equal(launchEvidence.pageErrors.length, 0, 'no uncaught renderer errors');
  const closed = desktop.waitForEvent('close', { timeout: 20_000 });
  const invoked = desktop.evaluate(({ app }) => {
    const snapshot = { nativeDialogs: global.__managedLocalDialogs, blockedRequests: global.__managedLocalBlockedRequests };
    app.quit(); return snapshot;
  }).then(snapshot => Object.assign(launchEvidence, snapshot));
  await Promise.all([closed, invoked]);
  desktop = null;
  report.checks.push(label);
}

async function openSaved(expected) {
  const saved = await inspectLibrary();
  assert.equal(saved.manifests.length, 1, 'one stable managed fixture in the library');
  assert.equal(saved.states.length, 1, 'managed snapshot is durable, not just localStorage');
  assert.ok(JSON.stringify(saved.states).includes(expected), 'canonical state contains the saved form value');
  if (report.localId) assert.equal(saved.manifests[0].localId, report.localId);
  report.localId = saved.manifests[0].localId;
  // Remove only this synthetic fixture's mirror. Reopen must restore IDB truth.
  await page.evaluate(keys => keys.forEach(key => localStorage.removeItem(key)), Object.keys(saved.states[0].state.entries));
  await page.getByRole('button', { name: 'Open managed-lifecycle.pdf', exact: true }).click();
  assert.equal(await desktop.evaluate(() => global.__managedLocalPickerCount), 0, 'cold library reopen never reimports the source file');
  const field = page.locator('input[name="siteRef"]');
  await field.waitFor();
  await page.waitForFunction(value => document.querySelector('input[name="siteRef"]')?.value === value, expected);
  const settlingStarted = Date.now();
  await page.waitForFunction(title => !document.querySelector(`[title="${title}"]`), dirtyTitle, { timeout: 5000 });
  // Observe beyond the form debounce/autosave window, not a single clean frame.
  await page.waitForTimeout(1100);
  assert.equal(await page.getByTitle(dirtyTitle, { exact: true }).count(), 0, 'cold reopen settles without a lingering dirty indicator');
  launchEvidence.coldReopenSettledMs = Date.now() - settlingStarted;
  return field;
}

async function inspectLibrary() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    let db; let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; clearTimeout(timer); db?.close();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('QA library inspection timed out')), 5000);
    const request = indexedDB.open('survey-local-documents-v1');
    request.onerror = () => finish(request.error);
    request.onsuccess = () => {
      db = request.result;
      if (settled) { db.close(); return; }
      if (!db.objectStoreNames.contains('manifests') || !db.objectStoreNames.contains('documentState')) { finish(null, { manifests: [], states: [] }); return; }
      const tx = db.transaction(['manifests', 'documentState'], 'readonly');
      const manifests = tx.objectStore('manifests').getAll();
      const states = tx.objectStore('documentState').getAll();
      tx.oncomplete = () => finish(null, { manifests: manifests.result, states: states.result });
      tx.onabort = () => finish(tx.error || new Error('QA library inspection aborted'));
    };
  }));
}

async function inspectLiveSnapshot() {
  const raw = await page.evaluate(() => {
    const host = document.getElementById('root');
    const rootKey = Object.keys(host || {}).find(key => key.startsWith('__reactContainer$'));
    const rootFiber = host?.[rootKey]?.stateNode?.current;
    let seen = 0;
    const walk = fiber => {
      if (!fiber || ++seen > 50000) return null;
      if (fiber.memoizedProps?.pdfFile?.localId) {
        const found = { canonical: fiber.memoizedProps.pdfFile._localDocumentState };
        for (let hook = fiber.memoizedState, count = 0; hook && count++ < 5000; hook = hook.next) {
          const value = hook.memoizedState;
          if (Array.isArray(value) && value[0]?.version === 1 && value[0]?.entries) found.current = value[0];
          if (value?.documentId && typeof value.signature === 'string') found.baseline = { pdfId: value.documentId, entries: JSON.parse(value.signature) };
        }
        if (found.current) return found;
      }
      return walk(fiber.child) || walk(fiber.sibling);
    };
    return walk(rootFiber);
  });
  if (!raw) return { error: 'No managed viewer snapshot found' };
  const diff = (left, right, prefix = '', results = []) => {
    if (results.length >= 40 || JSON.stringify(left) === JSON.stringify(right)) return results;
    if (left && right && typeof left === 'object' && typeof right === 'object') {
      for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) diff(left[key], right[key], `${prefix}/${key}`, results);
    } else results.push({ path: prefix, before: JSON.stringify(left)?.slice(0, 400), after: JSON.stringify(right)?.slice(0, 400) });
    return results;
  };
  const decode = state => Object.fromEntries(Object.entries(state?.entries || {}).map(([key, value]) => [key, JSON.parse(value)]));
  const annotations = state => {
    const key = Object.keys(state?.entries || {}).find(key => key.startsWith('annotationsByPage_'));
    return key ? JSON.parse(state.entries[key]) : {};
  };
  const idOf = item => item.pdfAnnotationId || item.id || item.data?.id || item.type;
  const order = state => Object.fromEntries(Object.entries(annotations(state)).map(([page, value]) => [page, (value.objects || []).map(idOf)]));
  const byId = state => Object.fromEntries(Object.entries(annotations(state)).map(([page, value]) => [page, Object.fromEntries((value.objects || []).map(item => [idOf(item), item]))]));
  return {
    entryEquality: Object.fromEntries(Object.keys(raw.current.entries).map(key => [key, {
      canonicalMatchesCurrent: raw.canonical?.entries?.[key] === raw.current.entries[key],
      baselineMatchesCurrent: raw.baseline?.entries?.[key] === raw.current.entries[key],
    }])),
    annotationOrder: { canonical: order(raw.canonical), current: order(raw.current), baseline: order(raw.baseline) },
    annotationByIdDiff: diff(byId(raw.canonical), byId(raw.current)),
    canonicalVsCurrent: diff(decode(raw.canonical), decode(raw.current)), baselineVsCurrent: diff(decode(raw.baseline), decode(raw.current)), canonicalVsBaseline: diff(decode(raw.canonical), decode(raw.baseline)),
  };
}

try {
  await launch();
  await page.getByRole('button', { name: 'Open local PDF', exact: true }).click();
  const field = page.locator('input[name="siteRef"]');
  await field.waitFor();
  assert.equal(await desktop.evaluate(() => global.__managedLocalPickerCount), 1, 'native picker feeds real preload/IPC import');
  await field.fill('Managed local manual save');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+s' : 'Control+s');
  await page.waitForFunction(title => !document.querySelector(`[title="${title}"]`), dirtyTitle);
  await page.waitForTimeout(650);
  assert.equal(await page.getByTitle(dirtyTitle, { exact: true }).count(), 0);
  assert.equal(await field.inputValue(), 'Managed local manual save');
  const imported = await inspectLibrary();
  assert.equal(imported.manifests.length, 1);
  report.localId = imported.manifests[0].localId;
  await page.screenshot({ path: path.join(evidence, 'manual-save.png') });
  report.checks.push('signed-out native managed import, focused form edit, manual Save');
  await quit('native app.quit after manual Save');

  await launch();
  const reopened = await openSaved('Managed local manual save');
  report.checks.push('exact-profile cold library reopen restores manual Save');
  await reopened.fill('Managed local focused native quit');
  assert.equal(await reopened.evaluate(element => element === document.activeElement), true);
  // No blur, screenshot, or debounce sleep between fill and native quit.
  await quit('native app.quit with focused pending form edit');

  await launch();
  await openSaved('Managed local focused native quit');
  await page.screenshot({ path: path.join(evidence, 'cold-reopen-focused-quit.png') });
  report.checks.push('exact-profile cold library reopen restores focused native-quit value');
  await quit('clean final native quit');
  report.result = 'passed';
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.result = 'failed'; report.error = error.stack || String(error);
  if (page && !page.isClosed()) {
    report.liveSnapshotAtFailure = await inspectLiveSnapshot().catch(error => ({ error: error.message }));
    report.libraryAtFailure = await inspectLibrary().then(({ manifests, states }) => ({
      manifests,
      states: states.map(row => ({ localId: row.localId, revision: row.revision,
        fields: Object.values(row.state.entries).flatMap(text => {
          try { return Object.values(JSON.parse(text)).flatMap(page => page?.objects || []).filter(item => item.type === 'form-field').map(item => item.data); }
          catch { return []; }
        }) })),
    })).catch(error => ({ error: error.message }));
    report.failureText = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000);
    await page.screenshot({ path: path.join(evidence, 'failure.png') }).catch(() => {});
  }
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  // Never bypass a real user's guard. Only dispose this exact fixture process.
  if (desktop) {
    const stopped = desktop.waitForEvent('close', { timeout: 10_000 }).catch(() => {});
    await desktop.evaluate(({ app }) => app.exit()).catch(() => {});
    await stopped;
  }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(report, null, 2));
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
