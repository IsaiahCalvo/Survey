// The signed-in E2E suite runs split across CI machines
// (scripts/e2e-signed-in-shard.mjs, .github/workflows/e2e-signed-in.yml). A
// split that drops a spec would hide it from CI, so every spec must land in
// exactly one shard for every shard count the workflow could use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  listSpecFiles,
  readSpecSeconds,
  secondsFromLogs,
  shardSpecFiles,
} from '../scripts/e2e-signed-in-shard.mjs';

const specs = listSpecFiles();

test('every spec lands in exactly one shard, and no shard is empty', () => {
  for (let count = 1; count <= 8; count += 1) {
    const shards = shardSpecFiles(specs, count);
    assert.equal(shards.length, count);
    const all = shards.flatMap((shard) => shard.files);
    assert.deepEqual([...all].sort(), specs, `${count} shards cover every spec once`);
    for (const shard of shards) assert.ok(shard.files.length > 0, `${count} shards: none empty`);
  }
});

test('the split is the same every time', () => {
  assert.deepEqual(shardSpecFiles(specs, 5), shardSpecFiles([...specs].reverse(), 5));
});

test('the split is balanced by measured time', () => {
  const shards = shardSpecFiles(specs, 5);
  const loads = shards.map((shard) => shard.load);
  const heaviestSpec = Math.max(...Object.values(readSpecSeconds()));
  assert.ok(Math.max(...loads) - Math.min(...loads) <= heaviestSpec, `loads ${loads.join(', ')}`);
});

test('no spec path is a filter that also matches another spec', () => {
  // Playwright reads each CLI path as a pattern, so one spec's path must not
  // be part of another's or a shard would also run the other spec.
  for (const a of specs) {
    for (const b of specs) {
      if (a !== b) assert.ok(!b.includes(a), `${a} also matches ${b}`);
    }
  }
});

test('a spec with no measured time still gets a shard', () => {
  const shards = shardSpecFiles([...specs, 'tests/e2e-signed-in/zz-brand-new.spec.mjs'], 5);
  assert.equal(shards.filter((shard) => shard.files.includes('tests/e2e-signed-in/zz-brand-new.spec.mjs')).length, 1);
});

test('times are read from a Playwright list-reporter log', () => {
  const log = [
    '2026-10-28T03:14:58Z   ✓    1 tests/e2e-signed-in/a.spec.mjs:42:1 › one (567ms)',
    '2026-10-28T03:14:59Z   ✓    2 tests/e2e-signed-in/a.spec.mjs:53:1 › two (1.5s)',
    '2026-10-28T03:15:00Z   ✘    3 [phone] › tests/e2e-signed-in/b.spec.mjs:9:1 › three (1.2m)',
    'unrelated line (3s)',
  ].join('\n');
  assert.deepEqual(secondsFromLogs([log]), { 'a.spec.mjs': 2.1, 'b.spec.mjs': 72 });
  // Shard logs: each spec in one log keeps its own time.
  const other = '  ✓    1 tests/e2e-signed-in/c.spec.mjs:1:1 › four (4s)';
  assert.deepEqual(secondsFromLogs([log, other]), { 'a.spec.mjs': 2.1, 'b.spec.mjs': 72, 'c.spec.mjs': 4 });
});

test('the workflow lists shards 1..n', () => {
  // The shard count is the matrix size (strategy.job-total), so the list must
  // run 1, 2, ... with no gap or every spec in the missing shard goes unrun.
  const workflow = readFileSync(new URL('../.github/workflows/e2e-signed-in.yml', import.meta.url), 'utf8');
  const listed = workflow.match(/fromJSON\('\[([\d,\s]+)\]'\)/g)?.find((m) => m.includes(','));
  assert.ok(listed, 'shard list in the workflow');
  const indexes = JSON.parse(listed.slice("fromJSON('".length, -"')".length));
  assert.ok(indexes.length > 1);
  assert.deepEqual(indexes, Array.from({ length: indexes.length }, (_, i) => i + 1));
});
