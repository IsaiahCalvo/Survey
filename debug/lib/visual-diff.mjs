/**
 * Visual Diff Generator
 *
 * Compares before/after screenshot pairs at each step using pixelmatch,
 * producing diff images in a diffs/ subdirectory with mismatch statistics.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/** Screenshot filename pattern: step-NN_MMMMMms_timing-description.png */
const SCREENSHOT_REGEX = /^step-(\d{2})_(\d+)ms_(\w+)-(.+)\.png$/;

/**
 * Parse a screenshot filename into structured data.
 *
 * @param {string} filename - Screenshot filename (e.g., "step-01_14789ms_after-zoom-100pct.png")
 * @returns {{ step: number, sessionMs: number, timing: string, description: string } | null}
 */
export function parseScreenshotName(filename) {
  if (!filename) return null;
  const match = filename.match(SCREENSHOT_REGEX);
  if (!match) return null;
  return {
    step: Number(match[1]),
    sessionMs: Number(match[2]),
    timing: match[3],
    description: match[4],
  };
}

/**
 * Generate visual diffs for all before/after screenshot pairs in a session directory.
 *
 * For each step that has both a "before" and "after" screenshot, runs pixelmatch
 * to produce a diff image in diffs/ and records mismatch statistics.
 *
 * @param {string} sessionDir - Path to the session directory containing screenshots
 * @returns {Promise<Array<Object>>} Array of diff result objects
 */
export async function generateDiffs(sessionDir) {
  // Create diffs/ subdirectory
  const diffsDir = join(sessionDir, 'diffs');
  mkdirSync(diffsDir, { recursive: true });

  // Read all PNG files and parse filenames
  const files = readdirSync(sessionDir).filter(f => f.endsWith('.png'));
  const parsed = files
    .map(f => ({ filename: f, ...parseScreenshotName(f) }))
    .filter(p => p.step != null);

  // Group by step number
  const stepGroups = {};
  for (const p of parsed) {
    if (!stepGroups[p.step]) stepGroups[p.step] = {};
    stepGroups[p.step][p.timing] = p;
  }

  const results = [];

  // Process each step that has both before and after
  for (const [stepStr, group] of Object.entries(stepGroups)) {
    const step = Number(stepStr);
    if (!group.before || !group.after) continue; // Skip steps without a pair

    const beforePath = join(sessionDir, group.before.filename);
    const afterPath = join(sessionDir, group.after.filename);

    // Read PNG files
    const beforePng = PNG.sync.read(readFileSync(beforePath));
    const afterPng = PNG.sync.read(readFileSync(afterPath));

    // Check dimension match
    if (beforePng.width !== afterPng.width || beforePng.height !== afterPng.height) {
      results.push({
        step,
        before: group.before.filename,
        after: group.after.filename,
        diffImage: null,
        mismatchCount: 0,
        mismatchPct: 0,
        totalPixels: 0,
        error: 'dimension_mismatch',
      });
      continue;
    }

    const { width, height } = beforePng;
    const totalPixels = width * height;
    const diff = new PNG({ width, height });

    // Run pixelmatch
    const mismatchCount = pixelmatch(
      beforePng.data,
      afterPng.data,
      diff.data,
      width,
      height,
      { threshold: 0.1, includeAA: false }
    );

    // Write diff image
    const diffFilename = `step-${String(step).padStart(2, '0')}_diff.png`;
    writeFileSync(join(diffsDir, diffFilename), PNG.sync.write(diff));

    const mismatchPct = Number((mismatchCount / totalPixels * 100).toFixed(2));

    results.push({
      step,
      before: group.before.filename,
      after: group.after.filename,
      diffImage: diffFilename,
      mismatchCount,
      mismatchPct,
      totalPixels,
    });
  }

  // Sort by step number
  results.sort((a, b) => a.step - b.step);

  // Write summary.json
  writeFileSync(join(diffsDir, 'summary.json'), JSON.stringify(results, null, 2));

  return results;
}
