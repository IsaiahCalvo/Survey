// OneDrive save-back in the app (Nightly flag 'drive-sync-back'):
// hooks/useDriveSyncBack.js pushes the marked-up PDF only after a change made
// on this screen, on its timer or on "Sync to OneDrive now", and raises
// Drawboard's dialogs for a conflict, a gone file and a read-only file.
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { webcrypto } from 'node:crypto';

import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

async function loadHook() {
  const reactUrl = pathToFileURL(require.resolve('react')).href;
  const editUrl = pathToFileURL(path.join(repoRoot, 'src/utils/localMarkEdit.js')).href;
  let source = await readFile(path.join(repoRoot, 'src/hooks/useDriveSyncBack.js'), 'utf8');
  source = source
    .replace("from 'react';", `from ${JSON.stringify(reactUrl)};`)
    .replace(/import \{[^}]*\} from '\.\.\/services\/driveFilesClient\.js';/, `
      const DRIVE_LINK_CHANGED_EVENT = 'survey:drive-link-changed';
      const driveCall = () => ({ error: 'no server in tests' });
      const uploadToDrive = async () => null;
      async function sha256Hex(bytes) {
        const d = await globalThis.crypto.subtle.digest('SHA-256', bytes);
        return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
      }`)
    .replace("from '../utils/localMarkEdit.js';", `from ${JSON.stringify(editUrl)};`);
  const dir = await mkdtemp(path.join(tmpdir(), 'drive-sync-back-'));
  const file = path.join(dir, 'useDriveSyncBack.mjs');
  await writeFile(file, source);
  try { return await import(pathToFileURL(file).href); } finally { await rm(dir, { recursive: true, force: true }); }
}

function setupDom() {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://surveytool.app/' });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.CustomEvent = dom.window.CustomEvent;
  globalThis.dispatchEvent = (e) => dom.window.dispatchEvent(e);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  if (!globalThis.crypto?.subtle) globalThis.crypto = webcrypto;
  return dom;
}

const LINK = { provider: 'msgraph', name: 'Plan.pdf', webUrl: 'https://x.sharepoint.com/Plan.pdf', syncMinutes: 5, syncOff: false, lastPushedAt: null, lastPushedSha: null, lastError: null };

function fakeServer({ pushAnswer } = {}) {
  const calls = [];
  let link = { ...LINK };
  const call = async (action, body) => {
    calls.push({ action, body });
    if (action === 'driveStatus') return { link, canPush: true };
    if (action === 'drivePush') return pushAnswer ? pushAnswer(body) : { uploadUrl: 'https://up.example/session' };
    if (action === 'drivePushed') { link = { ...link, lastPushedAt: new Date().toISOString(), lastPushedSha: body.sha, syncOff: body.force ? false : link.syncOff }; return { link }; }
    if (action === 'driveSettings') { link = { ...link, ...(body.syncOff !== undefined ? { syncOff: body.syncOff } : {}), ...(body.syncMinutes ? { syncMinutes: body.syncMinutes } : {}) }; return { link }; }
    if (action === 'driveUnlink') { link = null; return { link: null }; }
    return { error: 'unknown' };
  };
  return { calls, call, setLink: (patch) => { link = { ...link, ...patch }; } };
}

async function mount(useDriveSyncBack, props) {
  const box = { state: null };
  function Probe(p) { box.state = useDriveSyncBack(p); return null; }
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Probe, props)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return { box, root, rerender: async (next) => act(async () => { root.render(React.createElement(Probe, next)); }) };
}

const edit = (documentId) => window.dispatchEvent(new window.CustomEvent('survey:local-mark-edit', { detail: { documentId } }));

