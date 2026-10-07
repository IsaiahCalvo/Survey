import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPageSizeCommitBatcher,
  PAGE_SIZE_COMMIT_INTERVAL_MS,
} from '../src/utils/pageSizeCommitBatcher.js';

const PDF_VIEWER_SOURCE = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');

const size = (n) => ({ width: 600 + n, height: 800 + n });
const batchFor = (pageNumbers) => {
  const heights = {}; const sizes = {}; const pages = {};
  for (const n of pageNumbers) {
    heights[n] = size(n).height;
    sizes[n] = size(n);
    pages[n] = { pageNumber: n };
  }
  return [heights, sizes, pages];
};

function simulateOpen({ pageCount, workers, msPerBatch, intervalMs = PAGE_SIZE_COMMIT_INTERVAL_MS }) {
  let clock = 0;
  const commits = [];
  const batcher = createPageSizeCommitBatcher({ commit: (b) => commits.push(b), now: () => clock, intervalMs });
  for (let start = 2; start <= pageCount; start += workers) {
    clock += msPerBatch;
    const nums = [];
    for (let n = start; n < start + workers && n <= pageCount; n += 1) nums.push(n);
    batcher.add(...batchFor(nums));
  }
  batcher.flush();
  return commits;
}

test('a 120-page open on a 4-core phone commits a handful of times, not once per 2-page batch', () => {
  // 59 batches of two pages, ~40 ms each (WebKit headless timing): the old
  // loop committed 59 times and React warned "Maximum update depth exceeded".
  const commits = simulateOpen({ pageCount: 120, workers: 2, msPerBatch: 40 });
  assert.ok(commits.length <= 10, `expected <= 10 commits, got ${commits.length}`);
  assert.ok(commits.length >= 2, 'still commits progressively while sizing');
  // Every page 2..120 lands exactly once, with its own size, page and height.
  const seen = {};
  for (const c of commits) {
    for (const [k, v] of Object.entries(c.sizes)) {
      assert.equal(seen[k], undefined, `page ${k} committed twice`);
      seen[k] = v;
      assert.equal(c.heights[k], v.height);
      assert.equal(c.pages[k].pageNumber, Number(k));
    }
  }
  assert.equal(Object.keys(seen).length, 119);
  assert.deepEqual(seen[120], size(120));
});

test('commits at most once per interval and flushes the remainder at the end', () => {
  let clock = 0;
  const commits = [];
  const batcher = createPageSizeCommitBatcher({ commit: (b) => commits.push(b), now: () => clock, intervalMs: 100 });
  clock = 30; assert.equal(batcher.add(...batchFor([2, 3])), false);
  clock = 60; assert.equal(batcher.add(...batchFor([4, 5])), false);
  assert.equal(commits.length, 0);
  assert.equal(batcher.pendingCount, 4);
  clock = 100; assert.equal(batcher.add(...batchFor([6])), true);
  assert.equal(commits.length, 1);
  assert.deepEqual(Object.keys(commits[0].sizes), ['2', '3', '4', '5', '6']);
  clock = 150; batcher.add(...batchFor([7]));
  assert.equal(commits.length, 1);
  assert.equal(batcher.flush(), true);
  assert.deepEqual(Object.keys(commits[1].sizes), ['7']);
  // Nothing pending: a second flush commits nothing.
  assert.equal(batcher.flush(), false);
  assert.equal(commits.length, 2);
});

test('slow sizing still shows pages as they come (one commit per slow batch)', () => {
  const commits = simulateOpen({ pageCount: 9, workers: 2, msPerBatch: 400 });
  assert.equal(commits.length, 4);
});

test('PDFViewer sizing loop commits through the batcher, not per batch', () => {
  const start = PDF_VIEWER_SOURCE.indexOf('const pageSizeCommits = createPageSizeCommitBatcher(');
  assert.ok(start > 0, 'sizing loop creates a page-size commit batcher');
  const end = PDF_VIEWER_SOURCE.indexOf("perfLoad.mark(docName, `Page sizes calculated", start);
  assert.ok(end > start);
  const loop = PDF_VIEWER_SOURCE.slice(start, end);
  assert.match(loop, /pageSizeCommits\.add\(batchHeights, batchSizes, batchPages\);/);
  assert.match(loop, /if \(!isPageViewOver\(pdf\)\) pageSizeCommits\.flush\(\);/);
  // The per-batch state setters are gone from the loop body (only the
  // batcher's commit callback sets them).
  assert.equal((loop.match(/setPageSizes\(/g) || []).length, 1);
  assert.doesNotMatch(loop, /\.\.\.batchSizes/);
});
