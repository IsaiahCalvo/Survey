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

export function pdfjsAssetsPlugin() {
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
