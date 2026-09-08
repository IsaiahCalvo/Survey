import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createRecoveryBundleWriter, MAX_CHUNK_BYTES, MAX_BUNDLE_BYTES } = require('../src/electron/recoveryBundleWriter.cjs');
const owner = () => Object.assign(new EventEmitter(), { mainFrame: { url: 'file:///app/dist/index.html' }, isDestroyed: () => false });
const eventFor = sender => ({ sender, senderFrame: sender.mainFrame });
async function setup(t, overrides = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'survey-recovery-writer-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'owned.survey-recovery'); await fs.writeFile(target, 'original', { mode: 0o640 });
  const sender = owner(); const event = eventFor(sender); const dialogs = [];
  const writer = createRecoveryBundleWriter({ authorize: () => true,
    chooseDestination: async (_event, options) => { dialogs.push(options); return { canceled: false, filePath: target }; }, ...overrides });
  const start = (totalBytes = 4, name = 'test') => writer.start(event, { name, totalBytes });
  const untouched = async () => { assert.equal(await fs.readFile(target, 'utf8'), 'original'); assert.deepEqual(await fs.readdir(directory), ['owned.survey-recovery']); };
  return { directory, target, sender, event, writer, start, untouched, dialogs };
}
test('sequential bounded chunks atomically replace full bytes without exposing or accepting paths', async t => {
  const f = await setup(t); const begin = await f.start(6, '../../malicious\\name');
  assert.equal(begin.maxChunkBytes, MAX_CHUNK_BYTES); assert.equal(Object.hasOwn(begin, 'filePath'), false);
  assert.equal(f.dialogs[0].defaultPath.includes('/'), false); assert.ok(f.dialogs[0].defaultPath.endsWith('.survey-recovery'));
  await f.writer.append(f.event, { token: begin.token, offset: 0, data: new Uint8Array([1, 2]), path: '/never-used' });
  assert.equal(await fs.readFile(f.target, 'utf8'), 'original');
  await f.writer.append(f.event, { token: begin.token, offset: 2, data: new Uint8Array([3, 4, 5, 6]).buffer });
  assert.deepEqual(await f.writer.finish(f.event, { token: begin.token }), { success: true });
  assert.deepEqual(await fs.readFile(f.target), Buffer.from([1, 2, 3, 4, 5, 6]));
  assert.deepEqual(await fs.readdir(f.directory), ['owned.survey-recovery']);
  if (process.platform !== 'win32') assert.equal((await fs.stat(f.target)).mode & 0o777, 0o640);
  assert.equal(f.sender.listenerCount('destroyed'), 0);
});
test('size caps and cancelled native picker create no temporary files', async t => {
  const f = await setup(t, { chooseDestination: async () => ({ canceled: true }) });
  for (const size of [0, -1, NaN, Infinity, MAX_BUNDLE_BYTES + 1]) await assert.rejects(f.start(size), { code: 'input' });
  assert.deepEqual(await f.start(), { canceled: true }); await f.untouched();
  assert.deepEqual(await f.start(), { canceled: true }, 'cancel releases owner reservation');
});
test('untrusted senders and non-recovery destination names cannot create a file', async t => {
  const denied = await setup(t, { authorize: () => false });
  await assert.rejects(denied.start(), { code: 'sender' }); assert.equal(denied.dialogs.length, 0); await denied.untouched();
  const wrongName = await setup(t, { chooseDestination: async () => ({ filePath: path.join(os.tmpdir(), 'must-not-write.pdf') }) });
  await assert.rejects(wrongName.start(), { code: 'destination' }); await wrongName.untouched();
  const exactCap = await setup(t); const { token } = await exactCap.start(MAX_BUNDLE_BYTES);
  await exactCap.writer.abort(exactCap.event, { token }); await exactCap.untouched();
});
test('truncated, unordered, oversized, empty and non-byte chunks preserve the original and clean owned temp', async t => {
  for (const bad of ['truncated', 'offset', 'overflow', 'large', 'empty', 'fake']) {
    const f = await setup(t); const { token } = await f.start();
    if (bad === 'truncated') await assert.rejects(f.writer.finish(f.event, { token }), { code: 'truncated' });
    else await assert.rejects(f.writer.append(f.event, { token, offset: bad === 'offset' ? 2 : 0,
      data: bad === 'fake' ? [1, 2] : new Uint8Array(bad === 'large' ? MAX_CHUNK_BYTES + 1 : bad === 'overflow' ? 5 : bad === 'empty' ? 0 : 2) }));
    await f.untouched();
  }
});
test('tokens reject other owners, forged main frames and navigation; one active transfer per owner', async t => {
  const f = await setup(t); const { token } = await f.start();
  await assert.rejects(f.start(), { code: 'busy' });
  const other = owner();
  assert.throws(() => f.writer.append(eventFor(other), { token, offset: 0, data: new Uint8Array(4) }), { code: 'token' });
  assert.throws(() => f.writer.append({ sender: f.sender, senderFrame: { url: f.sender.mainFrame.url } }, { token }), { code: 'sender' });
  assert.throws(() => f.writer.finish(f.event, { token: 'fake' }), { code: 'token' });
  await f.writer.abort(f.event, { token }); await f.untouched();
  const next = await f.start(); f.sender.mainFrame.url = 'file:///different.html';
  assert.throws(() => f.writer.finish(f.event, { token: next.token }), { code: 'token' });
  f.sender.emit('did-start-loading');
  await new Promise(resolve => setTimeout(resolve, 15)); await f.untouched();
});
test('renderer crash, destruction, navigation and idle timeout remove only owned partial files', async t => {
  for (const action of ['destroyed', 'render-process-gone', 'did-start-loading', 'timeout']) {
    let fire;
    const f = await setup(t, { setTimer: callback => { fire = callback; return 1; }, clearTimer: () => {} });
    const { token } = await f.start(); await f.writer.append(f.event, { token, offset: 0, data: new Uint8Array([1, 2]) });
    if (action === 'timeout') fire(); else f.sender.emit(action);
    await new Promise(resolve => setTimeout(resolve, 15)); await f.untouched();
    assert.equal(f.sender.listenerCount('destroyed'), 0);
  }
});
test('write, file flush and rename failures never touch existing destination', async t => {
  for (const failAt of ['write', 'sync', 'rename']) {
    const f = await setup(t, { filesystem: { ...fs,
      async open(name, ...args) { const handle = await fs.open(name, ...args); if (!name.endsWith('.tmp')) return handle;
        return { write: (...params) => failAt === 'write' ? Promise.reject(Error('disk full')) : handle.write(...params),
          sync: () => failAt === 'sync' ? Promise.reject(Error('flush failed')) : handle.sync(), close: () => handle.close() }; },
      rename: (...args) => failAt === 'rename' ? Promise.reject(Error('rename failed')) : fs.rename(...args),
    } });
    const { token } = await f.start();
    if (failAt === 'write') await assert.rejects(f.writer.append(f.event, { token, offset: 0, data: new Uint8Array(4) }), { code: 'write' });
    else { await f.writer.append(f.event, { token, offset: 0, data: new Uint8Array(4) }); await assert.rejects(f.writer.finish(f.event, { token }), { code: 'write' }); }
    await f.untouched();
  }
});
test('directory flush failure after atomic commit reports success with an honest durability warning', async t => {
  const f = await setup(t, { platform: 'linux', filesystem: { ...fs, async open(name, ...args) {
    if (args[0] === 'r') return { sync: async () => { throw Error('directory flush failed'); }, close: async () => {} };
    return fs.open(name, ...args);
  } } });
  const { token } = await f.start(); await f.writer.append(f.event, { token, offset: 0, data: Buffer.from('next') });
  const result = await f.writer.finish(f.event, { token }); assert.equal(result.success, true); assert.match(result.durabilityWarning, /Keep the source draft/);
  assert.equal(await fs.readFile(f.target, 'utf8'), 'next');
});

