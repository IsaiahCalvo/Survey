// Prints the verdict table of the last test-plan run:
//   node debug/scenarios/test-plan/summary.mjs [results-dir]
// (default test-results/test-plan, or TEST_PLAN_OUT). One line per item and
// variant: PASS / FAIL / NEEDS-IPHONE / NEEDS-BACKEND and the numbers seen.
import { readdirSync, readFileSync } from 'node:fs';

const dir = process.argv[2] || process.env.TEST_PLAN_OUT || 'test-results/test-plan';
const rows = readdirSync(dir)
  .filter((f) => /^result-.*\.json$/.test(f))
  .map((f) => JSON.parse(readFileSync(`${dir}/${f}`, 'utf8')))
  .sort((a, b) => Number(a.item) - Number(b.item) || a.variant.localeCompare(b.variant));
for (const r of rows) {
  const ev = typeof r.evidence === 'string' ? r.evidence : JSON.stringify(r.evidence);
  console.log(`${String(r.item).padEnd(4)} ${r.result.padEnd(13)} ${r.variant.padEnd(24)} ${ev}`);
}
const failed = rows.filter((r) => r.result === 'FAIL');
console.log(`\n${rows.length} results, ${failed.length} FAIL`);
process.exitCode = failed.length ? 1 : 0;
