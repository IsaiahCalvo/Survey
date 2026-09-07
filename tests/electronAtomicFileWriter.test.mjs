import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAtomicFileWriter } = require('../src/electron/atomicFileWriter.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'survey-atomic-write-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'plan.pdf');
  await fs.writeFile(target, 'original', { mode: 0o640 });
  return { directory, target };
}

test('atomic write replaces complete bytes, preserves mode and leaves no temporary files', async (t) => {
  const { directory, target } = await fixture(t);
  assert.deepEqual(await createAtomicFileWriter()(target, new Uint8Array([1, 2, 3])), { success: true });
  assert.deepEqual(await fs.readFile(target), Buffer.from([1, 2, 3]));
  if (process.platform !== 'win32') assert.equal((await fs.stat(target)).mode & 0o777, 0o640);
  assert.deepEqual(await fs.readdir(directory), ['plan.pdf']);
});

test('failed replacement keeps the original path and cleans only its owned temporary file', async (t) => {
  const { directory, target } = await fixture(t);
  await fs.writeFile(`${target}.tmp`, 'other app temp');
  await fs.writeFile(`${target}.bak`, 'other app backup');
  const writer = createAtomicFileWriter({ filesystem: {
    ...fs,
    async rename(temporary, destination) {
      assert.equal(destination, target);
      assert.equal(await fs.readFile(target, 'utf8'), 'original');
      assert.equal(await fs.readFile(temporary, 'utf8'), 'next');
      throw Object.assign(new Error('rename denied'), { code: 'EACCES' });
    },
  } });
  await assert.rejects(writer(target, 'next'), /rename denied/);
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
  assert.deepEqual((await fs.readdir(directory)).sort(), ['plan.pdf', 'plan.pdf.bak', 'plan.pdf.tmp']);
});

test('same-path writes serialize in enqueue order, copy input bytes, and survive a rejected predecessor', async (t) => {
  const { directory, target } = await fixture(t);
  const renamed = [];
  const writer = createAtomicFileWriter({ filesystem: {
    ...fs,
    async rename(from, to) {
      const contents = await fs.readFile(from, 'utf8');
      renamed.push(contents);
      if (contents === 'bad') throw new Error('first fails');
      return fs.rename(from, to);
    },
  } });
  const bytes = Buffer.from('second');
  const first = writer(target, 'bad');
  const second = writer(target, bytes);
  bytes.fill(0);
  const third = writer(target, 'last');
  const results = await Promise.allSettled([first, second, third]);
  assert.deepEqual(results.map(result => result.status), ['rejected', 'fulfilled', 'fulfilled']);
  assert.deepEqual(renamed, ['bad', 'second', 'last']);
  assert.equal(await fs.readFile(target, 'utf8'), 'last');
  assert.deepEqual(await fs.readdir(directory), ['plan.pdf']);
});

test('failed data flush prevents replacement and cleans temporary bytes', async (t) => {
  const { directory, target } = await fixture(t);
  let renameCalls = 0;
  const writer = createAtomicFileWriter({ filesystem: {
    ...fs,
    async open(...args) {
      const handle = await fs.open(...args);
      if (args[1] !== 'wx') return handle;
      return {
        writeFile: (...writeArgs) => handle.writeFile(...writeArgs),
        sync: async () => { throw new Error('disk flush failed'); },
        close: () => handle.close(),
      };
    },
    rename: async (...args) => { renameCalls++; return fs.rename(...args); },
  } });
  await assert.rejects(writer(target, 'next'), /disk flush failed/);
  assert.equal(renameCalls, 0);
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
  assert.deepEqual(await fs.readdir(directory), ['plan.pdf']);
});

test('Windows skips only directory sync, while still flushing file bytes', async (t) => {
  const { target } = await fixture(t);
  let directoryOpens = 0;
  let fileSyncs = 0;
  const writer = createAtomicFileWriter({ platform: 'win32', filesystem: {
    ...fs,
    async open(...args) {
      if (args[1] === 'r') directoryOpens++;
      const handle = await fs.open(...args);
      return {
        writeFile: (...writeArgs) => handle.writeFile(...writeArgs),
        sync: async () => { fileSyncs++; await handle.sync(); },
        close: () => handle.close(),
      };
    },
  } });
  await writer(target, 'next');
  assert.equal(fileSyncs, 1);
  assert.equal(directoryOpens, 0);
});

test('new files work without a prior target', async (t) => {
  const { directory } = await fixture(t);
  const target = path.join(directory, 'new.pdf');
  await createAtomicFileWriter()(target, 'new');
  assert.equal(await fs.readFile(target, 'utf8'), 'new');
});

test('both Electron save entry points use the packaged writer and preserve the path guard', async () => {
  const source = await fs.readFile(new URL('../src/electron-main.js', import.meta.url), 'utf8');
  const packageJson = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(packageJson.build.files.includes('src/electron/atomicFileWriter.cjs'), 'Electron uses an explicit package allowlist; the helper must ship');
  const saveDialog = source.slice(source.indexOf("ipcMain.handle('dialog:saveFile'"), source.indexOf("ipcMain.handle('shell:openPath'"));
  const atomicHandler = source.slice(source.indexOf("ipcMain.handle('fs:writeFileAtomic'"), source.indexOf('// File watcher handlers'));
  assert.match(saveDialog, /await writeFileAtomic\(filePath, data\)/);
  assert.match(atomicHandler, /assertAllowedPath\(filePath, \{ forWrite: true \}\);\s*return writeFileAtomic\(filePath, data\)/);
});