test('abort during rename waits for the actual commit and never reports a failed rename as committed', async t => {
  for (const fail of [false, true]) {
    let release, entered;
    const enteredPromise = new Promise(resolve => { entered = resolve; });
    const f = await setup(t, { filesystem: { ...fs, async rename(...args) {
      entered(); await new Promise((resolve, reject) => { release = () => fail ? reject(Error('rename failed')) : resolve(); });
      return fs.rename(...args);
    } } });
    const { token } = await f.start(); await f.writer.append(f.event, { token, offset: 0, data: Buffer.from('next') });
    const finishing = f.writer.finish(f.event, { token });
    const finishRejected = fail ? assert.rejects(finishing, { code: 'write' }) : null;
    await enteredPromise;
    let abortSettled = false;
    const aborted = f.writer.abort(f.event, { token });
    aborted.then(() => { abortSettled = true; }, () => { abortSettled = true; });
    const abortRejected = fail ? assert.rejects(aborted, { code: 'write' }) : null;
    await Promise.resolve(); await Promise.resolve();
    assert.equal(abortSettled, false, 'an in-flight rename cannot produce a committed receipt');
    assert.equal(await fs.readFile(f.target, 'utf8'), 'original');
    release();
    if (fail) { await finishRejected; await abortRejected; await f.untouched(); }
    else { assert.deepEqual(await finishing, { success: true }); assert.deepEqual(await aborted, { success: true, committed: true }); assert.equal(await fs.readFile(f.target, 'utf8'), 'next'); }
  }
});
test('abort during pending IO prevents commit and overlapping steps reject', async t => {
  let release, entered; const enteredPromise = new Promise(resolve => { entered = resolve; });
  const f = await setup(t, { filesystem: { ...fs, async open(name, ...args) { const handle = await fs.open(name, ...args);
    return !name.endsWith('.tmp') ? handle : { write: async (...params) => { entered(); await new Promise(resolve => { release = resolve; }); return handle.write(...params); }, sync: () => handle.sync(), close: () => handle.close() };
  } } });
  const { token } = await f.start(); const writing = f.writer.append(f.event, { token, offset: 0, data: Buffer.from('next') });
  const rejected = assert.rejects(writing, { code: 'cancelled' }); await enteredPromise;
  assert.throws(() => f.writer.finish(f.event, { token }), { code: 'busy' });
  const aborted = f.writer.abort(f.event, { token }); release(); await rejected; await aborted; await f.untouched();
});

