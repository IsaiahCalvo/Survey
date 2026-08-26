// Imported filled Ink must keep /CA, not leftover dict×AP multiply.
// clickable-link-test 67R has /CA 0.34902 and /AP fillAlpha 0.34902;
// extractAnnotationOpacity * appearancePaintAlpha leftover-painted fill
// 0.12 until Opacity was re-touched. Distinct from leftover-18, imported
// Ink/Polygon/PolyLine dash+opacity export, Square / Circle / Polygon
// stroke /CA (already landed), and imported-outline Width restroke.
// Do not invent a create-ink tool.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

function parseAlpha(raw) {
  const text = String(raw || '');
  const rgba = text.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([+-]?\d*\.?\d+)\s*\)/i);
  return rgba ? Number(rgba[1]) : (text === 'transparent' || text === 'none' || !text ? 0 : 1);
}

test('imported filled Ink 67R keeps /CA and does not leftover-multiply AP fillAlpha', async (t) => {
  const bytes = readFileSync(join(process.cwd(), 'debug', 'fixtures', 'clickable-link-test.pdf'));
  const loadingTask = pdfjsLib.getDocument({
    data: Uint8Array.from(bytes),
    disableWorker: true,
    verbosity: pdfjsLib.VerbosityLevel.ERRORS,
  });
  t.after(() => loadingTask.destroy());
  const pdfDoc = await loadingTask.promise;
  const imported = await importAnnotationsFromPdf(pdfDoc, { rawPdfBytes: bytes });
  const ink = Object.values(imported.annotationsByPage || {})
    .flatMap((page) => page?.objects || [])
    .find((object) => object?.pdfAnnotationId === '67R');

  assert.ok(ink, 'fixture Ink 67R');
  assert.equal(ink.pdfAnnotationType, 'Ink');
  const fillA = parseAlpha(ink.fill);
  assert.ok(fillA > 0.34 && fillA < 0.36, `fill must keep /CA ~0.35, not leftover 0.12: ${ink.fill}`);
  assert.ok(fillA !== 0.12181496039999999, 'must not leftover-multiply dict /CA by AP fillAlpha');
  const paintOps = ink.data?.pdfInkSourceGeometry?.appearancePaintOperations || [];
  const fillOp = paintOps.find((operation) => operation?.fill);
  assert.ok(fillOp, '67R filled appearance');
  assert.ok(
    Math.abs(Number(fillOp.fillAlpha) - fillA) < 0.01,
    `fill must match AP fillAlpha once: fill=${fillA} ap=${fillOp.fillAlpha}`,
  );
});

test('Ink converter resolves dict /CA and AP fillAlpha once; export leftovers stay untouched', () => {
  const importer = read('src/utils/pdfAnnotationImporter.js');
  assert.match(importer, /function resolveImportedInkPaintOpacity/);
  assert.match(
    importer,
    /const strokeOpacity = resolveImportedInkPaintOpacity\(\s*extractAnnotationOpacity\(annotation, 1\),\s*Number\.isFinite\(appearancePaintAlpha\) \? appearancePaintAlpha : null,\s*\);/,
  );
  assert.doesNotMatch(
    importer,
    /extractAnnotationOpacity\(annotation, 1\) \* \(\s*Number\.isFinite\(appearancePaintAlpha\) \? appearancePaintAlpha : 1\s*\)/,
  );
  assert.doesNotMatch(importer, /create-ink tool/);
});

test('isolated 8448 / 75/250 stay standing; leftover-18 stay fail-closed', () => {
  const complexity = read('tests/partialEraserComplexity.test.mjs');
  assert.match(complexity, /maxAllocatedBytes: 8_448 \* 1024 \* 1024/);
  assert.match(complexity, /p95CommitMs: 75/);
  assert.match(complexity, /maxCommitMs: 250/);
  const leftover = read('tests/leftover18FailClosed.test.mjs');
  assert.match(leftover, /stamp file\.id on \?testPdf=/);
});
