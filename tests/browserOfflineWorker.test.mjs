import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createOfflineManifest } from '../scripts/browserOfflineAssets.mjs';
import { installBrowserOfflineWorker } from '../src/offline/browserOfflineWorker.js';
import { getPdfjsDocumentOptions } from '../src/utils/pdfWorkerConfig.js';

const base = 'https://survey.test/';
const fixture = suffix => ({
  'index.html': { type: 'asset', fileName: 'index.html', source: `<html>app ${suffix}</html>` },
  [`assets/main-${suffix}.js`]: { type: 'chunk', fileName: `assets/main-${suffix}.js`, code: `import('./viewer-${suffix}.js')` },
  [`assets/viewer-${suffix}.js`]: { type: 'chunk', fileName: `assets/viewer-${suffix}.js`, code: `/* viewer ${suffix} */` },
  'assets/pdfjs/wasm/test.wasm': { type: 'asset', fileName: 'assets/pdfjs/wasm/test.wasm', source: new Uint8Array([0, 97, 115, 109]) },
});
class CacheStorage {
  constructor() { this.entries = new Map(); this.deleted = []; }
  async keys() { return [...this.entries.keys()]; }
  async open(name) {
    if (!this.entries.has(name)) this.entries.set(name, new Map());
    const entries = this.entries.get(name);
    return {
      match: async key => entries.get(typeof key === 'string' ? key : key.url)?.clone(),
      put: async (key, response) => entries.set(typeof key === 'string' ? key : key.url, response.clone()),
      delete: async key => entries.delete(key),
    };
  }
  async delete(name) { this.deleted.push(name); return this.entries.delete(name); }
}
function worker(suffix = 'a', caches = new CacheStorage(), alter, options = {}) {
  const bundle = options.bundle || fixture(suffix); const requests = []; const handlers = new Map();
  const scopeBase = options.base || base;
  const manifest = createOfflineManifest(bundle, [], installBrowserOfflineWorker.toString());
  const scope = {
    registration: { scope: scopeBase }, caches, crypto: webcrypto,
    addEventListener: (type, handler) => handlers.set(type, handler),
    async fetch(request) {
      requests.push(request);
      const file = bundle[request.url.slice(scopeBase.length)];
      if (!file) throw new Error('offline');
      const response = new Response(file.code || file.source, { headers: { 'content-type': file.fileName.endsWith('.html') ? 'text/html' : file.fileName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript' } });
      return alter ? alter(request, response) : response;
    },
  };
  // Exercise exactly the standalone script shape emitted by Vite, not a mock
  // handler or imports that would accidentally hide worker-global dependencies.
  vm.runInNewContext(`(${installBrowserOfflineWorker.toString()})(self, manifest)`, { self: scope, manifest, URL, Request, Response, AbortController, setTimeout, clearTimeout });
  return {
    requests, caches, manifest,
    async emit(type, data = {}) { let promise; handlers.get(type)({ ...data, waitUntil: value => { promise = value; } }); return promise; },
    route(url, options = {}) {
      let response;
      handlers.get('fetch')({ request: { url, method: options.method || 'GET', headers: new Headers(options.headers), mode: options.mode || 'cors' }, respondWith: value => { response = value; } });
      return response;
    },
    async status() { let reply; await this.emit('message', { data: { type: 'SURVEY_OFFLINE_STATUS' }, ports: [{ postMessage: value => { reply = value; } }] }); return reply; },
    async repair() { let reply; await this.emit('message', { data: { type: 'SURVEY_OFFLINE_REPAIR' }, ports: [{ postMessage: value => { reply = value; } }] }); return reply; },
  };
}

test('complete verified bundle reopens home plus never-visited lazy viewer and binary assets offline', async () => {
  const app = worker(); assert.equal((await app.status()).availableOffline, false);
  await app.emit('install'); await app.emit('activate');
  assert.equal((await app.status()).availableOffline, true);
  assert.equal(app.requests.length, 4);
  for (const request of app.requests) { assert.equal(request.credentials, 'omit'); assert.equal(request.cache, 'no-store'); assert.equal(request.redirect, 'error'); }
  assert.equal(await (await app.route(base, { mode: 'navigate' })).text(), '<html>app a</html>');
  assert.match(await (await app.route(`${base}assets/viewer-a.js`)).text(), /viewer a/);
  assert.equal((await (await app.route(`${base}assets/pdfjs/wasm/test.wasm`)).arrayBuffer()).byteLength, 4);
  assert.equal(app.requests.length, 4, 'cache serves all offline reads with no network');
});

test('private, auth, API, query, range, foreign, mutation and non-home navigation requests never enter cache routing', async () => {
  const app = worker(); await app.emit('install');
  const before = app.requests.length;
  for (const [url, options] of [
    [`${base}api/data`, {}], [`${base}auth/callback`, { mode: 'navigate' }], [`${base}?code=secret`, { mode: 'navigate' }],
    [`${base}reset-password`, { mode: 'navigate' }], [`${base}assets/main-a.js?token=secret`, {}],
    ['https://project.supabase.co/storage/v1/object/sign/file.pdf?token=secret', {}],
    [`${base}assets/main-a.js`, { headers: { authorization: 'Bearer private' } }],
    [`${base}assets/main-a.js`, { headers: { range: 'bytes=0-10' } }],
    [`${base}assets/main-a.js`, { method: 'POST' }], [`${base}release.json`, {}],
  ]) assert.equal(app.route(url, options), undefined, url);
  assert.equal(app.requests.length, before);
});

test('wrong MIME, wrong bytes, missing assets and cache writes failing abort the whole new install, retaining the active version', async () => {
  for (const failure of ['mime', 'bytes', 'missing', 'quota']) {
    const caches = new CacheStorage(); const old = worker('a', caches); await old.emit('install'); await old.emit('activate');
    const oldNames = await caches.keys();
    const newer = worker('b', caches, (request, response) => {
      if (!request.url.includes('viewer-')) return response;
      if (failure === 'mime') return new Response('/* viewer b */', { headers: { 'content-type': 'text/html' } });
      if (failure === 'bytes') return new Response('/* changed! */', { headers: { 'content-type': 'text/javascript' } });
      if (failure === 'missing') throw new Error('offline');
      return response;
    });
    if (failure === 'quota') {
      const open = caches.open.bind(caches);
      caches.open = async name => {
        const cache = await open(name);
        if (!oldNames.includes(name)) cache.put = async () => { throw new Error('quota'); };
        return cache;
      };
    }
    await assert.rejects(newer.emit('install'));
    assert.deepEqual(await caches.keys(), oldNames);
    assert.equal((await old.status()).availableOffline, true);
    assert.equal((await newer.status()).availableOffline, false);
  }
});

test('new version waits without forced activation, old shell stays pinned; activation removes predecessors only', async () => {
  const caches = new CacheStorage(); const old = worker('a', caches); await old.emit('install'); await old.emit('activate');
  await caches.open('other-app-cache');
  const newer = worker('b', caches); await newer.emit('install');
  assert.equal((await caches.keys()).length, 3);
  assert.equal(await (await old.route(base, { mode: 'navigate' })).text(), '<html>app a</html>');
  const later = worker('c', caches); await later.emit('install');
  await newer.emit('activate');
  assert.equal((await newer.status()).availableOffline, true);
  assert.equal((await later.status()).availableOffline, true, 'activation must not remove a newer waiting/installing cache');
  assert.ok((await caches.keys()).includes('other-app-cache'));
  assert.doesNotMatch(installBrowserOfflineWorker.toString(), /scope\.(skipWaiting|clients|indexedDB)/);
});

test('too many waiting versions fails closed without deleting active or foreign storage', async () => {
  const caches = new CacheStorage();
  for (const version of ['a', 'b', 'c']) await worker(version, caches).emit('install');
  const before = await caches.keys();
  await assert.rejects(worker('d', caches).emit('install'), /budget/);
  assert.deepEqual(await caches.keys(), before); assert.equal(caches.deleted.length, 0);
});

test('readiness detects cleared entries; only an exact verified public network miss can repair its cached entry', async () => {
  const app = worker(); await app.emit('install');
  const cache = await app.caches.open((await app.caches.keys())[0]);
  await cache.delete(`${base}assets/viewer-a.js`);
  assert.equal((await app.status()).availableOffline, false);
  assert.match(await (await app.route(`${base}assets/viewer-a.js`)).text(), /viewer a/);
  assert.ok(await cache.match(`${base}assets/viewer-a.js`));
  assert.equal((await app.status()).availableOffline, true);
});

test('index-only update reuses unchanged own-cache bytes after verification and fetches only the changed index', async () => {
  const caches = new CacheStorage(); const old = worker('a', caches); await old.emit('install');
  const bundle = fixture('a'); bundle['index.html'].source += '<!-- B -->';
  const next = worker('b', caches, undefined, { bundle }); await next.emit('install');
  assert.deepEqual(next.requests.map(request => request.url), [`${base}index.html`]);
  assert.equal((await old.status()).availableOffline, true);
  assert.equal((await next.status()).availableOffline, true);
});

test('real HTTP request counter sees only changed index bytes during an index-only update', async t => {
  let bundle = fixture('a'); let requests = [];
  const server = createServer((request, response) => {
    const file = bundle[request.url.slice(1)];
    if (!file) { response.writeHead(404); response.end(); return; }
    const body = file.code || file.source;
    requests.push({ path: request.url, bytes: Buffer.byteLength(body) });
    response.setHeader('content-type', file.fileName.endsWith('.html') ? 'text/html' : file.fileName.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
    response.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const scopeBase = `http://127.0.0.1:${server.address().port}/`;
  const caches = new CacheStorage();
  const first = worker('a', caches, request => fetch(request), { base: scopeBase, bundle });
  await first.emit('install'); assert.equal(requests.length, 4);
  bundle = fixture('a'); bundle['index.html'].source += '<!-- HTTP build B -->'; requests = [];
  const next = worker('b', caches, request => fetch(request), { base: scopeBase, bundle });
  await next.emit('install');
  assert.deepEqual(requests, [{ path: '/index.html', bytes: Buffer.byteLength(bundle['index.html'].source) }]);
  assert.equal((await next.status()).availableOffline, true);
});

test('reuse rejects changed bytes or MIME in prior entries and never modifies the prior cache', async () => {
  for (const mime of ['text/javascript', 'text/html']) {
    const caches = new CacheStorage(); const old = worker('a', caches); await old.emit('install');
    const oldCache = await caches.open((await caches.keys())[0]);
    await oldCache.put(`${base}assets/main-a.js`, new Response('corrupt', { headers: { 'content-type': mime } }));
    const bundle = fixture('a'); bundle['index.html'].source += '<!-- B -->';
    const next = worker('b', caches, undefined, { bundle }); await next.emit('install');
    assert.deepEqual(next.requests.map(request => new URL(request.url).pathname).sort(), ['/assets/main-a.js', '/index.html']);
    assert.equal(await (await oldCache.match(`${base}assets/main-a.js`)).text(), 'corrupt');
  }
});

test('missing-marker and foreign-scope caches are never reuse sources; nested scope keeps exact URLs', async () => {
  for (const incomplete of [false, true]) {
    const caches = new CacheStorage(); const old = worker('a', caches); await old.emit('install');
    if (incomplete) await (await caches.open((await caches.keys())[0])).delete(`${base}__survey_offline_complete__`);
    const scopeBase = incomplete ? base : `${base}survey/`;
    const bundle = fixture('a'); bundle['index.html'].source += '<!-- distinct build -->';
    const next = worker('b', caches, undefined, { base: scopeBase, bundle });
    await next.emit('install');
    assert.equal(next.requests.length, 4);
    assert.ok(next.requests.every(request => request.url.startsWith(scopeBase)));
    assert.equal(next.route(`${base}other/`, { mode: 'navigate' }), undefined);
  }
});

test('partial and whole active cache eviction can repair the same build without reinstall or deleting other caches', async () => {
  for (const whole of [false, true]) {
    const app = worker(); await app.emit('install');
    const name = (await app.caches.keys())[0];
    await app.caches.open('foreign-private-cache');
    if (whole) await app.caches.delete(name);
    else await (await app.caches.open(name)).delete(`${base}assets/viewer-a.js`);
    app.requests.length = 0;
    assert.equal((await app.status()).availableOffline, false);
    assert.equal((await app.repair()).availableOffline, true);
    assert.equal(app.requests.length, whole ? 4 : 1);
    assert.ok((await app.caches.keys()).includes('foreign-private-cache'));
    const record = await (await (await app.caches.open(name)).match(`${base}__survey_offline_complete__`)).json();
    assert.deepEqual(record.previousCaches, [], 'repair grants no cache cleanup authority');
  }
});

test('failed active repair preserves every good entry and a waiting version, then a later retry succeeds', async () => {
  for (const failure of ['network', 'quota']) {
    let failing = false;
    const caches = new CacheStorage();
    const app = worker('a', caches, (request, response) => { if (failing && failure === 'network' && request.url.includes('viewer')) throw new Error('offline'); return response; });
    await app.emit('install'); const name = (await caches.keys())[0];
    const waiting = worker('b', caches); await waiting.emit('install');
    const waitingName = (await caches.keys()).find(key => key !== name);
    await (await caches.open(name)).delete(`${base}assets/viewer-a.js`);
    const open = caches.open.bind(caches);
    caches.open = async key => { const cache = await open(key); const put = cache.put; cache.put = async (url, response) => { if (failing && failure === 'quota' && key === name && url.includes('viewer')) throw new Error('quota'); return put(url, response); }; return cache; };
    failing = true;
    assert.equal((await app.repair()).availableOffline, false);
    assert.equal((await app.status()).availableOffline, false);
    assert.equal(await (await (await caches.open(name)).match(`${base}assets/main-a.js`)).text(), fixture('a')['assets/main-a.js'].code);
    assert.ok((await caches.keys()).includes(waitingName));
    assert.equal(caches.deleted.length, 0);
    failing = false;
    assert.equal((await app.repair()).availableOffline, true);
  }
});

test('overlapping repair messages join one bounded repair and a quota-failed runtime fill still returns verified bytes online', async () => {
  let release; let gate = null;
  const app = worker('a', undefined, async (request, response) => { if (gate && request.url.includes('viewer')) await gate; return response; });
  await app.emit('install');
  const name = (await app.caches.keys())[0]; const cache = await app.caches.open(name);
  await cache.delete(`${base}assets/viewer-a.js`); app.requests.length = 0;
  gate = new Promise(resolve => { release = resolve; });
  const repairs = [app.repair(), app.repair(), app.repair()];
  await new Promise(resolve => setImmediate(resolve)); release();
  assert.ok((await Promise.all(repairs)).every(reply => reply.availableOffline));
  assert.equal(app.requests.length, 1);
  await cache.delete(`${base}assets/viewer-a.js`);
  const open = app.caches.open.bind(app.caches);
  app.caches.open = async key => { const value = await open(key); value.put = async () => { throw new Error('quota'); }; return value; };
  assert.match(await (await app.route(`${base}assets/viewer-a.js`)).text(), /viewer a/);
  assert.equal((await app.status()).availableOffline, false);
});

test('PDF.js support options preserve directory suffixes on browser and native URLs, without forcing worker fetch', () => {
  for (const root of ['https://survey.test/assets/pdfjs/', 'file:///Applications/Survey.app/dist/assets/pdfjs/', 'capacitor://localhost/assets/pdfjs/']) {
    const options = getPdfjsDocumentOptions(root);
    assert.equal(options.cMapUrl, `${root}cmaps/`);
    assert.equal(options.standardFontDataUrl, `${root}standard_fonts/`);
    assert.equal(options.wasmUrl, `${root}wasm/`);
    assert.equal(options.iccUrl, `${root}iccs/`);
    assert.equal(options.cMapPacked, true);
    assert.equal(options.useWorkerFetch, undefined);
  }
});

test('installed PDF.js binary loader uses native XHR with status zero for file URLs, not unsupported fetch', async () => {
  const require = createRequire(import.meta.url);
  const source = readFileSync(require.resolve('pdfjs-dist/legacy/build/pdf.mjs'), 'utf8');
  const fetchSource = source.slice(source.indexOf('async function fetchData('), source.indexOf('\nclass RenderingCancelledException'));
  const validSource = source.slice(source.indexOf('function isValidFetchUrl('), source.indexOf('\nfunction noContextMenu'));
  assert.ok(fetchSource.length > 100 && validSource.length > 50);
  const calls = [];
  class XHR {
    static DONE = 4;
    open(method, url) { calls.push({ method, url }); }
    send() { this.readyState = XHR.DONE; this.status = 0; this.response = new Uint8Array([11, 22]).buffer; this.onreadystatechange(); }
  }
  const read = vm.runInNewContext(`${validSource}\n${fetchSource}\nfetchData`, { URL, Uint8Array, XMLHttpRequest: XHR, document: { baseURI: 'file:///Applications/Survey.app/dist/index.html' }, fetch() { throw new Error('file fetch must not run'); } });
  const url = getPdfjsDocumentOptions('file:///Applications/Survey.app/dist/assets/pdfjs/hash/').standardFontDataUrl + 'FoxitSerif.pfb';
  assert.deepEqual([...await read(url, 'bytes')], [11, 22]);
  assert.deepEqual(calls, [{ method: 'GET', url }]);
});
