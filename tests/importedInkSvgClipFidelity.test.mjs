import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import { importAnnotationsFromPdf } from '../src/utils/pdfAnnotationImporter.js';
import { erasePageAnnotations } from '../src/utils/pageSpaceEraser.js';

const fixturePath = join(
  process.cwd(),
  'debug',
  'fixtures',
  'clickable-link-test.pdf',
);

// 2026-10-06 (test plan 68): the SVG layer FILLS the survivor polygons of a
// partially erased authored curve. It used to paint the authored curve under a
// clipPath of those polygons; the clip edge lay on the curve's own edge, so
// each edge pixel was anti-aliased twice and thin imported lines drew 10-30%
// lighter than untouched ones. The authored curve stays stored unchanged.
test('real imported Ink 67R keeps its authored curve stored and is drawn as its filled partial-erase survivors', async (t) => {
  const bytes = readFileSync(fixturePath);
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

  assert.ok(ink, 'the fixture must contain purple imported Ink 67R');
  assert.equal(ink.pdfAnnotationType, 'Ink');
  assert.equal(ink.path.length, 65);
  assert.ok(ink.path.some((command) => command?.[0] === 'C'));
  const authoredPath = structuredClone(ink.path);

  const erased = erasePageAnnotations({
    pageAnnotations: { objects: [ink] },
    eraserPoints: [{ x: 130, y: 430 }, { x: 270, y: 430 }],
    eraserRadius: 10,
    mode: 'partial',
  });

  assert.deepEqual(erased.deletedIds, [], 'partial erase must not delete Ink 67R');
  assert.equal(erased.pageAnnotations.objects.length, 1);
  const survivor = erased.pageAnnotations.objects[0];
  assert.ok(survivor.polygons.length >= 2, 'geometry must survive on both sides of the cut');
  assert.ok(survivor.paperEraserCuts.length > 0);
  assert.deepEqual(
    survivor.paperSourceStroke.path,
    authoredPath,
    'the authored cubic curve must remain byte-identical',
  );

  const rendererSource = readFileSync(
    join(process.cwd(), 'src', 'utils', 'svgAnnotationRenderers.jsx'),
    'utf8',
  );
  assert.match(
    rendererSource,
    /const paperSurvivorD = paperCutsToSvgD\(obj\?\.polygons\);/,
    'SVG presentation must draw the survivor geometry',
  );
  assert.doesNotMatch(
    rendererSource,
    /const paperCutD = paperCutsToSvgD\(obj\?\.paperEraserCuts\);/,
    'the renderer cannot reconstruct an inverted page-space clip from cuts',
  );
  assert.doesNotMatch(
    rendererSource,
    /<clipPath/,
    'no clipPath: a clip on the line\'s own edge anti-aliases it twice',
  );
  const survivorPathIndex = rendererSource.indexOf('d={paperSurvivorD}');
  assert.ok(survivorPathIndex >= 0, 'the survivor rings are the painted path');
  const survivorMarkup = rendererSource.slice(
    survivorPathIndex,
    rendererSource.indexOf('/>', survivorPathIndex),
  );
  assert.match(survivorMarkup, /fillRule="evenodd"/);
  assert.match(survivorMarkup, /transform=\{transform\}/, 'same local-to-page transform as the mark');
  assert.match(survivorMarkup, /stroke="none"/);
});
