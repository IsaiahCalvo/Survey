import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLibraryMutation, createLibraryReadReconciler } from '../src/hooks/libraryMutationState.js';

test('journal equals ACK replay while retaining unseen rows', () => {
  const original = [{ id: 'unknown' }, { id: 'updated', v: 0 }, { id: 'gone' }];
  const changes = [
    { kind: 'upsert', row: { id: 'a', v: 0 } },
    { kind: 'upsert', row: { id: 'b' } },
    { kind: 'update', row: { id: 'a', v: 1 } },
    { kind: 'update', row: { id: 'updated', v: 2 } },
    { kind: 'delete', id: 'gone' },
    { kind: 'update', row: { id: 'gone', v: 3 } },
    { kind: 'update', row: { id: 'absent' } },
  ];
  const journal = createLibraryReadReconciler();
  changes.forEach(change => journal.record(change));
  assert.deepEqual(journal.apply(original), changes.reduce(applyLibraryMutation, original));
  assert.deepEqual(original, [{ id: 'unknown' }, { id: 'updated', v: 0 }, { id: 'gone' }]);
});

test('journal reset, repeated insertion and nested ownership', () => {
  const journal = createLibraryReadReconciler();
  journal.record({ kind: 'upsert', row: { id: 'discard' } });
  const replacement = { kind: 'replace', rows: [{ id: 's', config: { n: 1 } }] };
  journal.record(replacement);
  replacement.rows[0].config.n = 9;
  journal.record({ kind: 'upsert', row: { id: 'a' } });
  journal.record({ kind: 'upsert', row: { id: 'b' } });
  journal.record({ kind: 'upsert', row: { id: 'a', v: 1 } });
  assert.deepEqual(journal.apply([{ id: 'stale' }]), [
    { id: 'a', v: 1 }, { id: 'b' }, { id: 's', config: { n: 1 } },
  ]);
});

test('bounded per-row journal matches long mixed deterministic replay', () => {
  let seed = 42;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const journal = createLibraryReadReconciler();
  const original = Array.from({ length: 20 }, (_, i) => ({ id: String(i) }));
  let expected = original;
  for (let i = 0; i < 4000; i++) {
    const kind = ['upsert', 'update', 'delete', 'replace'][(random() >>> 16) % 4];
    const id = String(random() % 30);
    const change = kind === 'replace' ? { kind, rows: [{ id, i }] }
      : kind === 'delete' ? { kind, id } : { kind, row: { id, i } };
    journal.record(change);
    expected = applyLibraryMutation(expected, change);
    assert.deepEqual(journal.apply(original), expected);
  }
});
