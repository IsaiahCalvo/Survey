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

test('real imported Ink 67R keeps its exact curve visibly clipped to partial-erase survivors', async (t) => {
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
    'SVG presentation must clip the authored curve to survivor geometry',
  );
  assert.doesNotMatch(
    rendererSource,
    /const paperCutD = paperCutsToSvgD\(obj\?\.paperEraserCuts\);/,
    'the renderer cannot reconstruct an inverted page-space clip from cuts',
  );
  const clippedWrapperIndex = rendererSource.indexOf(
    '<g clipPath={`url(#${clipId})`}>',
  );
  const transformedSourceIndex = rendererSource.indexOf(
    'd={sourceD}',
    clippedWrapperIndex,
  );
  assert.ok(
    clippedWrapperIndex >= 0 && transformedSourceIndex > clippedWrapperIndex,
    'the page-space clip must wrap the transformed local source path',
  );
  const transformedSourceEnd = rendererSource.indexOf('/>', transformedSourceIndex);
  const transformedSourceMarkup = rendererSource.slice(
    transformedSourceIndex,
    transformedSourceEnd,
  );
  assert.doesNotMatch(
    transformedSourceMarkup,
    /clipPath=/,
    'the page-space clip cannot be attached directly to the transformed local path',
  );
});
