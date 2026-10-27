// Memory guard: a failed open gives back its pdf.js worker.
//
// A rejected loadingTask.promise does not end the task. Its worker, and the
// bytes it was sent, stay alive until loadingTask.destroy(). The viewer opens
// a broken file up to three times (standard, recovery, pdf-lib rewrite), so a
// file that needed the rewrite kept two dead workers holding its bytes, and a
// file that failed all three kept three. See
// /mnt/project-files/perf/speed-round-3.md, Round 13.
import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import { pdfOrDestroy } from '../src/utils/destroyPdfDocument.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('pdf.js keeps a failed task alive on its own (why the helper exists)', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new TextEncoder().encode('not a pdf'), isEvalSupported: false, verbosity: 0 });
  await assert.rejects(task.promise);
  await settle();
  assert.equal(task.destroyed, false);
  await task.destroy();
});

test('a broken file: the error passes through and the task is destroyed', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new TextEncoder().encode('not a pdf'), isEvalSupported: false, verbosity: 0 });
  await assert.rejects(pdfOrDestroy(task), (error) => error?.name === 'InvalidPDFException');
  await settle();
  assert.equal(task.destroyed, true);
});

test('a good file opens as before and its task stays alive', async () => {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(new URL('../debug/fixtures/order-pages.pdf', import.meta.url)));
  const task = pdfjs.getDocument({ data, isEvalSupported: false, verbosity: 0 });
  const pdf = await pdfOrDestroy(task);
  assert.ok(pdf.numPages > 0);
  assert.equal(task.destroyed, false);
  await task.destroy();
});

test('a destroy that throws or rejects never replaces the open error', async () => {
  const error = new Error('bad file');
  for (const destroy of [() => { throw new Error('x'); }, () => Promise.reject(new Error('y'))]) {
    const task = { promise: Promise.reject(error), destroy };
    await assert.rejects(pdfOrDestroy(task), (e) => e === error);
    await settle();
  }
});

test('wiring: every viewer open attempt and the bundle thumbnails await through the helper', () => {
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  for (const name of ['loadingTask', 'recoveryTask', 'rewriteTask']) {
    assert.match(viewer, new RegExp(`pdf = await pdfOrDestroy\\(${name}\\);`));
    assert.doesNotMatch(viewer, new RegExp(`await ${name}\\.promise`));
  }
  const thumbs = readFileSync(new URL('../src/utils/annotationBundle/thumbnails.js', import.meta.url), 'utf8');
  assert.match(thumbs, /const doc = await pdfOrDestroy\(task\);/);
});
