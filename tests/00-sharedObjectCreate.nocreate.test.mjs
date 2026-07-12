/**
 * Runs before every other test file (name sorts before 000-*).
 * Evaluates packages/shared/dist/index.js while Object.create is falsy so the
 * __createBinding else-branch (lines 13-14) is covered on first load.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const prevCreate = Object.create;
Object.create = null;
let sharedMod;
try {
  sharedMod = await import('../packages/shared/dist/index.js');
} finally {
  Object.create = prevCreate;
}

test('shared dist index loads via Object.create-null __createBinding branch', () => {
  assert.ok(sharedMod);
  assert.ok(
    sharedMod.SURVEY_MARKER_TYPE
      || sharedMod.ANNOTATION_TYPES
      || Object.keys(sharedMod).length > 0,
  );
});
