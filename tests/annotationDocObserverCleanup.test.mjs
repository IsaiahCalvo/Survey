// useAnnotationDoc's background effects (legacy carry-over, store compaction)
// observe the meta map only once they begin, and their stop() runs more than
// once (from run() and again on unmount). An unguarded unobserve made Yjs log
// "[yjs] Tried to remove event handler that doesn't exist." on every document
// open/close (seen in the real two-account run, TEST-PLAN Part 9, 2026-10-06).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';

const HOOK_SOURCE = readFileSync(new URL('../src/hooks/useAnnotationDoc.js', import.meta.url), 'utf8');

test('every meta.unobserve(onMeta) in useAnnotationDoc is guarded by the observing flag', () => {
  const lines = HOOK_SOURCE.split('\n').filter((l) => l.includes('meta.unobserve(onMeta)'));
  assert.ok(lines.length >= 2, 'both background effects unobserve the meta map');
  for (const line of lines) assert.match(line, /if \(observing\) meta\.unobserve\(onMeta\)/, line.trim());
  // ...and every effect that observes sets the flag right after.
  const observes = HOOK_SOURCE.split('\n').map((l, i, all) => [l, all[i + 1] || '']).filter(([l]) => l.includes('meta.observe(onMeta)'));
  assert.ok(observes.length >= 2);
  for (const [, next] of observes) assert.match(next, /observing = true/);
});

test('the guarded pattern is silent in Yjs when stop() runs twice or before begin()', () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); };
  try {
    const meta = new Y.Doc().getMap('meta');
    const make = () => {
      let observing = false;
      const onMeta = () => {};
      return {
        begin() { meta.observe(onMeta); observing = true; },
        stop() { if (observing) meta.unobserve(onMeta); observing = false; },
      };
    };
    const neverBegun = make();
    neverBegun.stop();
    const twice = make();
    twice.begin();
    twice.stop();
    twice.stop();
    assert.deepEqual(errors, []);
    // The old unguarded form does log (what the guard prevents).
    const onMeta = () => {};
    meta.observe(onMeta);
    meta.unobserve(onMeta);
    meta.unobserve(onMeta);
    assert.equal(errors.length, 1);
  } finally {
    console.error = original;
  }
});
