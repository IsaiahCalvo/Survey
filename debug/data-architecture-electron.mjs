// Run against the local no-auth Vite route. No account or cloud writes.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(path.join(tmpdir(), 'survey-data-qa-'));
let desktop;
try {
  desktop = await _electron.launch({
    args: [path.join(root, 'debug/data-architecture-electron-entry.cjs')],
    env: { ...process.env, NODE_ENV: 'development', DEV_PORT: '5218', SURVEY_DATA_QA_PROFILE: profile },
    timeout: 30_000,
  });
  assert.equal(await desktop.evaluate(({ app }) => app.getPath('userData')), profile);
  // The OS dialog has no renderer DOM. Capture its real main-process call in
  // this isolated fixture and select its only safe action, Keep open.
  await desktop.evaluate(({ dialog }) => {
    global.__qaQuitDialogs = [];
    dialog.showMessageBox = async (...args) => {
      global.__qaQuitDialogs.push(args.at(-1)); return { response: 0 };
    };
  });
  const page = await desktop.firstWindow();
  page.setDefaultTimeout(15_000);
  await page.goto('http://localhost:5218/?testPdf=e2e/prog-07-form-fields.pdf');
  await page.waitForFunction(() => [...document.querySelectorAll('canvas')].some(c => c.width > 400 && c.getBoundingClientRect().width > 400));

  // Real preload -> IPC -> filesystem, using only this test's own directory.
  const target = path.join(profile, 'saved.pdf');
  const results = await page.evaluate(async targetPath => Promise.all([
    window.electronAPI.writeFileAtomic(targetPath, new Uint8Array([1, 2, 3])),
    window.electronAPI.writeFileAtomic(targetPath, new Uint8Array([4, 5, 6])),
  ]), target);
  assert.ok(results.every(r => r.success));
  assert.deepEqual([...await readFile(target)], [4, 5, 6]);

  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__restoreQaStorage = () => { Storage.prototype.setItem = original; };
    localStorage.setItem('annotationsByPage_qa-neighbor', '{"keep":true}');
    Storage.prototype.setItem = function(key, value) {
      if (String(key).startsWith('annotationsByPage_')) throw new DOMException('QA quota failure', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  const field = page.locator('input[name="siteRef"]');
  await field.fill('Native quota QA');
  await field.blur();
  await page.keyboard.press('Meta+s');
  await page.getByText('Could not save a local copy. Keep this document open and retry Save.', { exact: true }).waitFor();
  assert.equal(await page.getByTitle('Unsaved changes (Cmd/Ctrl+S to save)', { exact: true }).count(), 1);
  await desktop.evaluate(({ app }) => app.quit());
  await desktop.evaluate(() => new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (global.__qaQuitDialogs.length) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > 10_000) { clearInterval(timer); reject(new Error('Missing native save failure dialog')); }
    }, 20);
  }));
  await page.waitForFunction(() => !document.documentElement.inert);
  assert.equal(page.isClosed(), false, 'failed local save must cancel native quit');
  assert.ok(await desktop.evaluate(() => global.__qaQuitDialogs.some(item => item.buttons.includes('Keep open'))));
  assert.equal(await page.evaluate(() => localStorage.getItem('annotationsByPage_qa-neighbor')), '{"keep":true}');
  await page.evaluate(() => window.__restoreQaStorage());
  await page.keyboard.press('Meta+s');
  await page.waitForFunction(() => !document.querySelector('[title="Unsaved changes (Cmd/Ctrl+S to save)"]'));
  // Do not blur: native close must commit this live PDF form input itself.
  await field.fill('Immediate native quit QA');
  const closed = desktop.waitForEvent('close', { timeout: 20_000 });
  await desktop.evaluate(({ app }) => app.quit());
  await closed;
  desktop = null;
  desktop = await _electron.launch({
    args: [path.join(root, 'debug/data-architecture-electron-entry.cjs')],
    env: { ...process.env, NODE_ENV: 'development', DEV_PORT: '5218', SURVEY_DATA_QA_PROFILE: profile },
    timeout: 30_000,
  });
  const restoredPage = await desktop.firstWindow();
  restoredPage.setDefaultTimeout(15_000);
  await restoredPage.goto('http://localhost:5218/?testPdf=e2e/prog-07-form-fields.pdf');
  await restoredPage.locator('input[name="siteRef"]').waitFor();
  assert.equal(await restoredPage.locator('input[name="siteRef"]').inputValue(), 'Immediate native quit QA', 'focused form value restores after actual process exit');
  await restoredPage.getByTitle('e2e/prog-07-form-fields.pdf', { exact: true }).locator('..').getByRole('button').click();
  await restoredPage.waitForFunction(() => !document.querySelector('input[name="siteRef"]'));
  const homeClosed = desktop.waitForEvent('close', { timeout: 20_000 });
  await desktop.evaluate(({ app }) => app.quit());
  await homeClosed;
  desktop = null;
  console.log(JSON.stringify({ nativeAtomicWrite: 'passed', localQuotaPreservesDirtyAndNeighbor: 'passed', nativeQuitVeto: 'passed', saveRetry: 'passed', focusedFieldNormalQuitAndRestore: 'passed', homeOnlyQuit: 'passed' }));
} finally {
  // A failed assertion may leave a deliberately vetoed save. Discard only
  // this fixture's isolated process/profile, never bypass a user's quit guard.
  if (desktop) await desktop.evaluate(({ app }) => app.exit()).catch(() => {});
  // Exact test-owned profile, never a user or shared app data directory.
  await rm(profile, { recursive: true, force: true });
}
