import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createProductionBenchmarkPage,
  parseProductionBenchmarkConfig,
} from '../src/utils/productionAnnotationBenchmark.js';

const VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const BENCHMARK_SOURCE = readFileSync(
  new URL('../src/utils/productionAnnotationBenchmark.js', import.meta.url),
  'utf8',
);

test('240k benchmark means 120 pages with 2,000 production annotations each', () => {
  const config = parseProductionBenchmarkConfig('?annotationBenchmarkPerPage=2000', 120);
  assert.deepEqual(config, { perPage: 2000, pageCount: 120, total: 240000 });
});

test('benchmark page data is deterministic and uses production Fabric object shapes', () => {
  const first = createProductionBenchmarkPage({ pageNumber: 7, count: 2000, width: 1000, height: 700 });
  const second = createProductionBenchmarkPage({ pageNumber: 7, count: 2000, width: 1000, height: 700 });

  assert.equal(first.length, 2000);
  assert.deepEqual(first, second);
  assert.equal(first.some((object) => object.type === 'path'), true);
  assert.equal(first.some((object) => object.type === 'rect'), true);
  assert.equal(first.every((object) => object.data?.productionBenchmark === true), true);
});

test('benchmark data enters only the production Canvas presentation adapter', () => {
  assert.match(BENCHMARK_SOURCE, /annotationBenchmarkPerPage/);
  assert.match(VIEWER_SOURCE, /createProductionBenchmarkPage/);
  assert.match(VIEWER_SOURCE, /data-production-annotation-benchmark-total/);
  assert.match(VIEWER_SOURCE, /benchmarkPageAnnotations/);
});

test('240k production benchmark has an executable browser runner', () => {
  const runnerUrl = new URL('../debug/benchmarks/run-production-240k.mjs', import.meta.url);
  assert.equal(existsSync(runnerUrl), true);
  const runnerSource = readFileSync(runnerUrl, 'utf8');
  assert.match(runnerSource, /annotationBenchmarkPerPage=2000/);
  assert.match(runnerSource, /\.survey-pdfjs-viewer/);
  assert.match(runnerSource, /visibleNotMounted/);
  assert.match(runnerSource, /maxHostDrift/);
  assert.match(runnerSource, /page120/);
  assert.match(runnerSource, /panAt500Percent/);
  assert.match(runnerSource, /aggressiveZoomStress/);
});
