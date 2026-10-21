import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import bmpPage from '../../../scripts/free-tools-catalog/bmp-to-pdf.mjs';

// The browser decodes BMP itself (createImageBitmap in prepareImage), so the
// page only needs to share Image to PDF and take .bmp files.
test('bmp to PDF page: shares Image to PDF and takes BMP files', () => {
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /TOOLS\['bmp-to-pdf'\] = TOOLS\['image-to-pdf'\];/);
  const imageAccept = /image: \{ test: isImage, input: '([^']+)'/.exec(app)[1];
  assert.ok(imageAccept.includes('image/bmp') && imageAccept.includes('.bmp'));
  assert.equal(bmpPage.accept, 'image');
  assert.equal(bmpPage.multiple, true);
  assert.ok(bmpPage.title.length <= 60 && bmpPage.desc.length <= 160);
});
