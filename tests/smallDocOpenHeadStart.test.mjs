// Open speed (round 9): opening a document no longer waits for the viewer
// chunk before it starts its slowest steps.
//   1. The cloud file's per-open access check and signed URL are asked for
//      when the tab is created, and the viewer's openDocumentStream uses those
//      same answers (services/openSourceHeadStart.js).
//   2. A press on a document row fetches the viewer chunk at once instead of
//      waiting for the idle prefetch (utils/pdfViewerPrefetch.js).
// Same requests, same chunk: only when they start changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createOpenSourceHeadStarts,
  openSourceCacheStamp,
  HEAD_START_MAX_AGE_MS,
} from '../src/services/openSourceHeadStart.js';
import { resolveOpenDocumentSource } from '../src/services/openDocumentStreamSource.js';
import { schedulePdfViewerPrefetch, preloadPdfViewerNow } from '../src/utils/pdfViewerPrefetch.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

// --- 1. access check + signed URL -------------------------------------------

function countingServer() {
  const calls = { info: 0, sign: 0 };
  return {
    calls,
    fetchInfo: async () => { calls.info += 1; return { data: { size: 10, etag: 'e1' }, error: null }; },
    sign: async () => { calls.sign += 1; return { data: { signedUrl: `https://x/signed-${calls.sign}` }, error: null }; },
  };
}

test('the tab asks once; the viewer uses those answers and asks nothing itself', async () => {
  const server = countingServer();
  const heads = createOpenSourceHeadStarts({ now: () => 1000 });
  heads.start('actor:path.pdf', { stamp: '0:0', fetchInfo: server.fetchInfo, sign: server.sign });
  await new Promise((resolve) => setImmediate(resolve));
  // Both requests are in flight before the viewer exists.
  assert.deepEqual(server.calls, { info: 1, sign: 1 });

  const early = heads.take('actor:path.pdf', '0:0');
  assert.ok(early);
  const source = await resolveOpenDocumentSource({
    fetchInfo: () => early?.info ?? server.fetchInfo(),
    sign: () => early?.signing ?? server.sign(),
    readCached: async () => null,
  });
  assert.deepEqual(server.calls, { info: 1, sign: 1 }, 'no second access check, no second signing');
  assert.equal(source.signedUrl, 'https://x/signed-1');
  assert.deepEqual(source.info, { size: 10, etag: 'e1' });
});

test('an answer is used once, only for the same account, path and cache state, and only while fresh', () => {
  let t = 0;
  const heads = createOpenSourceHeadStarts({ now: () => t });
  const ask = { fetchInfo: async () => ({ data: {} }), sign: async () => ({ data: {} }) };

  heads.start('a:p.pdf', { ...ask, stamp: '0:0' });
  assert.ok(heads.take('a:p.pdf', '0:0'));
  assert.equal(heads.take('a:p.pdf', '0:0'), null, 'a second open asks again');

  heads.start('a:p.pdf', { ...ask, stamp: '0:0' });
  assert.equal(heads.take('b:p.pdf', '0:0'), null, 'another account never gets it');
  assert.equal(heads.take('a:p.pdf', '0:1'), null, 'an upload / replace / delete of the path in between drops it');

  heads.start('a:p.pdf', { ...ask, stamp: '0:0' });
  t = HEAD_START_MAX_AGE_MS + 1;
  assert.equal(heads.take('a:p.pdf', '0:0'), null, 'a stale answer is dropped');
  assert.equal(heads.size, 0);
});

test('a refused access check is passed on exactly as the viewer would have seen it', async () => {
  const heads = createOpenSourceHeadStarts();
  const refusal = { data: null, error: { status: 400, message: 'Object not found' } };
  heads.start('a:p.pdf', { stamp: 's', fetchInfo: async () => refusal, sign: async () => { throw new Error('denied'); } });
  const early = heads.take('a:p.pdf', 's');
  assert.deepEqual(await early.info, refusal);
  assert.equal(await resolveOpenDocumentSource({ fetchInfo: () => early.info, sign: () => early.signing, readCached: async () => null }), null,
    'null = the viewer falls back to the full download and its own check, as before');
});