test('nextPushAt waits the minutes after the first change, and never while off or clean', async () => {
  const { nextPushAt, pushedElsewhereSince } = await loadHook();
  assert.equal(nextPushAt({ link: LINK, canPush: true, dirtySince: 0 }), null);
  assert.equal(nextPushAt({ link: { ...LINK, syncOff: true }, canPush: true, dirtySince: 1000 }), null);
  assert.equal(nextPushAt({ link: LINK, canPush: false, dirtySince: 1000 }), null);
  assert.equal(nextPushAt({ link: LINK, canPush: true, dirtySince: 1000 }), 1000 + 5 * 60_000);
  assert.equal(nextPushAt({ link: LINK, canPush: true, dirtySince: 1000, retryAt: 9_999_999 }), 9_999_999);
  assert.equal(pushedElsewhereSince({ lastPushedAt: new Date(100_000).toISOString() }, 10_000), true);
  assert.equal(pushedElsewhereSince({ lastPushedAt: new Date(12_000).toISOString() }, 10_000), false);
  assert.equal(pushedElsewhereSince({ lastPushedAt: null }, 10_000), false);
});

test('Sync now sends the marked-up PDF once, records its fingerprint, and skips an unchanged second push', async () => {
  setupDom();
  const { useDriveSyncBack } = await loadHook();
  const server = fakeServer();
  const uploads = [];
  const bytes = new TextEncoder().encode('%PDF-1.7 marked');
  const { box, root } = await mount(useDriveSyncBack, {
    documentId: 'doc-1', enabled: true, call: server.call,
    exportBytes: async () => bytes,
    upload: async (url, data) => { uploads.push({ url, size: data.byteLength }); return { id: 'item' }; },
  });
  assert.equal(box.state.link?.name, 'Plan.pdf');
  await act(async () => { edit('doc-1'); });
  assert.equal(box.state.dirty, true);
  await act(async () => { await box.state.syncNow(); });
  assert.deepEqual(uploads, [{ url: 'https://up.example/session', size: bytes.byteLength }]);
  const pushed = server.calls.find((c) => c.action === 'drivePushed');
  assert.match(pushed.body.sha, /^[0-9a-f]{64}$/);
  assert.equal(box.state.phase, 'saved');
  assert.equal(box.state.dirty, false);
  // The same bytes again: nothing goes to OneDrive.
  await act(async () => { await box.state.syncNow(); });
  assert.equal(uploads.length, 1);
  await act(async () => root.unmount());
});

