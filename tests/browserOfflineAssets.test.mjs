import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { createOfflineManifest, browserOfflineAssetsPlugin } from '../scripts/browserOfflineAssets.mjs';
import { canRegisterBrowserOffline, registerBrowserOffline } from '../src/offline/registerBrowserOffline.js';

const asset = (fileName, source) => ({ type: 'asset', fileName, source });
const fixture = () => ({
  'index.html': asset('index.html', '<script type="module" src="./assets/main-a.js"></script>'),
  'assets/main-a.js': { type: 'chunk', fileName: 'assets/main-a.js', code: 'import("./viewer-b.js")' },
  'assets/viewer-b.js': { type: 'chunk', fileName: 'assets/viewer-b.js', code: 'export default 1' },
  'assets/pdf.worker-a.mjs': asset('assets/pdf.worker-a.mjs', '/* worker */'),
  'assets/pdfjs/cmaps/Test.bcmap': asset('assets/pdfjs/cmaps/Test.bcmap', new Uint8Array([1, 2])),
});

test('manifest includes lazy chunks, workers and binary resources with exact digests; build content sets version', () => {
  const bundle = fixture(); const explicit = [asset('ocr/eng.traineddata.gz', new Uint8Array([3, 4]))];
  const first = createOfflineManifest(bundle, explicit, 'worker-v1');
  assert.equal(first.assets.length, 6);
  assert.equal(first.assets.find(x => x.path === 'assets/viewer-b.js').sha256, createHash('sha256').update('export default 1').digest('hex'));
  assert.equal(first.version, createOfflineManifest(bundle, explicit, 'worker-v1').version);
  assert.notEqual(first.version, createOfflineManifest(bundle, explicit, 'worker-v2').version);
  bundle['assets/viewer-b.js'].code += ';';
  assert.notEqual(first.version, createOfflineManifest(bundle, explicit, 'worker-v1').version);
  assert.equal(first.assets.reduce((sum, item) => sum + item.bytes, 0), first.totalBytes);
});

test('manifest rejects missing shell, unknown output paths, traversal, duplicate resources and oversized builds', () => {
  assert.throws(() => createOfflineManifest({}, [], ''), /index/);
  for (const fileName of ['api/private.json', 'assets/../token.js', 'assets/app.js?token=x']) {
    assert.throws(() => createOfflineManifest({ ...fixture(), [fileName]: asset(fileName, 'x') }, [], ''), /path/);
  }
  assert.throws(() => createOfflineManifest(fixture(), [asset('index.html', 'duplicate')], ''), /duplicate/);
  assert.throws(() => createOfflineManifest(fixture(), [], '', { maxBytes: 10 }), /budget/);
});

test('real plugin emits installed PDF support assets under the shared content hash', async () => {
  const plugin = browserOfflineAssetsPlugin(); const emitted = [];
  plugin.configResolved({ command: 'build', root: new URL('..', import.meta.url).pathname, publicDir: new URL('../public', import.meta.url).pathname });
  await plugin.buildStart.call({ emitFile: value => emitted.push(value) });
  const config = await plugin.config();
  const version = JSON.parse(config.define.__SURVEY_PDFJS_RESOURCE_VERSION__);
  assert.match(version, /^[a-f0-9]{64}$/);
  for (const folder of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) assert.ok(emitted.some(x => x.fileName.startsWith(`assets/pdfjs/${version}/${folder}/`)));
});

function host(overrides = {}) {
  const win = new EventTarget();
  return Object.assign(win, { location: { protocol: 'https:', hostname: 'survey.test' }, isSecureContext: true, navigator: { serviceWorker: { register: async () => ({}) } }, CustomEvent: class extends Event { constructor(type, options) { super(type); this.detail = options.detail; } } }, overrides);
}
test('production-only registration skips native and insecure runtimes, including native HTTPS', () => {
  assert.equal(canRegisterBrowserOffline(host(), true), true);
  for (const win of [host({ electronAPI: {} }), host({ Capacitor: { isNativePlatform: () => true } }), host({ ReactNativeWebView: {} }), host({ location: { protocol: 'file:' } }), host({ isSecureContext: false })]) assert.equal(canRegisterBrowserOffline(win, true), false);
  assert.equal(canRegisterBrowserOffline(host(), false), false);
  assert.equal(canRegisterBrowserOffline(host({ location: { protocol: 'https:', search: '?nativeShell=expo' } }), true), false);
  assert.equal(canRegisterBrowserOffline(host({ document: { documentElement: { dataset: { nativeShell: 'capacitor' } } } }), true), false);
});

test('registration readiness needs a complete worker reply and reports a waiting update without activating or reloading', async () => {
  const listeners = new Map(); const posts = [];
  function channel() {
    this.port1 = { close() {} };
    this.port2 = { send: data => this.port1.onmessage({ data }) };
  }
  const worker = { state: 'installed', addEventListener: (event, listener) => listeners.set(event, listener), postMessage: (request, ports) => posts.push({ request, port: ports[0] }) };
  const registration = { waiting: worker, active: { state: 'activating', addEventListener() {} } };
  const win = host({ navigator: { serviceWorker: { register: async (url, options) => { assert.equal(url, 'https://survey.test/sw.js'); assert.equal(options.scope, baseOrigin); return registration; } } }, MessageChannel: channel, setTimeout, clearTimeout });
  const baseOrigin = 'https://survey.test/';
  await registerBrowserOffline(win, { production: true, moduleUrl: `${baseOrigin}assets/main-a.js` });
  assert.equal(win.__surveyOfflineAssets.availableOffline, false);
  assert.equal(posts.length, 1); assert.deepEqual(posts[0].request, { type: 'SURVEY_OFFLINE_STATUS' });
  posts[0].port.send({ type: 'SURVEY_OFFLINE_STATUS', availableOffline: true, version: 'a', totalBytes: 42 });
  assert.equal(win.__surveyOfflineAssets.status, 'waiting');
  assert.equal(win.__surveyOfflineAssets.availableOffline, true);
  worker.state = 'redundant'; listeners.get('statechange')();
  assert.equal(win.__surveyOfflineAssets.status, 'error');
});

