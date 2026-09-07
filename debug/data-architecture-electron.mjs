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
  const page = await desktop.firstWindow();
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
  await page.keyboard.press('Meta+s');
  await page.getByText('Could not save a local copy. Keep this document open and retry Save.', { exact: true }).waitFor();
  assert.equal(await page.getByTitle('Unsaved changes (Cmd/Ctrl+S to save)', { exact: true }).count(), 1);
  await desktop.evaluate(({ app }) => app.quit());
  // The old code always quit after five seconds, even after a save failed.
  await new Promise(resolve => setTimeout(resolve, 5400));
  assert.equal(page.isClosed(), false, 'failed local save must cancel native quit');
  assert.equal(await page.evaluate(() => localStorage.getItem('annotationsByPage_qa-neighbor')), '{"keep":true}');
  await page.evaluate(() => window.__restoreQaStorage());
  await page.keyboard.press('Meta+s');
  await page.waitForFunction(() => !document.querySelector('[title="Unsaved changes (Cmd/Ctrl+S to save)"]'));
  console.log(JSON.stringify({ nativeAtomicWrite: 'passed', localQuotaPreservesDirtyAndNeighbor: 'passed', nativeQuitVeto: 'passed', saveRetry: 'passed' }));
} finally {
  if (desktop) await desktop.close();
  // Exact test-owned profile, never a user or shared app data directory.
  await rm(profile, { recursive: true, force: true });
}