test('the cache stamp follows the byte cache generation and the path epoch', () => {
  const cache = { generation: 2, pathEpoch: (path) => (path === 'p.pdf' ? 5 : 0) };
  assert.equal(openSourceCacheStamp(cache, 'p.pdf'), '2:5');
  assert.notEqual(openSourceCacheStamp({ ...cache, generation: 3 }, 'p.pdf'), '2:5');
  assert.equal(openSourceCacheStamp(null, 'p.pdf'), 'no-cache');
});

test('wiring: the tab asks, openDocumentStream takes, an upload in flight is left alone', () => {
  const db = read('../src/hooks/useDatabase.js');
  const stream = db.slice(db.indexOf('const openDocumentStream = useCallback'), db.indexOf('const startOpenSource = useCallback'));
  assert.match(stream, /await waitForPdfUpload\(filePath\);[\s\S]*openSourceHeadStarts\(\)\.take\(key, openSourceCacheStamp\(cache, filePath\)\)/);
  assert.match(stream, /fetchInfo: \(\) => early\?\.info \?\? fetchStoredPdfInfo\(filePath\)/);
  assert.match(stream, /sign: \(\) => early\?\.signing \?\? signOpenSource\(filePath\)/);
  const start = db.slice(db.indexOf('const startOpenSource = useCallback'), db.indexOf('const deleteDocumentFile = useCallback'));
  assert.match(start, /isPdfUploadPending\(filePath\)\) return false/);
  // An open that will download (file:// desktop build, offline) asks nothing early.
  assert.match(start, /chooseCloudPdfOpenPath\(\{ pdfFile: \{ filePath \} \}\)\.path !== 'stream'\) return false/);
  assert.match(start, /pdfCacheKey\(user\?\.id \?\? null, filePath\)/);

  const shell = read('../src/AppShell.jsx');
  const select = shell.slice(shell.indexOf('const handleDocumentSelect = '), shell.indexOf('// Create new tab', shell.indexOf('const handleDocumentSelect = ')));
  // Only a new tab asks: the already-open branch returns before it.
  assert.ok(select.indexOf('if (existingTab)') < select.indexOf('startOpenSource('));
  assert.match(select, /if \(typeof file\.arrayBuffer !== 'function' && file\.filePath\) startOpenSource\(file\.filePath\);/);
});

// --- 2. viewer chunk on a row press -----------------------------------------

function fakeWindow({ online = true } = {}) {
  const listeners = new Map();
  return {
    listeners,
    navigator: { onLine: online },
    document: { readyState: 'complete' },
    addEventListener(type, cb) { listeners.set(type, cb); },
    removeEventListener(type, cb) { if (listeners.get(type) === cb) listeners.delete(type); },
    setTimeout() { return 1; },
    clearTimeout() {},
    requestIdleCallback() { return 1; },
    cancelIdleCallback() {},
  };
}

test('a row press fetches the viewer at once, once', () => {
  let loads = 0;
  const cancel = schedulePdfViewerPrefetch(() => { loads += 1; }, { windowObject: fakeWindow() });
  assert.equal(loads, 0, 'nothing before the idle prefetch or a press');
  preloadPdfViewerNow();
  assert.equal(loads, 1);
  preloadPdfViewerNow();
  assert.equal(loads, 1, 'later presses and the idle prefetch reuse the same load');
  cancel();
  preloadPdfViewerNow();
  assert.equal(loads, 1);
});

test('a row press while offline waits for the connection, like the idle prefetch', () => {
  let loads = 0;
  const win = fakeWindow({ online: false });
  const cancel = schedulePdfViewerPrefetch(() => { loads += 1; }, { windowObject: win });
  preloadPdfViewerNow();
  assert.equal(loads, 0);
  win.navigator.onLine = true;
  win.listeners.get('online')();
  assert.equal(loads, 1);
  cancel();
});

test('wiring: desktop rows and phone cards press-load the viewer', () => {
  const ledger = read('../src/home/DocumentsLedger.jsx');
  assert.match(ledger, /onPointerDown=\{preloadPdfViewerNow\}\s*onClick=\{\(event\) => onDesktopRowClick\(event, d\)\}/);
  assert.match(ledger, /onPointerDown=\{preloadPdfViewerNow\}\s*onClick=\{\(\) => openMobileDoc\(d\)\}/);
});
