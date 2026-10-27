// Memory guard: a closed document gives back its pdf.js worker.
//
// pdf.js 6 has no PDFDocumentProxy#destroy(); only the loading task can be
// destroyed. The viewer still called `pdf.destroy()` inside try/catch, so the
// TypeError was swallowed and every closed document kept its own worker
// thread (the app starts one per getDocument) and everything it had parsed.
// Six open/close cycles of the big drawing set left 7 workers alive; now 1.
// See /mnt/project-files/perf/speed-round-3.md, Round 10.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { destroyPdfDocument } from '../src/utils/destroyPdfDocument.js';
import { createPageView } from '../src/utils/pageViewDocument.js';

function fakeDoc({ reject = false } = {}) {
  const task = { calls: 0, destroy() { this.calls += 1; return reject ? Promise.reject(new Error('gone')) : Promise.resolve(); } };
  return { numPages: 2, loadingTask: task, getPage: async () => ({}), task };
}

test('destroys the loading task that owns the document worker', async () => {
  const doc = fakeDoc();
  await destroyPdfDocument(doc);
  assert.equal(doc.task.calls, 1);
});

test('never throws or rejects, also for a missing doc or a failing destroy', async () => {
  await destroyPdfDocument(null);
  await destroyPdfDocument(undefined);
  await destroyPdfDocument({ numPages: 1 });
  const failing = fakeDoc({ reject: true });
  await destroyPdfDocument(failing);
  assert.equal(failing.task.calls, 1);
  const throwing = { get loadingTask() { throw new Error('no transport'); } };
  await destroyPdfDocument(throwing);
});

test('a page view never destroys its base document', async () => {
  const base = fakeDoc();
  const view = createPageView(base);
  assert.equal(view.loadingTask, base.task, 'the view reads through to the base task');
  await destroyPdfDocument(view);
  assert.equal(base.task.calls, 0);
});

test('a real pdf.js document is destroyed (its loading task ends)', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(new URL('../debug/fixtures/order-pages.pdf', import.meta.url)));
  const task = pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 });
  const pdf = await task.promise;
  assert.equal(task.destroyed, false);
  await destroyPdfDocument(pdf);
  assert.equal(task.destroyed, true);
  await destroyPdfDocument(pdf); // twice is harmless
  await assert.rejects(async () => pdf.getPage(1));
});

// ---------------------------------------------------------------------------
// Source guard: no document proxy `.destroy()` call comes back.
// ---------------------------------------------------------------------------
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(jsx?|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

test('no source file calls destroy() on a pdf.js document proxy', () => {
  const root = new URL('../src', import.meta.url).pathname;
  const hits = [];
  // `pdf.destroy()`, `pdfBaseDoc.destroy()`, `streamed?.pdf?.destroy()` …
  // (a loading task — `loadingTask.destroy()`, `task.destroy()` — is right).
  const bad = /\b[\w$.?]*pdf[\w$]*\??\.destroy\s*\(/gi;
  for (const file of sourceFiles(root)) {
    // Comments may name the old call; blank them out, keeping line numbers.
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    for (const m of text.matchAll(bad)) {
      if (/task/i.test(m[0])) continue;
      const line = text.slice(0, m.index).split('\n').length;
      hits.push(`${file.slice(root.length + 1)}:${line} ${m[0]}`);
    }
  }
  assert.deepEqual(hits, [], 'use destroyPdfDocument(doc) from src/utils/destroyPdfDocument.js');
});

test('the viewer container unloads its own document through the helper', () => {
  const src = readFileSync(new URL('../src/components/PdfjsViewerContainer.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /\bprev\.destroy\s*\(/);
  assert.match(src, /destroyPdfDocument\(prev\)/);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /destroyPdfDocument\(pdfBaseDoc\)/);
});