test('short writes loop, caller mutation is isolated and max-size chunks are accepted', async t => {
  let writes = 0;
  const f = await setup(t, { filesystem: { ...fs, async open(name, ...args) { const handle = await fs.open(name, ...args);
    return !name.endsWith('.tmp') ? handle : { write: (buffer, offset, length, position) => { writes++; return handle.write(buffer, offset, Math.min(length, 32768), position); }, sync: () => handle.sync(), close: () => handle.close() };
  } } });
  const { token } = await f.start(MAX_CHUNK_BYTES); const data = new Uint8Array(MAX_CHUNK_BYTES).fill(7);
  const writing = f.writer.append(f.event, { token, offset: 0, data }); data.fill(9); await writing;
  await f.writer.finish(f.event, { token }); assert.equal(writes, 32);
  assert.deepEqual(await fs.readFile(f.target), Buffer.alloc(MAX_CHUNK_BYTES, 7));
});

test('dialog in flight reserves the owner and a destroyed owner cannot publish a late chosen destination', async t => {
  let release;
  const f = await setup(t, { chooseDestination: () => new Promise(resolve => { release = resolve; }) });
  const starting = f.start(); const rejected = assert.rejects(starting, { code: 'cancelled' });
  await Promise.resolve(); await assert.rejects(f.start(), { code: 'busy' });
  f.sender.emit('destroyed'); release({ canceled: false, filePath: f.target }); await rejected;
  await new Promise(resolve => setTimeout(resolve, 10)); await f.untouched();
});

