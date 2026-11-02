// Emits pdf.js's own asset folders (image decoders, standard fonts, CMaps,
// ICC profiles) into the build as assets/pdfjs-<version>/..., next to the
// pdf.js worker. src/utils/pdfjsAssets.js points getDocument at them. Without
// them pdf.js leaves JPEG 2000 / JBIG2 images (scanned drawings) off the page.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DIRS = ['wasm', 'standard_fonts', 'cmaps', 'iccs'];
// quickjs-eval is pdf.js's sandbox for PDF JavaScript, which the app keeps off
// (isEvalSupported: false); licence files are not served.
const SKIP = /^(quickjs|LICENSE)/;

// pdf.js 6.4 dropped core-js's Promise.withResolvers polyfill from its
// "legacy" build. Chrome only has Promise.withResolvers from 119, and the
// Android 14 system WebView (the CI emulator, and real phones that have not
// updated their WebView) is older, so getDocument threw "Promise.withResolvers
// is not a function" and every PDF showed "Couldn't open this PDF". The same
// few lines go in front of pdf.js on the page (transform) and in front of the
// worker file, which is emitted as a plain ?url asset (generateBundle).
export const PROMISE_WITH_RESOLVERS_POLYFILL = `if (typeof Promise.withResolvers !== 'function') {
  Object.defineProperty(Promise, 'withResolvers', {
    configurable: true,
    writable: true,
    value: function withResolvers() {
      let resolve;
      let reject;
      const promise = new this((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    },
  });
}
`;

const PDFJS_MODULE = /[\\/]pdfjs-dist[\\/](legacy[\\/])?build[\\/]pdf(\.worker)?(\.min)?\.mjs$/;
const PDFJS_WORKER_ASSET = /(^|\/)pdf\.worker(\.min)?-[^/]*\.m?js$/;

export function pdfjsPolyfillPlugin() {
  return {
    name: 'pdfjs-promise-with-resolvers',
    transform(code, id) {
      if (!PDFJS_MODULE.test(id.split('?')[0])) return null;
      return { code: PROMISE_WITH_RESOLVERS_POLYFILL + code, map: null };
    },
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !PDFJS_WORKER_ASSET.test(file.fileName)) continue;
        const source = typeof file.source === 'string' ? file.source : Buffer.from(file.source).toString('utf8');
        if (!source.startsWith(PROMISE_WITH_RESOLVERS_POLYFILL)) file.source = PROMISE_WITH_RESOLVERS_POLYFILL + source;
      }
    },
  };
}

export function pdfjsAssetsPlugin() {
  return [pdfjsAssetFoldersPlugin(), pdfjsPolyfillPlugin()];
}

function pdfjsAssetFoldersPlugin() {
  const pkgDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
  const { version } = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
  return {
    name: 'pdfjs-assets',
    apply: 'build',
    generateBundle() {
      for (const dir of DIRS) {
        const from = path.join(pkgDir, dir);
        if (!fs.existsSync(from)) continue;
        for (const name of fs.readdirSync(from)) {
          if (SKIP.test(name)) continue;
          this.emitFile({
            type: 'asset',
            fileName: `assets/pdfjs-${version}/${dir}/${name}`,
            source: fs.readFileSync(path.join(from, name)),
          });
        }
      }
    },
  };
}
