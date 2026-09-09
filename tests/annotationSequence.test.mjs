import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAnnotationSequence, compareAnnotationSequences, nextAnnotationSequence,
  maxAnnotationSequence, annotationSequenceToSafeInteger,
} from '../src/services/annotationSequence.js';

const safe = Number.MAX_SAFE_INTEGER;
const pgMax = 9223372036854775807n;

test('canonical sequences retain exact PostgreSQL bigint values without rounding', () => {
  for (const value of [0, 0n, '0']) assert.equal(normalizeAnnotationSequence(value), 0);
  for (const value of [1, 1n, '1']) assert.equal(normalizeAnnotationSequence(value), 1);
  for (const value of [safe, BigInt(safe), String(safe)]) assert.equal(normalizeAnnotationSequence(value), safe);
  for (const value of [BigInt(safe) + 1n, String(BigInt(safe) + 1n)]) {
    assert.equal(normalizeAnnotationSequence(value), '9007199254740992');
  }
  assert.equal(normalizeAnnotationSequence('9007199254740993'), '9007199254740993');
  assert.equal(normalizeAnnotationSequence(pgMax), '9223372036854775807');
  assert.equal(normalizeAnnotationSequence(String(pgMax)), '9223372036854775807');
});

test('invalid or noncanonical sequence input is rejected instead of coerced', () => {
  for (const value of [null, undefined, true, false, {}, [], ['1'], '', ' ', ' 1', '1 ',
    '00', '01', '+1', '-1', '-0', '1.0', '1e3', '0x10', 'NaN', 'Infinity',
    -1, -1n, 0.5, NaN, Infinity, -Infinity, safe + 1, pgMax + 1n, String(pgMax + 1n)]) {
    assert.throws(() => normalizeAnnotationSequence(value), String(value));
  }
});

test('nullable sequence mode is explicit and never relaxes numeric validation', () => {
  assert.equal(normalizeAnnotationSequence(null, { nullable: true }), null);
  for (const value of [-1, '01', pgMax + 1n]) {
    assert.throws(() => normalizeAnnotationSequence(value, { nullable: true }));
  }
});

test('sequence ordering distinguishes adjacent values beyond 2^53 and mixed representations', () => {
  const values = [0, 1, safe, '9007199254740992', '9007199254740993', '9223372036854775807'];
  for (let a = 0; a < values.length; a++) for (let b = 0; b < values.length; b++) {
    assert.equal(compareAnnotationSequences(values[a], values[b]), Math.sign(a - b));
  }
  assert.equal(compareAnnotationSequences(7, '7'), 0);
  assert.equal(compareAnnotationSequences('9007199254740993', 9007199254740993n), 0);
  assert.throws(() => compareAnnotationSequences(safe + 1, '9007199254740992'));
});

test('next and max remain exact across the safe-integer boundary and reject PostgreSQL overflow', () => {
  assert.equal(nextAnnotationSequence(0), 1);
  assert.equal(nextAnnotationSequence(safe - 1), safe);
  assert.equal(nextAnnotationSequence(safe), '9007199254740992');
  assert.equal(nextAnnotationSequence('9007199254740992'), '9007199254740993');
  assert.equal(nextAnnotationSequence(pgMax - 1n), String(pgMax));
  assert.throws(() => nextAnnotationSequence(pgMax));
  assert.equal(maxAnnotationSequence(1, '9007199254740992', '9007199254740993', safe), '9007199254740993');
  assert.equal(maxAnnotationSequence('7', 1n, 3), 7);
  assert.throws(() => maxAnnotationSequence(1, safe + 1));
  assert.throws(() => maxAnnotationSequence());
});

test('conversion for number-only consumers refuses every precision-losing value', () => {
  assert.equal(annotationSequenceToSafeInteger('0'), 0);
  assert.equal(annotationSequenceToSafeInteger(String(safe)), safe);
  assert.equal(annotationSequenceToSafeInteger(BigInt(safe)), safe);
  for (const value of ['9007199254740992', '9007199254740993', pgMax, safe + 1, null, '01']) {
    assert.throws(() => annotationSequenceToSafeInteger(value));
  }
});
