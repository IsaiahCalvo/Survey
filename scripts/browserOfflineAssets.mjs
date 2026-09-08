import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { installBrowserOfflineWorker } from '../src/offline/browserOfflineWorker.js';

const require = createRequire(import.meta.url);
const PDFJS_FOLDERS = ['cmaps', 'standard_fonts', 'wasm', 'iccs'];
const PUBLIC_ASSETS = ['ocr/eng.traineddata.gz', 'paintWorker.js', 'favicon.ico'];
const MAX_BUILD_BYTES = 64 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function createOfflineManifest(bundle, explicitAssets, workerSource, { maxBytes = MAX_BUILD_BYTES } = {}) {
  const seen = new Set();
  const assets = [...Object.values(bundle), ...explicitAssets].filter(item => !item.fileName.endsWith('.map')).map(item => {
    const name = item.fileName;
    if (!/^(index\.html|assets\/[A-Za-z0-9_./-]+|ocr\/eng\.traineddata\.gz|paintWorker\.js|favicon\.ico)$/.test(name)
      || name.split('/').some(part => part === '.' || part === '..')) throw new Error(`Unsafe offline asset path: ${name}`);
    if (seen.has(name)) throw new Error(`Offline duplicate asset: ${name}`);
    seen.add(name);
    const bytes = Buffer.from(item.type === 'chunk' ? item.code : item.source);
    return { path: name, bytes: bytes.length, sha256: sha256(bytes), kind: /\.m?js$/.test(name) ? 'script' : name.endsWith('.css') ? 'style' : name.endsWith('.html') ? 'html' : 'binary' };
  }).sort((a, b) => a.path.localeCompare(b.path, 'en'));
  if (!seen.has('index.html')) throw new Error('Offline build requires index.html.');
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  if (totalBytes > maxBytes) throw new Error(`Offline asset budget exceeded: ${totalBytes} bytes.`);
  return { version: sha256(JSON.stringify({ assets, workerSource })), totalBytes, assets };
}

// No dependency/plugin download. Vite owns the emitted URL assets; this plugin
// supplies PDF.js directory resources and verifies the exact final app bundle.
export function browserOfflineAssetsPlugin() {
  let config;
  let supportPromise;
  let supportVersion;
  const pdfjsRoot = path.dirname(require.resolve('pdfjs-dist/package.json'));
  async function supportAssets() {
    const output = [];
    for (const folder of PDFJS_FOLDERS) {
      for (const name of await readdir(path.join(pdfjsRoot, folder))) {
        if (!/^[A-Za-z0-9_.-]+$/.test(name)) throw new Error(`Invalid PDF.js resource path: ${name}`);
        output.push({ type: 'asset', fileName: `${folder}/${name}`, source: await readFile(path.join(pdfjsRoot, folder, name)) });
      }
    }
    supportVersion = sha256(JSON.stringify(output.map(item => [item.fileName, sha256(item.source)])));
    return output.map(item => ({ ...item, fileName: `assets/pdfjs/${supportVersion}/${item.fileName}` }));
  }
  const getSupportAssets = () => (supportPromise ||= supportAssets());
  return {
    name: 'survey-browser-offline-assets',
    enforce: 'post',
    async config() {
      await getSupportAssets();
      return { define: { __SURVEY_PDFJS_RESOURCE_VERSION__: JSON.stringify(supportVersion) } };
    },
    configResolved(resolved) { config = resolved; },
    async buildStart() {
      if (config.command !== 'build') return;
      for (const asset of await getSupportAssets()) this.emitFile(asset);
    },
    configureServer(server) {
      // Dev uses the same owned resource URLs, without any service worker.
      server.middlewares.use('/assets/pdfjs/', async (request, response, next) => {
        if (request.method !== 'GET') return next();
        const match = /^\/([a-f0-9]{64})\/(cmaps|standard_fonts|wasm|iccs)\/([A-Za-z0-9_.-]+)$/.exec(request.url || '');
        if (!match || match[1] !== supportVersion || match[3] === '.' || match[3] === '..') return next();
        try {
          const bytes = await readFile(path.join(pdfjsRoot, match[2], match[3]));
          response.setHeader('Content-Type', match[3].endsWith('.js') ? 'text/javascript' : match[3].endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream');
          response.end(bytes);
        } catch { next(); }
      });
    },
    async writeBundle(options, bundle) {
      // Rolldown/Vite can still replace references after generateBundle. Hash
      // final written bytes, not the earlier chunk.code snapshot.
      const outputDirectory = path.resolve(config.root, options.dir || config.build.outDir);
      const written = {};
      for (const item of Object.values(bundle)) {
        if (item.fileName.endsWith('.map')) continue;
        written[item.fileName] = { type: 'asset', fileName: item.fileName, source: await readFile(path.join(outputDirectory, item.fileName)) };
      }
      const explicit = [];
      for (const fileName of PUBLIC_ASSETS) {
        try { explicit.push({ type: 'asset', fileName, source: await readFile(path.join(outputDirectory, fileName)) }); }
        catch (error) { if (fileName === 'ocr/eng.traineddata.gz' || error.code !== 'ENOENT') throw error; }
      }
      const workerSource = installBrowserOfflineWorker.toString();
      const manifest = createOfflineManifest(written, explicit, workerSource);
      await writeFile(path.join(outputDirectory, 'sw.js'), `/* Survey public app assets only. Generated; do not edit. */\n(${workerSource})(self, ${JSON.stringify(manifest)});\n`);
    },
  };
}
