import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  assertDocumentVersionMatch,
  DocumentVersionConflictError,
} from '../src/utils/documentVersionCheck.js';

test('P1-19: missing expected version is a no-op', () => {
  assert.equal(assertDocumentVersionMatch({ remoteUpdatedAt: '2026-08-20' }).ok, true);
});

test('P1-19: matching updated_at allows replace', () => {
  assert.equal(assertDocumentVersionMatch({
    expectedUpdatedAt: '2026-08-20T12:00:00.000Z',
    remoteUpdatedAt: '2026-08-20T12:00:00.000Z',
  }).ok, true);
});

test('P1-19: mismatched updated_at is a conflict', () => {
  const result = assertDocumentVersionMatch({
    expectedUpdatedAt: '2026-08-20T12:00:00.000Z',
    remoteUpdatedAt: '2026-08-20T13:00:00.000Z',
  });
  assert.equal(result.ok, false);
  assert.ok(result.error instanceof DocumentVersionConflictError);
});

test('P1-19: replaceDocument consults expectedUpdatedAt before upsert', () => {
  const source = readFileSync(new URL('../src/hooks/useDatabase.js', import.meta.url), 'utf8');
  const start = source.indexOf('const replaceDocument = useCallback');
  const body = source.slice(start, start + 1600);
  assert.match(body, /expectedUpdatedAt/);
  assert.match(body, /assertDocumentVersionMatch/);
  assert.match(body, /upsert: true/);
});
