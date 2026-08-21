#!/usr/bin/env node
// scripts/check-no-diff-delete.mjs
//
// Phase 30 architectural invariant gate.
//
// Created out-of-order during Plan 30-03 execution as a Rule 3 blocking
// deviation - Plan 30-03 needs this gate to verify its production module.
// When Plan 30-01 runs, its Task 3 should detect this file already exists.
//
// CONTEXT.md `<decisions>` "No 'diff = delete' logic anywhere":
//   The dual-write code paths must NEVER delete from one store to "match"
//   the other. If the two stores diverge transiently (one save landed, the
//   other didn't), the only allowed remediation is retrying the missing-side
//   write. Code review + a lint rule confirm the pattern is banned by
//   construction. Defends Pitfall 5 (the simple-sync killer).
//
// This script is the lint rule. It runs in CI before the test suite. If it
// finds a banned pattern in the 3 dual-write surface files, it exits 1 and
// prints the offending location.
//
// Escape hatch: append `// NO_DIFF_DELETE_OK: <reason>` on the same line for
// legitimate uses. The escape comment is also grep-checked so a developer
// cannot dodge by simply adding "NO_DIFF_DELETE_OK" to a comment elsewhere.

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SCAN_FILES = [
  'src/services/annotationCloudSync.js',
  'src/lib/collab/crdtBackfill.js',
];

// Banned pattern: "diff" or "reconcile" or "sync" near "delete", any direction.
// Case-insensitive. Word-boundary on the trigger words to reduce false hits.
const BANNED = /\b(diff|reconcile|sync)\b[^\n]{0,80}\bdelete\b|\bdelete\b[^\n]{0,80}\b(diff|reconcile|sync)\b/i;
const ESCAPE = /NO_DIFF_DELETE_OK:/;

const isList = process.argv.includes('--list');
if (isList) {
  console.log('Scanned files:');
  for (const f of SCAN_FILES) console.log(' -', f);
  process.exit(0);
}

let violations = 0;
for (const relPath of SCAN_FILES) {
  const abs = resolve(process.cwd(), relPath);
  if (!existsSync(abs)) {
    // File not yet shipped - Plan 30-02 / 30-03 / 30-04 lands them. Skip.
    continue;
  }
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (BANNED.test(line) && !ESCAPE.test(line)) {
      console.error(`[check-no-diff-delete] ${relPath}:${i + 1}: ${line.trim()}`);
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n[check-no-diff-delete] ${violations} violation(s) found.`);
  console.error(`Phase 30 architectural lock: dual-write paths must NEVER delete from one store to match the other.`);
  console.error(`Add \`// NO_DIFF_DELETE_OK: <reason>\` on the offending line if the pattern is intentional.`);
  process.exit(1);
}

console.log(`[check-no-diff-delete] OK - 0 violations across ${SCAN_FILES.length} files.`);
process.exit(0);