test('a change from another screen or an open never pushes; only this screen\'s edit does, after the minutes', async () => {
  setupDom();
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { useDriveSyncBack } = await loadHook();
    const server = fakeServer();
    let clock = 1_000_000;
    const uploads = [];
    const { box, root } = await mount(useDriveSyncBack, {
      documentId: 'doc-2', enabled: true, call: server.call, now: () => clock,
      exportBytes: async () => new TextEncoder().encode(`pdf ${clock}`),
      upload: async () => { uploads.push(clock); return {}; },
    });
    // No local edit: ten minutes pass and nothing is pushed.
    clock += 10 * 60_000;
    await act(async () => { mock.timers.tick(15_000); await new Promise((r) => setImmediate(r)); });
    assert.equal(uploads.length, 0);
    // An edit for another document does nothing here.
    await act(async () => { edit('other-doc'); });
    assert.equal(box.state.dirty, false);
    // This screen's edit: not before 5 minutes, then once.
    await act(async () => { edit('doc-2'); });
    clock += 4 * 60_000;
    await act(async () => { mock.timers.tick(15_000); await new Promise((r) => setImmediate(r)); });
    assert.equal(uploads.length, 0);
    clock += 61_000;
    await act(async () => { mock.timers.tick(15_000); for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
    assert.equal(uploads.length, 1);
    assert.equal(box.state.dirty, false);
    await act(async () => root.unmount());
  } finally {
    mock.timers.reset();
  }
});

test('a conflict opens the dialog; Keep Survey\'s version overwrites with force and turns syncing back on', async () => {
  setupDom();
  const { useDriveSyncBack } = await loadHook();
  let refuse = true;
  const server = fakeServer({ pushAnswer: (body) => (refuse && !body.force ? { error: 'Someone changed this file in OneDrive since Survey last saved it.', code: 'conflict' } : { uploadUrl: 'https://up.example/forced' }) });
  const uploads = [];
  const { box, root } = await mount(useDriveSyncBack, {
    documentId: 'doc-3', enabled: true, call: server.call,
    exportBytes: async () => new TextEncoder().encode('pdf'),
    upload: async (url) => { uploads.push(url); return {}; },
  });
  await act(async () => { edit('doc-3'); await box.state.syncNow(); });
  assert.equal(box.state.dialog, 'conflict');
  assert.equal(uploads.length, 0);
  await act(async () => { await box.state.keepSurveyVersion(); });
  assert.deepEqual(uploads, ['https://up.example/forced']);
  assert.equal(server.calls.filter((c) => c.action === 'drivePushed').at(-1).body.force, true);
  assert.equal(box.state.dialog, null);
  refuse = false;
  await act(async () => root.unmount());
});

test('a gone file and a read-only file open their dialogs; Stop saving back and Unlink reach the server', async () => {
  setupDom();
  const { useDriveSyncBack } = await loadHook();
  for (const code of ['gone', 'read_only']) {
    const server = fakeServer({ pushAnswer: () => ({ error: code, code }) });
    const { box, root } = await mount(useDriveSyncBack, {
      documentId: `doc-${code}`, enabled: true, call: server.call,
      exportBytes: async () => new TextEncoder().encode('pdf'),
      upload: async () => ({}),
    });
    await act(async () => { edit(`doc-${code}`); await box.state.syncNow(); });
    assert.equal(box.state.dialog, code);
    if (code === 'gone') {
      await act(async () => { await box.state.unlink(); });
      assert.ok(server.calls.some((c) => c.action === 'driveUnlink'));
      assert.equal(box.state.link, null);
    } else {
      await act(async () => { await box.state.stopSyncing(); });
      assert.equal(server.calls.find((c) => c.action === 'driveSettings').body.syncOff, true);
      assert.equal(box.state.link.syncOff, true);
    }
    await act(async () => root.unmount());
  }
});

test('a push that fails for a passing reason waits a minute before the timer tries again', async () => {
  setupDom();
  const { useDriveSyncBack, nextPushAt } = await loadHook();
  const server = fakeServer({ pushAnswer: () => ({ error: 'Microsoft asked Survey to slow down.', code: 'busy' }) });
  const { box, root } = await mount(useDriveSyncBack, {
    documentId: 'doc-busy', enabled: true, call: server.call,
    exportBytes: async () => new TextEncoder().encode('pdf'),
    upload: async () => ({}),
  });
  await act(async () => { edit('doc-busy'); await box.state.syncNow(); });
  assert.equal(box.state.dialog, null);
  assert.equal(box.state.phase, 'problem');
  assert.equal(box.state.dirty, true);
  assert.equal(nextPushAt({ link: LINK, canPush: true, dirtySince: 1, retryAt: 5 }) >= 5, true);
  await act(async () => root.unmount());
});

test('an upload the server never heard about is confirmed before the next push, so Survey’s own write is no conflict', async () => {
  setupDom();
  const { useDriveSyncBack } = await loadHook();
  const server = fakeServer();
  let pushedAnswers = 0;
  let serverDown = true;
  const call = async (action, body) => {
    if (action === 'drivePushed') {
      pushedAnswers += 1;
      if (serverDown) return { error: 'Survey could not reach the server.' };
    }
    return server.call(action, body);
  };
  let n = 0;
  const { box, root } = await mount(useDriveSyncBack, {
    documentId: 'doc-1', enabled: true, call,
    exportBytes: async () => new TextEncoder().encode(`%PDF-1.7 v${++n}`),
    upload: async () => ({ id: 'item' }),
  });
  await act(async () => { edit('doc-1'); });
  await act(async () => { await box.state.syncNow(); });
  assert.equal(pushedAnswers, 2, 'one retry right away');
  assert.equal(box.state.phase, 'saved', 'the drive has the file');
  serverDown = false;
  await act(async () => { edit('doc-1'); });
  await act(async () => { await box.state.syncNow(); });
  const order = server.calls.map((c) => c.action).filter((a) => a === 'drivePush' || a === 'drivePushed');
  // First push, then the late confirm, then the second push and its confirm.
  assert.deepEqual(order, ['drivePush', 'drivePushed', 'drivePush', 'drivePushed']);
  assert.equal(box.state.phase, 'saved');
  await act(async () => { root.unmount(); });
});

test('a late confirm goes out on its own a minute later, and survives a reload', async () => {
  setupDom();
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { useDriveSyncBack } = await loadHook();
    const server = fakeServer();
    let serverDown = true;
    const call = async (action, body) => {
      if (action === 'drivePushed' && serverDown) return { error: 'Survey could not reach the server.' };
      return server.call(action, body);
    };
    let clock = 5_000_000;
    const props = {
      documentId: 'doc-late', enabled: true, call, now: () => clock,
      exportBytes: async () => new TextEncoder().encode('%PDF-1.7 late'),
      upload: async () => ({ id: 'item', eTag: '"{item},2"' }),
    };
    const uploadStartedAt = clock;
    const first = await mount(useDriveSyncBack, props);
    await act(async () => { edit('doc-late'); });
    await act(async () => { await first.box.state.syncNow(); });
    assert.equal(first.box.state.dirty, false);
    assert.ok(window.localStorage.getItem('survey:drive-unconfirmed:doc-late'), 'kept on this device');
    // Reload before the server is back: the new screen still owes the confirm.
    await act(async () => first.root.unmount());
    const second = await mount(useDriveSyncBack, props);
    serverDown = false;
    const confirms = () => server.calls.filter((c) => c.action === 'drivePushed').length;
    const pushes = () => server.calls.filter((c) => c.action === 'drivePush').length;
    clock += 61_000;
    await act(async () => { mock.timers.tick(15_000); for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
    assert.equal(confirms(), 1, 'the confirm went out with no new edit');
    const sent = server.calls.find((c) => c.action === 'drivePushed').body;
    assert.equal(sent.late, true);
    assert.equal(sent.eTag, '"{item},2"', 'names the version Survey wrote');
    assert.equal(sent.pushedAt, new Date(uploadStartedAt).toISOString(), 'stamped with when the push started');
    assert.equal(pushes(), 1, 'no second upload');
    assert.equal(window.localStorage.getItem('survey:drive-unconfirmed:doc-late'), null);
    // Nothing more is owed: the timer stays quiet.
    clock += 10 * 60_000;
    await act(async () => { mock.timers.tick(15_000); for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
    assert.equal(confirms(), 1);
    await act(async () => second.root.unmount());
  } finally {
    mock.timers.reset();
  }
});

test('a change not yet saved back survives a reload and still goes out on the timer', async () => {
  setupDom();
  mock.timers.enable({ apis: ['setInterval'] });
  try {
    const { useDriveSyncBack } = await loadHook();
    const server = fakeServer();
    let clock = 9_000_000;
    const uploads = [];
    const props = {
      documentId: 'doc-reload', enabled: true, call: server.call, now: () => clock,
      exportBytes: async () => new TextEncoder().encode(`%PDF-1.7 ${clock}`),
      upload: async () => { uploads.push(clock); return { id: 'item' }; },
    };
    const first = await mount(useDriveSyncBack, props);
    await act(async () => { edit('doc-reload'); });
    await act(async () => first.root.unmount());
    const second = await mount(useDriveSyncBack, props);
    assert.equal(second.box.state.dirty, true, 'still owed after the reload');
    clock += 5 * 60_000 + 1_000;
    await act(async () => { mock.timers.tick(15_000); for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)); });
    assert.equal(uploads.length, 1);
    assert.equal(second.box.state.dirty, false);
    assert.equal(window.localStorage.getItem('survey:drive-dirty:doc-reload'), null);
    await act(async () => second.root.unmount());
  } finally {
    mock.timers.reset();
  }
});

test('nextPushAt after a failed try: the 60 s retry wins, not a whole save interval', async () => {
  const { nextPushAt } = await loadHook();
  const t = 10 * 60_000;
  // A failed try clears lastAttemptAt and sets retryAt.
  assert.equal(nextPushAt({ link: LINK, canPush: true, dirtySince: 1000, lastAttemptAt: 0, retryAt: t + 60_000 }), t + 60_000);
});
