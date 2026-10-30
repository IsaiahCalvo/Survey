// Perf guard (tab switches, zoomed-out sheets): no page CSS ends in a
// descendant-universal selector keyed on an element id. PDFViewer used to put
// a <style> in every drawn page that carried imported PDF marks, full of
// Syncfusion-era rules like `[id="<page>"] .survey-pdfjs-annotation-layer *`
// and `[id="<page>"] [id$="_diagramAdornerLayer"] *`. A rule that ends in `*`
// is tried on every element of every restyle, and an id attribute in it
// cannot be ruled out early, so each try walked all the way up the tree. The
// rules matched nothing: pdf.js draws pages with AnnotationMode.DISABLE and
// builds no native annotation layer, and nothing makes those ids or classes.
//
// Measured on the 36-sheet set (scripts/perf/tab-switch-style.mjs): see
// /mnt/project-files/perf/speed-round-3.md, Round 11.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');

function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(jsx?|tsx?|css)$/.test(name)) out.push(full);
  }
  return out;
}

const files = sourceFiles(SRC).map((file) => ({ rel: relative(ROOT, file), text: readFileSync(file, 'utf8') }));

test('no CSS selector ends in a descendant `*` under an [id…] attribute', () => {
  // `[id="${x}"] *`, `[id="${x}"] .a *`, `[id$="_layer"] *` before , or {
  const shape = /\[id[\^$*|~]?="[^"]*"\][^,{};`]*\s\*\s*[,{]/;
  const hits = [];
  for (const { rel, text } of files) {
    text.split('\n').forEach((line, i) => { if (shape.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(hits, [], 'per-id descendant-universal selectors run on every element of every restyle');
});

test('no CSS targets the Syncfusion viewer DOM that pdf.js never builds', () => {
  // Ids and classes only Syncfusion's PDF viewer made (adorner layers, the
  // annotation canvas, selector handles). Syncfusion is gone from the app.
  const dead = /_annotationCanvas_|_diagramAdorner|SelectorElement|e-adorner-layer|survey-pdfjs-annotation-(layer|selection)|survey-pdfjs-resize-(container|div)/;
  const hits = [];
  for (const { rel, text } of files) {
    text.split('\n').forEach((line, i) => { if (dead.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(hits, []);
});

test('the per-page overlay renders no <style> of its own', () => {
  const viewer = files.find((f) => f.rel.replace(/\\/g, '/') === 'src/PDFViewer.jsx').text;
  const start = viewer.indexOf('key={`pdfjs-overlay-${pageNumber}`}');
  assert.ok(start > 0, 'the per-page overlay portal is still keyed pdfjs-overlay-<page>');
  // The overlay's own attributes and first children, up to its first layer.
  const head = viewer.slice(start, viewer.indexOf('<OcrTextLayer', start));
  assert.ok(head.length > 0 && head.length < 8000, 'found the head of the overlay');
  assert.doesNotMatch(head, /<style[\s>]/, 'a <style> per drawn page adds a stylesheet per page, per tab');
  // The policy itself stays readable for tests and diagnostics.
  assert.match(head, /data-native-pdf-annotation-layer-hidden=/);
});
