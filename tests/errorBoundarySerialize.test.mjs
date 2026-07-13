import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  serializeErrorForLog,
  formatErrorForDisplay,
  enumerableFieldsOf,
} from '../src/components/errorBoundarySerialize.js';

// The bug: a NON-Error object thrown into React's render/effect tree logged as
// the opaque "[object Object]". These guard that a thrown plain object stays
// diagnosable (constructor + enumerable fields), while real Errors keep their
// name/message/stack.

test('a real Error serializes to name/message/stack', () => {
  const e = new TypeError('boom');
  const s = serializeErrorForLog(e);
  assert.equal(s.name, 'TypeError');
  assert.equal(s.message, 'boom');
  assert.ok(typeof s.stack === 'string' && s.stack.length > 0);
});

test('a non-Error object (no message) surfaces its fields instead of [object Object]', () => {
  // Shape of a thrown Supabase/PostgREST-style error object.
  const thrown = { code: '42501', details: 'permission denied', hint: null };
  const s = serializeErrorForLog(thrown);
  assert.equal(s.name, 'Object');
  assert.equal(s.message, null);
  assert.ok(s.thrownValue.includes('42501'), 'the code is in the serialized fields');
  assert.notEqual(s.thrownValue, '[object Object]');
});

test('a non-Error object WITH a message keeps the message and still lists fields', () => {
  const thrown = { message: 'sync failed', code: 'XX000' };
  const s = serializeErrorForLog(thrown);
  assert.equal(s.message, 'sync failed');
  assert.ok(s.thrownValue.includes('XX000'));
});

test('formatErrorForDisplay never returns "[object Object]" for a plain object', () => {
  const out = formatErrorForDisplay({ code: 'X', details: 'nope' });
  assert.notEqual(out, '[object Object]');
  assert.ok(out.includes('X'));
});

test('primitive throws (string/number/null/undefined) do not crash the serializer', () => {
  assert.equal(serializeErrorForLog('kaboom').message, 'kaboom');
  assert.equal(serializeErrorForLog(42).message, '42');
  assert.equal(serializeErrorForLog(null).message, 'null');
  assert.equal(serializeErrorForLog(undefined).message, 'undefined');
  assert.equal(formatErrorForDisplay('kaboom'), 'kaboom');
});

test('a circular non-Error object degrades gracefully (no throw)', () => {
  const circular = { a: 1 };
  circular.self = circular;
  const s = serializeErrorForLog(circular);
  assert.equal(s.name, 'Object');
  // enumerableFieldsOf returns null on circular → thrownValue falls back to String()
  assert.equal(enumerableFieldsOf(circular), null);
  assert.equal(typeof s.thrownValue, 'string');
});

test('an Array thrown is labelled Array, not Object', () => {
  const s = serializeErrorForLog([{ id: 1 }]);
  assert.equal(s.name, 'Array');
  assert.ok(s.thrownValue.includes('"id":1'));
});

// These helpers run INSIDE the boundary's own render/componentDidCatch, so a
// throw here would blank the whole app. A hostile thrown value must never make
// them throw.
test('a null-prototype object does not crash the serializer or formatter', () => {
  const hostile = Object.create(null);
  hostile.code = 'XX';
  assert.doesNotThrow(() => serializeErrorForLog(hostile));
  assert.doesNotThrow(() => formatErrorForDisplay(hostile));
  const s = serializeErrorForLog(hostile);
  assert.ok(s.thrownValue.includes('XX'));
});

test('a throwing message/toString getter does not crash the serializer or formatter', () => {
  const hostile = {
    get message() { throw new Error('nope'); },
    toString() { throw new Error('nope'); },
    code: 'BOOM',
  };
  // The essential guarantee is "never throw" — a throwing getter aborts
  // JSON.stringify wholesale (so fields past it may be lost), but the boundary
  // must still render. Both helpers must return a string without throwing.
  assert.doesNotThrow(() => serializeErrorForLog(hostile));
  assert.doesNotThrow(() => formatErrorForDisplay(hostile));
  assert.equal(typeof formatErrorForDisplay(hostile), 'string');
  assert.equal(serializeErrorForLog(hostile).name, 'Object');
});

test('a bare null-prototype object with no fields still degrades without throwing', () => {
  const bare = Object.create(null);
  assert.doesNotThrow(() => serializeErrorForLog(bare));
  assert.doesNotThrow(() => formatErrorForDisplay(bare));
  assert.equal(typeof formatErrorForDisplay(bare), 'string');
});
