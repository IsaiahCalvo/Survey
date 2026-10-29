import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PULL_BEFORE_PUSH, hasRowWaitingOnChoice, isVersionMismatch, pullAllowsPush, readWorkbookVersion, uploadIfMatch,
  workbookChangedSincePull,
} from '../excelPushGate.js';

test('a push goes ahead after a finished pull, or when the linked file is missing', () => {
  assert.equal(pullAllowsPush(PULL_BEFORE_PUSH.DONE), true);
  assert.equal(pullAllowsPush(PULL_BEFORE_PUSH.MISSING), true);
  assert.equal(pullAllowsPush(PULL_BEFORE_PUSH.PAUSED), false);
  assert.equal(pullAllowsPush(PULL_BEFORE_PUSH.FAILED), false);
  assert.equal(pullAllowsPush(undefined), false);
});

test('a row tied to a live marker that waits for a choice holds the push', () => {
  const markers = { m1: { id: 'm1' } };
  assert.equal(hasRowWaitingOnChoice([{ reason: 'conflict', markerId: 'm1' }], markers), true);
  assert.equal(hasRowWaitingOnChoice([{ reason: 'paste-above', markerId: 'm1' }], markers), true);
});

test('rows the app could not place and rows of deleted markers do not hold it', () => {
  const markers = { m1: { id: 'm1' } };
  assert.equal(hasRowWaitingOnChoice([
    { reason: 'unknown-rowid', markerId: null },
    { reason: 'malformed', markerId: null },
    { reason: 'unknown-rowid', markerId: 'gone' },
  ], markers), false);
  assert.equal(hasRowWaitingOnChoice(null, markers), false);
});

test('the version read before the pull: a OneDrive eTag or a local time and size', async () => {
  const onedrive = await readWorkbookVersion({ oneDriveFileId: 'item1', getDriveItem: async (id) => ({ id, eTag: '"{A},7"' }) });
  assert.equal(onedrive, 'etag:"{A},7"');
  assert.equal(uploadIfMatch(onedrive), '"{A},7"');

  const local = await readWorkbookVersion({ localPath: '/x.xlsx', getFileStats: async () => ({ isFile: true, mtimeMs: 1000, size: 42 }) });
  assert.equal(local, 'file:1000|42');
  assert.equal(uploadIfMatch(local), null);

  // Unreadable: no version, so the push goes ahead as it did before.
  assert.equal(await readWorkbookVersion({ oneDriveFileId: 'gone', getDriveItem: async () => null }), null);
  assert.equal(await readWorkbookVersion({ localPath: '/x', getFileStats: async () => { throw new Error('ENOENT'); } }), null);
  assert.equal(await readWorkbookVersion({ localPath: '/x' }), null);
  assert.equal(uploadIfMatch(null), null);
});

test('a save in Excel after the pull stops the push; no version means no check', () => {
  assert.equal(workbookChangedSincePull('file:1000|42', 'file:1000|42'), false);
  assert.equal(workbookChangedSincePull('file:1000|42', 'file:2000|43'), true);
  assert.equal(workbookChangedSincePull('etag:"{A},7"', null), true);
  assert.equal(workbookChangedSincePull(null, 'file:2000|43'), false);
});

test('Microsoft refusing an out-of-date If-Match reads as a version clash', () => {
  assert.equal(isVersionMismatch({ statusCode: 412 }), true);
  assert.equal(isVersionMismatch({ code: 'preconditionFailed' }), true);
  assert.equal(isVersionMismatch({ statusCode: 423, message: 'locked' }), false);
  assert.equal(isVersionMismatch(null), false);
});
