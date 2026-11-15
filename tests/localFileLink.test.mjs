// The desktop document's link to the file it was opened from (Nightly
// 'local-file-link', 2026-11-14): Survey writes back only while the file is
// still the one it knows, tells the viewer when another app changes or
// removes it, and never mistakes its own write for another app's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalFileLink, canLinkLocalFile, fileNameOf, sha256Hex } from '../src/services/localFileLink.js';

const enc = (s) => new TextEncoder().encode(s);

function fakeDesktop(initial) {
  const files = new Map([['/Users/me/plan.pdf', enc(initial)]]);
  const listeners = new Set();
  const watching = new Set();
  const api = {
    writes: 0,
    readFile: async (p) => {
      if (!files.has(p)) { const e = new Error(`ENOENT: no such file, open '${p}'`); e.code = 'ENOENT'; throw e; }
      return Buffer.from(files.get(p));
    },
    writeFileAtomic: async (p, data) => { api.writes += 1; files.set(p, Uint8Array.from(data)); },
    startFileWatcher: async (_p, id) => { watching.add(id); },
    stopFileWatcher: async (id) => { watching.delete(id); },
    onFileChanged: (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
  };
  const fire = async (id, event = 'change') => { for (const cb of [...listeners]) await cb({ watchId: id, filePath: '/Users/me/plan.pdf', event }); };
  const otherApp = (text) => files.set('/Users/me/plan.pdf', enc(text));
  const remove = () => files.delete('/Users/me/plan.pdf');
  return { api, fire, otherApp, remove, files, watching, listeners };
}

test('helpers', async () => {
  assert.equal(await sha256Hex(enc('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(fileNameOf('/Users/me/Plans/A-101.pdf'), 'A-101.pdf');
  assert.equal(fileNameOf('C:\\Jobs\\A-101.pdf'), 'A-101.pdf');
  assert.equal(canLinkLocalFile(null, '/x.pdf'), false);
  assert.equal(canLinkLocalFile(fakeDesktop('a').api, ''), false);
  assert.equal(canLinkLocalFile(fakeDesktop('a').api, '/x.pdf'), true);
});

test('saves back while the file is unchanged, and its own write is not an outside change', async () => {
  const d = fakeDesktop('v1');
  const told = [];
  const link = createLocalFileLink({ api: d.api, filePath: '/Users/me/plan.pdf', watchId: 'w', onOutsideChange: (c) => told.push(c) });
  assert.equal(await link.start(), await sha256Hex(enc('v1')));
  assert.ok(d.watching.has('w'));
  const out = await link.save(enc('v1+marks'));
  assert.equal(out.ok, true);
  assert.equal(new TextDecoder().decode(d.files.get('/Users/me/plan.pdf')), 'v1+marks');
  await d.fire('w');
  assert.deepEqual(told, []);
  // A second save after the first is fine too.
  assert.equal((await link.save(enc('v1+more'))).ok, true);
  assert.equal(d.api.writes, 2);
});

test('another app changes the file: the viewer is told once, and Save refuses to overwrite it', async () => {
  const d = fakeDesktop('v1');
  const told = [];
  const link = createLocalFileLink({ api: d.api, filePath: '/Users/me/plan.pdf', watchId: 'w', onOutsideChange: (c) => told.push(c) });
  await link.start();
  d.otherApp('v1 edited in Acrobat');
  await d.fire('w');
  await d.fire('w'); // a second event for the same bytes says nothing new
  assert.equal(told.length, 1);
  assert.equal(told[0].kind, 'changed');
  assert.equal(new TextDecoder().decode(told[0].bytes), 'v1 edited in Acrobat');
  assert.deepEqual(await link.save(enc('mine')), { ok: false, reason: 'changed' });
  assert.equal(d.api.writes, 0);
  assert.equal(new TextDecoder().decode(d.files.get('/Users/me/plan.pdf')), 'v1 edited in Acrobat');
  // Another change after that is told again.
  d.otherApp('edited twice');
  await d.fire('w');
  assert.equal(told.length, 2);
  // Keeping the other app's file as the known one lets Save write again.
  await link.adoptCurrent();
  assert.equal((await link.save(enc('mine'))).ok, true);
});

test('the file is moved or deleted: told as gone, and Save does not recreate it', async () => {
  const d = fakeDesktop('v1');
  const told = [];
  const link = createLocalFileLink({ api: d.api, filePath: '/Users/me/plan.pdf', watchId: 'w', onOutsideChange: (c) => told.push(c) });
  await link.start();
  d.remove();
  await d.fire('w', 'unlink');
  await d.fire('w', 'change');
  assert.deepEqual(told, [{ kind: 'gone' }]);
  assert.deepEqual(await link.save(enc('mine')), { ok: false, reason: 'gone' });
  assert.equal(d.files.has('/Users/me/plan.pdf'), false);
});

test('events for other watches are ignored, and stop ends the watch', async () => {
  const d = fakeDesktop('v1');
  const told = [];
  const link = createLocalFileLink({ api: d.api, filePath: '/Users/me/plan.pdf', watchId: 'w', onOutsideChange: (c) => told.push(c) });
  await link.start();
  d.otherApp('changed');
  await d.fire('someone-else');
  assert.deepEqual(told, []);
  await link.stop();
  assert.equal(d.watching.has('w'), false);
  assert.equal(d.listeners.size, 0);
  await d.fire('w');
  assert.deepEqual(told, []);
});