test('two windows cannot replace the same selected destination concurrently', async t => {
  const f = await setup(t); const first = await f.start();
  await assert.rejects(f.writer.start(eventFor(owner()), { name: 'other', totalBytes: 4 }));
  await f.writer.append(f.event, { token: first.token, offset: 0, data: Buffer.from('next') });
  await f.writer.finish(f.event, { token: first.token }); assert.equal(await fs.readFile(f.target, 'utf8'), 'next');
});

test('symlink-parent aliases share the destination lock and never follow the destination file symlink', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'survey-recovery-alias-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const real = path.join(directory, 'real'); await fs.mkdir(real);
  const alias = path.join(directory, 'alias');
  try { await fs.symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (error.code === 'EPERM') { t.skip('host cannot create directory symlinks'); return; } throw error; }
  const firstOwner = owner(), secondOwner = owner();
  const target = path.join(real, 'copy.survey-recovery'); await fs.writeFile(target, 'original');
  const writer = createRecoveryBundleWriter({ authorize: () => true,
    chooseDestination: async event => ({ filePath: path.join(event.sender === firstOwner ? real : alias, 'copy.survey-recovery') }) });
  const first = await writer.start(eventFor(firstOwner), { name: 'copy', totalBytes: 4 });
  await assert.rejects(writer.start(eventFor(secondOwner), { name: 'copy', totalBytes: 4 }), { code: 'busy' });
  assert.equal(await fs.readFile(target, 'utf8'), 'original');
  await writer.abort(eventFor(firstOwner), { token: first.token });
  assert.deepEqual(await fs.readdir(real), ['copy.survey-recovery']);
  const referent = path.join(directory, 'untouched.pdf'); await fs.writeFile(referent, 'referent');
  await fs.unlink(target);
  try { await fs.symlink(referent, target, 'file'); }
  catch (error) { if (error.code === 'EPERM') { t.diagnostic('host cannot create file symlinks; directory alias lock verified'); return; } throw error; }
  const next = await writer.start(eventFor(secondOwner), { name: 'copy', totalBytes: 4 });
  await writer.append(eventFor(secondOwner), { token: next.token, offset: 0, data: Buffer.from('next') });
  await writer.finish(eventFor(secondOwner), { token: next.token });
  assert.equal(await fs.readFile(target, 'utf8'), 'next');
  assert.equal((await fs.lstat(target)).isSymbolicLink(), false);
  assert.equal(await fs.readFile(referent, 'utf8'), 'referent');
});

test('macOS and Windows case aliases conservatively share one lock without rewriting the selected filename', async t => {
  for (const platform of ['darwin', 'win32']) {
    const f = await setup(t); const firstOwner = owner();
    const writer = createRecoveryBundleWriter({ authorize: () => true, platform,
      chooseDestination: async event => ({ filePath: event.sender === firstOwner ? f.target : path.join(f.directory, 'OWNED.survey-recovery') }) });
    const first = await writer.start(eventFor(firstOwner), { name: 'copy', totalBytes: 4 });
    await assert.rejects(writer.start(eventFor(owner()), { name: 'other', totalBytes: 4 }), { code: 'busy' });
    await writer.abort(eventFor(firstOwner), { token: first.token }); await f.untouched();
  }
});

test('main IPC trusts only registered native main frames and preload exposes no path parameter', async () => {
  const main = await fs.readFile(new URL('../src/electron-main.js', import.meta.url), 'utf8');
  const preload = await fs.readFile(new URL('../src/preload.js', import.meta.url), 'utf8');
  const registration = main.slice(main.indexOf('const recoveryBundleWriter ='), main.indexOf("ipcMain.handle('dialog:saveFile'"));
  assert.match(registration, /nativeEditorWindows\.get\(event\.sender\.id\)\?\.win\.webContents === event\.sender/);
  assert.match(registration, /isExpectedElectronAnalyticsEntry/);
  assert.match(registration, /showSaveDialog\(BrowserWindow\.fromWebContents\(event\.sender\), options\)/);
  for (const method of ['start', 'append', 'finish', 'abort']) assert.ok(preload.includes(`ipcRenderer.invoke('recovery-bundle:${method}'`));
});
