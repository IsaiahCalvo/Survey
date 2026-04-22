import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Source priority for stable tie-breaking when entries share the same sessionMs.
 * Lower number = higher priority (appears first in sorted output).
 */
const SOURCE_PRIORITY = { performance: 0, state: 1, console: 2 };

/**
 * Read a JSONL file and tag each entry with _source and _index.
 * Returns empty array if file is missing or empty.
 *
 * @param {string} filePath - Absolute path to the JSONL file
 * @param {string} source - Source tag ('state' | 'performance' | 'console')
 * @returns {Array<Object>} Parsed entries with _source and _index fields
 */
function readJsonl(filePath, source) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf-8').trim();
  if (!content) return [];
  return content.split('\n').map((line, index) => {
    const entry = JSON.parse(line);
    return { ...entry, _source: source, _index: index };
  });
}

/**
 * Merge three JSONL streams (state, performance, console) from a session
 * directory into a single sorted array.
 *
 * Entries are sorted by sessionMs with stable tie-breaking:
 * performance first, then state, then console. Within the same source,
 * original file order (_index) is preserved.
 *
 * @param {string} sessionDir - Path to the session directory containing JSONL files
 * @returns {Array<Object>} Merged and sorted timeline entries
 */
export function mergeTimeline(sessionDir) {
  const state = readJsonl(join(sessionDir, 'state.jsonl'), 'state');
  const perf = readJsonl(join(sessionDir, 'performance.jsonl'), 'performance');
  const cons = readJsonl(join(sessionDir, 'console.jsonl'), 'console');

  const merged = [...state, ...perf, ...cons];

  merged.sort((a, b) => {
    const timeDiff = a.sessionMs - b.sessionMs;
    if (timeDiff !== 0) return timeDiff;
    // Stable tie-breaking: performance first, then state, then console
    const priorityDiff = SOURCE_PRIORITY[a._source] - SOURCE_PRIORITY[b._source];
    if (priorityDiff !== 0) return priorityDiff;
    // Within same source, preserve original file order
    return a._index - b._index;
  });

  return merged;
}