test('actual isolated Vite build emits a complete executable worker and matching hashed PDF support URLs', async t => {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'survey-offline-build-fixture-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'public', 'ocr'), { recursive: true });
  await writeFile(path.join(directory, 'public', 'ocr', 'eng.traineddata.gz'), new Uint8Array([1, 2, 3]));
  await writeFile(path.join(directory, 'index.html'), '<html><body><script type="module" src="./entry.js"></script></body></html>');
  const helper = new URL('../src/utils/pdfWorkerConfig.js', import.meta.url).pathname;
  await writeFile(path.join(directory, 'entry.js'), `import { getPdfjsDocumentOptions } from ${JSON.stringify(helper)}; console.log(getPdfjsDocumentOptions()); import('./viewer.js').then(console.log);`);
  await writeFile(path.join(directory, 'viewer.js'), 'export const viewer = "offline lazy viewer";');
  await build({ configFile: false, root: directory, base: './', plugins: [browserOfflineAssetsPlugin()], logLevel: 'silent', build: { outDir: path.join(directory, 'output'), modulePreload: false } });
  const output = path.join(directory, 'output');
  const source = await readFile(path.join(output, 'sw.js'), 'utf8');
  assert.match(source, /eng\.traineddata\.gz/);
  assert.doesNotMatch(source, /pdf\.worker\.min\.js"|release\.json"|public\/index/);
  const manifest = JSON.parse(source.slice(source.lastIndexOf(')(self, ') + ')(self, '.length, -3));
  assert.ok(manifest.assets.some(asset => /^assets\/viewer-.*\.js$/.test(asset.path)));
  const resource = manifest.assets.find(asset => asset.path.includes('/cmaps/'));
  assert.ok(resource);
  const version = resource.path.split('/')[2];
  const entryName = (await readdir(path.join(output, 'assets'))).find(name => /^index-.*\.js$/.test(name));
  const entry = await readFile(path.join(output, 'assets', entryName), 'utf8');
  assert.ok(entry.includes(version), 'runtime and emitted support files share the content hash');
  for (const asset of manifest.assets) {
    const bytes = await readFile(path.join(output, asset.path));
    assert.equal(bytes.length, asset.bytes, asset.path);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.path);
  }
});
test('registration reports installing, never announces ready from registration alone, and exposes errors', async () => {
  const win = host(); const states = []; win.addEventListener('survey-offline-assets-status', e => states.push(e.detail.status));
  await registerBrowserOffline(win, { production: true, moduleUrl: 'https://survey.test/assets/main-a.js' });
  assert.deepEqual(states, ['installing']);
  assert.equal(win.__surveyOfflineAssets.status, 'installing');
  const failed = host({ navigator: { serviceWorker: { register: async () => { throw new Error('no space'); } } } });
  await registerBrowserOffline(failed, { production: true, moduleUrl: 'https://survey.test/assets/main-a.js' });
  assert.equal(failed.__surveyOfflineAssets.status, 'error');
});

test('same-build registration and online retry repair an incomplete active cache without reloading or reinstalling', async () => {
  const posts = [];
  function channel() { this.port1 = { close() {} }; this.port2 = { send: data => this.port1.onmessage({ data }) }; }
  const worker = { state: 'activated', addEventListener() {}, postMessage: (request, ports) => posts.push({ request, port: ports[0] }) };
  const win = host({ navigator: { serviceWorker: { register: async () => ({ active: worker }) } }, MessageChannel: channel, setTimeout, clearTimeout });
  await registerBrowserOffline(win, { production: true, moduleUrl: 'https://survey.test/assets/main-a.js' });
  const reply = (index, availableOffline) => posts[index].port.send({ type: 'SURVEY_OFFLINE_STATUS', availableOffline, version: 'a' });
  assert.equal(posts[0].request.type, 'SURVEY_OFFLINE_STATUS'); reply(0, false);
  assert.equal(posts[1].request.type, 'SURVEY_OFFLINE_REPAIR');
  assert.equal(win.__surveyOfflineAssets.status, 'repairing');
  win.dispatchEvent(new Event('online')); win.dispatchEvent(new Event('online'));
  assert.equal(posts.length, 2, 'pending repair coalesces online events');
  reply(1, false); assert.equal(win.__surveyOfflineAssets.status, 'error');
  win.dispatchEvent(new Event('online')); assert.equal(posts[2].request.type, 'SURVEY_OFFLINE_STATUS'); reply(2, false);
  assert.equal(posts[3].request.type, 'SURVEY_OFFLINE_REPAIR'); reply(3, true);
  assert.equal(win.__surveyOfflineAssets.availableOffline, true);
  assert.equal(win.__surveyOfflineAssets.status, 'ready');
});
