import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReleaseCommit } from '../scripts/write-release-marker.mjs';

test('release marker prefers Vercel exact commit over GitHub and local git', () => {
  assert.equal(resolveReleaseCommit({
    VERCEL_GIT_COMMIT_SHA: 'a'.repeat(40),
    GITHUB_SHA: 'b'.repeat(40),
  }), 'a'.repeat(40));
});

test('release marker accepts the exact GitHub commit outside Vercel', () => {
  assert.equal(resolveReleaseCommit({
    GITHUB_SHA: 'ABCDEF1234ABCDEF1234ABCDEF1234ABCDEF1234',
  }), 'abcdef1234abcdef1234abcdef1234abcdef1234');
});
