/**
 * Post-Processing Pipeline Orchestrator
 *
 * Wires together the full post-processing pipeline:
 * 1. mergeTimeline() - Merge JSONL streams into unified sorted timeline
 * 2. detectAnomalies() - Run four anomaly detection rules
 * 3. generateDiffs() - Compare before/after screenshot pairs
 * 4. writeNarrative() - Generate human/LLM-readable markdown report
 *
 * CLI: npm run debug:process -- <session-dir>
 * API: import { processSession } from './post-process.mjs'
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { mergeTimeline } from './timeline-merger.mjs';
import { detectAnomalies } from './anomaly-detector.mjs';
import { generateDiffs } from './visual-diff.mjs';
import { writeNarrative } from './timeline-writer.mjs';

/**
 * Process a raw session folder into enriched analysis outputs.
 *
 * Reads manifest.json, merges timeline streams, detects anomalies,
 * generates visual diffs, and writes a narrative markdown report.
 *
 * @param {string} sessionDir - Absolute path to the session directory
 * @returns {Promise<{ timeline: Array, anomalies: Array, diffs: Array }>}
 */
export async function processSession(sessionDir) {
  // 1. Read manifest
  const manifestPath = join(sessionDir, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  // 2. Merge timeline
  const timeline = mergeTimeline(sessionDir);
  writeFileSync(join(sessionDir, 'timeline.json'), JSON.stringify(timeline, null, 2));

  // 3. Detect anomalies
  const anomalies = detectAnomalies(timeline, manifest);
  writeFileSync(join(sessionDir, 'anomalies.json'), JSON.stringify(anomalies, null, 2));

  // 4. Generate visual diffs
  const diffs = await generateDiffs(sessionDir);

  // 5. Write narrative
  const narrative = writeNarrative(timeline, anomalies, manifest, sessionDir);
  writeFileSync(join(sessionDir, 'timeline.md'), narrative);

  // Summary log
  console.log(
    `Post-processing complete: ${timeline.length} events, ${anomalies.length} anomalies, ${diffs.length} diffs`
  );

  return { timeline, anomalies, diffs };
}

// CLI entry point
const isMain = process.argv[1] && (
  process.argv[1].endsWith('post-process.mjs') ||
  process.argv[1].includes('post-process')
);
if (isMain) {
  const sessionDir = process.argv[2];
  if (!sessionDir) {
    console.error('Usage: node debug/lib/post-process.mjs <session-dir>');
    process.exit(1);
  }
  const resolved = resolve(sessionDir);
  processSession(resolved).then(() => {
    console.log('Done.');
  }).catch(err => {
    console.error('Post-processing failed:', err.message);
    process.exit(1);
  });
}
