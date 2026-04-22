import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeTimeline } from '../debug/lib/timeline-merger.mjs';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FIXTURE_DIR = join(import.meta.dirname, '..', 'debug', 'fixtures', 'mock-session');

test('mergeTimeline produces array sorted by sessionMs', () => {
  const timeline = mergeTimeline(FIXTURE_DIR);
  assert.ok(Array.isArray(timeline), 'result should be an array');
  assert.ok(timeline.length > 0, 'result should not be empty');

  for (let i = 1; i < timeline.length; i++) {
    assert.ok(
      timeline[i].sessionMs >= timeline[i - 1].sessionMs,
      `Entry ${i} (sessionMs=${timeline[i].sessionMs}) should be >= entry ${i - 1} (sessionMs=${timeline[i - 1].sessionMs})`
    );
  }
});

test('each merged entry has _source and _index fields', () => {
  const timeline = mergeTimeline(FIXTURE_DIR);
  const validSources = new Set(['state', 'performance', 'console']);

  for (const entry of timeline) {
    assert.ok(validSources.has(entry._source), `_source should be one of state/performance/console, got: ${entry._source}`);
    assert.equal(typeof entry._index, 'number', '_index should be a number');
  }
});

test('entries with same sessionMs sort stably: performance first, then state, then console', () => {
  // Create a temp directory with entries sharing the same sessionMs
  const tmpDir = mkdtempSync(join(tmpdir(), 'timeline-tie-'));
  writeFileSync(join(tmpDir, 'state.jsonl'), '{"sessionMs":1000,"step":0,"action":"test"}\n');
  writeFileSync(join(tmpDir, 'performance.jsonl'), '{"sessionMs":1000,"type":"cdp","metrics":{}}\n');
  writeFileSync(join(tmpDir, 'console.jsonl'), '{"sessionMs":1000,"level":"warn","text":"test"}\n');

  const timeline = mergeTimeline(tmpDir);
  assert.equal(timeline.length, 3, 'should have 3 entries');
  assert.equal(timeline[0]._source, 'performance', 'performance should come first at same sessionMs');
  assert.equal(timeline[1]._source, 'state', 'state should come second at same sessionMs');
  assert.equal(timeline[2]._source, 'console', 'console should come last at same sessionMs');
});

test('missing JSONL file returns zero entries for that source (no crash)', () => {
  // Create a temp directory with only state.jsonl (no performance or console)
  const tmpDir = mkdtempSync(join(tmpdir(), 'timeline-missing-'));
  writeFileSync(join(tmpDir, 'state.jsonl'), '{"sessionMs":500,"step":0,"action":"test"}\n');

  const timeline = mergeTimeline(tmpDir);
  assert.ok(Array.isArray(timeline), 'result should be an array');
  assert.equal(timeline.length, 1, 'should have 1 entry from state only');
  assert.equal(timeline[0]._source, 'state');
});

test('empty JSONL file returns zero entries for that source (no crash)', () => {
  // Create a temp directory with all files, but console.jsonl is empty
  const tmpDir = mkdtempSync(join(tmpdir(), 'timeline-empty-'));
  writeFileSync(join(tmpDir, 'state.jsonl'), '{"sessionMs":500,"step":0,"action":"test"}\n');
  writeFileSync(join(tmpDir, 'performance.jsonl'), '{"sessionMs":600,"type":"mark","name":"test","detail":{}}\n');
  writeFileSync(join(tmpDir, 'console.jsonl'), '');

  const timeline = mergeTimeline(tmpDir);
  assert.ok(Array.isArray(timeline), 'result should be an array');
  assert.equal(timeline.length, 2, 'should have 2 entries (empty console excluded)');
  const sources = timeline.map(e => e._source);
  assert.ok(!sources.includes('console'), 'should have no console entries');
});
