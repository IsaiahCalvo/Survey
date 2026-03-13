import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { generateDiffs, parseScreenshotName } from '../debug/lib/visual-diff.mjs';

/**
 * Create a synthetic PNG buffer with a solid color.
 * @param {number} width
 * @param {number} height
 * @param {{ r: number, g: number, b: number, a: number }} color
 * @returns {Buffer}
 */
function createPng(width, height, color = { r: 255, g: 0, b: 0, a: 255 }) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      png.data[idx] = color.r;
      png.data[idx + 1] = color.g;
      png.data[idx + 2] = color.b;
      png.data[idx + 3] = color.a;
    }
  }
  return PNG.sync.write(png);
}

/**
 * Create a synthetic PNG with one pixel changed at (0,0).
 */
function createPngWithDiff(width, height, baseColor, diffColor) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const c = (x === 0 && y === 0) ? diffColor : baseColor;
      png.data[idx] = c.r;
      png.data[idx + 1] = c.g;
      png.data[idx + 2] = c.b;
      png.data[idx + 3] = c.a;
    }
  }
  return PNG.sync.write(png);
}

const TEMP_DIR = join(process.cwd(), '.test-temp-visual-diff');

describe('parseScreenshotName', () => {
  it('parses valid screenshot filenames', () => {
    const result = parseScreenshotName('step-01_14789ms_after-zoom-100pct.png');
    assert.deepStrictEqual(result, {
      step: 1,
      sessionMs: 14789,
      timing: 'after',
      description: 'zoom-100pct',
    });
  });

  it('parses before timing', () => {
    const result = parseScreenshotName('step-03_15672ms_before-zoom-150pct.png');
    assert.deepStrictEqual(result, {
      step: 3,
      sessionMs: 15672,
      timing: 'before',
      description: 'zoom-150pct',
    });
  });

  it('parses baseline timing', () => {
    const result = parseScreenshotName('step-00_13597ms_baseline-initial-state.png');
    assert.deepStrictEqual(result, {
      step: 0,
      sessionMs: 13597,
      timing: 'baseline',
      description: 'initial-state',
    });
  });

  it('returns null for invalid filenames', () => {
    assert.strictEqual(parseScreenshotName('not-a-screenshot.png'), null);
    assert.strictEqual(parseScreenshotName('step-01_noMs_after.png'), null);
    assert.strictEqual(parseScreenshotName(''), null);
  });
});

describe('generateDiffs', () => {
  before(() => {
    // Create temp session directory with synthetic PNGs
    mkdirSync(TEMP_DIR, { recursive: true });

    const red = { r: 255, g: 0, b: 0, a: 255 };
    const blue = { r: 0, g: 0, b: 255, a: 255 };
    const green = { r: 0, g: 255, b: 0, a: 255 };

    // Step 0: only baseline (no pair expected)
    writeFileSync(
      join(TEMP_DIR, 'step-00_1000ms_baseline-initial-state.png'),
      createPng(4, 4, red)
    );

    // Step 1: before/after pair with one pixel different
    writeFileSync(
      join(TEMP_DIR, 'step-01_2000ms_before-zoom-100pct.png'),
      createPng(4, 4, red)
    );
    writeFileSync(
      join(TEMP_DIR, 'step-01_3000ms_after-zoom-100pct.png'),
      createPngWithDiff(4, 4, red, blue) // one pixel changed
    );

    // Step 2: before/after with dimension mismatch
    writeFileSync(
      join(TEMP_DIR, 'step-02_4000ms_before-zoom-125pct.png'),
      createPng(4, 4, red)
    );
    writeFileSync(
      join(TEMP_DIR, 'step-02_5000ms_after-zoom-125pct.png'),
      createPng(8, 8, green) // different dimensions
    );

    // Step 3: only "before" (no after -- should be skipped)
    writeFileSync(
      join(TEMP_DIR, 'step-03_6000ms_before-zoom-150pct.png'),
      createPng(4, 4, red)
    );
  });

  after(() => {
    rmSync(TEMP_DIR, { recursive: true, force: true });
  });

  it('produces diff images and summary for before/after pairs', async () => {
    const results = await generateDiffs(TEMP_DIR);

    // Should have results for step 1 (valid pair) and step 2 (dimension mismatch)
    assert.ok(Array.isArray(results));

    const step1 = results.find(r => r.step === 1);
    assert.ok(step1, 'Expected result for step 1');
    assert.strictEqual(step1.before, 'step-01_2000ms_before-zoom-100pct.png');
    assert.strictEqual(step1.after, 'step-01_3000ms_after-zoom-100pct.png');
    assert.strictEqual(step1.diffImage, 'step-01_diff.png');
    assert.strictEqual(typeof step1.mismatchCount, 'number');
    assert.ok(step1.mismatchCount > 0, 'Expected at least one mismatched pixel');
    assert.strictEqual(typeof step1.mismatchPct, 'number');
    assert.strictEqual(step1.totalPixels, 16); // 4x4
  });

  it('includes mismatchCount, mismatchPct, and diff image path in each result', async () => {
    const results = await generateDiffs(TEMP_DIR);
    const step1 = results.find(r => r.step === 1);
    assert.ok(step1);
    // One pixel out of 16 changed = 6.25%
    assert.strictEqual(step1.mismatchPct, Number((step1.mismatchCount / 16 * 100).toFixed(2)));
    // Diff image file should exist
    assert.ok(existsSync(join(TEMP_DIR, 'diffs', 'step-01_diff.png')));
  });

  it('writes summary.json to diffs/ directory', async () => {
    const results = await generateDiffs(TEMP_DIR);
    const summaryPath = join(TEMP_DIR, 'diffs', 'summary.json');
    assert.ok(existsSync(summaryPath), 'summary.json should exist');
    const summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));
    assert.ok(Array.isArray(summary));
    assert.strictEqual(summary.length, results.length);
  });

  it('records dimension mismatch as error entry (not crash)', async () => {
    const results = await generateDiffs(TEMP_DIR);
    const step2 = results.find(r => r.step === 2);
    assert.ok(step2, 'Expected result for step 2');
    assert.strictEqual(step2.error, 'dimension_mismatch');
  });

  it('skips steps with only baseline or only before/after', async () => {
    const results = await generateDiffs(TEMP_DIR);
    // Step 0 (baseline only) should not appear
    const step0 = results.find(r => r.step === 0);
    assert.strictEqual(step0, undefined, 'Step 0 (baseline only) should be skipped');
    // Step 3 (before only, no after) should not appear
    const step3 = results.find(r => r.step === 3);
    assert.strictEqual(step3, undefined, 'Step 3 (before only) should be skipped');
  });
});
